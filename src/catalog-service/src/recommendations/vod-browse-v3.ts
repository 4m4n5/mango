export const VOD_BROWSE_MODEL_VERSION = 'vod-browse-v3' as const;
export const VOD_RELATED_MODEL_VERSION = 'vod-related-v1' as const;
export const DEEP_WEIGHTED_ALGORITHM_VERSION = 'deep-weighted-v1' as const;
export const DEEP_WEIGHTED_EXPLORATION_FRACTION = 0.05;

export type VodBrowseMode = 'off' | 'shadow' | 'serve';

export function vodBrowseV3Mode(): VodBrowseMode {
  const raw = process.env.MANGO_VOD_BROWSE_V3?.trim().toLowerCase();
  return raw === 'shadow' || raw === 'serve' ? raw : 'off';
}

export type WeightedIdentity = {
  type: string;
  id: string;
  weight: number;
};

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stableUnit(seed: string): number {
  // cyrb53-style integer mixing is deterministic and allocation-free. This is
  // sampling entropy, not a security boundary; a cryptographic digest added
  // substantial couch-time CPU/GC without improving the weighted distribution.
  let high = 0xdeadbeef ^ seed.length;
  let low = 0x41c6ce57 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    high = Math.imul(high ^ code, 2_654_435_761);
    low = Math.imul(low ^ code, 1_597_334_677);
  }
  high = Math.imul(high ^ (high >>> 16), 2_246_822_507)
    ^ Math.imul(low ^ (low >>> 13), 3_266_489_909);
  low = Math.imul(low ^ (low >>> 16), 2_246_822_507)
    ^ Math.imul(high ^ (high >>> 13), 3_266_489_909);
  const integer = (2_097_151 & low) * 0x1_0000_0000 + (high >>> 0);
  return Math.max(Number.MIN_VALUE, (integer + 1) / 0x20_0000_0000_0000);
}

/** Deterministic Gumbel/exponential-race weighted sampling without replacement. */
export function weightedDeal<T extends WeightedIdentity>(
  items: readonly T[],
  limit: number,
  seed: string,
): T[] {
  const boundedLimit = Math.max(0, Math.min(Math.floor(limit), items.length));
  if (boundedLimit === 0) return [];
  type Winner = { item: T; key: number };
  const compareValue = (key: number, item: T, right: Winner): number => (
    key - right.key
    || item.type.localeCompare(right.item.type)
    || item.id.localeCompare(right.item.id)
  );
  const compare = (left: Winner, right: Winner): number => (
    compareValue(left.key, left.item, right)
  );
  const winners: Winner[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.weight) || item.weight <= 0) continue;
    const key = -Math.log(stableUnit(`${seed}:${item.type}:${item.id}`)) / item.weight;
    if (winners.length === boundedLimit && compareValue(key, item, winners.at(-1)!) >= 0) continue;
    const candidate = { item, key };
    let insertAt = winners.length;
    while (insertAt > 0 && compare(candidate, winners[insertAt - 1]!) < 0) insertAt -= 1;
    winners.splice(insertAt, 0, candidate);
    if (winners.length > boundedLimit) winners.pop();
  }
  return winners.map(({ item }) => item);
}

/**
 * Blend normalized relevance with an explicit uniform floor. The returned
 * masses sum to one and every candidate is positive, even when all raw scores
 * are absent or zero.
 */
export function deepSamplingMasses<T extends WeightedIdentity>(
  items: readonly T[],
  explorationFraction = DEEP_WEIGHTED_EXPLORATION_FRACTION,
): number[] {
  if (items.length === 0) return [];
  const exploration = clampUnit(explorationFraction);
  const raw = items.map((item) => (
    Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0
  ));
  const rawSum = raw.reduce((sum, value) => sum + value, 0);
  const uniform = 1 / items.length;
  return raw.map((value) => (
    (1 - exploration) * (rawSum > 0 ? value / rawSum : uniform)
      + exploration * uniform
  ));
}

/** Deterministic 95/5 weighted sample across the complete supplied corpus. */
export function deepWeightedDeal<T extends WeightedIdentity>(
  items: readonly T[],
  limit: number,
  seed: string,
  explorationFraction = DEEP_WEIGHTED_EXPLORATION_FRACTION,
): T[] {
  const masses = deepSamplingMasses(items, explorationFraction);
  return weightedDeal(items.map((item, index) => ({
    item,
    type: item.type,
    id: item.id,
    weight: masses[index]!,
  })), limit, `${DEEP_WEIGHTED_ALGORITHM_VERSION}:${seed}`).map((entry) => entry.item);
}

export function percentile(values: readonly number[], value: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length <= 1) return finite.length === 1 ? 1 : 0;
  let below = 0;
  for (const candidate of finite) {
    if (candidate <= value) below += 1;
    else break;
  }
  return clampUnit((below - 1) / (finite.length - 1));
}

export function forYouRelevanceWeight(input: {
  rankScore: number;
  fitFloor: number;
  threadQ95: number;
}): number {
  if (!Number.isFinite(input.rankScore) || input.rankScore < input.fitFloor) return 0;
  const denominator = input.threadQ95 - input.fitFloor;
  const q = denominator > 1e-9
    ? clampUnit((input.rankScore - input.fitFloor) / denominator)
    : 1;
  return 1 + 31 * q ** 2;
}

export function weightedSignalScore(
  signals: ReadonlyArray<{ value: number | null | undefined; mass: number }>,
): number {
  let weighted = 0;
  let mass = 0;
  for (const signal of signals) {
    if (signal.value === null || signal.value === undefined || !Number.isFinite(signal.value)) continue;
    weighted += clampUnit(signal.value) * signal.mass;
    mass += signal.mass;
  }
  return mass > 0 ? clampUnit(weighted / mass) : 0.5;
}

export function exploreWeight(input: {
  catalogQuality?: number | null;
  tasteAdjacency?: number | null;
  profileConfidence?: number | null;
  novelty?: number | null;
}): number {
  const score = weightedSignalScore([
    { value: input.catalogQuality, mass: 0.35 },
    { value: input.tasteAdjacency, mass: 0.25 },
    { value: input.profileConfidence, mass: 0.20 },
    { value: input.novelty, mass: 0.20 },
  ]);
  return 0.60 + 0.40 * score;
}

export function categoryWeight(input: {
  sourcePosition?: number | null;
  themeConfidence?: number | null;
  tasteAffinity?: number | null;
  novelty?: number | null;
  pinned?: boolean;
}): number {
  const score = weightedSignalScore([
    { value: input.sourcePosition, mass: 0.55 },
    { value: input.themeConfidence, mass: 0.25 },
    { value: input.tasteAffinity, mass: 0.10 },
    { value: input.novelty, mass: 0.10 },
  ]);
  const base = 0.35 + 0.65 * score;
  return input.pinned ? Math.max(base, 2) : base;
}

export function aiCatalogWeight(input: {
  catalogRelevance?: number | null;
  tasteAffinity?: number | null;
  pinned?: boolean;
}): number {
  const score = weightedSignalScore([
    { value: input.catalogRelevance, mass: 0.85 },
    { value: input.tasteAffinity, mass: 0.15 },
  ]);
  const base = 0.35 + 0.65 * score;
  return input.pinned ? Math.max(base, 2) : base;
}

export const VOD_UTILITY_DISPLAY_LIMIT = 9;
export const VOD_CONTINUE_SHUFFLE_POOL = 40;
export const VOD_SAVED_RECENCY_HALF_LIFE_DAYS = 180;
export const VOD_CONTINUE_RECENCY_HALF_LIFE_DAYS = 30;

export function recencyWeight(activityAt: number | null | undefined, halfLifeDays: number, now: number): number {
  if (!activityAt || !Number.isFinite(activityAt) || halfLifeDays <= 0) return 0.25;
  const ageDays = Math.max(0, now - activityAt) / (24 * 60 * 60 * 1_000);
  return 0.25 + 0.75 * 2 ** (-ageDays / halfLifeDays);
}

/** Modest boost for titles closer to finishing; just-started Continue rows stay eligible. */
export function vodUtilityProgressWeight(progressPct: number | null | undefined): number {
  if (progressPct == null || !Number.isFinite(progressPct)) return 1;
  return 0.6 + 0.4 * clampUnit(progressPct);
}

/** Deterministic recency-weighted Home sample for Continue and Saved. */
export function dealVodUtilityRail<T extends { type: string; id: string }>(
  items: readonly T[],
  limit: number,
  seed: string,
  weightFor: (item: T) => number,
): T[] {
  const bounded = Math.max(0, Math.min(Math.floor(limit), items.length));
  if (bounded === 0) return [];
  return deepWeightedDeal(
    items.map((item) => ({
      item,
      type: item.type,
      id: item.id,
      weight: weightFor(item),
    })),
    bounded,
    seed,
  ).map((entry) => entry.item);
}

export type RelatedFamilyScore = {
  family: string;
  score: number;
  semantic: boolean;
};

export function relatedScore(input: {
  families: readonly RelatedFamilyScore[];
  householdAffinity?: number | null;
}): { score: number; sharedFamilies: number; semanticFamilies: number } {
  const semantic = input.families.filter((family) => family.semantic);
  const factual = input.families.filter((family) => !family.semantic);
  const average = (values: RelatedFamilyScore[]): number | null => values.length > 0
    ? values.reduce((sum, family) => sum + clampUnit(family.score), 0) / values.length
    : null;
  const semanticScore = average(semantic);
  const factualScore = average(factual);
  const score = semanticScore === null && factualScore === null
    ? 0
    : 0.65 * (semanticScore ?? 0)
      + 0.25 * (factualScore ?? 0)
      + 0.10 * clampUnit(input.householdAffinity ?? 0.5);
  return {
    score: clampUnit(score),
    sharedFamilies: input.families.length,
    semanticFamilies: semantic.length,
  };
}

export function relatedWeight(score: number): number {
  return 1 + 15 * clampUnit(score) ** 2;
}

const RELATED_DIRECT_CORE_FAMILIES = new Set([
  'genre-subgenre', 'story-engine', 'theme', 'character-dynamic', 'tone',
]);
const RELATED_SPARSE_FACT_FAMILIES = new Set([
  'creator', 'director', 'writer', 'country', 'language', 'decade', 'format',
  'franchise', 'studio',
]);

/** Broad parents and ordinal facets may refine ordering but cannot admit a title. */
export function relatedEvidenceQualifies(input: {
  anchorEnriched: boolean;
  shared: ReadonlyArray<{ family: string; nodeKey: string }>;
}): boolean {
  const direct = input.shared.filter((edge) => !edge.nodeKey.includes('parent%3D'));
  const families = new Set(direct.map((edge) => edge.family));
  if (input.anchorEnriched) {
    const core = [...families].filter((family) => RELATED_DIRECT_CORE_FAMILIES.has(family));
    const hasGenre = families.has('genre-subgenre');
    const hasStoryEngine = families.has('story-engine');
    return hasGenre && core.length >= 3 && (hasStoryEngine || core.length >= 4);
  }
  const hasGenreOrCategory = families.has('genre-subgenre') || families.has('curated-list');
  return hasGenreOrCategory
    && [...families].some((family) => RELATED_SPARSE_FACT_FAMILIES.has(family));
}

export function strongestRelatedFrontier<T extends WeightedIdentity & { relation_score: number }>(
  items: readonly T[],
  limit: number,
): T[] {
  const bounded = Math.max(0, Math.floor(limit));
  return [...items].sort((left, right) => (
    right.relation_score - left.relation_score
      || left.type.localeCompare(right.type)
      || left.id.localeCompare(right.id)
  )).slice(0, bounded);
}
