import type { CatalogCore } from '../core.js';
import {
  getRailIngestOffsetsBulk,
  getRailPlayabilityStatus,
  getRailPoolTitleKeys,
  getTitlesPlayabilityBulk,
  pruneNonPlayableFromRailPools,
  setRailIngestOffset,
  type PlayabilityRailStatus,
} from './db.js';
import {
  ingestPaginatedCandidates,
  type IngestCandidatesStats,
} from './candidate-ingest.js';
import {
  candidateKey,
  createVerifyContext,
  finalizeVerifyContext,
  linkExistingVerifiedCandidates,
  processVerifyQueue,
  railMapsFromRails,
  type RailCandidateRef,
} from './pipeline.js';
import {
  isPlayabilityGrowthMode,
  playabilityFreshPerRail,
  playabilityIngestPageSize,
  playabilityMaxIngestScan,
} from './config.js';
import { effectivePoolTarget } from './pool-growth.js';
import { growRail, type GrowRailOptions } from './grow-rail.js';
import { applyAiCatalogTopUpHints, clearAppliedTopUpHints } from '../ai-catalogs/hints.js';
import type { BrowsableRail } from '../rails.js';

export type TopUpRailResult = {
  rail_id: string;
  label: string;
  ok: boolean;
  candidate_limit: number;
  pool_target: number;
  grow_target?: number;
  probe_verified?: number;
  grow_target_met?: boolean;
  /** @deprecated Use grow_target */
  growth_quota?: number;
  /** @deprecated Use probe_verified */
  verified_added?: number;
  /** @deprecated Use grow_target_met */
  growth_quota_met?: boolean;
  min_display: number;
  before: PlayabilityRailStatus;
  after: PlayabilityRailStatus;
  candidates_seen: number;
  linked_existing: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  exhausted: boolean;
  grow_loops?: number;
  attempts?: number;
  ingest?: IngestCandidatesStats;
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: 'linked_existing' | 'verified' | 'failed' | 'skipped_existing' | 'skipped_recent_failed' | 'reverified';
    reason?: string;
    rails?: string[];
  }>;
};

export type TopUpRailMode = 'incremental' | 'grow' | 'full' | 'growth';

export type TopUpRailOptions = GrowRailOptions & {
  poolTarget?: number;
  candidateLimit?: number;
  mode?: TopUpRailMode;
};

function resolveTopUpMode(options: TopUpRailOptions): 'incremental' | 'grow' {
  if (options.mode === 'incremental') {
    return 'incremental';
  }
  if (options.mode === 'grow' || options.mode === 'full' || options.mode === 'growth') {
    return 'grow';
  }
  if (isPlayabilityGrowthMode()) {
    return 'grow';
  }
  return 'incremental';
}

function growResultToTopUp(result: Awaited<ReturnType<typeof growRail>>): TopUpRailResult {
  return {
    rail_id: result.rail_id,
    label: result.label,
    ok: result.ok,
    candidate_limit: result.candidate_limit,
    pool_target: result.pool_target,
    grow_target: result.grow_target,
    probe_verified: result.probe_verified,
    grow_target_met: result.grow_target_met,
    growth_quota: result.growth_quota,
    verified_added: result.verified_added,
    growth_quota_met: result.growth_quota_met,
    min_display: result.min_display,
    before: result.before,
    after: result.after,
    candidates_seen: result.candidates_seen,
    linked_existing: result.linked_existing,
    verified: result.verified,
    failed: result.failed,
    skipped_existing: result.skipped_existing,
    skipped_recent_failed: result.skipped_recent_failed,
    exhausted: result.exhausted,
    grow_loops: result.grow_loops,
    attempts: result.attempts,
    ingest: result.ingest,
    results: result.results,
  };
}

async function topUpRailIncremental(
  core: CatalogCore,
  railId: string,
  options: TopUpRailOptions = {},
): Promise<TopUpRailResult> {
  const rail = core.browsableRail(railId);
  if (rail.type === 'ai_catalog') {
    await applyAiCatalogTopUpHints(rail);
    await core.reloadAiCatalogRails();
  }
  const source = core.listSourceForRail(railId);
  const before = await getRailPlayabilityStatus(rail.id);
  const poolTarget = options.poolTarget ?? effectivePoolTarget(rail.playability, before.verified_pool);
  const freshTarget = options.candidateLimit ?? playabilityFreshPerRail();

  if (before.verified_pool >= poolTarget) {
    return {
      rail_id: rail.id,
      label: rail.label,
      ok: before.verified_pool >= rail.playability.min_display,
      candidate_limit: freshTarget,
      pool_target: poolTarget,
      min_display: rail.playability.min_display,
      before,
      after: before,
      candidates_seen: 0,
      linked_existing: 0,
      verified: 0,
      failed: 0,
      skipped_existing: 0,
      skipped_recent_failed: 0,
      exhausted: false,
      results: [],
    };
  }

  const ingestOffsets = await getRailIngestOffsetsBulk([rail.id]);
  const ingested = await ingestPaginatedCandidates(source, {
    startOffset: ingestOffsets.get(rail.id) ?? 0,
    freshTarget,
    pageSize: playabilityIngestPageSize(),
    maxScanned: playabilityMaxIngestScan(),
    lookupTitles: getTitlesPlayabilityBulk,
  });
  await setRailIngestOffset(rail.id, ingested.next_offset);
  const candidates = ingested.candidates;
  const refsByKey = new Map<string, RailCandidateRef[]>();
  for (const [index, candidate] of candidates.entries()) {
    const key = candidateKey(candidate);
    refsByKey.set(key, [{ railId: rail.id, index, candidate }]);
  }

  const titleStatuses = await getTitlesPlayabilityBulk(candidates.map((candidate) => ({
    type: candidate.type,
    id: candidate.id,
  })));

  const railPoolKeys = new Map<string, Set<string>>([
    [rail.id, await getRailPoolTitleKeys(rail.id)],
  ]);
  const { railVerifiedCounts, railPoolTargets } = railMapsFromRails(
    [rail as BrowsableRail],
    [before],
    { poolTargetOverride: poolTarget },
  );

  const context = await createVerifyContext();
  const linked = await linkExistingVerifiedCandidates({
    refsByKey,
    titleStatuses,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    refreshMode: 'full',
    context,
  });
  const processed = await processVerifyQueue({
    core,
    queue: linked.verifyQueue,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    context,
  });
  await finalizeVerifyContext(context);
  await pruneNonPlayableFromRailPools();

  if (rail.type === 'ai_catalog') {
    await clearAppliedTopUpHints(rail.id);
    await core.reloadAiCatalogRails();
  }

  const after = await getRailPlayabilityStatus(rail.id);
  return {
    rail_id: rail.id,
    label: rail.label,
    ok: after.verified_pool >= rail.playability.min_display,
    candidate_limit: freshTarget,
    pool_target: poolTarget,
    min_display: rail.playability.min_display,
    before,
    after,
    candidates_seen: ingested.scanned,
    linked_existing: linked.linked_existing,
    verified: processed.verified,
    failed: processed.failed,
    skipped_existing: linked.skipped_existing,
    skipped_recent_failed: linked.skipped_recent_failed,
    exhausted: after.verified_pool < poolTarget && Boolean(ingested.catalog_exhausted),
    ingest: ingested,
    results: [...linked.results, ...processed.results],
  };
}

export async function topUpRail(
  core: CatalogCore,
  railId: string,
  options: TopUpRailOptions = {},
): Promise<TopUpRailResult> {
  if (resolveTopUpMode(options) === 'grow') {
    return growResultToTopUp(await growRail(core, railId, options));
  }
  return topUpRailIncremental(core, railId, options);
}
