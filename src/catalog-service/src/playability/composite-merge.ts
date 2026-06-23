import type { CandidateMeta } from './list-source.js';

export type WeightedCandidateBatch = {
  sourceIndex: number;
  sourceLabel: string;
  weight: number;
  candidates: CandidateMeta[];
};

const DEFAULT_SOURCE_CAP_RATIO = 0.55;
const DEFAULT_TITLE_CLUSTER_CAP = 3;

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
  const sourceCapRatio = sourceCapRatioForMerge();
  const titleClusterCap = titleClusterCapForMerge();
  const sourceCap = batches.length > 1
    ? Math.max(1, Math.ceil(limit * sourceCapRatio))
    : Number.MAX_SAFE_INTEGER;
  const ranked = new Map<string, { candidate: CandidateMeta; rank: number; sourceIndex: number }>();
  const sourceCounts = new Map<string, number>();
  const titleClusterCounts = new Map<string, number>();

  for (const batch of batches) {
    for (const [position, candidate] of batch.candidates.entries()) {
      const sourceCount = sourceCounts.get(batch.sourceLabel) ?? 0;
      if (sourceCount >= sourceCap) {
        continue;
      }
      const cluster = titleCluster(candidate);
      if (cluster) {
        const clusterCount = titleClusterCounts.get(cluster) ?? 0;
        if (clusterCount >= titleClusterCap) {
          continue;
        }
        titleClusterCounts.set(cluster, clusterCount + 1);
      }
      sourceCounts.set(batch.sourceLabel, sourceCount + 1);
      const weight = Math.max(0.01, batch.weight);
      const rank = (position / weight) + (batch.sourceIndex * 0.001);
      const key = candidateIdentity(candidate);
      const existing = ranked.get(key);
      if (
        !existing
        || batch.sourceIndex < existing.sourceIndex
        || (batch.sourceIndex === existing.sourceIndex && rank < existing.rank)
      ) {
        ranked.set(key, {
          candidate: {
            ...candidate,
            source: batch.sourceLabel,
          },
          rank,
          sourceIndex: batch.sourceIndex,
        });
      }
    }
  }

  return [...ranked.values()]
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.candidate)
    .slice(offset, offset + limit);
}

function sourceCapRatioForMerge(): number {
  const raw = process.env.MANGO_GROW_SOURCE_CAP_RATIO;
  if (raw === undefined || raw === '') {
    return DEFAULT_SOURCE_CAP_RATIO;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_SOURCE_CAP_RATIO;
  }
  return parsed;
}

function titleClusterCapForMerge(): number {
  const raw = process.env.MANGO_GROW_TITLE_CLUSTER_CAP;
  if (raw === undefined || raw === '') {
    return DEFAULT_TITLE_CLUSTER_CAP;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_TITLE_CLUSTER_CAP;
  }
  return Math.min(parsed, 20);
}

function titleCluster(candidate: CandidateMeta): string | null {
  const title = candidate.title?.trim();
  if (!title) {
    return null;
  }
  const normalized = title
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(season|series|part|volume|vol)\s*\d+\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized.length >= 4 ? normalized : null;
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
