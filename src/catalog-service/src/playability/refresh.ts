import type { CatalogCore } from '../core.js';
import {
  getPlayabilityStatus,
  getRailPoolTitleKeysBulk,
  getStaleTitlesForRefresh,
  getTitlesPlayabilityBulk,
  pruneNonPlayableFromRailPools,
  type PlayabilityRailStatus,
} from './db.js';
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
import { playabilityBootstrapFill, playabilityEarlyExitMinDisplay } from './config.js';
import {
  effectiveCandidateLimit,
  effectivePoolTarget,
} from './pool-growth.js';

export type RefreshMode = 'full' | 'stale';

export type RefreshAllOptions = {
  mode?: RefreshMode;
  poolTarget?: number;
  candidateLimit?: number;
  bootstrap?: boolean;
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
  min_display: number;
  candidates_seen: number;
  linked_existing: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  exhausted: boolean;
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
  // full = additive growth — ingest new candidates when below pool target only
  return status.verified_pool < poolTarget;
}

export async function refreshAllRails(
  core: CatalogCore,
  options: RefreshAllOptions = {},
): Promise<RefreshAllResult> {
  const startedAt = Date.now();
  const mode = options.mode ?? 'stale';
  const bootstrap = options.bootstrap ?? playabilityBootstrapFill();
  const rails = core.browsableRails();
  const railIds = rails.map((rail) => rail.id);
  const status = await getPlayabilityStatus(railIds);
  const { railVerifiedCounts, railPoolTargets, railMinDisplays } = railMapsFromRails(
    rails,
    status.rails,
    { poolTargetOverride: options.poolTarget, bootstrap },
  );
  const railPoolKeys = await getRailPoolTitleKeysBulk(railIds);
  const beforeByRail = new Map(status.rails.map((rail) => [rail.rail_id, rail]));

  const refsByKey = new Map<string, RailCandidateRef[]>();
  const candidatesSeenByRail = new Map<string, number>();
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

  await Promise.all(railsToFetch.map(async (rail) => {
    const source = core.listSourceForRail(rail.id);
    const verified = railVerifiedCounts.get(rail.id) ?? 0;
    const poolTarget = railPoolTargets.get(rail.id) ?? rail.playability.pool_target;
    const candidateLimit = options.candidateLimit
      ?? effectiveCandidateLimit(
        rail.limit,
        rail.playability.ingest_multiplier,
        verified,
        poolTarget,
      );
    const candidates = uniqueCandidates(await source.candidates({ offset: 0, limit: candidateLimit }));
    candidatesSeenByRail.set(rail.id, candidates.length);
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
      min_display: rail.playability.min_display,
      candidates_seen: candidatesSeenByRail.get(rail.id) ?? 0,
      linked_existing: railResults.filter((result) => result.action === 'linked_existing').length,
      verified: railResults.filter((result) => result.action === 'verified' || result.action === 'reverified').length,
      failed: railResults.filter((result) => result.action === 'failed').length,
      skipped_existing: railResults.filter((result) => result.action === 'skipped_existing').length,
      skipped_recent_failed: railResults.filter((result) => result.action === 'skipped_recent_failed').length,
      exhausted: after.verified_pool < poolTarget,
    });
  }

  return {
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
    rails: railSummaries,
  };
}
