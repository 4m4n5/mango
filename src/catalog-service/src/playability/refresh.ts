import type { BrowsableRail } from '../rails.js';
import type { CatalogCore } from '../core.js';
import { applyAiCatalogTopUpHints, clearAppliedTopUpHints } from '../ai-catalogs/hints.js';
import {
  getPlayabilityStatus,
  getRailIngestOffsetsBulk,
  getRailPoolTitleKeysBulk,
  getStaleTitlesForRefresh,
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
  uniqueCandidates,
  type RailCandidateRef,
} from './pipeline.js';
import {
  playabilityBootstrapFill,
  playabilityEarlyExitMinDisplay,
  playabilityFreshPerRail,
  playabilityIngestPageSize,
  playabilityMaxIngestScan,
} from './config.js';
import {
  createGrowthPassState,
  effectiveCandidateLimit,
  effectiveGrowthAttemptBudget,
  effectivePoolTarget,
  type GrowthPassState,
} from './pool-growth.js';
import { growRail } from './grow-rail.js';
import { isGrowRefreshMode, resolveGrowPreset, type GrowPresetId } from './grow-target.js';

export type RefreshMode = 'full' | 'stale' | 'growth' | 'grow';

export type RefreshAllOptions = {
  mode?: RefreshMode;
  poolTarget?: number;
  candidateLimit?: number;
  bootstrap?: boolean;
  growPreset?: GrowPresetId;
  growWallMs?: number;
  growMaxAttempts?: number;
};

function allRailsMeetMinDisplay(
  railVerifiedCounts: Map<string, number>,
  railMinDisplays: Map<string, number>,
): boolean {
  for (const [railId, minDisplay] of railMinDisplays) {
    if ((railVerifiedCounts.get(railId) ?? 0) < minDisplay) {
      return false;
    }
  }
  return railMinDisplays.size > 0;
}

export type RefreshRailSummary = {
  rail_id: string;
  label: string;
  ok: boolean;
  before: PlayabilityRailStatus;
  after: PlayabilityRailStatus;
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
  grow_loops?: number;
  attempts?: number;
  min_display: number;
  candidates_seen: number;
  linked_existing: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  exhausted: boolean;
  ingest?: IngestCandidatesStats;
};

export type RefreshAllResult = {
  ok: boolean;
  mode: RefreshMode;
  bootstrap: boolean;
  started_at: number;
  finished_at: number;
  duration_ms: number;
  unique_candidates: number;
  verify_queue_size: number;
  linked_existing: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  batch_flush: { verify_count: number; pool_count: number };
  pruned_pool_entries: number;
  ingest_fresh_queued: number;
  ingest_scanned: number;
  rails: RefreshRailSummary[];
};

function railNeedsWork(
  mode: RefreshMode,
  status: PlayabilityRailStatus,
  poolTarget: number,
): boolean {
  if (mode === 'stale') {
    return status.stale > 0;
  }
  if (mode === 'growth') {
    return true;
  }
  // full = additive growth — ingest new candidates when below pool target only
  return status.verified_pool < poolTarget;
}

function usesPaginatedIngest(mode: RefreshMode): boolean {
  return mode === 'full' || mode === 'growth' || mode === 'grow';
}

function growResultToRailSummary(
  result: Awaited<ReturnType<typeof growRail>>,
): RefreshRailSummary {
  return {
    rail_id: result.rail_id,
    label: result.label,
    ok: result.ok,
    before: result.before,
    after: result.after,
    candidate_limit: result.candidate_limit,
    pool_target: result.pool_target,
    grow_target: result.grow_target,
    probe_verified: result.probe_verified,
    grow_target_met: result.grow_target_met,
    growth_quota: result.growth_quota,
    verified_added: result.verified_added,
    growth_quota_met: result.growth_quota_met,
    grow_loops: result.grow_loops,
    attempts: result.attempts,
    min_display: result.min_display,
    candidates_seen: result.candidates_seen,
    linked_existing: result.linked_existing,
    verified: result.verified,
    failed: result.failed,
    skipped_existing: result.skipped_existing,
    skipped_recent_failed: result.skipped_recent_failed,
    exhausted: result.exhausted,
    ingest: result.ingest,
  };
}

async function refreshAllRailsGrow(
  core: CatalogCore,
  options: RefreshAllOptions,
): Promise<RefreshAllResult> {
  const startedAt = Date.now();
  const mode = options.mode ?? 'grow';
  const preset = resolveGrowPreset(options.growPreset);
  const rails = core.browsableRails();
  const railSummaries: RefreshRailSummary[] = [];

  for (const rail of rails) {
    const growResult = await growRail(core, rail.id, {
      preset: options.growPreset,
      wallMs: options.growWallMs ?? preset.wall_ms,
      maxAttempts: options.growMaxAttempts ?? preset.max_attempts,
    });
    railSummaries.push(growResultToRailSummary(growResult));
  }

  const finishedAt = Date.now();
  const refreshResult: RefreshAllResult = {
    ok: railSummaries.every((rail) => rail.ok),
    mode,
    bootstrap: false,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt - startedAt,
    unique_candidates: railSummaries.reduce((sum, rail) => sum + rail.candidates_seen, 0),
    verify_queue_size: 0,
    linked_existing: railSummaries.reduce((sum, rail) => sum + rail.linked_existing, 0),
    verified: railSummaries.reduce((sum, rail) => sum + rail.verified, 0),
    failed: railSummaries.reduce((sum, rail) => sum + rail.failed, 0),
    skipped_existing: railSummaries.reduce((sum, rail) => sum + rail.skipped_existing, 0),
    skipped_recent_failed: railSummaries.reduce((sum, rail) => sum + rail.skipped_recent_failed, 0),
    batch_flush: { verify_count: 0, pool_count: 0 },
    pruned_pool_entries: 0,
    ingest_fresh_queued: railSummaries.reduce(
      (sum, rail) => sum + (rail.ingest?.fresh_queued ?? 0),
      0,
    ),
    ingest_scanned: railSummaries.reduce((sum, rail) => sum + rail.candidates_seen, 0),
    rails: railSummaries,
  };

  if (process.env.MANGO_OPS_LOG_REFRESH !== '0') {
    const { recordRefreshOps } = await import('../ops/record.js');
    recordRefreshOps(
      refreshResult,
      process.env.MANGO_OPS_SOURCE ?? 'refresh',
      process.env.MANGO_OPS_RUN_ID,
    );
  }

  return refreshResult;
}

export async function refreshAllRails(
  core: CatalogCore,
  options: RefreshAllOptions = {},
): Promise<RefreshAllResult> {
  const mode = options.mode ?? 'stale';
  const bootstrap = options.bootstrap ?? playabilityBootstrapFill();
  if (isGrowRefreshMode(mode, bootstrap)) {
    return refreshAllRailsGrow(core, options);
  }

  const startedAt = Date.now();
  const rails = core.browsableRails();
  const railIds = rails.map((rail) => rail.id);
  const status = await getPlayabilityStatus(railIds);
  const { railVerifiedCounts, railPoolTargets, railMinDisplays } = railMapsFromRails(
    rails as BrowsableRail[],
    status.rails,
    { poolTargetOverride: options.poolTarget, bootstrap },
  );
  const railPoolKeys = await getRailPoolTitleKeysBulk(railIds);
  const beforeByRail = new Map(status.rails.map((rail) => [rail.rail_id, rail]));

  const growthPass: GrowthPassState | undefined = mode === 'growth'
    ? createGrowthPassState(rails as BrowsableRail[])
    : undefined;
  const refsByKey = new Map<string, RailCandidateRef[]>();
  const candidatesSeenByRail = new Map<string, number>();
  const ingestStatsByRail = new Map<string, IngestCandidatesStats>();
  const railsToFetch = rails.filter((rail) => {
    const verified = beforeByRail.get(rail.id)?.verified_pool ?? 0;
    const poolTarget = options.poolTarget
      ?? effectivePoolTarget(rail.playability, verified, { bootstrap });
    railPoolTargets.set(rail.id, poolTarget);
    const before = beforeByRail.get(rail.id) ?? {
      rail_id: rail.id,
      pool_depth: 0,
      verified_pool: 0,
      pending: 0,
      stale: 0,
      failed: 0,
      last_verified_at: null,
    };
    return railNeedsWork(mode, before, poolTarget);
  });

  const freshPerRail = playabilityFreshPerRail();
  const ingestOffsets = usesPaginatedIngest(mode)
    ? await getRailIngestOffsetsBulk(railsToFetch.map((rail) => rail.id))
    : new Map<string, number>();

  await Promise.all(railsToFetch.map(async (rail) => {
    if (rail.type === 'ai_catalog') {
      await applyAiCatalogTopUpHints(rail);
    }
    const source = core.listSourceForRail(rail.id);
    const verified = railVerifiedCounts.get(rail.id) ?? 0;
    const poolTarget = railPoolTargets.get(rail.id) ?? rail.playability.pool_target;
    let candidates;

    if (usesPaginatedIngest(mode)) {
      const freshTarget = mode === 'growth'
        ? effectiveGrowthAttemptBudget(rail.playability)
        : freshPerRail;
      const ingested = await ingestPaginatedCandidates(source, {
        startOffset: ingestOffsets.get(rail.id) ?? 0,
        freshTarget,
        pageSize: playabilityIngestPageSize(),
        maxScanned: playabilityMaxIngestScan(),
        lookupTitles: getTitlesPlayabilityBulk,
      });
      await setRailIngestOffset(rail.id, ingested.next_offset);
      ingestStatsByRail.set(rail.id, ingested);
      candidates = ingested.candidates;
      candidatesSeenByRail.set(rail.id, ingested.scanned);
    } else {
      const candidateLimit = options.candidateLimit
        ?? effectiveCandidateLimit(
          rail.limit,
          rail.playability.ingest_multiplier,
          verified,
          poolTarget,
        );
      candidates = uniqueCandidates(await source.candidates({ offset: 0, limit: candidateLimit }));
      candidatesSeenByRail.set(rail.id, candidates.length);
    }

    for (const [index, candidate] of candidates.entries()) {
      const key = candidateKey(candidate);
      const refs = refsByKey.get(key) ?? [];
      refs.push({ railId: rail.id, index, candidate });
      refsByKey.set(key, refs);
    }
  }));

  const staleTitles = mode === 'stale' ? await getStaleTitlesForRefresh() : [];
  const staleKeys = new Set(staleTitles.map((title) => candidateKey(title)));
  for (const title of staleTitles) {
    const key = candidateKey(title);
    if (!refsByKey.has(key)) {
      refsByKey.set(key, [{
        railId: title.rail_id ?? railIds[0] ?? 'unknown',
        index: 0,
        candidate: { id: title.id, type: title.type, source: 'stale_pool' },
      }]);
    }
  }

  const titleStatuses = await getTitlesPlayabilityBulk(
    [...refsByKey.values()].flatMap((refs) => refs.map((ref) => ({
      type: ref.candidate.type,
      id: ref.candidate.id,
    }))),
  );

  const context = await createVerifyContext();
  const linked = await linkExistingVerifiedCandidates({
    refsByKey,
    titleStatuses,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    staleKeys,
    refreshMode: mode,
    growthPass,
    context,
  });

  let processed = {
    verified: 0,
    failed: 0,
    linked_existing: 0,
    skipped_existing: 0,
    skipped_recent_failed: 0,
    results: [] as Awaited<ReturnType<typeof processVerifyQueue>>['results'],
  };

  const skipVerifyQueue = mode !== 'stale'
    && mode !== 'growth'
    && playabilityEarlyExitMinDisplay()
    && allRailsMeetMinDisplay(railVerifiedCounts, railMinDisplays);

  if (!skipVerifyQueue) {
    processed = await processVerifyQueue({
      core,
      queue: linked.verifyQueue,
      railVerifiedCounts,
      railPoolTargets,
      railMinDisplays,
      railPoolKeys,
      earlyExitMinDisplay: mode === 'growth' ? false : playabilityEarlyExitMinDisplay(),
      growthPass,
      context,
    });
  }

  const batchFlush = await finalizeVerifyContext(context);
  const prunedPoolEntries = await pruneNonPlayableFromRailPools();
  for (const rail of railsToFetch) {
    if (rail.type === 'ai_catalog') {
      await clearAppliedTopUpHints(rail.id);
    }
  }
  await core.reloadAiCatalogRails();
  const finishedAt = Date.now();
  const afterStatus = await getPlayabilityStatus(railIds);
  const afterByRail = new Map(afterStatus.rails.map((rail) => [rail.rail_id, rail]));

  const railSummaries: RefreshRailSummary[] = [];
  for (const rail of rails) {
    const before = beforeByRail.get(rail.id) ?? {
      rail_id: rail.id,
      pool_depth: 0,
      verified_pool: 0,
      pending: 0,
      stale: 0,
      failed: 0,
      last_verified_at: null,
    };
    const after = afterByRail.get(rail.id) ?? {
      rail_id: rail.id,
      pool_depth: 0,
      verified_pool: 0,
      pending: 0,
      stale: 0,
      failed: 0,
      last_verified_at: null,
    };
    const verified = before.verified_pool;
    const poolTarget = railPoolTargets.get(rail.id)
      ?? effectivePoolTarget(rail.playability, verified, { bootstrap });
    const railResults = [...linked.results, ...processed.results].filter((result) => (
      result.rails?.includes(rail.id)
    ));
    const verifiedAdded = growthPass
      ? (growthPass.verifiedAddedThisPass.get(rail.id) ?? 0)
      : railResults.filter((result) => result.action === 'verified' || result.action === 'reverified').length;
    const growthQuota = growthPass?.quotas.get(rail.id);
    const ingestStats = ingestStatsByRail.get(rail.id);
    railSummaries.push({
      rail_id: rail.id,
      label: rail.label,
      ok: after.verified_pool >= rail.playability.min_display,
      before,
      after,
      candidate_limit: mode === 'growth'
        ? effectiveGrowthAttemptBudget(rail.playability)
        : (options.candidateLimit
          ?? effectiveCandidateLimit(
            rail.limit,
            rail.playability.ingest_multiplier,
            verified,
            poolTarget,
          )),
      pool_target: poolTarget,
      growth_quota: growthQuota,
      verified_added: verifiedAdded,
      growth_quota_met: growthQuota !== undefined ? verifiedAdded >= growthQuota : undefined,
      min_display: rail.playability.min_display,
      candidates_seen: candidatesSeenByRail.get(rail.id) ?? 0,
      linked_existing: railResults.filter((result) => result.action === 'linked_existing').length,
      verified: railResults.filter((result) => result.action === 'verified' || result.action === 'reverified').length,
      failed: railResults.filter((result) => result.action === 'failed').length,
      skipped_existing: railResults.filter((result) => result.action === 'skipped_existing').length,
      skipped_recent_failed: railResults.filter((result) => result.action === 'skipped_recent_failed').length,
      exhausted: mode === 'growth'
        ? (growthQuota !== undefined
          && verifiedAdded < growthQuota
          && Boolean(ingestStats?.catalog_exhausted))
        : after.verified_pool < poolTarget,
      ingest: ingestStats,
    });
  }

  const ingestFreshQueued = [...ingestStatsByRail.values()].reduce(
    (sum, stats) => sum + stats.fresh_queued,
    0,
  );
  const ingestScanned = [...ingestStatsByRail.values()].reduce(
    (sum, stats) => sum + stats.scanned,
    0,
  );

  const refreshResult = {
    ok: railSummaries.every((rail) => rail.ok),
    mode,
    bootstrap,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt - startedAt,
    unique_candidates: refsByKey.size,
    verify_queue_size: linked.verifyQueue.length,
    linked_existing: linked.linked_existing,
    verified: processed.verified,
    failed: processed.failed,
    skipped_existing: linked.skipped_existing,
    skipped_recent_failed: linked.skipped_recent_failed,
    batch_flush: batchFlush,
    pruned_pool_entries: prunedPoolEntries,
    ingest_fresh_queued: ingestFreshQueued,
    ingest_scanned: ingestScanned,
    rails: railSummaries,
  };

  if (process.env.MANGO_OPS_LOG_REFRESH !== '0') {
    const { recordRefreshOps } = await import('../ops/record.js');
    recordRefreshOps(
      refreshResult,
      process.env.MANGO_OPS_SOURCE ?? 'refresh',
      process.env.MANGO_OPS_RUN_ID,
    );
  }

  return refreshResult;
}
