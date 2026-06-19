import type { CandidateMeta } from './list-source.js';

export type WeightedCandidateBatch = {
  sourceIndex: number;
  sourceLabel: string;
  weight: number;
  candidates: CandidateMeta[];
};

export function candidateIdentity(candidate: CandidateMeta): string {
  return `${candidate.type}:${candidate.id}`;
}

/**
 * Merge weighted source batches: earlier sources win ties; within a source, list order is preserved.
 */
export function mergeCompositeCandidates(
  batches: WeightedCandidateBatch[],
  limit: number,
  offset = 0,
): CandidateMeta[] {
  const ranked = new Map<string, { candidate: CandidateMeta; rank: number }>();

  for (const batch of batches) {
    for (const [position, candidate] of batch.candidates.entries()) {
      const rank = batch.sourceIndex * 1_000_000 + position;
      const key = candidateIdentity(candidate);
      const existing = ranked.get(key);
      if (!existing || rank < existing.rank) {
        ranked.set(key, {
          candidate: {
            ...candidate,
            source: batch.sourceLabel,
          },
          rank,
        });
      }
    }
  }

  return [...ranked.values()]
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.candidate)
    .slice(offset, offset + limit);
}

export function allocateSourceLimits(
  totalLimit: number,
  weights: number[],
): number[] {
  if (weights.length === 0) {
    return [];
  }
  const normalized = weights.map((weight) => (weight > 0 ? weight : 1));
  const weightSum = normalized.reduce((sum, weight) => sum + weight, 0);
  const allocations = normalized.map((weight) => Math.max(
    1,
    Math.ceil((totalLimit * weight) / weightSum),
  ));
  const allocated = allocations.reduce((sum, value) => sum + value, 0);
  if (allocated > totalLimit && allocations.length > 0) {
    let excess = allocated - totalLimit;
    for (let index = allocations.length - 1; index >= 0 && excess > 0; index -= 1) {
      if (allocations[index] > 1) {
        allocations[index] -= 1;
        excess -= 1;
      }
    }
  }
  return allocations;
}
