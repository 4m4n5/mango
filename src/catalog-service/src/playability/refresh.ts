import type { BrowsableRail } from '../rails.js';
import type { CatalogCore } from '../core.js';
import { applyAiCatalogTopUpHints, clearAppliedTopUpHints } from '../ai-catalogs/hints.js';
import {
  getPlayabilityStatus,
  getUniqueVerifiedLibraryCount,
  countOrphanVerifiedPoolTitles,
  getRailPoolOverlapSummary,
  getRailIngestOffsetsBulk,
  getRailPoolTitleKeysBulk,
  getStaleTitlesForRefresh,
  getTitlesPlayabilityBulk,
  pruneNonPlayableFromRailPools,
  setRailIngestOffset,
  type PlayabilityRailStatus,
  type RailPoolOverlapSummary,
} from './db.js';
import {
  ingestPaginatedCandidates,
  type IngestCandidatesStats,
  type SourceIngestStats,
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
  playabilityGrowRequireTarget,
  playabilityIngestPageSize,
  playabilityMaxIngestScan,
} from './config.js';
import {
  effectiveCandidateLimit,
  effectivePoolTarget,
} from './pool-growth.js';
import { growRail } from './grow-rail.js';
import { railsForGrowPass } from './grow-order.js';
import {
  isGrowRefreshMode,
  normalizeRefreshMode,
  resolveGrowPreset,
  type GrowPresetId,
  type RefreshMode,
} from './grow-target.js';
import {
  loadSourceOffsetsForListSource,
  persistSourceOffsetsForListSource,
} from './source-cursors.js';
import { rethemeRailPools, type RethemePoolsResult } from './rail-pool-retheme.js';
import { recordGrowRunState } from './grow-run-state.js';

export type { RefreshMode } from './grow-target.js';

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
  fresh_verified?: number;
  probe_verified?: number;
  new_to_rail_verified?: number;
  pool_growth?: number;
  grow_target_met?: boolean;
  /** @deprecated Use grow_target */
  growth_quota?: number;
  /** @deprecated Use probe_verified */
  verified_added?: number;
  /** @deprecated Use grow_target_met */
  growth_quota_met?: boolean;
  grow_loops?: number;
  attempts?: number;
  sources_touched?: number;
  source_stats?: SourceIngestStats[];
  failure_category?: string;
  repair_suggestions?: string[];
  min_display: number;
  candidates_seen: number;
  linked_existing: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  skipped_rejected?: number;
  duplicate_candidates?: number;
  wasted_candidate_ratio?: number;
  exhausted: boolean;
  compose_escalated?: boolean;
  compose_fallback_level?: number;
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
  skipped_rejected?: number;
  duplicate_candidates?: number;
  wasted_candidate_ratio?: number;
  batch_flush: { verify_count: number; pool_count: number };
  pruned_pool_entries: number;
  ingest_fresh_queued: number;
  ingest_scanned: number;
  strict_grow_sla?: boolean;
  failure_category?: string;
  repair_suggestions?: string[];
  /** Global library size — distinct active verified titles (not rail pool slots). */
  unique_verified_before?: number;
  unique_verified_after?: number;
  unique_verified_delta?: number;
  benchmark_target?: number;
  orphan_total_before?: number;
  orphan_total_after?: number;
  orphan_attached?: number;
  overlap_before?: RailPoolOverlapSummary;
  overlap_after?: RailPoolOverlapSummary;
  retheme_finalization?: Omit<RethemePoolsResult, 'actions'>;
  rails: RefreshRailSummary[];
};

function railNeedsWork(
  mode: RefreshMode,
  status: PlayabilityRailStatus,
  poolTarget: number,
  bootstrap: boolean,
): boolean {
  if (mode === 'stale') {
    return status.stale > 0;
  }
  return bootstrap || status.verified_pool < poolTarget;
}

function usesBootstrapIngest(bootstrap: boolean): boolean {
  return bootstrap;
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
    fresh_verified: result.fresh_verified,
    probe_verified: result.probe_verified,
    new_to_rail_verified: result.new_to_rail_verified,
    pool_growth: result.pool_growth,
    grow_target_met: result.grow_target_met,
    growth_quota: result.growth_quota,
    verified_added: result.verified_added,
    growth_quota_met: result.growth_quota_met,
    grow_loops: result.grow_loops,
    attempts: result.attempts,
    sources_touched: result.sources_touched,
    source_stats: result.source_stats,
    failure_category: result.failure_category,
    repair_suggestions: result.repair_suggestions,
    min_display: result.min_display,
    candidates_seen: result.candidates_seen,
    linked_existing: result.linked_existing,
    verified: result.verified,
    failed: result.failed,
    skipped_existing: result.skipped_existing,
    skipped_recent_failed: result.skipped_recent_failed,
    skipped_rejected: result.skipped_rejected,
    duplicate_candidates: result.duplicate_candidates,
    wasted_candidate_ratio: result.wasted_candidate_ratio,
    exhausted: result.exhausted,
    compose_escalated: result.compose_escalated,
    compose_fallback_level: result.compose_fallback_level,
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
  const uniqueVerifiedBefore = await getUniqueVerifiedLibraryCount();
  const orphanTotalBefore = await countOrphanVerifiedPoolTitles();
  const overlapBefore = await getRailPoolOverlapSummary({ maxRailsPerTitle: 2 });
  const browsable = core.browsableRails();
  const status = await getPlayabilityStatus(browsable.map((rail) => rail.id));
  const verifiedPoolByRail = new Map(
    status.rails.map((rail) => [rail.rail_id, rail.verified_pool]),
  );
  const rails = railsForGrowPass(browsable, { verifiedPoolByRail });
  const railSummaries: RefreshRailSummary[] = [];
  const prevGrowPass = process.env.MANGO_PLAYABILITY_GROW_PASS;
  process.env.MANGO_PLAYABILITY_GROW_PASS = '1';

  try {
    for (const rail of rails) {
      const growResult = await growRail(core, rail.id, {
        preset: options.growPreset,
        wallMs: options.growWallMs ?? preset.wall_ms,
        maxAttempts: options.growMaxAttempts ?? preset.max_attempts,
      });
      railSummaries.push(growResultToRailSummary(growResult));
    }
  } finally {
    if (prevGrowPass === undefined) {
      delete process.env.MANGO_PLAYABILITY_GROW_PASS;
    } else {
      process.env.MANGO_PLAYABILITY_GROW_PASS = prevGrowPass;
    }
  }

  const requireGrowTarget = playabilityGrowRequireTarget();
  const strictOk = railSummaries.every((rail) => rail.ok && (!requireGrowTarget || rail.grow_target_met === true));
  let rethemeFinalization: RethemePoolsResult | undefined;
  let finalizationOk = true;
  if (strictOk && process.env.MANGO_GROW_FINAL_RETHEME !== '0') {
    recordGrowRunState({
      phase: 'retheme',
      message: 'post-grow retheme finalization',
      mode,
      preset: process.env.MANGO_GROW_PRESET,
    });
    rethemeFinalization = await rethemeRailPools(core, {
      dryRun: false,
      includeOrphans: true,
      maxRailsPerTitle: 2,
    });
    const finalStatus = await getPlayabilityStatus(rails.map((rail) => rail.id));
    const minByRail = new Map(rails.map((rail) => [rail.id, rail.playability.min_display]));
    finalizationOk = finalStatus.rails.every((rail) => (
      rail.verified_pool >= (minByRail.get(rail.rail_id) ?? 0)
    ));
    recordGrowRunState({
      phase: 'publish',
      message: finalizationOk
        ? 'strict grow finalization complete'
        : 'strict grow finalization left a rail below min_display',
      mode,
      preset: process.env.MANGO_GROW_PRESET,
      ok: finalizationOk,
      orphan_attached: rethemeFinalization.attached,
      overlap_removed: rethemeFinalization.overlap_removed,
    });
  }
  const finishedAt = Date.now();
  const uniqueVerifiedAfter = await getUniqueVerifiedLibraryCount();
  const orphanTotalAfter = await countOrphanVerifiedPoolTitles();
  const overlapAfter = await getRailPoolOverlapSummary({ maxRailsPerTitle: 2 });
  const ok = strictOk && finalizationOk;
  const repairSuggestions = [
    ...railSummaries
    .flatMap((rail) => rail.repair_suggestions ?? [])
    .filter((suggestion, index, all) => all.indexOf(suggestion) === index),
    ...(!finalizationOk
      ? ['Review retheme finalization: orphan/overlap cleanup left one or more rails below min_display; do not publish couch sessions until rail depth is repaired.']
      : []),
  ];
  const refreshResult: RefreshAllResult = {
    ok,
    mode,
    bootstrap: false,
    strict_grow_sla: true,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt - startedAt,
    unique_verified_before: uniqueVerifiedBefore,
    unique_verified_after: uniqueVerifiedAfter,
    unique_verified_delta: uniqueVerifiedAfter - uniqueVerifiedBefore,
    benchmark_target: process.env.MANGO_GROW_PER_PASS
      ? Number(process.env.MANGO_GROW_PER_PASS)
      : undefined,
    orphan_total_before: orphanTotalBefore,
    orphan_total_after: orphanTotalAfter,
    orphan_attached: rethemeFinalization?.attached ?? 0,
    overlap_before: overlapBefore,
    overlap_after: overlapAfter,
    retheme_finalization: rethemeFinalization
      ? {
        ok: rethemeFinalization.ok,
        dry_run: rethemeFinalization.dry_run,
        include_orphans: rethemeFinalization.include_orphans,
        max_rails_per_title: rethemeFinalization.max_rails_per_title,
        memberships_scanned: rethemeFinalization.memberships_scanned,
        orphans_scanned: rethemeFinalization.orphans_scanned,
        unique_titles: rethemeFinalization.unique_titles,
        kept: rethemeFinalization.kept,
        removed: rethemeFinalization.removed,
        overlap_removed: rethemeFinalization.overlap_removed,
        relocated: rethemeFinalization.relocated,
        attached: rethemeFinalization.attached,
        meta_fetched: rethemeFinalization.meta_fetched,
        rails_touched: rethemeFinalization.rails_touched,
      }
      : undefined,
    unique_candidates: railSummaries.reduce((sum, rail) => sum + rail.candidates_seen, 0),
    verify_queue_size: 0,
    linked_existing: railSummaries.reduce((sum, rail) => sum + rail.linked_existing, 0),
    verified: railSummaries.reduce((sum, rail) => sum + rail.verified, 0),
    failed: railSummaries.reduce((sum, rail) => sum + rail.failed, 0),
    skipped_existing: railSummaries.reduce((sum, rail) => sum + rail.skipped_existing, 0),
    skipped_recent_failed: railSummaries.reduce((sum, rail) => sum + rail.skipped_recent_failed, 0),
    skipped_rejected: railSummaries.reduce((sum, rail) => sum + (rail.skipped_rejected ?? 0), 0),
    duplicate_candidates: railSummaries.reduce((sum, rail) => sum + (rail.duplicate_candidates ?? 0), 0),
    wasted_candidate_ratio: (() => {
      const candidates = railSummaries.reduce((sum, rail) => sum + rail.candidates_seen, 0);
      if (candidates <= 0) return undefined;
      const wasted = railSummaries.reduce((sum, rail) => (
        sum
        + rail.skipped_existing
        + rail.skipped_recent_failed
        + (rail.skipped_rejected ?? 0)
        + (rail.duplicate_candidates ?? 0)
      ), 0);
      return wasted / candidates;
    })(),
    batch_flush: { verify_count: 0, pool_count: 0 },
    pruned_pool_entries: 0,
    ingest_fresh_queued: railSummaries.reduce(
      (sum, rail) => sum + (rail.ingest?.fresh_queued ?? 0),
      0,
    ),
    ingest_scanned: railSummaries.reduce((sum, rail) => sum + rail.candidates_seen, 0),
    failure_category: ok
      ? undefined
      : strictOk
        ? 'retheme_finalization_failed'
        : 'rail_grow_target_shortfall',
    repair_suggestions: repairSuggestions.length > 0 ? repairSuggestions : undefined,
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
  const mode = normalizeRefreshMode(options.mode);
  const bootstrap = options.bootstrap ?? playabilityBootstrapFill();
  if (isGrowRefreshMode(mode, bootstrap)) {
    return refreshAllRailsGrow(core, { ...options, mode });
  }

  const startedAt = Date.now();
  const uniqueVerifiedBefore = await getUniqueVerifiedLibraryCount();
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
    return railNeedsWork(mode, before, poolTarget, bootstrap);
  });

  const freshPerRail = playabilityFreshPerRail();
  const ingestOffsets = usesBootstrapIngest(bootstrap)
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

    if (usesBootstrapIngest(bootstrap)) {
      const sourceOffsets = await loadSourceOffsetsForListSource(rail.id, source);
      const ingested = await ingestPaginatedCandidates(source, {
        startOffset: sourceOffsets ? 0 : (ingestOffsets.get(rail.id) ?? 0),
        sourceOffsets,
        freshTarget: freshPerRail,
        pageSize: playabilityIngestPageSize(),
        maxScanned: playabilityMaxIngestScan(),
        lookupTitles: getTitlesPlayabilityBulk,
      });
      if (sourceOffsets) {
        await persistSourceOffsetsForListSource(rail.id, source);
      } else {
        await setRailIngestOffset(rail.id, ingested.next_offset);
      }
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

  const context = await createVerifyContext(core);
  const linked = await linkExistingVerifiedCandidates({
    refsByKey,
    titleStatuses,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    staleKeys,
    refreshMode: bootstrap ? 'full' : mode,
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

  const skipVerifyQueue = bootstrap
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
      earlyExitMinDisplay: playabilityEarlyExitMinDisplay(),
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
    const verifiedAdded = railResults.filter(
      (result) => result.action === 'verified' || result.action === 'reverified',
    ).length;
    const ingestStats = ingestStatsByRail.get(rail.id);
    railSummaries.push({
      rail_id: rail.id,
      label: rail.label,
      ok: after.verified_pool >= rail.playability.min_display,
      before,
      after,
      candidate_limit: options.candidateLimit
        ?? effectiveCandidateLimit(
          rail.limit,
          rail.playability.ingest_multiplier,
          verified,
          poolTarget,
        ),
      pool_target: poolTarget,
      verified_added: verifiedAdded,
      min_display: rail.playability.min_display,
      candidates_seen: candidatesSeenByRail.get(rail.id) ?? 0,
      linked_existing: railResults.filter((result) => result.action === 'linked_existing').length,
      verified: railResults.filter((result) => result.action === 'verified' || result.action === 'reverified').length,
      failed: railResults.filter((result) => result.action === 'failed').length,
      skipped_existing: railResults.filter((result) => result.action === 'skipped_existing').length,
      skipped_recent_failed: railResults.filter((result) => result.action === 'skipped_recent_failed').length,
      exhausted: bootstrap ? after.verified_pool < poolTarget : false,
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

  const uniqueVerifiedAfter = await getUniqueVerifiedLibraryCount();
  const refreshResult = {
    ok: railSummaries.every((rail) => rail.ok),
    mode,
    bootstrap,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt - startedAt,
    unique_verified_before: uniqueVerifiedBefore,
    unique_verified_after: uniqueVerifiedAfter,
    unique_verified_delta: uniqueVerifiedAfter - uniqueVerifiedBefore,
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
