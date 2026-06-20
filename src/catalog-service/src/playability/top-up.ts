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
  playabilityFreshTargetPerRefresh,
  playabilityIngestPageSize,
  playabilityMaxIngestScan,
} from './config.js';
import { effectivePoolTarget } from './pool-growth.js';

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
  const before = await getRailPlayabilityStatus(rail.id);
  const poolTarget = options.poolTarget ?? effectivePoolTarget(rail.playability, before.verified_pool);
  const freshTarget = options.candidateLimit ?? playabilityFreshTargetPerRefresh();

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
  await pruneNonPlayableFromRailPools();

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
    exhausted: after.verified_pool < poolTarget,
    ingest: ingested,
    results: [...linked.results, ...processed.results],
  };
}
