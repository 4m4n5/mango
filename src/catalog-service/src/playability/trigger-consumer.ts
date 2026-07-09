import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CatalogCore } from '../core.js';
import {
  triggerConsumerBatchLimit,
  triggerConsumerCooldownMs,
  triggerConsumerEnabled,
  triggerConsumerIdleSec,
} from './config.js';
import {
  listUnhandledPlayabilityTriggers,
  markPlayabilityTriggersHandled,
  sweepExpiredVerified,
  type PlayabilityTriggerRow,
} from './db.js';
import { verifyTitle } from './verify.js';
import { assignVerifiedTitleToBestRail } from './rail-pool-retheme.js';

export type DrainTriggersOptions = {
  limit?: number;
  now?: number;
  /** Injectable for tests — defaults to the real verify pipeline (prepare -> probe -> record). */
  verify?: typeof verifyTitle;
  /** Injectable for tests — defaults to the real rail-pool-retheme assignment. */
  promote?: typeof assignVerifiedTitleToBestRail;
};

export type DrainTriggersResult = {
  drained: number;
  verified: number;
  failed: number;
  promoted: number;
  by_trigger_type: Record<string, number>;
};

/**
 * H1: drains playability_triggers (handled_at IS NULL), probing + promoting title-bearing rows
 * (voice_request, play_failure_reverify, play_failure, stale) via the existing verify pipeline,
 * and simply marking rail-only signal rows (pool_low, display_low, config_change, scheduled)
 * handled since there is no single title to probe. Every drained row gets handled_at set —
 * success or failure — so the queue can never grow unbounded. Rows are pre-ordered by
 * listUnhandledPlayabilityTriggers so H2's play_failure_reverify fast-lane drains first.
 */
export async function drainTriggers(
  core: CatalogCore,
  options: DrainTriggersOptions = {},
): Promise<DrainTriggersResult> {
  const limit = Math.max(1, options.limit ?? triggerConsumerBatchLimit());
  const verify = options.verify ?? verifyTitle;
  const promote = options.promote ?? assignVerifiedTitleToBestRail;
  const rows = await listUnhandledPlayabilityTriggers(limit);

  const result: DrainTriggersResult = {
    drained: 0,
    verified: 0,
    failed: 0,
    promoted: 0,
    by_trigger_type: {},
  };
  if (rows.length === 0) {
    return result;
  }

  const countType = (row: PlayabilityTriggerRow): void => {
    result.by_trigger_type[row.trigger_type] = (result.by_trigger_type[row.trigger_type] ?? 0) + 1;
  };

  const byTitle = new Map<string, PlayabilityTriggerRow[]>();
  const rowsToHandleWithoutProbe: PlayabilityTriggerRow[] = [];
  for (const row of rows) {
    countType(row);
    if (!row.type || !row.id_value) {
      rowsToHandleWithoutProbe.push(row);
      continue;
    }
    const key = `${row.type}:${row.id_value}`;
    const group = byTitle.get(key) ?? [];
    group.push(row);
    byTitle.set(key, group);
  }

  const handledIds: number[] = rowsToHandleWithoutProbe.map((row) => row.id);

  for (const group of byTitle.values()) {
    const type = group[0].type as string;
    const id = group[0].id_value as string;
    const railId = group.find((row) => row.rail_id)?.rail_id ?? null;
    result.drained += 1;
    try {
      const verifyResult = await verify(core, type, id, { railId });
      if (verifyResult.status === 'verified') {
        result.verified += 1;
        try {
          await promote(core, { type, id, preferredRailId: railId });
          result.promoted += 1;
        } catch (assignError) {
          console.warn(
            `trigger-consumer: rail assign failed type=${type} id=${id}: ${
              assignError instanceof Error ? assignError.message : String(assignError)
            }`,
          );
        }
      } else {
        result.failed += 1;
      }
    } catch (verifyError) {
      result.failed += 1;
      console.warn(
        `trigger-consumer: verify failed type=${type} id=${id}: ${
          verifyError instanceof Error ? verifyError.message : String(verifyError)
        }`,
      );
    } finally {
      handledIds.push(...group.map((row) => row.id));
    }
  }

  if (handledIds.length > 0) {
    await markPlayabilityTriggersHandled(handledIds, options.now);
  }

  return result;
}

/**
 * Synchronous single-title drain for couch play recovery — does not require
 * MANGO_TRIGGER_CONSUMER. Verifies + promotes the title once.
 */
export async function drainTriggersForTitle(
  core: CatalogCore,
  options: {
    type: string;
    id: string;
    railId?: string | null;
    verify?: typeof verifyTitle;
    promote?: typeof assignVerifiedTitleToBestRail;
  },
): Promise<DrainTriggersResult> {
  const verify = options.verify ?? verifyTitle;
  const promote = options.promote ?? assignVerifiedTitleToBestRail;
  const result: DrainTriggersResult = {
    drained: 1,
    verified: 0,
    failed: 0,
    promoted: 0,
    by_trigger_type: { play_failure_reverify: 1 },
  };
  try {
    const verifyResult = await verify(core, options.type, options.id, {
      railId: options.railId ?? null,
      forceReprobe: true,
    });
    if (verifyResult.status === 'verified') {
      result.verified = 1;
      try {
        await promote(core, {
          type: options.type,
          id: options.id,
          preferredRailId: options.railId ?? null,
        });
        result.promoted = 1;
      } catch (assignError) {
        console.warn(
          `drainTriggersForTitle: rail assign failed type=${options.type} id=${options.id}: ${
            assignError instanceof Error ? assignError.message : String(assignError)
          }`,
        );
      }
    } else {
      result.failed = 1;
    }
  } catch (verifyError) {
    result.failed = 1;
    console.warn(
      `drainTriggersForTitle: verify failed type=${options.type} id=${options.id}: ${
        verifyError instanceof Error ? verifyError.message : String(verifyError)
      }`,
    );
  }
  return result;
}

function couchActivityStatePath(): string {
  return process.env.MANGO_COUCH_ACTIVITY_STATE
    || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'mango/couch-activity.json');
}

/**
 * Read-only mirror of scripts/lib/couch-activity.sh's is-idle check (that script and
 * couch-activity.ts own the state file; this only guards the background tick below).
 */
export function isCouchIdleForTriggerConsumer(now: number = Date.now()): boolean {
  if (process.env.MANGO_MAINTENANCE_IGNORE_COUCH_ACTIVITY === '1') {
    return true;
  }
  try {
    const raw = readFileSync(couchActivityStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as { ts?: number };
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
    const ageSec = (now - ts) / 1000;
    return ageSec >= triggerConsumerIdleSec();
  } catch {
    // No activity marker yet (fresh boot / no couch session recorded) — don't block forever.
    return true;
  }
}

let lastBackgroundTickAt = 0;
let backgroundTickInFlight = false;

/** Reset shared background-tick debounce state (tests only). */
export function resetTriggerConsumerBackgroundTickForTests(): void {
  lastBackgroundTickAt = 0;
  backgroundTickInFlight = false;
}

/**
 * H1(b): bounded, idle-gated, debounced background drain — off by default (MANGO_TRIGGER_CONSUMER=1).
 * Safe to call on every tick; internally no-ops unless enabled, off cooldown, and couch is idle.
 */
export function maybeRunTriggerConsumerBackgroundTick(core: CatalogCore): void {
  if (!triggerConsumerEnabled()) {
    return;
  }
  if (backgroundTickInFlight) {
    return;
  }
  const now = Date.now();
  if (now - lastBackgroundTickAt < triggerConsumerCooldownMs()) {
    return;
  }
  if (!isCouchIdleForTriggerConsumer(now)) {
    return;
  }
  lastBackgroundTickAt = now;
  backgroundTickInFlight = true;
  void (async () => {
    await sweepExpiredVerified(now);
    await drainTriggers(core, { limit: triggerConsumerBatchLimit(), now });
  })()
    .catch((error) => {
      console.warn(
        `trigger-consumer background tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      backgroundTickInFlight = false;
    });
}

/** Additive index.ts wiring point — starts the interval; every invocation is a cheap no-op unless enabled. */
export function startTriggerConsumerBackgroundTick(core: CatalogCore): void {
  if (!triggerConsumerEnabled()) {
    return;
  }
  const interval = setInterval(
    () => maybeRunTriggerConsumerBackgroundTick(core),
    Math.min(60_000, triggerConsumerCooldownMs()),
  );
  interval.unref?.();
}
