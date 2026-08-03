import { createHash } from 'node:crypto';
import type { CatalogTab } from '../rails.js';
import type { VerifiedLibraryCatalogRow } from '../playability/db.js';
import type { FireWaterRating, RatingContentType } from '../library/ratings.js';

export const RECOMMENDATION_MODEL_VERSION = 'fire-water-knn-v1';
export const RECOMMENDATION_FEATURE_VERSION = 'metadata-hash-v1';
const VECTOR_SIZE = 96;
const MIN_SIMILARITY = 0.15;
const MAX_NEIGHBORS = 12;
const PRIOR_WEIGHT = 2;

export type RecommendationFeature = {
  type: RatingContentType;
  id: string;
  title: string;
  year: string | null;
  rail_id: string;
  vector: number[];
  cluster: string;
  confidence: number;
};

export type ScoredRecommendation = RecommendationFeature & {
  predicted_fire: number;
  predicted_water: number;
  affinity: number;
  diversity: number;
  bucket: 'close' | 'adjacent' | 'explore' | 'fallback';
};

export type AiRecommendationFeatureDocument = {
  type: RatingContentType;
  id: string;
  model_version: string;
  prompt_version: string;
  input_hash: string;
  themes: string[];
  tone: string[];
  pace: 'slow' | 'moderate' | 'fast' | 'varied';
  tension: number;
  humor: number;
  spectacle: number;
  emotional_intensity: number;
  tenderness: number;
  narrative_complexity: number;
};

export function validateAiFeatureDocument(
  document: AiRecommendationFeatureDocument,
  allowedStableIds: Set<string>,
): AiRecommendationFeatureDocument {
  const identity = `${document.type}:${document.id.toLowerCase()}`;
  if (!allowedStableIds.has(identity)) throw new Error('AI feature document references an unknown stable id');
  if (!document.model_version?.trim() || !document.prompt_version?.trim()
    || !/^[a-f0-9]{64}$/i.test(document.input_hash || '')) {
    throw new Error('AI feature document is missing bounded provenance');
  }
  if (!Array.isArray(document.themes) || document.themes.length > 12
    || !Array.isArray(document.tone) || document.tone.length > 8
    || document.themes.some((item) => typeof item !== 'string' || !item.trim() || item.length > 40)
    || document.tone.some((item) => typeof item !== 'string' || !item.trim() || item.length > 40)) {
    throw new Error('AI feature document contains invalid bounded tags');
  }
  if (!['slow', 'moderate', 'fast', 'varied'].includes(document.pace)) {
    throw new Error('AI feature document contains invalid pace');
  }
  for (const field of [
    'tension', 'humor', 'spectacle', 'emotional_intensity', 'tenderness', 'narrative_complexity',
  ] as const) {
    if (!Number.isFinite(document[field]) || document[field] < 0 || document[field] > 1) {
      throw new Error(`AI feature document ${field} must be between 0 and 1`);
    }
  }
  return document;
}

function tokenHash(token: string): number {
  const digest = createHash('sha256').update(token).digest();
  return digest.readUInt32BE(0) % VECTOR_SIZE;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

function textTokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 32);
}

export function buildRecommendationFeature(input: {
  type: RatingContentType;
  id: string;
  title: string;
  year?: string | null;
  rail_id?: string;
  taste_tags?: string[];
}): RecommendationFeature {
  const vector = Array<number>(VECTOR_SIZE).fill(0);
  const railTokens = textTokens(input.rail_id ?? 'metadata')
    .filter((token) => !['movie', 'movies', 'series', 'rail'].includes(token));
  const titleTokens = textTokens(input.title);
  const tasteTokens = (input.taste_tags ?? []).flatMap(textTokens);
  for (const token of railTokens) vector[tokenHash(`rail:${token}`)] += 1.7;
  for (const token of titleTokens) vector[tokenHash(`title:${token}`)] += 0.35;
  for (const token of tasteTokens) vector[tokenHash(`taste:${token}`)] += 2.2;
  const year = Number.parseInt(input.year ?? '', 10);
  if (Number.isFinite(year)) {
    const era = Math.floor(year / 10) * 10;
    vector[tokenHash(`era:${era}`)] += 1.1;
  }
  vector[tokenHash(`type:${input.type}`)] += 0.8;
  return {
    type: input.type,
    id: input.id,
    title: input.title,
    year: input.year ?? null,
    rail_id: input.rail_id ?? 'metadata',
    vector: normalizeVector(vector),
    cluster: input.rail_id?.trim().toLowerCase()
      || `era-${Number.isFinite(year) ? Math.floor(year / 10) * 10 : 'unknown'}`,
    confidence: tasteTokens.length ? 0.9 : railTokens.length ? 0.72 : 0.5,
  };
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) score += left[index]! * right[index]!;
  return Math.max(0, Math.min(1, score));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 2.5;
}

function fallbackAffinity(feature: RecommendationFeature, axisMean: number): number {
  const profile = feature.vector.reduce((sum, value, index) => sum + value * ((index % 7) / 6), 0);
  return Math.max(0, Math.min(5, axisMean + Math.max(-0.35, Math.min(0.35, profile / 24 - 0.16))));
}

export function predictAxes(input: {
  candidate: RecommendationFeature;
  ratings: FireWaterRating[];
  ratingFeatures: Map<string, RecommendationFeature>;
  tab: 'movies' | 'series';
}): { fire: number; water: number; neighbor_weight: number } {
  const sameDomain = input.ratings.filter((rating) => rating.type === (input.tab === 'movies' ? 'movie' : 'series'));
  const seriesCount = input.ratings.filter((rating) => rating.type === 'series').length;
  const movieTransfer = input.tab === 'series' ? 0.6 * Math.max(0, 1 - seriesCount / 12) : 0;
  const eligibleRatings = input.tab === 'movies'
    ? sameDomain
    : input.ratings.filter((rating) => rating.type === 'series' || (rating.type === 'movie' && movieTransfer > 0));
  const householdFire = mean(sameDomain.length ? sameDomain.map((rating) => rating.fire) : input.ratings.map((rating) => rating.fire));
  const householdWater = mean(sameDomain.length ? sameDomain.map((rating) => rating.water) : input.ratings.map((rating) => rating.water));
  const neighbors = eligibleRatings
    .map((rating) => {
      const feature = input.ratingFeatures.get(`${rating.type}:${rating.id}`);
      if (!feature) return null;
      const similarity = cosineSimilarity(input.candidate.vector, feature.vector);
      if (similarity < MIN_SIMILARITY) return null;
      const domainWeight = rating.type === input.candidate.type ? 1 : movieTransfer;
      return {
        rating,
        weight: similarity * similarity * feature.confidence * domainWeight,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_NEIGHBORS);
  const neighborWeight = neighbors.reduce((sum, neighbor) => sum + neighbor.weight, 0);
  if (neighborWeight < 0.15) {
    return {
      fire: fallbackAffinity(input.candidate, householdFire),
      water: fallbackAffinity(input.candidate, householdWater),
      neighbor_weight: neighborWeight,
    };
  }
  return {
    fire: (neighbors.reduce((sum, item) => sum + item.rating.fire * item.weight, 0) + householdFire * PRIOR_WEIGHT)
      / (neighborWeight + PRIOR_WEIGHT),
    water: (neighbors.reduce((sum, item) => sum + item.rating.water * item.weight, 0) + householdWater * PRIOR_WEIGHT)
      / (neighborWeight + PRIOR_WEIGHT),
    neighbor_weight: neighborWeight,
  };
}

export function holisticAffinity(fire: number, water: number): number {
  return 0.75 * Math.max(fire, water) + 0.25 * Math.min(fire, water);
}

function seededUnit(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 0xffffffff;
}

function mmrPick(candidates: ScoredRecommendation[], limit: number): ScoredRecommendation[] {
  const remaining = [...candidates];
  const selected: ScoredRecommendation[] = [];
  const clusterCount = new Map<string, number>();
  while (remaining.length && selected.length < limit) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      if ((clusterCount.get(candidate.cluster) ?? 0) >= 2) continue;
      const redundancy = selected.length
        ? Math.max(...selected.map((item) => cosineSimilarity(candidate.vector, item.vector)))
        : 0;
      const score = 0.75 * (candidate.affinity / 5) - 0.25 * redundancy;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (bestIndex < 0) break;
    const [picked] = remaining.splice(bestIndex, 1);
    picked!.diversity = 1 - Math.max(0, ...selected.map((item) => cosineSimilarity(picked!.vector, item.vector)));
    selected.push(picked!);
    clusterCount.set(picked!.cluster, (clusterCount.get(picked!.cluster) ?? 0) + 1);
  }
  return selected;
}

export function rankRecommendations(input: {
  tab: 'movies' | 'series';
  candidates: RecommendationFeature[];
  ratings: FireWaterRating[];
  ratingFeatures: Map<string, RecommendationFeature>;
  dailySeed: string;
  limit?: number;
}): ScoredRecommendation[] {
  const scored = input.candidates.map((candidate) => {
    const axes = predictAxes({ ...input, candidate });
    return {
      ...candidate,
      predicted_fire: axes.fire,
      predicted_water: axes.water,
      affinity: holisticAffinity(axes.fire, axes.water),
      diversity: 1,
      bucket: 'close' as const,
    };
  });
  const byAffinity = [...scored].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id));
  const close = mmrPick(byAffinity.slice(0, Math.max(8, Math.ceil(byAffinity.length * 0.55))), 8)
    .map((item) => ({ ...item, bucket: 'close' as const }));
  const used = new Set(close.map((item) => `${item.type}:${item.id}`));
  const adjacentPool = byAffinity.filter((item) => !used.has(`${item.type}:${item.id}`))
    .slice(0, Math.max(12, Math.ceil(byAffinity.length * 0.8)));
  const adjacent = mmrPick(adjacentPool, 3).map((item) => ({ ...item, bucket: 'adjacent' as const }));
  adjacent.forEach((item) => used.add(`${item.type}:${item.id}`));
  const exploration = byAffinity
    .filter((item) => !used.has(`${item.type}:${item.id}`))
    .sort((a, b) => seededUnit(`${input.dailySeed}:${a.type}:${a.id}`) - seededUnit(`${input.dailySeed}:${b.type}:${b.id}`))[0];
  const output: ScoredRecommendation[] = [...close, ...adjacent];
  if (exploration) output.push({ ...exploration, bucket: 'explore' });
  const limit = input.limit ?? 12;
  if (output.length < limit) {
    for (const item of byAffinity) {
      if (output.length >= limit) break;
      if (output.some((entry) => entry.type === item.type && entry.id === item.id)) continue;
      output.push({ ...item, bucket: 'fallback' });
    }
  }
  return output.slice(0, limit);
}

export function candidatesToFeatures(
  candidates: VerifiedLibraryCatalogRow[],
  type: RatingContentType,
): RecommendationFeature[] {
  return candidates
    .filter((candidate) => candidate.type === type)
    .map((candidate) => buildRecommendationFeature({
      type,
      id: candidate.id,
      title: candidate.title,
      year: candidate.year,
      rail_id: candidate.rail_id,
    }));
}

export function recommendationDailySeed(tab: CatalogTab, now = new Date()): string {
  return `${tab}:${now.toISOString().slice(0, 10)}`;
}
