import { createHash } from 'node:crypto';
import type { CatalogTab } from '../rails.js';
import type { VerifiedLibraryCatalogRow } from '../playability/db.js';
import type { FireWaterRating, RatingContentType } from '../library/ratings.js';

export const RECOMMENDATION_MODEL_VERSION = 'fire-water-hybrid-v3';
export const RECOMMENDATION_FEATURE_VERSION = 'semantic-hash-v3';
const VECTOR_SIZE = 96;
const MIN_SIMILARITY = 0.15;
const MAX_NEIGHBORS = 12;
const PRIOR_WEIGHT = 2;
const NEUTRAL_AXIS_PRIOR = 2.5;
const LOW_EVIDENCE_VIEWER_WEIGHT = 4;

export type RecommendationFeature = {
  type: RatingContentType;
  id: string;
  title: string;
  year: string | null;
  rail_id: string;
  rail_ids: string[];
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
  couch_provenance?: 'watch_again';
};

export type ImplicitRecommendationPreference = {
  feature: RecommendationFeature;
  /** Positive-only confidence. Explicit ratings remain authoritative. */
  strength: number;
};

export type NegativeRecommendationPreference = {
  feature: RecommendationFeature;
  /** Current, decayed Not-for-me confidence. Exact-title vetoes happen upstream. */
  strength: number;
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
  rail_ids?: string[];
  taste_tags?: string[];
}): RecommendationFeature {
  const vector = Array<number>(VECTOR_SIZE).fill(0);
  const railIds = [...new Set([
    ...(input.rail_ids ?? []),
    ...(input.rail_id ? [input.rail_id] : []),
  ].map((item) => item.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const railTokens = railIds.flatMap(textTokens)
    .filter((token) => !['movie', 'movies', 'series', 'rail'].includes(token));
  const titleTokens = textTokens(input.title);
  const tasteTokens = (input.taste_tags ?? []).flatMap(textTokens);
  // Every semantic source shares a namespace. Source-specific namespaces made
  // a seed tag such as "hopeful" orthogonal to a catalog rail containing the
  // same concept, defeating cold-start transfer from imported ratings.
  for (const token of railTokens) vector[tokenHash(`semantic:${token}`)] += 1.7 / Math.sqrt(Math.max(1, railIds.length));
  for (const token of titleTokens) vector[tokenHash(`semantic:${token}`)] += 0.35;
  for (const token of tasteTokens) vector[tokenHash(`semantic:${token}`)] += 2.2;
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
    rail_id: railIds[0] ?? 'metadata',
    rail_ids: railIds,
    vector: normalizeVector(vector),
    // Most verified candidates arrive with the complete rail_ids set rather
    // than a singular rail_id. Use the first stable semantic membership so
    // the global MMR cap diversifies themes instead of accidentally grouping
    // nearly the whole catalog by release decade.
    cluster: railIds[0]?.toLowerCase()
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

function lowEvidenceAxisPrior(axisMean: number): number {
  // Without a sufficiently similar explicit rating, metadata has no principled
  // basis for inventing a candidate-specific Fire or Water lift. Preserve the
  // viewer's observed axis mean while shrinking it 20% toward the neutral
  // editorial prior; deterministic slate/MMR ordering handles the remaining tie.
  return Math.max(0, Math.min(5, (
    axisMean * LOW_EVIDENCE_VIEWER_WEIGHT + NEUTRAL_AXIS_PRIOR
  ) / (LOW_EVIDENCE_VIEWER_WEIGHT + 1)));
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
  // Movie taste is learned only from movie ratings. Series is intentionally
  // asymmetric: movie ratings may provide a bounded cold-start transfer until
  // enough first-party series evidence exists, but series-only history must
  // never invent a movie prior.
  const priorRatings = sameDomain.length > 0
    ? sameDomain
    : input.tab === 'series'
      ? input.ratings.filter((rating) => rating.type === 'movie' && movieTransfer > 0)
      : [];
  const householdFire = mean(priorRatings.map((rating) => rating.fire));
  const householdWater = mean(priorRatings.map((rating) => rating.water));
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
      fire: lowEvidenceAxisPrior(householdFire),
      water: lowEvidenceAxisPrior(householdWater),
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

export function recommendationRewatchCadence(seed: string): boolean {
  // A stable hash bucket makes rewatch discovery rare, replayable, and
  // independent of process restarts: exactly one of seven possible buckets.
  return createHash('sha256').update(seed).digest().readUInt32BE(0) % 7 === 0;
}

function boundedImplicitAffinity(
  candidate: RecommendationFeature,
  preferences: ImplicitRecommendationPreference[],
): number {
  const weighted = preferences
    .map((preference) => ({
      similarity: cosineSimilarity(candidate.vector, preference.feature.vector),
      weight: Math.max(0, Math.min(1, preference.strength)),
    }))
    .filter((entry) => entry.similarity >= MIN_SIMILARITY && entry.weight > 0)
    .sort((left, right) => right.similarity * right.weight - left.similarity * left.weight)
    .slice(0, 12);
  const denominator = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (denominator <= 0) return 0;
  return weighted.reduce((sum, entry) => sum + entry.similarity * entry.weight, 0) / denominator;
}

function balancedViewerImplicitAffinity(similarities: number[]): number {
  if (similarities.length === 0) return 0;
  if (similarities.length === 1) return similarities[0]!;
  // Every viewer contributes one bounded similarity regardless of history
  // volume; a minority-protection term avoids optimizing only for the average.
  return 0.70 * mean(similarities) + 0.30 * Math.min(...similarities);
}

function boundedNegativeAffinity(
  candidate: RecommendationFeature,
  preferences: NegativeRecommendationPreference[],
): number {
  return preferences.reduce((strongest, preference) => {
    const strength = Math.max(0, Math.min(1, preference.strength));
    const similarity = cosineSimilarity(candidate.vector, preference.feature.vector);
    if (similarity < MIN_SIMILARITY || strength <= 0) return strongest;
    // Use the strongest semantic objection instead of accumulating dislikes;
    // this prevents a growing history from permanently burying broad genres.
    return Math.max(strongest, similarity * strength);
  }, 0);
}

export function balancedHouseholdAffinity(affinities: number[]): number {
  if (affinities.length === 0) return 2.5;
  if (affinities.length === 1) return affinities[0]!;
  const bounded = affinities.map((value) => Math.max(0.1, Math.min(5, value)));
  const average = mean(bounded);
  const geometric = Math.exp(mean(bounded.map((value) => Math.log(value / 5)))) * 5;
  const minimum = Math.min(...bounded);
  // Geometric satisfaction prevents one prolific viewer from dominating,
  // while the small minimum term protects a minority viewer from a poor slate.
  return 0.55 * geometric + 0.30 * average + 0.15 * minimum;
}

function mmrPick(
  candidates: ScoredRecommendation[],
  limit: number,
  alreadySelected: ScoredRecommendation[] = [],
  options: { explorationSeed?: string; maxPerCluster?: number } = {},
): ScoredRecommendation[] {
  const remaining = [...candidates];
  const selected: ScoredRecommendation[] = [];
  const maxPerCluster = Math.max(1, options.maxPerCluster ?? 2);
  const clusterCount = new Map<string, number>();
  for (const item of alreadySelected) {
    clusterCount.set(item.cluster, (clusterCount.get(item.cluster) ?? 0) + 1);
  }
  while (remaining.length && selected.length < limit) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    const comparison = [...alreadySelected, ...selected];
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      if ((clusterCount.get(candidate.cluster) ?? 0) >= maxPerCluster) continue;
      const redundancy = comparison.length
        ? Math.max(...comparison.map((item) => cosineSimilarity(candidate.vector, item.vector)))
        : 0;
      const discoveryPrior = options.explorationSeed
        ? seededUnit(`${options.explorationSeed}:${candidate.type}:${candidate.id}`)
        : 0;
      const score = options.explorationSeed
        // Exploration remains quality-bounded and diversity-aware. The stable
        // daily prior changes only the controlled discovery card, never the
        // four close matches or the adjacent pick.
        ? 0.46 * (candidate.affinity / 5) + 0.26 * discoveryPrior - 0.28 * redundancy
        : 0.72 * (candidate.affinity / 5) - 0.28 * redundancy;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (bestIndex < 0) break;
    const [picked] = remaining.splice(bestIndex, 1);
    picked!.diversity = 1 - Math.max(
      0,
      ...[...alreadySelected, ...selected].map((item) => cosineSimilarity(picked!.vector, item.vector)),
    );
    selected.push(picked!);
    clusterCount.set(picked!.cluster, (clusterCount.get(picked!.cluster) ?? 0) + 1);
  }
  return selected;
}

function fillMmrPick(
  preferred: ScoredRecommendation[],
  fallback: ScoredRecommendation[],
  limit: number,
  alreadySelected: ScoredRecommendation[] = [],
  options: { explorationSeed?: string; maxPerCluster?: number } = {},
): ScoredRecommendation[] {
  const selected = mmrPick(preferred, limit, alreadySelected, options);
  if (selected.length >= limit) return selected;
  const selectedKeys = new Set(selected.map((item) => `${item.type}:${item.id}`));
  return [
    ...selected,
    ...mmrPick(
      fallback.filter((item) => !selectedKeys.has(`${item.type}:${item.id}`)),
      limit - selected.length,
      [...alreadySelected, ...selected],
      options,
    ),
  ];
}

/** Visible slate stays six; the last-good snapshot aims deeper for shuffle/heal. */
export const FOR_YOU_VISIBLE_LIMIT = 6;
export const FOR_YOU_RESERVE_LIMIT = 200;
/** Strict diversity on the 10-foot six; softer on the deeper thematic reserve. */
const VISIBLE_CLUSTER_CAP = 2;
const RESERVE_CLUSTER_CAP = 5;

export type RankRecommendationsInput = {
  tab: 'movies' | 'series';
  candidates: RecommendationFeature[];
  ratings: FireWaterRating[];
  ratingFeatures: Map<string, RecommendationFeature>;
  /** One equally weighted group per viewer when Household is active. */
  ratingGroups?: FireWaterRating[][];
  implicitPreferences?: ImplicitRecommendationPreference[];
  /** One bounded positive-signal group per viewer for Household ranking. */
  implicitPreferenceGroups?: ImplicitRecommendationPreference[][];
  negativePreferences?: NegativeRecommendationPreference[];
  contextFeature?: RecommendationFeature | null;
  /** Cooled, non-negative titles eligible only for the rare exploration slot. */
  rewatchCandidates?: RecommendationFeature[];
  rewatchCadenceSeed?: string;
  dailySeed: string;
  limit?: number;
  /** Cards actually visible on the 10-foot rail; its mix is the user-facing contract. */
  visibleLimit?: number;
};

export function rankRecommendations(input: RankRecommendationsInput): ScoredRecommendation[] {
  const scoreCandidate = (candidate: RecommendationFeature): ScoredRecommendation => {
    const axes = predictAxes({ ...input, candidate });
    const groupAffinities = (input.ratingGroups ?? [])
      .filter((group) => group.length > 0)
      .map((ratings) => {
        const predicted = predictAxes({ ...input, candidate, ratings });
        return holisticAffinity(predicted.fire, predicted.water);
      });
    const explicitAffinity = groupAffinities.length > 1
      ? balancedHouseholdAffinity(groupAffinities)
      : holisticAffinity(axes.fire, axes.water);
    const viewerImplicitSimilarities = (input.implicitPreferenceGroups ?? [])
      .filter((group) => group.length > 0)
      .map((group) => boundedImplicitAffinity(candidate, group));
    const implicitSimilarity = viewerImplicitSimilarities.length > 0
      ? balancedViewerImplicitAffinity(viewerImplicitSimilarities)
      : boundedImplicitAffinity(candidate, input.implicitPreferences ?? []);
    const negativeSimilarity = boundedNegativeAffinity(candidate, input.negativePreferences ?? []);
    const contextSimilarity = input.contextFeature
      ? cosineSimilarity(candidate.vector, input.contextFeature.vector)
      : 0;
    // Implicit and session context can refine a slate, never rewrite explicit
    // taste. Current semantic dislikes are a soft, decayed penalty; exact-title
    // vetoes remain a service eligibility rule and Undo removes their signal.
    const secondaryAdjustment = Math.max(-0.20, Math.min(0.20,
      Math.min(0.30, implicitSimilarity * 0.30)
        + Math.min(0.25, contextSimilarity * 0.25)
        - Math.min(0.20, negativeSimilarity * 0.20),
    ));
    const affinity = Math.max(0, Math.min(5, explicitAffinity + secondaryAdjustment));
    return {
      ...candidate,
      predicted_fire: axes.fire,
      predicted_water: axes.water,
      affinity,
      diversity: 1,
      bucket: 'close' as const,
    };
  };
  const scored = input.candidates.map(scoreCandidate);
  const candidateKeys = new Set(input.candidates.map((candidate) => `${candidate.type}:${candidate.id}`));
  const rewatchScored = recommendationRewatchCadence(input.rewatchCadenceSeed ?? input.dailySeed)
    ? (input.rewatchCandidates ?? [])
      .filter((candidate) => !candidateKeys.has(`${candidate.type}:${candidate.id}`))
      .map((candidate) => ({ ...scoreCandidate(candidate), couch_provenance: 'watch_again' as const }))
      .sort((left, right) => right.affinity - left.affinity || left.id.localeCompare(right.id))
    : [];
  const byAffinity = [...scored].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id));
  const limit = Math.max(1, input.limit ?? FOR_YOU_RESERVE_LIMIT);
  const visibleLimit = Math.min(limit, Math.max(1, input.visibleLimit ?? FOR_YOU_VISIBLE_LIMIT));
  const closeTarget = Math.min(visibleLimit, Math.round(visibleLimit * 0.7));
  const adjacentTarget = Math.min(visibleLimit - closeTarget, Math.round(visibleLimit * 0.2));
  const exploreTarget = Math.max(0, visibleLimit - closeTarget - adjacentTarget);
  const closePoolSize = Math.max(closeTarget, Math.ceil(byAffinity.length * 0.55));
  const adjacentPoolEnd = Math.max(closePoolSize + adjacentTarget, Math.ceil(byAffinity.length * 0.82));
  const visibleOpts = { maxPerCluster: VISIBLE_CLUSTER_CAP };
  const close = fillMmrPick(byAffinity.slice(0, closePoolSize), byAffinity, closeTarget, [], visibleOpts)
    .map((item) => ({ ...item, bucket: 'close' as const }));
  const used = new Set(close.map((item) => `${item.type}:${item.id}`));
  const adjacentPool = byAffinity.slice(closePoolSize, adjacentPoolEnd)
    .filter((item) => !used.has(`${item.type}:${item.id}`));
  const adjacentFallback = byAffinity.filter((item) => !used.has(`${item.type}:${item.id}`));
  const adjacent = fillMmrPick(adjacentPool, adjacentFallback, adjacentTarget, close, visibleOpts)
    .map((item) => ({ ...item, bucket: 'adjacent' as const }));
  adjacent.forEach((item) => used.add(`${item.type}:${item.id}`));
  // Surprise is bounded, not random: use the viable upper 85%, a replay-stable
  // discovery prior, and the same global MMR/cluster budget as every other card.
  const explorationPool = byAffinity
    .slice(0, Math.max(visibleLimit, Math.ceil(byAffinity.length * 0.85)))
    .filter((item) => !used.has(`${item.type}:${item.id}`));
  const preExploration = [...close, ...adjacent];
  const rewatchExploration = exploreTarget > 0
    ? mmrPick(
      rewatchScored,
      1,
      preExploration,
      { explorationSeed: `${input.dailySeed}:rewatch`, maxPerCluster: VISIBLE_CLUSTER_CAP },
    )
    : [];
  const explorationFallback = byAffinity.filter((item) => !used.has(`${item.type}:${item.id}`));
  const regularExploration = fillMmrPick(
    explorationPool,
    explorationFallback,
    Math.max(0, exploreTarget - rewatchExploration.length),
    [...preExploration, ...rewatchExploration],
    { explorationSeed: input.dailySeed, maxPerCluster: VISIBLE_CLUSTER_CAP },
  );
  const exploration = [...rewatchExploration, ...regularExploration]
    .map((item) => ({ ...item, bucket: 'explore' as const }));
  const output: ScoredRecommendation[] = [...close, ...adjacent];
  output.push(...exploration);
  exploration.forEach((item) => used.add(`${item.type}:${item.id}`));

  // Deeper last-good reserve: stay inside the high-affinity thematic band, deepen
  // close/adjacent/explore pools for shuffle variety, then soft-cap MMR fill.
  if (output.length < limit) {
    const remaining = limit - output.length;
    const thematicCutoff = Math.max(
      limit * 2,
      Math.ceil(byAffinity.length * 0.65),
    );
    const affinityIndex = new Map(
      byAffinity.map((item, index) => [`${item.type}:${item.id}`, index] as const),
    );
    const thematic = byAffinity
      .slice(0, thematicCutoff)
      .filter((item) => !used.has(`${item.type}:${item.id}`));
    const reserveOpts = { maxPerCluster: RESERVE_CLUSTER_CAP };
    // Fill surprise/adjacent before close so cluster budget is not exhausted by
    // the large close band — shuffles need alternatives in every slot.
    const exploreExtraTarget = Math.ceil(remaining * 0.25);
    const adjacentExtraTarget = Math.ceil(remaining * 0.30);
    const closeExtraTarget = Math.max(0, remaining - exploreExtraTarget - adjacentExtraTarget);

    const exploreBand = thematic.filter((item) => !used.has(`${item.type}:${item.id}`));
    const exploreExtra = fillMmrPick(
      exploreBand,
      byAffinity.filter((item) => !used.has(`${item.type}:${item.id}`)),
      exploreExtraTarget,
      output,
      { ...reserveOpts, explorationSeed: `${input.dailySeed}:reserve` },
    ).map((item) => ({ ...item, bucket: 'fallback' as const }));
    exploreExtra.forEach((item) => used.add(`${item.type}:${item.id}`));
    output.push(...exploreExtra);

    const adjacentBand = thematic.filter((item) => {
      const index = affinityIndex.get(`${item.type}:${item.id}`) ?? -1;
      return index >= closePoolSize && index < adjacentPoolEnd && !used.has(`${item.type}:${item.id}`);
    });
    const adjacentExtra = fillMmrPick(
      adjacentBand,
      adjacentBand,
      adjacentExtraTarget,
      output,
      reserveOpts,
    ).map((item) => ({ ...item, bucket: 'adjacent' as const }));
    adjacentExtra.forEach((item) => used.add(`${item.type}:${item.id}`));
    output.push(...adjacentExtra);

    const closeBand = thematic.filter((item) => {
      const index = affinityIndex.get(`${item.type}:${item.id}`) ?? -1;
      return index >= 0 && index < closePoolSize && !used.has(`${item.type}:${item.id}`);
    });
    const closeExtra = fillMmrPick(
      closeBand,
      closeBand,
      closeExtraTarget,
      output,
      reserveOpts,
    ).map((item) => ({ ...item, bucket: 'close' as const }));
    closeExtra.forEach((item) => used.add(`${item.type}:${item.id}`));
    output.push(...closeExtra);

    // Affinity-ordered depth fill so cluster caps alone cannot stall at ~30–60.
    // Prefer the thematic band first, then remaining byAffinity order.
    const bucketForIndex = (index: number): ScoredRecommendation['bucket'] => (
      index < closePoolSize ? 'close'
        : index < adjacentPoolEnd ? 'adjacent'
          : 'fallback'
    );
    for (const item of thematic) {
      if (output.length >= limit) break;
      const key = `${item.type}:${item.id}` as const;
      if (used.has(key)) continue;
      used.add(key);
      const index = affinityIndex.get(key) ?? Number.POSITIVE_INFINITY;
      output.push({ ...item, bucket: bucketForIndex(index) });
    }
    if (output.length < limit) {
      for (const item of byAffinity) {
        if (output.length >= limit) break;
        const key = `${item.type}:${item.id}` as const;
        if (used.has(key)) continue;
        used.add(key);
        const index = affinityIndex.get(key) ?? Number.POSITIVE_INFINITY;
        output.push({ ...item, bucket: bucketForIndex(index) });
      }
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
      rail_ids: candidate.rail_ids,
    }));
}

export function recommendationDailySeed(tab: CatalogTab, now = new Date()): string {
  return `${tab}:${now.toISOString().slice(0, 10)}`;
}
