import type { CatalogCore } from '../core.js';
import {
  getRailPlayabilityStatus,
  getRailPoolTitleKeys,
  getTitlesPlayabilityBulk,
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

export type TopUpRailResult = {
  rail_id: string;
  label: string;
  ok: boolean;
  candidate_limit: number;
  pool_target: number;
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
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: 'linked_existing' | 'verified' | 'failed' | 'skipped_existing' | 'skipped_recent_failed' | 'reverified';
    reason?: string;
    rails?: string[];
  }>;
};

export type TopUpRailOptions = {
  poolTarget?: number;
  candidateLimit?: number;
};

export async function topUpRail(
  core: CatalogCore,
  railId: string,
  options: TopUpRailOptions = {},
): Promise<TopUpRailResult> {
  const rail = core.browsableRail(railId);
  const source = core.listSourceForRail(railId);
  const candidateLimit = options.candidateLimit ?? rail.limit * rail.playability.ingest_multiplier;
  const poolTarget = options.poolTarget ?? rail.playability.pool_target;
  const before = await getRailPlayabilityStatus(rail.id);

  if (before.verified_pool >= poolTarget) {
    return {
      rail_id: rail.id,
      label: rail.label,
      ok: before.verified_pool >= rail.playability.min_display,
      candidate_limit: candidateLimit,
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

  const candidates = uniqueCandidates(await source.candidates({ offset: 0, limit: candidateLimit }));
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
    [rail],
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

  const after = await getRailPlayabilityStatus(rail.id);
  return {
    rail_id: rail.id,
    label: rail.label,
    ok: after.verified_pool >= rail.playability.min_display,
    candidate_limit: candidateLimit,
    pool_target: poolTarget,
    min_display: rail.playability.min_display,
    before,
    after,
    candidates_seen: candidates.length,
    linked_existing: linked.linked_existing,
    verified: processed.verified,
    failed: processed.failed,
    skipped_existing: linked.skipped_existing,
    skipped_recent_failed: linked.skipped_recent_failed,
    exhausted: after.verified_pool < poolTarget,
    results: [...linked.results, ...processed.results],
  };
}
