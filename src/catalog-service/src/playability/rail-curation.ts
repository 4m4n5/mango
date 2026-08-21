import { CatalogCore } from '../core.js';
import { metahubPosterUrl } from '../poster.js';
import {
  clearRailSessions,
  deleteRailPoolTitle,
  listRailIdsContainingTitle,
  upsertRailPoolTitle,
} from './db.js';
import {
  invalidateRailCurationCache,
  loadRailCurationOverrides,
  type RailCurationOverrides,
  type RailCurationPin,
} from './rail-overrides.js';
import { expandPlayLadder } from '../play-ladder.js';
import { prepareVerifyTitle, verifyPreparedTitle } from './verify.js';

export type ApplyRailCurationResult = {
  pins_applied: number;
  pins_failed: number;
  blocks_removed: number;
  sessions_cleared: string[];
  details: string[];
};

async function verifyPin(
  core: CatalogCore,
  pin: RailCurationPin,
): Promise<{ ok: boolean; detail: string }> {
  const prepared = await prepareVerifyTitle(core, pin.type, pin.id);
  if (!prepared.ok) {
    return {
      ok: false,
      detail: `${pin.rail_id} ${pin.type}/${pin.id}: prepare failed (${prepared.reason})`,
    };
  }
  const verified = await verifyPreparedTitle(
    prepared,
    { railId: pin.rail_id, preserveVerified: true },
  );
  if (!verified.ok && pin.verify_probe) {
    return {
      ok: false,
      detail: `${pin.rail_id} ${pin.type}/${pin.id}: verify failed (${verified.reason ?? 'probe'})`,
    };
  }
  if (!verified.ok && !pin.verify_probe) {
    const streamCount = expandPlayLadder(
      prepared.resolved.streams,
      prepared.resolved.filters.play_ladder,
      prepared.resolved.filterContext,
      {
        strict_unknown_cache: prepared.resolved.filters.strict_unknown_cache,
        preferred_quality: prepared.resolved.filters.preferred_quality,
        preferred_hdr_tags: prepared.resolved.filters.preferred_hdr_tags,
        preferred_video_codecs: prepared.resolved.filters.preferred_video_codecs,
        max_candidates: prepared.resolved.filters.auto_play_max_attempts,
      },
    ).length;
    if (streamCount === 0) {
      return {
        ok: false,
        detail: `${pin.rail_id} ${pin.type}/${pin.id}: no stream candidates`,
      };
    }
  }
  await upsertRailPoolTitle({
    rail_id: pin.rail_id,
    type: pin.type,
    id: pin.id,
    score: pin.score,
    title: pin.label?.trim() || undefined,
    poster_url: metahubPosterUrl(pin.id) ?? undefined,
  });
  return {
    ok: true,
    detail: `${pin.rail_id} pinned ${pin.type}/${pin.id} score=${pin.score}`,
  };
}

export async function applyRailCuration(
  core: CatalogCore,
  overrides?: RailCurationOverrides,
): Promise<ApplyRailCurationResult> {
  invalidateRailCurationCache();
  const config = overrides ?? await loadRailCurationOverrides();
  const details: string[] = [];
  let pinsApplied = 0;
  let pinsFailed = 0;
  let blocksRemoved = 0;
  const railsTouched = new Set<string>();

  for (const block of config.blocks) {
    if (block.rail_id) {
      await deleteRailPoolTitle(block.rail_id, block.type, block.id);
      blocksRemoved += 1;
      railsTouched.add(block.rail_id);
      details.push(`blocked ${block.rail_id} ${block.type}/${block.id}`);
      continue;
    }
    const railIds = await listRailIdsContainingTitle(block.type, block.id);
    for (const railId of railIds) {
      await deleteRailPoolTitle(railId, block.type, block.id);
      blocksRemoved += 1;
      railsTouched.add(railId);
    }
    details.push(`global block ${block.type}/${block.id} removed from ${railIds.length} rail(s)`);
  }

  for (const pin of config.pins) {
    railsTouched.add(pin.rail_id);
    const result = await verifyPin(core, pin);
    details.push(result.detail);
    if (result.ok) {
      pinsApplied += 1;
    } else {
      pinsFailed += 1;
    }
  }

  const sessionsCleared = [...railsTouched];
  await clearRailSessions(sessionsCleared);

  return {
    pins_applied: pinsApplied,
    pins_failed: pinsFailed,
    blocks_removed: blocksRemoved,
    sessions_cleared: sessionsCleared,
    details,
  };
}
