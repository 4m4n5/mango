import type { CandidateMeta } from './list-source.js';
import {
  getRailPlayabilityStatus,
  getRailPoolTitleKeys,
  getTitlesPlayabilityBulk,
  listLinkableVerifiedForRail,
} from './db.js';
import type { GrowthPassState } from './pool-growth.js';
import {
  candidateKey,
  flushVerifyContextBatch,
  linkExistingVerifiedCandidates,
  railMapsFromRails,
  type RailCandidateRef,
} from './pipeline.js';
import type { VerifyContext } from './verify.js';
import type { BrowsableRail } from '../rails.js';

export type GlobalLinkPassResult = {
  linked: number;
  linked_global: number;
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: 'linked_existing' | 'verified' | 'failed' | 'skipped_existing' | 'skipped_recent_failed' | 'reverified';
    reason?: string;
    rails?: string[];
  }>;
};

export function growGlobalLinkEnabled(): boolean {
  return process.env.MANGO_GROW_GLOBAL_LINK !== '0';
}

/**
 * Link globally verified titles into this rail before catalog ingest — zero probes.
 */
export async function runGlobalVerifiedLinkPass(
  rail: BrowsableRail,
  remainingQuota: number,
  growthPass: GrowthPassState,
  context: VerifyContext,
): Promise<GlobalLinkPassResult> {
  const empty: GlobalLinkPassResult = { linked: 0, linked_global: 0, results: [] };
  if (!growGlobalLinkEnabled() || remainingQuota <= 0) {
    return empty;
  }

  const rows = await listLinkableVerifiedForRail(rail.id, rail.content_type, remainingQuota);
  if (rows.length === 0) {
    return empty;
  }

  const candidates: CandidateMeta[] = rows.map((row) => ({
    type: row.type,
    id: row.id,
    title: row.title?.trim() || `${row.type}:${row.id}`,
    poster: row.poster ?? undefined,
    source: 'global_library',
  }));

  const refsByKey = new Map<string, RailCandidateRef[]>();
  for (const [index, candidate] of candidates.entries()) {
    refsByKey.set(candidateKey(candidate), [{ railId: rail.id, index, candidate }]);
  }

  const titleStatuses = await getTitlesPlayabilityBulk(candidates.map((candidate) => ({
    type: candidate.type,
    id: candidate.id,
  })));

  const afterStatus = await getRailPlayabilityStatus(rail.id);
  const { railVerifiedCounts, railPoolTargets } = railMapsFromRails([rail], [afterStatus]);
  const railPoolKeys = new Map<string, Set<string>>([
    [rail.id, await getRailPoolTitleKeys(rail.id)],
  ]);

  const linked = await linkExistingVerifiedCandidates({
    refsByKey,
    titleStatuses,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    refreshMode: 'grow',
    growthPass,
    context,
  });

  if (linked.linked_existing > 0) {
    await flushVerifyContextBatch(context);
  }

  return {
    linked: linked.linked_existing,
    linked_global: linked.linked_existing,
    results: linked.results,
  };
}
