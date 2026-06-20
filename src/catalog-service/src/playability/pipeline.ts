import type { CatalogCore } from '../core.js';
import type { BrowsableRail } from '../rails.js';
import type { CandidateMeta } from './list-source.js';
import { PlayabilityBatchWriter } from './batch-writer.js';
import {
  playabilityBatchDbEnabled,
  playabilityEarlyExitMinDisplay,
  playabilityFailedRetryMsForReason,
  playabilityProbeConcurrency,
  playabilityResolveConcurrency,
  playabilityUseProbePool,
} from './config.js';
import {
  getRailPoolTitleKeys,
  getTitlesPlayabilityBulk,
  upsertRailPoolTitle,
  type PlayabilityRailStatus,
  type RailPoolEntry,
  type TitlePlayabilityRecord,
} from './db.js';
import { displaySnapshotFromCandidate } from './pool-display.js';
import { ensureProbePool, stopProbePool } from './mpv-probe-pool.js';
import {
  prepareVerifyTitle,
  verifyPreparedTitle,
  type PreparedVerifyTitleResult,
  type VerifyContext,
} from './verify.js';
import { effectivePoolTarget } from './pool-growth.js';

export type CandidateKey = string;

export type RailCandidateRef = {
  railId: string;
  index: number;
  candidate: CandidateMeta;
};

export type VerifyQueueItem = {
  key: CandidateKey;
  candidate: CandidateMeta;
  refs: RailCandidateRef[];
  forceReprobe: boolean;
};

type PreparedQueueItem = {
  queueId: number;
  item: VerifyQueueItem;
  prepared: PreparedVerifyTitleResult;
};

export function candidateKey(candidate: CandidateMeta): CandidateKey {
  return `${candidate.type}:${candidate.id}`;
}

export function isActiveVerifiedTitle(
  title: TitlePlayabilityRecord | undefined,
  now: number,
): boolean {
  if (!title || title.status !== 'verified') {
    return false;
  }
  return title.expires_at === null || title.expires_at > now;
}

export function shouldForceReprobeTitle(
  title: TitlePlayabilityRecord | undefined,
  staleKeys: Set<CandidateKey>,
  key: CandidateKey,
  _now: number,
): boolean {
  // Only titles explicitly marked stale are reprobed — never refresh-replace verified rows.
  return staleKeys.has(key);
}

export function valueAsString(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function scoreForCandidate(index: number, stream?: Record<string, unknown>): number {
  let score = 1_000_000 - index;
  const cacheStatus = valueAsString(stream?.cache_status);
  const debridService = valueAsString(stream?.debrid_service);
  const quality = valueAsString(stream?.quality);

  if (cacheStatus === 'cached') score += 10_000;
  else if (cacheStatus === 'unknown') score += 1_000;

  if (debridService === 'torbox') score += 500;
  else if (debridService === 'realdebrid') score += 250;

  if (quality === '1080p') score += 100;
  else if (quality === '720p') score += 50;

  return score;
}

export function uniqueCandidates(candidates: CandidateMeta[]): CandidateMeta[] {
  const seen = new Set<string>();
  const unique: CandidateMeta[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

async function queuePoolLink(
  railId: string,
  candidate: CandidateMeta,
  index: number,
  stream: Record<string, unknown> | undefined,
  context: VerifyContext,
): Promise<void> {
  const entry: RailPoolEntry = {
    rail_id: railId,
    type: candidate.type,
    id: candidate.id,
    score: scoreForCandidate(index, stream),
    ...displaySnapshotFromCandidate(candidate),
  };
  if (context.batchWriter) {
    context.batchWriter.queuePool(entry);
    return;
  }
  await upsertRailPoolTitle(entry);
}

export type ProcessVerifyQueueResult = {
  verified: number;
  failed: number;
  linked_existing: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: 'linked_existing' | 'verified' | 'failed' | 'skipped_existing' | 'skipped_recent_failed' | 'reverified';
    reason?: string;
    rails?: string[];
  }>;
};

export type ProcessVerifyQueueOptions = {
  core: CatalogCore;
  queue: VerifyQueueItem[];
  railVerifiedCounts: Map<string, number>;
  railPoolTargets: Map<string, number>;
  railMinDisplays?: Map<string, number>;
  railPoolKeys: Map<string, Set<string>>;
  earlyExitMinDisplay?: boolean;
  context?: VerifyContext;
};

export async function processVerifyQueue(
  options: ProcessVerifyQueueOptions,
): Promise<ProcessVerifyQueueResult> {
  const {
    core,
    queue,
    railVerifiedCounts,
    railPoolTargets,
    railMinDisplays,
    railPoolKeys,
    earlyExitMinDisplay = playabilityEarlyExitMinDisplay(),
    context = {},
  } = options;

  const results: ProcessVerifyQueueResult['results'] = [];
  let verified = 0;
  let failed = 0;
  let earlyStopped = false;

  const resolveConcurrency = playabilityResolveConcurrency();
  const probeConcurrency = playabilityProbeConcurrency();
  let nextVerifyIndex = 0;
  let nextQueueId = 0;
  const prepareInFlight = new Map<number, Promise<PreparedQueueItem>>();
  const pendingProbes: PreparedQueueItem[] = [];
  const activeProbes = new Set<Promise<void>>();

  const allRailsMeetMinDisplay = (): boolean => {
    if (!earlyExitMinDisplay || !railMinDisplays || railMinDisplays.size === 0) {
      return false;
    }
    for (const [railId, minDisplay] of railMinDisplays) {
      if ((railVerifiedCounts.get(railId) ?? 0) < minDisplay) {
        return false;
      }
    }
    return true;
  };

  const maybeStopEarly = (): void => {
    if (allRailsMeetMinDisplay()) {
      earlyStopped = true;
      pendingProbes.length = 0;
    }
  };

  const railStillNeeds = (railId: string): boolean => {
    const target = railPoolTargets.get(railId) ?? 0;
    const current = railVerifiedCounts.get(railId) ?? 0;
    return current < target;
  };

  const anyRailStillNeeds = (item: VerifyQueueItem): boolean => (
    item.refs.some((ref) => railStillNeeds(ref.railId))
  );

  const applyVerifyResult = async (prepared: PreparedQueueItem): Promise<void> => {
    const { item } = prepared;
    const eligibleRefs = item.refs.filter((ref) => item.forceReprobe || railStillNeeds(ref.railId));
    if (eligibleRefs.length === 0) {
      return;
    }

    const primaryRailId = eligibleRefs[0]?.railId ?? null;
    const result = await verifyPreparedTitle(
      prepared.prepared,
      { railId: primaryRailId, forceReprobe: item.forceReprobe },
      context,
    );

    if (result.ok) {
      for (const ref of eligibleRefs) {
        const keys = railPoolKeys.get(ref.railId) ?? new Set<string>();
        await queuePoolLink(ref.railId, ref.candidate, ref.index, result.stream, context);
        if (!keys.has(item.key)) {
          keys.add(item.key);
          railPoolKeys.set(ref.railId, keys);
          railVerifiedCounts.set(ref.railId, (railVerifiedCounts.get(ref.railId) ?? 0) + 1);
        }
      }
      verified += 1;
      results.push({
        type: item.candidate.type,
        id: item.candidate.id,
        title: item.candidate.title,
        action: item.forceReprobe ? 'reverified' : 'verified',
        rails: eligibleRefs.map((ref) => ref.railId),
      });
      maybeStopEarly();
    } else if (result.status === 'verified') {
      results.push({
        type: item.candidate.type,
        id: item.candidate.id,
        title: item.candidate.title,
        action: 'skipped_existing',
        rails: eligibleRefs.map((ref) => ref.railId),
      });
    } else if (result.status === 'stale') {
      results.push({
        type: item.candidate.type,
        id: item.candidate.id,
        title: item.candidate.title,
        action: 'failed',
        reason: result.reason,
        rails: eligibleRefs.map((ref) => ref.railId),
      });
    } else {
      failed += 1;
      results.push({
        type: item.candidate.type,
        id: item.candidate.id,
        title: item.candidate.title,
        action: 'failed',
        reason: result.reason,
        rails: eligibleRefs.map((ref) => ref.railId),
      });
    }
  };

  const scheduleProbes = () => {
    if (earlyStopped) {
      return;
    }
    while (activeProbes.size < probeConcurrency && pendingProbes.length > 0) {
      const prepared = pendingProbes.shift();
      if (!prepared) break;
      const task = applyVerifyResult(prepared).finally(() => {
        activeProbes.delete(task);
        scheduleProbes();
      });
      activeProbes.add(task);
    }
  };

  const enqueueProbe = (prepared: PreparedQueueItem) => {
    if (earlyStopped) {
      return;
    }
    pendingProbes.push(prepared);
    scheduleProbes();
  };

  const fillPrepareQueue = () => {
    if (earlyStopped) {
      return;
    }
    while (
      prepareInFlight.size < resolveConcurrency
      && nextVerifyIndex < queue.length
    ) {
      const item = queue[nextVerifyIndex];
      nextVerifyIndex += 1;
      if (!item.forceReprobe && !anyRailStillNeeds(item)) {
        continue;
      }
      const queueId = nextQueueId;
      nextQueueId += 1;
      prepareInFlight.set(queueId, prepareQueueItem(queueId, item, core));
    }
  };

  fillPrepareQueue();
  while (!earlyStopped && (prepareInFlight.size > 0 || pendingProbes.length > 0 || activeProbes.size > 0)) {
    if (prepareInFlight.size > 0) {
      const prepared = await Promise.race(prepareInFlight.values());
      prepareInFlight.delete(prepared.queueId);
      enqueueProbe(prepared);
      fillPrepareQueue();
      continue;
    }
    if (activeProbes.size > 0) {
      await Promise.race(activeProbes);
    }
  }

  return {
    verified,
    failed,
    linked_existing: 0,
    skipped_existing: 0,
    skipped_recent_failed: 0,
    results,
  };
}

async function prepareQueueItem(
  queueId: number,
  item: VerifyQueueItem,
  core: CatalogCore,
): Promise<PreparedQueueItem> {
  return {
    queueId,
    item,
    prepared: await prepareVerifyTitle(core, item.candidate.type, item.candidate.id),
  };
}

export type BuildVerifyQueueOptions = {
  refsByKey: Map<CandidateKey, RailCandidateRef[]>;
  titleStatuses: Map<CandidateKey, TitlePlayabilityRecord>;
  railVerifiedCounts: Map<string, number>;
  railPoolTargets: Map<string, number>;
  railPoolKeys: Map<string, Set<string>>;
  staleKeys?: Set<CandidateKey>;
  refreshMode?: 'full' | 'stale';
  now?: number;
  context?: VerifyContext;
};

export async function linkExistingVerifiedCandidates(
  options: BuildVerifyQueueOptions,
): Promise<{
  verifyQueue: VerifyQueueItem[];
  linked_existing: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  results: ProcessVerifyQueueResult['results'];
}> {
  const {
    refsByKey,
    titleStatuses,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    staleKeys = new Set(),
    refreshMode = 'stale',
    now = Date.now(),
    context = {},
  } = options;

  const verifyQueue: VerifyQueueItem[] = [];
  const results: ProcessVerifyQueueResult['results'] = [];
  let linkedExisting = 0;
  let skippedExisting = 0;
  let skippedRecentFailed = 0;

  for (const [key, refs] of refsByKey.entries()) {
    const candidate = refs[0]?.candidate;
    if (!candidate) continue;

    const title = titleStatuses.get(key);
    const forceReprobe = shouldForceReprobeTitle(title, staleKeys, key, now);

    if (!forceReprobe && isActiveVerifiedTitle(title, now)) {
      for (const ref of refs) {
        const target = railPoolTargets.get(ref.railId) ?? 0;
        const current = railVerifiedCounts.get(ref.railId) ?? 0;
        if (current >= target) {
          continue;
        }
        const keys = railPoolKeys.get(ref.railId) ?? new Set<string>();
        await queuePoolLink(ref.railId, candidate, ref.index, undefined, context);
        if (keys.has(key)) {
          skippedExisting += 1;
          results.push({
            type: candidate.type,
            id: candidate.id,
            title: candidate.title,
            action: 'skipped_existing',
            rails: [ref.railId],
          });
        } else {
          keys.add(key);
          railPoolKeys.set(ref.railId, keys);
          railVerifiedCounts.set(ref.railId, current + 1);
          linkedExisting += 1;
          results.push({
            type: candidate.type,
            id: candidate.id,
            title: candidate.title,
            action: 'linked_existing',
            rails: [ref.railId],
          });
        }
      }
      // Valid verified titles must never be re-probed just because a rail is below pool_target.
      continue;
    }

    if (
      !forceReprobe
      && title?.status === 'failed'
      && title.updated_at > now - playabilityFailedRetryMsForReason(title.fail_reason)
    ) {
      skippedRecentFailed += 1;
      results.push({
        type: candidate.type,
        id: candidate.id,
        title: candidate.title,
        action: 'skipped_recent_failed',
        rails: refs.map((ref) => ref.railId),
      });
      continue;
    }

    if (refs.some((ref) => forceReprobe || (railVerifiedCounts.get(ref.railId) ?? 0) < (railPoolTargets.get(ref.railId) ?? 0))) {
      verifyQueue.push({
        key,
        candidate,
        refs,
        forceReprobe,
      });
    }
  }

  return {
    verifyQueue,
    linked_existing: linkedExisting,
    skipped_existing: skippedExisting,
    skipped_recent_failed: skippedRecentFailed,
    results,
  };
}

export async function createVerifyContext(): Promise<VerifyContext> {
  const usePool = playabilityUseProbePool();
  if (usePool) {
    await ensureProbePool();
  }
  return {
    batchWriter: playabilityBatchDbEnabled() ? new PlayabilityBatchWriter() : null,
    useProbePool: usePool,
  };
}

export async function finalizeVerifyContext(context: VerifyContext): Promise<{ verify_count: number; pool_count: number }> {
  let flushed = { verify_count: 0, pool_count: 0 };
  if (context.batchWriter) {
    flushed = await context.batchWriter.flush();
  }
  if (context.useProbePool ?? playabilityUseProbePool()) {
    await stopProbePool();
  }
  return flushed;
}

export function railMapsFromRails(
  rails: BrowsableRail[],
  statuses: PlayabilityRailStatus[],
  options?: { poolTargetOverride?: number; bootstrap?: boolean },
): {
  railVerifiedCounts: Map<string, number>;
  railPoolTargets: Map<string, number>;
  railMinDisplays: Map<string, number>;
} {
  const railVerifiedCounts = new Map<string, number>();
  const railPoolTargets = new Map<string, number>();
  const railMinDisplays = new Map<string, number>();
  for (const rail of rails) {
    const status = statuses.find((entry) => entry.rail_id === rail.id);
    railVerifiedCounts.set(rail.id, status?.verified_pool ?? 0);
    railMinDisplays.set(rail.id, rail.playability.min_display);
    if (options?.poolTargetOverride !== undefined) {
      railPoolTargets.set(rail.id, options.poolTargetOverride);
    } else {
      railPoolTargets.set(
        rail.id,
        effectivePoolTarget(rail.playability, status?.verified_pool ?? 0, {
          bootstrap: options?.bootstrap,
        }),
      );
    }
  }
  return { railVerifiedCounts, railPoolTargets, railMinDisplays };
}
