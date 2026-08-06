import { createHash } from 'node:crypto';
import type { RatingContentType } from '../library/ratings.js';
import {
  storyDnaToGraphEdges,
  type StoryDnaDocument,
  type StoryDnaGraphEdge,
} from './story-dna.js';
import { forYouRelevanceWeight } from './vod-browse-v3.js';

/** The v2 model consumes typed StoryDNA graph edges through a local posterior. */
export const VOD_STORY_GRAPH_MODEL_VERSION = 'vod-story-graph-v2' as const;
export const STORY_GRAPH_EXPLICIT_SHARE = 0.85;
export const STORY_GRAPH_IMPLICIT_SHARE = 0.15;
export const STORY_GRAPH_WATCH_HALF_LIFE_DAYS = 180;
export const STORY_GRAPH_MAX_THREADS = 3;
export const STORY_GRAPH_VISIBLE_LIMIT = 6;
export const STORY_GRAPH_DEALER_EXPONENT = 1.5;
export type StoryDealerWeightPolicy = 'rank' | 'relevance';

/** Two is neutral; only values below one are negative and values above two propagate. */
const PREFERENCE_FLOOR = 2;
const PREFERENCE_RANGE = 3;
const DIRICHLET_PRIOR_STRENGTH = 2;
const ORDINAL_PRIOR_STRENGTH = 2;
const AXIS_PRIOR_STRENGTH = 0.25;
/** A strongest single-axis 5/0 or 0/5 rating is one explicit-equivalent unit. */
const MIN_THREAD_SUPPORT = 0.75;
const MIXTURE_WEIGHT_PRIOR = 0.25;
const MAX_FAMILY_LOG_LIFT = Math.log(8);
const MIN_FAMILY_LOG_LIFT = -Math.log(4);
const MAX_FIT_ITERATIONS = 64;
const RESPONSIBILITY_CONVERGENCE = 1e-10;
const EPSILON = 1e-9;

/** Families are fixed and audited; node values remain ontology-versioned. */
export const STORY_GRAPH_FAMILIES = [
  'genre-subgenre', 'format', 'story-engine', 'theme', 'character-dynamic',
  'tone', 'setting-era', 'geographic-scope', 'social-setting',
  'narrative-structure', 'ending-emotional-arc',
  'facet.pace', 'facet.action', 'facet.tension', 'facet.spectacle',
  'facet.humor', 'facet.romance', 'facet.fear', 'facet.tenderness',
  'facet.sadness', 'facet.hope', 'facet.realism',
  'facet.narrative_complexity', 'facet.moral_ambiguity', 'facet.violence',
  'facet.family_accessibility',
  'language', 'country', 'decade', 'runtime', 'certification', 'creator', 'cast',
  'director', 'writer', 'franchise', 'studio', 'curated-list', 'compound',
] as const;

export type StoryGraphFamily = typeof STORY_GRAPH_FAMILIES[number];
export type StoryGraphContentId = `${RatingContentType}:${string}`;

export type StoryGraphEdge = {
  family: StoryGraphFamily;
  /** Stable ontology key or a deterministic metadata relation key. */
  node_key: string;
  /** Categorical edges use 1; ordinal edges use the controlled 0-4 value. */
  intensity: number;
  confidence: number;
  ordinal: boolean;
  source: 'teacher' | 'metadata' | 'compound' | 'metadata_fact'
    | 'curated_theme' | 'deterministic_rule' | 'llm_teacher' | 'mixed';
};

export type StoryGraphTitle = {
  type: RatingContentType;
  id: string;
  title: string;
  year?: string | null;
  /** Optional strict teacher overlay. Progressive factual profiles omit it. */
  story_dna?: StoryDnaDocument;
  /**
   * Persisted ontology/metadata/compound edges.  When omitted, deterministic
   * edges are derived from the canonical StoryDNA document.
   */
  edges?: StoryGraphEdge[];
  family_coverage?: Partial<Record<StoryGraphFamily, {
    state: 'observed' | 'known_absent' | 'unknown';
    confidence: number;
  }>>;
  profile_hash?: string;
  profile_state?: 'base' | 'enriched' | 'sparse_unresolved' | 'unrankable';
};

export type StoryGraphExplicitRating = {
  type: RatingContentType;
  id: string;
  fire: number;
  water: number;
};

export type StoryGraphImplicitSignal = {
  type: RatingContentType;
  id: string;
  kind: 'saved' | 'partial' | 'completion';
  /** Milliseconds since Unix epoch. Saved is durable; viewing decays. */
  occurred_at: number;
};

type FamilyBackground = {
  ordinal: boolean;
  document_mass: number;
  node_mass: Record<string, number>;
  ordinal_weight: number;
  ordinal_sum: number;
  ordinal_sum_squares: number;
};

export type StoryGraphBackground = {
  document_count: number;
  families: Record<string, FamilyBackground>;
};

type FamilyPosterior = {
  ordinal: boolean;
  evidence_mass: number;
  node_mass: Record<string, number>;
  ordinal_weight: number;
  ordinal_sum: number;
  ordinal_sum_squares: number;
  mean_confidence: number;
};

type StoryThreadProfile = {
  total_mass: number;
  families: Record<string, FamilyPosterior>;
};

export type StoryTasteThread = {
  thread_id: string;
  seed_id: StoryGraphContentId;
  member_ids: StoryGraphContentId[];
  effective_evidence_mass: number;
  explicit_evidence_mass: number;
  implicit_evidence_mass: number;
  fire_uplift: number;
  water_uplift: number;
  fire_uncertainty: number;
  water_uncertainty: number;
  explicit_profile: StoryThreadProfile;
  implicit_profile: StoryThreadProfile;
};

export type StoryTasteModel = {
  model_version: typeof VOD_STORY_GRAPH_MODEL_VERSION;
  background: StoryGraphBackground;
  threads: StoryTasteThread[];
  explicit_evidence_present: boolean;
  selected_k: number;
  loao: Array<{ k: number; mean_log_likelihood: number; standard_error: number }>;
  diagnostics: {
    qualifying_explicit: number;
    ignored_low_ratings: number;
    qualifying_implicit: number;
    missing_evidence_documents: number;
    total_explicit_mass: number;
    total_implicit_mass: number;
  };
};

export type StoryGraphThreadMatch = {
  thread_id: string;
  explicit_match: number;
  implicit_match: number;
  blended_match: number;
  posterior_standard_deviation: number;
  fire_support: number;
  water_support: number;
};

export type StoryGraphScoredRecommendation = {
  type: RatingContentType;
  id: string;
  title: string;
  year: string | null;
  predicted_fire: number;
  predicted_water: number;
  holistic: number;
  affinity: number;
  posterior_standard_deviation: number;
  rank_score: number;
  best_thread_id: string | null;
  explicit_support: number;
  implicit_support: number;
  feature_confidence: number;
  thread_matches: StoryGraphThreadMatch[];
};

export type StoryGraphRankInput = {
  algorithm: typeof VOD_STORY_GRAPH_MODEL_VERSION;
  documents: StoryGraphTitle[];
  /**
   * Verified-corpus identities used to fit the background prior. Retained
   * unplayable anchors may remain in `documents` to teach household taste, but
   * must never change the verified-corpus likelihood denominator.
   */
  background_ids?: StoryGraphContentId[];
  /** Persisted immutable priors for the captured content-profile generation. */
  background?: StoryGraphBackground;
  /** Omit to score the entire document corpus. */
  candidate_ids?: StoryGraphContentId[];
  explicit_ratings: StoryGraphExplicitRating[];
  implicit_signals?: StoryGraphImplicitSignal[];
  as_of: number;
  /** Service-only page hook; never sent to the worker. */
  on_page?: (cursor: number, total: number) => void | Promise<void>;
};

export type StoryDealerCacheItem = {
  rank: number;
  dealer_weight: number;
  recommendation: StoryGraphScoredRecommendation;
};

export type StoryDealerCache = {
  model_version: typeof VOD_STORY_GRAPH_MODEL_VERSION;
  weight_policy: StoryDealerWeightPolicy;
  thread_order: string[];
  items: StoryDealerCacheItem[];
};

export type StoryGraphRankResult = {
  model_version: typeof VOD_STORY_GRAPH_MODEL_VERSION;
  /** Returned so masked-profile calibration can reuse the exact fitted model. */
  background: StoryGraphBackground;
  selected_k: number;
  threads: StoryTasteThread[];
  /** Complete ranked input universe; publication/reserve depth is service policy. */
  ranked: StoryGraphScoredRecommendation[];
  portfolio: StoryGraphScoredRecommendation[];
  dealer_cache: StoryDealerCache;
  loao: StoryTasteModel['loao'];
  diagnostics: StoryTasteModel['diagnostics'];
};

type NormalizedFamily = {
  family: StoryGraphFamily;
  ordinal: boolean;
  nodes: Array<{ node_key: string; weight: number; confidence: number }>;
  ordinal_value: number | null;
  confidence: number;
};

type Anchor = {
  key: StoryGraphContentId;
  title: StoryGraphTitle;
  explicit_strength: number;
  implicit_strength: number;
  effective_strength: number;
  fire_positive: number;
  water_positive: number;
};

type FittedThreads = {
  requested_k: number;
  k: number;
  responsibilities: number[][];
  mixture_weights: number[];
  threads: StoryTasteThread[];
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function contentKey(type: RatingContentType, id: string): StoryGraphContentId {
  return `${type}:${id}`;
}

function stableUnit(seed: string): number {
  return (createHash('sha256').update(seed).digest().readUInt32BE(0) + 1) / 0x1_0000_0001;
}

function stableCompare(left: StoryGraphContentId, right: StoryGraphContentId): number {
  return left.localeCompare(right);
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function storyGraphWeightedMeanAndStandardError(
  values: readonly number[],
  weights: readonly number[],
): { mean: number; standardError: number } {
  if (values.length !== weights.length || values.length === 0) {
    return { mean: 0, standardError: 0 };
  }
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (totalWeight <= EPSILON) return { mean: 0, standardError: 0 };
  const mean = values.reduce(
    (sum, value, index) => sum + Math.max(0, weights[index]!) * value,
    0,
  ) / totalWeight;
  if (values.length < 2) return { mean, standardError: 0 };
  const sumSquaredWeights = weights.reduce(
    (sum, weight) => sum + Math.max(0, weight) ** 2,
    0,
  );
  const varianceDenominator = totalWeight - sumSquaredWeights / totalWeight;
  if (varianceDenominator <= EPSILON || sumSquaredWeights <= EPSILON) {
    return { mean, standardError: 0 };
  }
  const variance = values.reduce(
    (sum, value, index) => sum + Math.max(0, weights[index]!) * (value - mean) ** 2,
    0,
  ) / varianceDenominator;
  const effectiveSampleSize = totalWeight * totalWeight / sumSquaredWeights;
  return {
    mean,
    standardError: Math.sqrt(Math.max(0, variance) / effectiveSampleSize),
  };
}

function logSumExp(values: readonly number[]): number {
  if (values.length === 0) return Number.NEGATIVE_INFINITY;
  const maximum = Math.max(...values);
  if (!Number.isFinite(maximum)) return maximum;
  return maximum + Math.log(values.reduce(
    (sum, value) => sum + Math.exp(value - maximum),
    0,
  ));
}

/** Posterior predictive for a proper finite mixture, expressed as a log ratio. */
export function storyGraphMixtureLogRatio(
  componentLogRatios: readonly number[],
  componentWeights: readonly number[],
): number {
  if (componentLogRatios.length === 0
    || componentLogRatios.length !== componentWeights.length
    || componentLogRatios.some((value) => !Number.isFinite(value))
    || componentWeights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error('Story Graph mixture components and weights must be finite and aligned');
  }
  const totalWeight = componentWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= EPSILON) throw new Error('Story Graph mixture requires positive weight');
  return logSumExp(componentLogRatios.map((logRatio, index) => (
    componentWeights[index] === 0
      ? Number.NEGATIVE_INFINITY
      : Math.log(componentWeights[index]! / totalWeight) + logRatio
  )));
}

function confidenceShrunkLogRatio(logRatio: number, confidence: number): number {
  const boundedConfidence = clamp(confidence);
  if (boundedConfidence <= EPSILON) return 0;
  if (boundedConfidence >= 1 - EPSILON) return logRatio;
  return logSumExp([
    Math.log1p(-boundedConfidence),
    Math.log(boundedConfidence) + logRatio,
  ]);
}

function confidenceShrinkDerivative(logRatio: number, confidence: number): number {
  const boundedConfidence = clamp(confidence);
  if (boundedConfidence <= EPSILON) return 0;
  if (boundedConfidence >= 1 - EPSILON) return 1;
  const shrunk = confidenceShrunkLogRatio(logRatio, boundedConfidence);
  return clamp(Math.exp(Math.log(boundedConfidence) + logRatio - shrunk));
}

function assertHalfStep(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 5
    || Math.abs(value * 2 - Math.round(value * 2)) > EPSILON) {
    throw new Error(`${field} must be a Fire/Water half-step between 0 and 5`);
  }
}

/**
 * Positive-only thematic propagation above the neutral rating of two.
 *
 * Ratings below one are true negative labels. Ratings from one through two
 * are neutral. Negative ratings remain exact-title output exclusions rather
 * than broad semantic penalties, so one dislike cannot suppress an otherwise
 * supported household taste thread.
 */
export function positiveRatingEvidence(rating: number): number {
  if (!Number.isFinite(rating)) throw new Error('rating must be finite');
  return (Math.max(0, clamp(rating, 0, 5) - PREFERENCE_FLOOR) / PREFERENCE_RANGE) ** 2;
}

export function storyRatingAnchorStrength(fire: number, water: number): number {
  assertHalfStep(fire, 'fire');
  assertHalfStep(water, 'water');
  const positiveFire = positiveRatingEvidence(fire);
  const positiveWater = positiveRatingEvidence(water);
  return 0.75 * Math.max(positiveFire, positiveWater)
    + 0.25 * Math.min(positiveFire, positiveWater);
}

export function storyHolisticAffinity(fire: number, water: number): number {
  return 0.75 * Math.max(fire, water) + 0.25 * Math.min(fire, water);
}

/**
 * Adapter for Track A's canonical document. Persisted graph edges remain
 * authoritative when supplied by the service.
 */
export function storyDnaDocumentEdges(document: StoryDnaDocument): StoryGraphEdge[] {
  return storyDnaToGraphEdges(document).map((item: StoryDnaGraphEdge) => {
    if (!(STORY_GRAPH_FAMILIES as readonly string[]).includes(item.family)) {
      throw new Error(`unsupported canonical StoryDNA family: ${item.family}`);
    }
    return {
      family: item.family as StoryGraphFamily,
      node_key: item.node_key,
      intensity: item.intensity,
      confidence: item.confidence,
      ordinal: item.family.startsWith('facet.'),
      source: item.edge_source,
    };
  });
}

function validateEdge(value: StoryGraphEdge): StoryGraphEdge {
  if (!(STORY_GRAPH_FAMILIES as readonly string[]).includes(value.family)) {
    throw new Error(`unsupported StoryDNA graph family: ${value.family}`);
  }
  if (!value.node_key.startsWith(`${value.family}:`)
    || value.node_key.length > 300 || /[\s\u0000-\u001f]/.test(value.node_key)) {
    throw new Error(`invalid StoryDNA graph node: ${value.node_key}`);
  }
  if (!Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 4
    || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('StoryDNA graph edge intensity/confidence is out of bounds');
  }
  if (value.ordinal && !value.node_key.startsWith(`${value.family}:`)) {
    throw new Error('ordinal StoryDNA graph node does not match its family');
  }
  return value;
}

export function validateStoryGraphTitle(value: StoryGraphTitle): StoryGraphTitle {
  if (!value || !['movie', 'series'].includes(value.type) || !value.id?.trim() || !value.title?.trim()) {
    throw new Error('Story graph title identity is incomplete');
  }
  if (value.story_dna
    && (value.story_dna.type !== value.type || value.story_dna.id !== value.id)) {
    throw new Error('StoryDNA identity does not match story graph title');
  }
  if (!value.story_dna && (value.edges?.length ?? 0) === 0) {
    throw new Error('progressive story graph title has no factual edges');
  }
  const seen = new Set<string>();
  for (const item of value.edges ?? []) {
    validateEdge(item);
    const key = `${item.family}:${item.node_key}:${item.ordinal ? 'ordinal' : 'categorical'}`;
    if (seen.has(key)) throw new Error(`duplicate StoryDNA graph edge: ${item.node_key}`);
    seen.add(key);
  }
  return value;
}

function allTitleEdges(title: StoryGraphTitle): StoryGraphEdge[] {
  const byKey = new Map<string, StoryGraphEdge>();
  const sourcePriority = (source: StoryGraphEdge['source']): number => ({
    metadata_fact: 7, metadata: 6, mixed: 5, llm_teacher: 4, teacher: 4,
    curated_theme: 3, deterministic_rule: 2, compound: 1,
  })[source] ?? 0;
  for (const item of [
    ...(title.story_dna ? storyDnaDocumentEdges(title.story_dna) : []),
    ...(title.edges ?? []),
  ]) {
    const key = `${item.family}:${item.node_key}:${item.ordinal ? 'ordinal' : 'categorical'}`;
    const previous = byKey.get(key);
    if (!previous || item.confidence > previous.confidence
      || (item.confidence === previous.confidence
        && sourcePriority(item.source) > sourcePriority(previous.source))) {
      byKey.set(key, validateEdge(item));
    }
  }
  return [...byKey.values()].sort((left, right) => (
    left.family.localeCompare(right.family) || left.node_key.localeCompare(right.node_key)
  ));
}

function normalizedFamilies(title: StoryGraphTitle): NormalizedFamily[] {
  const grouped = new Map<StoryGraphFamily, StoryGraphEdge[]>();
  for (const item of allTitleEdges(title)) {
    const group = grouped.get(item.family) ?? [];
    group.push(item);
    grouped.set(item.family, group);
  }
  const output: NormalizedFamily[] = [];
  for (const [family, items] of grouped) {
    const ordinalItems = items.filter((item) => item.ordinal);
    if (ordinalItems.length > 0) {
      const weight = ordinalItems.reduce((sum, item) => sum + item.confidence, 0);
      output.push({
        family,
        ordinal: true,
        nodes: [],
        ordinal_value: weight > 0
          ? ordinalItems.reduce((sum, item) => sum + item.intensity * item.confidence, 0) / weight
          : 2,
        confidence: weight > 0 ? average(ordinalItems.map((item) => item.confidence)) : 0,
      });
      continue;
    }
    const rawWeights = items.map((item) => Math.max(EPSILON, item.intensity) * item.confidence);
    const total = rawWeights.reduce((sum, item) => sum + item, 0);
    if (total <= EPSILON) continue;
    output.push({
      family,
      ordinal: false,
      nodes: items.map((item, index) => ({
        node_key: item.node_key,
        weight: rawWeights[index]! / total,
        confidence: item.confidence,
      })),
      ordinal_value: null,
      confidence: average(items.map((item) => item.confidence)),
    });
  }
  return output.sort((left, right) => left.family.localeCompare(right.family));
}

function emptyFamilyBackground(ordinal: boolean): FamilyBackground {
  return {
    ordinal,
    document_mass: 0,
    node_mass: {},
    ordinal_weight: 0,
    ordinal_sum: 0,
    ordinal_sum_squares: 0,
  };
}

/** Corpus priors are computed once per immutable StoryDNA generation. */
export function buildStoryGraphBackground(documents: StoryGraphTitle[]): StoryGraphBackground {
  const identities = new Set<StoryGraphContentId>();
  const progressive = documents.some((document) => document.family_coverage !== undefined);
  const families: Record<string, FamilyBackground> = progressive
    ? Object.fromEntries(STORY_GRAPH_FAMILIES.map((family) => [
      family,
      emptyFamilyBackground(family.startsWith('facet.')),
    ]))
    : {};
  const orderedDocuments = documents.map((document) => validateStoryGraphTitle(document))
    .sort((left, right) => stableCompare(
      contentKey(left.type, left.id),
      contentKey(right.type, right.id),
    ));
  for (const title of orderedDocuments) {
    const identity = contentKey(title.type, title.id);
    if (identities.has(identity)) throw new Error(`duplicate StoryDNA title: ${identity}`);
    identities.add(identity);
    for (const family of normalizedFamilies(title)) {
      const background = families[family.family]
        ?? (families[family.family] = emptyFamilyBackground(family.ordinal));
      if (background.ordinal !== family.ordinal) {
        throw new Error(`StoryDNA family mixes ordinal and categorical edges: ${family.family}`);
      }
      background.document_mass += 1;
      if (family.ordinal) {
        const value = family.ordinal_value ?? 2;
        const weight = family.confidence;
        background.ordinal_weight += weight;
        background.ordinal_sum += value * weight;
        background.ordinal_sum_squares += value * value * weight;
      } else {
        for (const node of family.nodes) {
          background.node_mass[node.node_key] = (background.node_mass[node.node_key] ?? 0) + node.weight;
        }
      }
    }
  }
  return { document_count: identities.size, families };
}

function emptyProfile(): StoryThreadProfile {
  return { total_mass: 0, families: {} };
}

function emptyFamilyPosterior(ordinal: boolean): FamilyPosterior {
  return {
    ordinal,
    evidence_mass: 0,
    node_mass: {},
    ordinal_weight: 0,
    ordinal_sum: 0,
    ordinal_sum_squares: 0,
    mean_confidence: 0,
  };
}

function addTitleToProfile(profile: StoryThreadProfile, title: StoryGraphTitle, evidenceWeight: number): void {
  if (evidenceWeight <= 0) return;
  profile.total_mass += evidenceWeight;
  for (const family of normalizedFamilies(title)) {
    const posterior = profile.families[family.family]
      ?? (profile.families[family.family] = emptyFamilyPosterior(family.ordinal));
    if (posterior.ordinal !== family.ordinal) {
      throw new Error(`StoryDNA posterior family kind drifted: ${family.family}`);
    }
    const effectiveWeight = evidenceWeight * family.confidence;
    const previousMass = posterior.evidence_mass;
    posterior.evidence_mass += effectiveWeight;
    posterior.mean_confidence = posterior.evidence_mass > 0
      ? (posterior.mean_confidence * previousMass + family.confidence * effectiveWeight)
        / posterior.evidence_mass
      : 0;
    if (family.ordinal) {
      const value = family.ordinal_value ?? 2;
      posterior.ordinal_weight += effectiveWeight;
      posterior.ordinal_sum += value * effectiveWeight;
      posterior.ordinal_sum_squares += value * value * effectiveWeight;
      continue;
    }
    for (const node of family.nodes) {
      // normalizedFamilies already uses edge confidence when distributing a
      // multi-value family. Do not multiply it a second time: categorical node
      // masses must sum exactly to the family's effective evidence mass.
      const nodeWeight = effectiveWeight * node.weight;
      posterior.node_mass[node.node_key] = (posterior.node_mass[node.node_key] ?? 0) + nodeWeight;
    }
  }
}

function categoricalBackgroundProbability(background: FamilyBackground, nodeKey: string): number {
  const vocabulary = Object.keys(background.node_mass).length + 1;
  const total = Object.values(background.node_mass).reduce((sum, value) => sum + value, 0);
  return clamp(
    ((background.node_mass[nodeKey] ?? 0) + 0.25) / (total + 0.25 * vocabulary),
    EPSILON,
    1 - EPSILON,
  );
}

function ordinalBackgroundMoments(background: FamilyBackground | undefined): { mean: number; variance: number } {
  if (!background || background.ordinal_weight <= EPSILON) return { mean: 2, variance: 1.25 ** 2 };
  const mean = background.ordinal_sum / background.ordinal_weight;
  const secondMoment = background.ordinal_sum_squares / background.ordinal_weight;
  return { mean, variance: Math.max(0.35 ** 2, secondMoment - mean * mean) };
}

function normalLogDensity(value: number, mean: number, variance: number): number {
  const safeVariance = Math.max(0.05 ** 2, variance);
  return -0.5 * (Math.log(2 * Math.PI * safeVariance) + (value - mean) ** 2 / safeVariance);
}

type LikelihoodResult = {
  log_ratio: number;
  standard_deviation: number;
  family_count: number;
};

/**
 * Equal-family posterior-predictive likelihood ratio. Every multi-value family
 * has unit total mass; rare lift is capped and low-confidence candidate edges
 * are shrunk toward the complete-corpus prior.
 */
function profileLikelihood(
  profile: StoryThreadProfile,
  title: StoryGraphTitle,
  background: StoryGraphBackground,
): LikelihoodResult {
  const familyScores: number[] = [];
  const familyVariances: number[] = [];
  const candidateFamilies = new Map(
    normalizedFamilies(title).map((family) => [family.family, family] as const),
  );
  // The verified generation fixes the denominator. A sparse/low-confidence
  // title cannot appear more certain merely because absent families were
  // omitted from its average.
  const backgroundFamilies = Object.keys(background.families).sort() as StoryGraphFamily[];
  const confidenceAdjustedProfileMass = backgroundFamilies.length > 0
    ? backgroundFamilies.reduce(
      (sum, family) => sum + (profile.families[family]?.evidence_mass ?? 0),
      0,
    ) / backgroundFamilies.length
    : 0;
  for (const familyName of backgroundFamilies) {
    const corpus = background.families[familyName]!;
    const candidateFamily = candidateFamilies.get(familyName);
    if (!candidateFamily) {
      familyScores.push(0);
      familyVariances.push(1 + 1 / (confidenceAdjustedProfileMass + 1));
      continue;
    }
    if (corpus.ordinal !== candidateFamily.ordinal) {
      throw new Error(`StoryDNA candidate/background family kind drifted: ${familyName}`);
    }
    const posterior = profile.families[candidateFamily.family]
      ?? emptyFamilyPosterior(candidateFamily.ordinal);
    if (candidateFamily.ordinal) {
      const corpusMoments = ordinalBackgroundMoments(corpus);
      const posteriorWeight = posterior.ordinal_weight;
      const posteriorMean = (
        ORDINAL_PRIOR_STRENGTH * corpusMoments.mean + posterior.ordinal_sum
      ) / (ORDINAL_PRIOR_STRENGTH + posteriorWeight);
      const posteriorSecondMoment = (
        ORDINAL_PRIOR_STRENGTH * (
          corpusMoments.variance + corpusMoments.mean * corpusMoments.mean
        ) + posterior.ordinal_sum_squares
      ) / (ORDINAL_PRIOR_STRENGTH + posteriorWeight);
      const posteriorVariance = Math.max(
        0.35 ** 2,
        posteriorSecondMoment - posteriorMean * posteriorMean
          + 1 / (ORDINAL_PRIOR_STRENGTH + posteriorWeight + 1),
      );
      const confidence = candidateFamily.confidence;
      const observed = candidateFamily.ordinal_value ?? corpusMoments.mean;
      const rawLogRatio = normalLogDensity(observed, posteriorMean, posteriorVariance)
        - normalLogDensity(observed, corpusMoments.mean, corpusMoments.variance);
      // Shrink the predictive density, not the observed value. At confidence
      // zero the candidate is exactly corpus-like and therefore has zero lift.
      const logRatio = confidenceShrunkLogRatio(rawLogRatio, confidence);
      const shrinkDerivative = confidenceShrinkDerivative(rawLogRatio, confidence);
      familyScores.push(clamp(logRatio, MIN_FAMILY_LOG_LIFT, MAX_FAMILY_LOG_LIFT));
      familyVariances.push(
        shrinkDerivative ** 2 / (ORDINAL_PRIOR_STRENGTH + posteriorWeight + 1)
          + (1 - confidence) ** 2,
      );
      continue;
    }
    let familyScore = 0;
    let familyVariance = 0;
    for (const node of candidateFamily.nodes) {
      const backgroundProbability = categoricalBackgroundProbability(corpus, node.node_key);
      const posteriorProbability = clamp((
        (posterior.node_mass[node.node_key] ?? 0)
          + DIRICHLET_PRIOR_STRENGTH * backgroundProbability
      ) / (posterior.evidence_mass + DIRICHLET_PRIOR_STRENGTH), EPSILON, 1 - EPSILON);
      // Confidence shrink in probability space makes c=0 exactly corpus-like.
      const shrunkProbability = node.confidence * posteriorProbability
        + (1 - node.confidence) * backgroundProbability;
      const logLift = clamp(
        Math.log(shrunkProbability / backgroundProbability),
        MIN_FAMILY_LOG_LIFT,
        MAX_FAMILY_LOG_LIFT,
      );
      familyScore += node.weight * logLift;
      const probabilityVariance = posteriorProbability * (1 - posteriorProbability)
        / (posterior.evidence_mass + DIRICHLET_PRIOR_STRENGTH + 1);
      familyVariance += node.weight * node.weight * (
        node.confidence ** 2 * probabilityVariance
          / Math.max(EPSILON, shrunkProbability * shrunkProbability)
          + (1 - node.confidence) ** 2
      );
    }
    familyScores.push(familyScore);
    familyVariances.push(familyVariance);
  }
  if (familyScores.length === 0) return { log_ratio: 0, standard_deviation: 1, family_count: 0 };
  return {
    log_ratio: average(familyScores),
    standard_deviation: clamp(
      Math.sqrt(familyVariances.reduce((sum, value) => sum + value, 0)) / familyScores.length
        + Math.sqrt(1 / (confidenceAdjustedProfileMass + 1)) * 0.35,
      0,
      1,
    ),
    family_count: familyScores.length,
  };
}

function positiveLikelihoodMatch(logRatio: number): number {
  return clamp(1 - Math.exp(-Math.max(0, logRatio)));
}

/** Convert log-likelihood uncertainty into the nonlinear 0-1 support scale. */
export function likelihoodMatchStandardDeviation(logRatio: number, logStandardDeviation: number): number {
  if (!Number.isFinite(logRatio) || !Number.isFinite(logStandardDeviation) || logStandardDeviation < 0) {
    throw new Error('likelihood uncertainty must be finite and non-negative');
  }
  if (logStandardDeviation <= EPSILON) return 0;

  // If X is the uncertain log-likelihood ratio then couch support is
  // Y=max(0, 1-exp(-X)).  Computing Var(Y) from the truncated-normal moments
  // avoids the zero-boundary artefact of taking half an interval width: a
  // low-confidence estimate centred at zero must remain uncertain, not look
  // safer than a well-supported positive match.
  const sigmaSquared = logStandardDeviation * logStandardDeviation;
  const probabilityPositive = standardNormalCdf(logRatio / logStandardDeviation);
  const firstTruncatedMoment = Math.exp(-logRatio + sigmaSquared / 2)
    * standardNormalCdf((logRatio - sigmaSquared) / logStandardDeviation);
  const secondTruncatedMoment = Math.exp(-2 * logRatio + 2 * sigmaSquared)
    * standardNormalCdf((logRatio - 2 * sigmaSquared) / logStandardDeviation);
  const mean = probabilityPositive - firstTruncatedMoment;
  const secondMoment = probabilityPositive - 2 * firstTruncatedMoment + secondTruncatedMoment;
  return clamp(Math.sqrt(Math.max(0, secondMoment - mean * mean)), 0, 0.5);
}

/** Deterministic approximation; maximum absolute error is below 2e-7. */
function standardNormalCdf(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * scaled);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-scaled * scaled);
  return clamp(0.5 * (1 + sign * erf));
}

function titleFeatureConfidence(title: StoryGraphTitle): number {
  if (title.family_coverage) {
    return STORY_GRAPH_FAMILIES.reduce(
      (sum, family) => sum + Math.max(0, Math.min(1, title.family_coverage?.[family]?.confidence ?? 0)),
      0,
    ) / STORY_GRAPH_FAMILIES.length;
  }
  const families = normalizedFamilies(title);
  return families.length > 0 ? average(families.map((family) => family.confidence)) : 0;
}

function implicitSignalStrength(signal: StoryGraphImplicitSignal, asOf: number): number {
  if (!Number.isFinite(signal.occurred_at) || signal.occurred_at < 0 || !Number.isFinite(asOf)) {
    throw new Error('implicit recommendation signal has invalid time');
  }
  if (signal.kind === 'saved') return 0.8;
  const ageDays = Math.max(0, asOf - signal.occurred_at) / (24 * 60 * 60 * 1_000);
  const decay = 2 ** (-ageDays / STORY_GRAPH_WATCH_HALF_LIFE_DAYS);
  return (signal.kind === 'completion' ? 1 : 0.55) * decay;
}

function buildAnchors(input: {
  documents: StoryGraphTitle[];
  explicit_ratings: StoryGraphExplicitRating[];
  implicit_signals: StoryGraphImplicitSignal[];
  as_of: number;
}): { anchors: Anchor[]; diagnostics: StoryTasteModel['diagnostics']; explicitPresent: boolean } {
  const documents = new Map<StoryGraphContentId, StoryGraphTitle>();
  for (const title of input.documents) documents.set(contentKey(title.type, title.id), title);
  const explicit = new Map<StoryGraphContentId, {
    strength: number;
    fire_positive: number;
    water_positive: number;
  }>();
  let ignoredLowRatings = 0;
  let missingDocuments = 0;
  for (const rating of input.explicit_ratings) {
    assertHalfStep(rating.fire, 'fire');
    assertHalfStep(rating.water, 'water');
    const key = contentKey(rating.type, rating.id);
    if (!documents.has(key)) {
      missingDocuments += 1;
      continue;
    }
    const strength = storyRatingAnchorStrength(rating.fire, rating.water);
    if (strength <= 0) {
      ignoredLowRatings += 1;
      continue;
    }
    const candidate = {
      strength,
      fire_positive: positiveRatingEvidence(rating.fire),
      water_positive: positiveRatingEvidence(rating.water),
    };
    const previous = explicit.get(key);
    // Current storage is one row/title. The guard keeps duplicate fixtures or
    // household blends from multiplying an exact title's influence.
    if (!previous || candidate.strength > previous.strength) explicit.set(key, candidate);
  }
  const implicit = new Map<StoryGraphContentId, number>();
  for (const signal of input.implicit_signals) {
    const key = contentKey(signal.type, signal.id);
    if (!documents.has(key)) {
      missingDocuments += 1;
      continue;
    }
    implicit.set(key, Math.max(implicit.get(key) ?? 0, implicitSignalStrength(signal, input.as_of)));
  }
  const explicitPresent = explicit.size > 0;
  const implicitEquivalentScale = explicitPresent
    ? STORY_GRAPH_IMPLICIT_SHARE / STORY_GRAPH_EXPLICIT_SHARE
    : 1;
  const keys = new Set<StoryGraphContentId>([...explicit.keys(), ...implicit.keys()]);
  const anchors = [...keys].map((key): Anchor => {
    const explicitEvidence = explicit.get(key);
    const explicitStrength = explicitEvidence?.strength ?? 0;
    const implicitStrength = implicit.get(key) ?? 0;
    return {
      key,
      title: documents.get(key)!,
      explicit_strength: explicitStrength,
      implicit_strength: implicitStrength,
      effective_strength: explicitStrength + implicitEquivalentScale * implicitStrength,
      fire_positive: explicitEvidence?.fire_positive ?? 0,
      water_positive: explicitEvidence?.water_positive ?? 0,
    };
  }).filter((anchor) => anchor.effective_strength > 0)
    .sort((left, right) => stableCompare(left.key, right.key));
  return {
    anchors,
    explicitPresent,
    diagnostics: {
      qualifying_explicit: explicit.size,
      ignored_low_ratings: ignoredLowRatings,
      qualifying_implicit: implicit.size,
      missing_evidence_documents: missingDocuments,
      total_explicit_mass: [...explicit.values()].reduce((sum, item) => sum + item.strength, 0),
      total_implicit_mass: [...implicit.values()].reduce((sum, item) => sum + item, 0),
    },
  };
}

function threadId(seed: StoryGraphContentId): string {
  return `taste-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function buildThread(
  members: Anchor[],
  seed: Anchor,
  membershipWeights: readonly number[] = members.map(() => 1),
  memberIds: StoryGraphContentId[] = members.map((member) => member.key),
): StoryTasteThread {
  if (membershipWeights.length !== members.length) {
    throw new Error('thread membership weights must align with anchors');
  }
  const explicitProfile = emptyProfile();
  const implicitProfile = emptyProfile();
  let explicitMass = 0;
  let implicitMass = 0;
  let effectiveMass = 0;
  let fireNumerator = 0;
  let waterNumerator = 0;
  for (let index = 0; index < members.length; index += 1) {
    const anchor = members[index]!;
    const membershipWeight = clamp(membershipWeights[index]!);
    addTitleToProfile(
      explicitProfile,
      anchor.title,
      anchor.explicit_strength * membershipWeight,
    );
    addTitleToProfile(
      implicitProfile,
      anchor.title,
      anchor.implicit_strength * membershipWeight,
    );
    explicitMass += anchor.explicit_strength * membershipWeight;
    implicitMass += anchor.implicit_strength * membershipWeight;
    effectiveMass += anchor.effective_strength * membershipWeight;
    fireNumerator += anchor.explicit_strength * membershipWeight * anchor.fire_positive;
    waterNumerator += anchor.explicit_strength * membershipWeight * anchor.water_positive;
  }
  const fireUplift = clamp(fireNumerator / (explicitMass + AXIS_PRIOR_STRENGTH));
  const waterUplift = clamp(waterNumerator / (explicitMass + AXIS_PRIOR_STRENGTH));
  return {
    thread_id: threadId(seed.key),
    seed_id: seed.key,
    member_ids: [...new Set(memberIds)].sort(stableCompare),
    effective_evidence_mass: effectiveMass,
    explicit_evidence_mass: explicitMass,
    implicit_evidence_mass: implicitMass,
    fire_uplift: fireUplift,
    water_uplift: waterUplift,
    fire_uncertainty: clamp(Math.sqrt(
      (fireUplift * (1 - fireUplift) + AXIS_PRIOR_STRENGTH) / (explicitMass + 1),
    )),
    water_uncertainty: clamp(Math.sqrt(
      (waterUplift * (1 - waterUplift) + AXIS_PRIOR_STRENGTH) / (explicitMass + 1),
    )),
    explicit_profile: explicitProfile,
    implicit_profile: implicitProfile,
  };
}

function blendedThreadLogRatio(
  thread: StoryTasteThread,
  title: StoryGraphTitle,
  background: StoryGraphBackground,
  explicitPresent: boolean,
): number {
  const explicitLikelihood = profileLikelihood(thread.explicit_profile, title, background);
  const implicitLikelihood = profileLikelihood(thread.implicit_profile, title, background);
  // Mixture fitting uses the joint posterior predictive across equally weighted
  // families. Candidate serving retains the bounded per-family mean below.
  const explicit = explicitLikelihood.log_ratio * explicitLikelihood.family_count;
  const implicit = implicitLikelihood.log_ratio * implicitLikelihood.family_count;
  return explicitPresent
    ? STORY_GRAPH_EXPLICIT_SHARE * explicit + STORY_GRAPH_IMPLICIT_SHARE * implicit
    : implicit;
}

function chooseInitialSeeds(
  anchors: Anchor[],
  requestedK: number,
  background: StoryGraphBackground,
  explicitPresent: boolean,
): Anchor[] {
  if (anchors.length === 0 || requestedK <= 0) return [];
  const first = [...anchors].sort((left, right) => {
    const leftScore = stableUnit(`story-seed:${requestedK}:${left.key}`)
      / Math.max(0.05, Math.sqrt(left.effective_strength));
    const rightScore = stableUnit(`story-seed:${requestedK}:${right.key}`)
      / Math.max(0.05, Math.sqrt(right.effective_strength));
    return leftScore - rightScore || stableCompare(left.key, right.key);
  })[0]!;
  const seeds = [first];
  while (seeds.length < Math.min(requestedK, anchors.length)) {
    const seedThreads = seeds.map((seed) => buildThread([seed], seed));
    const candidates = anchors.filter((anchor) => !seeds.some((seed) => seed.key === anchor.key));
    candidates.sort((left, right) => {
      const leftBest = Math.max(...seedThreads.map((thread) => blendedThreadLogRatio(
        thread, left.title, background, explicitPresent,
      )));
      const rightBest = Math.max(...seedThreads.map((thread) => blendedThreadLogRatio(
        thread, right.title, background, explicitPresent,
      )));
      const leftNovelty = 1 / (1 + Math.exp(clamp(leftBest, -20, 20)));
      const rightNovelty = 1 / (1 + Math.exp(clamp(rightBest, -20, 20)));
      const leftScore = leftNovelty * Math.sqrt(left.effective_strength)
        + stableUnit(`story-farthest:${requestedK}:${left.key}`) * 1e-9;
      const rightScore = rightNovelty * Math.sqrt(right.effective_strength)
        + stableUnit(`story-farthest:${requestedK}:${right.key}`) * 1e-9;
      return rightScore - leftScore || stableCompare(left.key, right.key);
    });
    seeds.push(candidates[0]!);
  }
  return seeds;
}

function mixtureWeights(threads: readonly StoryTasteThread[]): number[] {
  if (threads.length === 0) return [];
  const totalMass = threads.reduce(
    (sum, thread) => sum + thread.effective_evidence_mass,
    0,
  );
  return threads.map((thread) => (
    (thread.effective_evidence_mass + MIXTURE_WEIGHT_PRIOR)
      / (totalMass + MIXTURE_WEIGHT_PRIOR * threads.length)
  ));
}

function mixtureLogPredictiveRatio(input: {
  title: StoryGraphTitle;
  threads: readonly StoryTasteThread[];
  mixture_weights: readonly number[];
  background: StoryGraphBackground;
  explicit_present: boolean;
}): number {
  if (input.threads.length === 0 || input.threads.length !== input.mixture_weights.length) {
    return 0;
  }
  return storyGraphMixtureLogRatio(input.threads.map((thread) => blendedThreadLogRatio(
    thread,
    input.title,
    input.background,
    input.explicit_present,
  )), input.mixture_weights);
}

function posteriorResponsibilities(input: {
  anchor: Anchor;
  threads: readonly StoryTasteThread[];
  mixture_weights: readonly number[];
  background: StoryGraphBackground;
  explicit_present: boolean;
}): number[] {
  const scores = input.threads.map((thread, index) => (
    Math.log(Math.max(EPSILON, input.mixture_weights[index]!))
      + blendedThreadLogRatio(
        thread,
        input.anchor.title,
        input.background,
        input.explicit_present,
      )
  ));
  const denominator = logSumExp(scores);
  if (!Number.isFinite(denominator)) {
    return input.threads.map(() => 1 / Math.max(1, input.threads.length));
  }
  const values = scores.map((score) => Math.exp(score - denominator));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / Math.max(EPSILON, total));
}

/** Stable MAP labels for persisted diagnostics only; fitting remains fractional. */
function representativeMemberIds(
  anchors: Anchor[],
  seeds: Anchor[],
  responsibilities: readonly (readonly number[])[],
): StoryGraphContentId[][] {
  const output = Array.from({ length: seeds.length }, () => [] as StoryGraphContentId[]);
  anchors.forEach((anchor, anchorIndex) => {
    const seedIndex = seeds.findIndex((seed) => seed.key === anchor.key);
    if (seedIndex >= 0) {
      output[seedIndex]!.push(anchor.key);
      return;
    }
    const row = responsibilities[anchorIndex] ?? [];
    let bestIndex = 0;
    for (let index = 1; index < seeds.length; index += 1) {
      if ((row[index] ?? 0) > (row[bestIndex] ?? 0) + EPSILON) bestIndex = index;
    }
    output[bestIndex]!.push(anchor.key);
  });
  return output;
}

function threadsForResponsibilities(input: {
  anchors: Anchor[];
  seeds: Anchor[];
  responsibilities: readonly (readonly number[])[];
}): StoryTasteThread[] {
  const memberIds = representativeMemberIds(input.anchors, input.seeds, input.responsibilities);
  return input.seeds.map((seed, componentIndex) => buildThread(
    input.anchors,
    seed,
    input.responsibilities.map((row) => row[componentIndex] ?? 0),
    memberIds[componentIndex],
  ));
}

function mixtureObjective(input: {
  anchors: Anchor[];
  threads: StoryTasteThread[];
  mixture_weights: number[];
  background: StoryGraphBackground;
  explicit_present: boolean;
}): number {
  return input.anchors.reduce((sum, anchor) => {
    const fit = mixtureLogPredictiveRatio({
      title: anchor.title,
      threads: input.threads,
      mixture_weights: input.mixture_weights,
      background: input.background,
      explicit_present: input.explicit_present,
    });
    return sum + anchor.effective_strength * fit;
  }, 0);
}

type SoftMixtureState = {
  responsibilities: number[][];
  mixture_weights: number[];
  threads: StoryTasteThread[];
  objective: number;
};

function responsibilityStateKey(responsibilities: readonly (readonly number[])[]): string {
  return responsibilities.map((row) => row.map((value) => value.toFixed(12)).join(',')).join(';');
}

function betterSoftState(
  candidate: SoftMixtureState,
  current: SoftMixtureState | null,
): boolean {
  if (!current) return true;
  if (candidate.objective > current.objective + EPSILON) return true;
  if (candidate.objective < current.objective - EPSILON) return false;
  return responsibilityStateKey(candidate.responsibilities)
    < responsibilityStateKey(current.responsibilities);
}

function materializeSoftState(input: {
  anchors: Anchor[];
  seeds: Anchor[];
  responsibilities: number[][];
  background: StoryGraphBackground;
  explicit_present: boolean;
}): SoftMixtureState {
  const threads = threadsForResponsibilities(input);
  const weights = mixtureWeights(threads);
  return {
    responsibilities: input.responsibilities.map((row) => [...row]),
    mixture_weights: weights,
    threads,
    objective: mixtureObjective({
      anchors: input.anchors,
      threads,
      mixture_weights: weights,
      background: input.background,
      explicit_present: input.explicit_present,
    }),
  };
}

function fitSoftMixture(input: {
  anchors: Anchor[];
  seeds: Anchor[];
  background: StoryGraphBackground;
  explicit_present: boolean;
}): SoftMixtureState {
  const initialThreads = input.seeds.map((seed) => buildThread([seed], seed));
  const initialWeights = mixtureWeights(initialThreads);
  let responsibilities = input.anchors.map((anchor) => posteriorResponsibilities({
    anchor,
    threads: initialThreads,
    mixture_weights: initialWeights,
    background: input.background,
    explicit_present: input.explicit_present,
  }));

  let best: SoftMixtureState | null = null;
  for (let iteration = 0; iteration < MAX_FIT_ITERATIONS; iteration += 1) {
    const state = materializeSoftState({ ...input, responsibilities });
    if (betterSoftState(state, best)) best = state;
    const next = input.anchors.map((anchor) => posteriorResponsibilities({
      anchor,
      threads: state.threads,
      mixture_weights: state.mixture_weights,
      background: input.background,
      explicit_present: input.explicit_present,
    }));
    const maximumDelta = next.reduce((outer, row, anchorIndex) => Math.max(
      outer,
      row.reduce((inner, value, componentIndex) => Math.max(
        inner,
        Math.abs(value - (responsibilities[anchorIndex]?.[componentIndex] ?? 0)),
      ), 0),
    ), 0);
    responsibilities = next;
    if (maximumDelta <= RESPONSIBILITY_CONVERGENCE) {
      return materializeSoftState({ ...input, responsibilities });
    }
  }
  if (!best) throw new Error('soft Story Graph mixture produced no deterministic state');
  return best;
}

function fitRequestedThreads(input: {
  requested_k: number;
  anchors: Anchor[];
  background: StoryGraphBackground;
  explicit_present: boolean;
}): FittedThreads {
  const requestedK = Math.min(input.requested_k, input.anchors.length, STORY_GRAPH_MAX_THREADS);
  const totalSupport = input.anchors.reduce((sum, anchor) => sum + anchor.effective_strength, 0);
  if (requestedK <= 0 || totalSupport + EPSILON < MIN_THREAD_SUPPORT) {
    return {
      requested_k: input.requested_k,
      k: 0,
      responsibilities: input.anchors.map(() => []),
      mixture_weights: [],
      threads: [],
    };
  }
  let seeds = chooseInitialSeeds(
    input.anchors,
    requestedK,
    input.background,
    input.explicit_present,
  );
  for (;;) {
    const fitted = fitSoftMixture({
      anchors: input.anchors,
      seeds,
      background: input.background,
      explicit_present: input.explicit_present,
    });
    const supportedIndices = fitted.threads.flatMap((thread, index) => (
      thread.effective_evidence_mass + EPSILON >= MIN_THREAD_SUPPORT ? [index] : []
    ));
    if (supportedIndices.length === fitted.threads.length) {
      return {
        requested_k: input.requested_k,
        k: fitted.threads.length,
        responsibilities: fitted.responsibilities,
        mixture_weights: fitted.mixture_weights,
        threads: fitted.threads,
      };
    }
    if (supportedIndices.length === 0) {
      // Aggregate evidence supports one honest thread even when an attempted
      // multi-thread mixture fragmented it into undersized components.
      seeds = [[...input.anchors].sort((left, right) => (
        right.effective_strength - left.effective_strength || stableCompare(left.key, right.key)
      ))[0]!];
    } else {
      seeds = supportedIndices.map((index) => {
        const seedId = fitted.threads[index]!.seed_id;
        return input.anchors.find((anchor) => anchor.key === seedId)!;
      });
    }
  }
}

function leaveOneAnchorOut(input: {
  fitted: FittedThreads;
  anchors: Anchor[];
  background: StoryGraphBackground;
}): { mean: number; standardError: number } {
  if (input.fitted.threads.length === 0 || input.anchors.length < 2) {
    return { mean: 0, standardError: 0 };
  }
  const scores: number[] = [];
  const heldWeights: number[] = [];
  for (let heldIndex = 0; heldIndex < input.anchors.length; heldIndex += 1) {
    const held = input.anchors[heldIndex]!;
    const trainingAnchors = input.anchors.filter((_, index) => index !== heldIndex);
    // Refit from scratch for every held anchor. Reusing full-data
    // responsibilities would leak the held title's seed/component choice.
    const trainingExplicitPresent = trainingAnchors.some((anchor) => anchor.explicit_strength > 0);
    const refitted = fitRequestedThreads({
      requested_k: input.fitted.requested_k,
      anchors: trainingAnchors,
      background: input.background,
      explicit_present: trainingExplicitPresent,
    });
    scores.push(mixtureLogPredictiveRatio({
      title: held.title,
      threads: refitted.threads,
      mixture_weights: refitted.mixture_weights,
      background: input.background,
      explicit_present: trainingExplicitPresent,
    }));
    heldWeights.push(held.effective_strength);
  }
  return storyGraphWeightedMeanAndStandardError(scores, heldWeights);
}

/**
 * Fits K=1..3 and chooses the smallest K within one standard error of the best
 * deterministic leave-one-anchor-out posterior likelihood.
 */
export function buildStoryTasteModel(input: {
  documents: StoryGraphTitle[];
  /** Defaults to `documents`; the service supplies verified titles only. */
  background_documents?: StoryGraphTitle[];
  explicit_ratings: StoryGraphExplicitRating[];
  implicit_signals?: StoryGraphImplicitSignal[];
  as_of: number;
}): StoryTasteModel {
  const background = buildStoryGraphBackground(input.background_documents ?? input.documents);
  return buildStoryTasteModelWithBackground({ ...input, background });
}

/** Fit household threads against already-persisted immutable corpus priors. */
export function buildStoryTasteModelWithBackground(input: {
  documents: StoryGraphTitle[];
  background: StoryGraphBackground;
  explicit_ratings: StoryGraphExplicitRating[];
  implicit_signals?: StoryGraphImplicitSignal[];
  as_of: number;
}): StoryTasteModel {
  const { background } = input;
  const built = buildAnchors({
    documents: input.documents,
    explicit_ratings: input.explicit_ratings,
    implicit_signals: input.implicit_signals ?? [],
    as_of: input.as_of,
  });
  if (built.anchors.length === 0
    || built.anchors.reduce((sum, anchor) => sum + anchor.effective_strength, 0) + EPSILON
      < MIN_THREAD_SUPPORT) {
    return {
      model_version: VOD_STORY_GRAPH_MODEL_VERSION,
      background,
      threads: [],
      explicit_evidence_present: built.explicitPresent,
      selected_k: 0,
      loao: [],
      diagnostics: built.diagnostics,
    };
  }
  const fitted = Array.from(
    { length: Math.min(STORY_GRAPH_MAX_THREADS, built.anchors.length) },
    (_, index) => fitRequestedThreads({
      requested_k: index + 1,
      anchors: built.anchors,
      background,
      explicit_present: built.explicitPresent,
    }),
  ).filter((candidate) => candidate.threads.length > 0);
  const evaluated = fitted.map((candidate) => ({
    candidate,
    evaluation: leaveOneAnchorOut({
      fitted: candidate,
      anchors: built.anchors,
      background,
    }),
  }));
  const best = [...evaluated].sort((left, right) => (
    right.evaluation.mean - left.evaluation.mean
      || left.candidate.requested_k - right.candidate.requested_k
  ))[0]!;
  const threshold = best.evaluation.mean - best.evaluation.standardError;
  const selected = [...evaluated]
    .filter(({ evaluation }) => evaluation.mean + EPSILON >= threshold)
    .sort((left, right) => (
      left.candidate.requested_k - right.candidate.requested_k
        || left.candidate.k - right.candidate.k
    ))[0] ?? best;
  return {
    model_version: VOD_STORY_GRAPH_MODEL_VERSION,
    background,
    threads: selected.candidate.threads,
    explicit_evidence_present: built.explicitPresent,
    selected_k: selected.candidate.threads.length,
    loao: evaluated.map(({ candidate, evaluation }) => ({
      k: candidate.requested_k,
      mean_log_likelihood: evaluation.mean,
      standard_error: evaluation.standardError,
    })),
    diagnostics: built.diagnostics,
  };
}

export function scoredRecommendationCompare(
  left: StoryGraphScoredRecommendation,
  right: StoryGraphScoredRecommendation,
): number {
  return right.rank_score - left.rank_score
    || right.affinity - left.affinity
    || right.holistic - left.holistic
    || right.explicit_support - left.explicit_support
    || contentKey(left.type, left.id).localeCompare(contentKey(right.type, right.id));
}

/** Incremental O(thread count × feature count) scoring for one changed title. */
export function scoreStoryGraphCandidate(
  model: StoryTasteModel,
  rawTitle: StoryGraphTitle,
): StoryGraphScoredRecommendation {
  const title = validateStoryGraphTitle(rawTitle);
  const matches = model.threads.map((thread): StoryGraphThreadMatch => {
    const explicitLikelihood = profileLikelihood(
      thread.explicit_profile,
      title,
      model.background,
    );
    const implicitLikelihood = profileLikelihood(
      thread.implicit_profile,
      title,
      model.background,
    );
    const explicitMatch = positiveLikelihoodMatch(explicitLikelihood.log_ratio);
    const implicitMatch = positiveLikelihoodMatch(implicitLikelihood.log_ratio);
    const blendedMatch = model.explicit_evidence_present
      ? STORY_GRAPH_EXPLICIT_SHARE * explicitMatch + STORY_GRAPH_IMPLICIT_SHARE * implicitMatch
      : implicitMatch;
    const explicitMatchDeviation = likelihoodMatchStandardDeviation(
      explicitLikelihood.log_ratio,
      explicitLikelihood.standard_deviation,
    );
    const implicitMatchDeviation = likelihoodMatchStandardDeviation(
      implicitLikelihood.log_ratio,
      implicitLikelihood.standard_deviation,
    );
    const standardDeviationUnit = model.explicit_evidence_present
      ? Math.sqrt(
        (STORY_GRAPH_EXPLICIT_SHARE * explicitMatchDeviation) ** 2
          + (STORY_GRAPH_IMPLICIT_SHARE * implicitMatchDeviation) ** 2,
      )
      : implicitMatchDeviation;
    return {
      thread_id: thread.thread_id,
      explicit_match: explicitMatch,
      implicit_match: implicitMatch,
      blended_match: blendedMatch,
      posterior_standard_deviation: PREFERENCE_RANGE * clamp(standardDeviationUnit),
      fire_support: explicitMatch * thread.fire_uplift,
      water_support: explicitMatch * thread.water_uplift,
    };
  }).sort((left, right) => (
    right.blended_match - left.blended_match
      || left.posterior_standard_deviation - right.posterior_standard_deviation
      || left.thread_id.localeCompare(right.thread_id)
  ));
  const strongest = matches[0] ?? null;
  // Fire and Water may be supported by different household taste threads.
  const fireSupport = Math.max(0, ...matches.map((match) => match.fire_support));
  const waterSupport = Math.max(0, ...matches.map((match) => match.water_support));
  const predictedFire = PREFERENCE_FLOOR + PREFERENCE_RANGE * fireSupport;
  const predictedWater = PREFERENCE_FLOOR + PREFERENCE_RANGE * waterSupport;
  const holistic = storyHolisticAffinity(predictedFire, predictedWater);
  const blendedAffinity = PREFERENCE_FLOOR
    + PREFERENCE_RANGE * (strongest?.blended_match ?? 0);
  const posteriorStandardDeviation = strongest?.posterior_standard_deviation
    ?? PREFERENCE_RANGE;
  return {
    type: title.type,
    id: title.id,
    title: title.title,
    year: title.year ?? null,
    predicted_fire: predictedFire,
    predicted_water: predictedWater,
    holistic,
    affinity: blendedAffinity,
    posterior_standard_deviation: posteriorStandardDeviation,
    rank_score: blendedAffinity - 0.5 * posteriorStandardDeviation,
    best_thread_id: strongest?.thread_id ?? null,
    explicit_support: strongest?.explicit_match ?? 0,
    implicit_support: strongest?.implicit_match ?? 0,
    feature_confidence: titleFeatureConfidence(title),
    thread_matches: matches,
  };
}

function activePortfolioThreads(
  ranked: StoryGraphScoredRecommendation[],
  requestedOrder: string[],
): string[] {
  const present = new Set(ranked.map((item) => item.best_thread_id).filter(
    (item): item is string => item !== null,
  ));
  const ordered = requestedOrder.filter((thread) => present.has(thread));
  const remaining = [...present].filter((thread) => !ordered.includes(thread)).sort((left, right) => {
    const leftBest = ranked.find((item) => item.best_thread_id === left)?.rank_score ?? 0;
    const rightBest = ranked.find((item) => item.best_thread_id === right)?.rank_score ?? 0;
    return rightBest - leftBest || left.localeCompare(right);
  });
  return [...ordered, ...remaining].slice(0, STORY_GRAPH_MAX_THREADS);
}

function portfolioQuotas(threadCount: number, visibleLimit: number): number[] {
  if (threadCount <= 0) return [];
  const base = Math.floor(visibleLimit / threadCount);
  const remainder = visibleLimit % threadCount;
  return Array.from({ length: threadCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** 2/2/2, 3/3, or all-six strongest supported fits. */
export function selectStrongestFitPortfolio(
  input: StoryGraphScoredRecommendation[],
  threadOrder: string[] = [],
  visibleLimit = STORY_GRAPH_VISIBLE_LIMIT,
): StoryGraphScoredRecommendation[] {
  const limit = Math.max(0, Math.floor(visibleLimit));
  if (limit === 0) return [];
  const ranked = [...input].sort(scoredRecommendationCompare);
  const threads = activePortfolioThreads(ranked, threadOrder);
  if (threads.length === 0) return ranked.slice(0, limit);
  const quotas = portfolioQuotas(threads.length, limit);
  const buckets = threads.map((thread) => ranked.filter((item) => item.best_thread_id === thread));
  const selectedByThread = buckets.map((bucket, index) => bucket.slice(0, quotas[index]!));
  const output: StoryGraphScoredRecommendation[] = [];
  const selected = new Set<StoryGraphContentId>();
  // Round-robin presentation keeps the portfolio from appearing as three
  // contiguous mini-rails while preserving deterministic strongest-fit order.
  const rounds = Math.max(0, ...selectedByThread.map((items) => items.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const items of selectedByThread) {
      const item = items[round];
      if (!item) continue;
      output.push(item);
      selected.add(contentKey(item.type, item.id));
    }
  }
  for (const item of ranked) {
    if (output.length >= limit) break;
    const identity = contentKey(item.type, item.id);
    if (selected.has(identity)) continue;
    selected.add(identity);
    output.push(item);
  }
  return output;
}

export function storyDealerRankWeight(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) throw new Error('dealer rank must be a positive integer');
  return rank ** -STORY_GRAPH_DEALER_EXPONENT;
}

/** Caches only ordering/weights; it does not truncate the complete rank generation. */
export function buildStoryDealerCache(
  rankedInput: StoryGraphScoredRecommendation[],
  threadOrder: string[] = [],
  weightPolicy: StoryDealerWeightPolicy = 'rank',
): StoryDealerCache {
  const ranked = [...rankedInput].sort(scoredRecommendationCompare);
  const seen = new Set<StoryGraphContentId>();
  const perThreadRank = new Map<string, number>();
  const fitFloor = 2.5;
  const perThreadScores = new Map<string, number[]>();
  for (const recommendation of ranked) {
    const thread = recommendation.best_thread_id ?? 'unassigned';
    const scores = perThreadScores.get(thread) ?? [];
    if (recommendation.rank_score >= fitFloor) scores.push(recommendation.rank_score);
    perThreadScores.set(thread, scores);
  }
  const q95ByThread = new Map([...perThreadScores].map(([thread, scores]) => {
    const ordered = [...scores].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(ordered.length * 0.95) - 1);
    return [thread, ordered[index] ?? fitFloor] as const;
  }));
  const items: StoryDealerCacheItem[] = [];
  for (const recommendation of ranked) {
    const identity = contentKey(recommendation.type, recommendation.id);
    if (seen.has(identity)) throw new Error(`duplicate recommendation in dealer cache: ${identity}`);
    seen.add(identity);
    const rank = items.length + 1;
    const thread = recommendation.best_thread_id ?? 'unassigned';
    const denseThreadRank = (perThreadRank.get(thread) ?? 0) + 1;
    perThreadRank.set(thread, denseThreadRank);
    items.push({
      rank,
      dealer_weight: weightPolicy === 'relevance'
        ? forYouRelevanceWeight({
          rankScore: recommendation.rank_score,
          fitFloor,
          threadQ95: q95ByThread.get(thread) ?? fitFloor,
        })
        : storyDealerRankWeight(denseThreadRank),
      recommendation,
    });
  }
  return {
    model_version: VOD_STORY_GRAPH_MODEL_VERSION,
    weight_policy: weightPolicy,
    thread_order: activePortfolioThreads(ranked, threadOrder),
    items,
  };
}

function dealerOrder(items: StoryDealerCacheItem[], seed: string): StoryDealerCacheItem[] {
  return [...items].sort((left, right) => {
    const leftIdentity = contentKey(left.recommendation.type, left.recommendation.id);
    const rightIdentity = contentKey(right.recommendation.type, right.recommendation.id);
    // Exponential-race sampling is deterministic, weighted, and without replacement.
    const leftKey = -Math.log(stableUnit(`${seed}:${leftIdentity}`)) / left.dealer_weight;
    const rightKey = -Math.log(stableUnit(`${seed}:${rightIdentity}`)) / right.dealer_weight;
    return leftKey - rightKey || left.rank - right.rank || leftIdentity.localeCompare(rightIdentity);
  });
}

/**
 * Cached couch-time deal. Previous-slate avoidance/floor relaxation is supplied
 * by the service through exclusions and repeated calls; this function performs
 * no metadata, graph, or ranking work.
 */
export function dealStoryRecommendations(
  cache: StoryDealerCache,
  options: {
    seed: string;
    visible_limit?: number;
    exclude_ids?: StoryGraphContentId[];
    minimum_rank_score?: number;
    group_keys_by_id?: ReadonlyMap<StoryGraphContentId, readonly string[]>;
    max_per_group?: number;
  },
): StoryGraphScoredRecommendation[] {
  if (cache.model_version !== VOD_STORY_GRAPH_MODEL_VERSION) {
    throw new Error('dealer cache model version is incompatible');
  }
  const limit = Math.max(0, Math.floor(options.visible_limit ?? STORY_GRAPH_VISIBLE_LIMIT));
  const excluded = new Set(options.exclude_ids ?? []);
  const eligible = cache.items.filter((item) => (
    !excluded.has(contentKey(item.recommendation.type, item.recommendation.id))
      && item.recommendation.rank_score >= (options.minimum_rank_score ?? Number.NEGATIVE_INFINITY)
  ));
  const weighted = dealerOrder(eligible, options.seed);
  const maxPerGroup = Math.max(1, Math.floor(options.max_per_group ?? Number.MAX_SAFE_INTEGER));
  const groupCounts = new Map<string, number>();
  const canSelect = (item: StoryDealerCacheItem): boolean => (
    (options.group_keys_by_id?.get(contentKey(
      item.recommendation.type,
      item.recommendation.id,
    )) ?? []).every((group) => (groupCounts.get(group) ?? 0) < maxPerGroup)
  );
  const recordGroups = (item: StoryDealerCacheItem): void => {
    for (const group of options.group_keys_by_id?.get(contentKey(
      item.recommendation.type,
      item.recommendation.id,
    )) ?? []) {
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    }
  };
  const threads = cache.thread_order.filter((thread) => weighted.some(
    (item) => item.recommendation.best_thread_id === thread,
  )).slice(0, STORY_GRAPH_MAX_THREADS);
  if (threads.length === 0) return weighted.slice(0, limit).map((item) => item.recommendation);
  const quotas = portfolioQuotas(threads.length, limit);
  const buckets = threads.map((thread) => {
    const bucket: StoryDealerCacheItem[] = [];
    for (const item of weighted) {
      if (item.recommendation.best_thread_id !== thread || !canSelect(item)) continue;
      bucket.push(item);
      recordGroups(item);
      if (bucket.length >= quotas[threads.indexOf(thread)]!) break;
    }
    return bucket;
  });
  // Recount in actual rendered order; the provisional per-thread pass above
  // exists only to find quota-capable buckets.
  groupCounts.clear();
  const output: StoryGraphScoredRecommendation[] = [];
  const selected = new Set<StoryGraphContentId>();
  const rounds = Math.max(0, ...buckets.map((items) => items.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const bucket of buckets) {
      const item = bucket[round];
      if (!item) continue;
      const identity = contentKey(item.recommendation.type, item.recommendation.id);
      if (selected.has(identity) || !canSelect(item)) continue;
      selected.add(identity);
      recordGroups(item);
      output.push(item.recommendation);
    }
  }
  for (const item of weighted) {
    if (output.length >= limit) break;
    const identity = contentKey(item.recommendation.type, item.recommendation.id);
    if (selected.has(identity) || !canSelect(item)) continue;
    selected.add(identity);
    recordGroups(item);
    output.push(item.recommendation);
  }
  return output;
}

/** Pure full-corpus v2 entry point. Eligibility/exact-title exclusions stay in service. */
export function rankStoryGraphRecommendations(input: StoryGraphRankInput): StoryGraphRankResult {
  if (input.algorithm !== VOD_STORY_GRAPH_MODEL_VERSION) {
    throw new Error('story graph ranking requires vod-story-graph-v2 input');
  }
  const documents = new Map<StoryGraphContentId, StoryGraphTitle>();
  for (const raw of input.documents) {
    const title = validateStoryGraphTitle(raw);
    const identity = contentKey(title.type, title.id);
    if (documents.has(identity)) throw new Error(`duplicate StoryDNA title: ${identity}`);
    documents.set(identity, title);
  }
  const backgroundIds = input.background_ids ?? [...documents.keys()];
  const backgroundSeen = new Set<StoryGraphContentId>();
  const backgroundDocuments = backgroundIds.map((identity) => {
    if (backgroundSeen.has(identity)) {
      throw new Error(`duplicate StoryDNA background identity: ${identity}`);
    }
    backgroundSeen.add(identity);
    const title = documents.get(identity);
    if (!title) throw new Error(`StoryDNA background has no document: ${identity}`);
    return title;
  });
  const modelInput = {
    documents: [...documents.values()],
    explicit_ratings: input.explicit_ratings,
    implicit_signals: input.implicit_signals ?? [],
    as_of: input.as_of,
  };
  const model = input.background
    ? buildStoryTasteModelWithBackground({ ...modelInput, background: input.background })
    : buildStoryTasteModel({ ...modelInput, background_documents: backgroundDocuments });
  const candidateIds = input.candidate_ids ?? [...documents.keys()];
  const candidateSeen = new Set<StoryGraphContentId>();
  const candidates = candidateIds.map((identity) => {
    if (candidateSeen.has(identity)) throw new Error(`duplicate story graph candidate: ${identity}`);
    candidateSeen.add(identity);
    const title = documents.get(identity);
    if (!title) throw new Error(`story graph candidate has no StoryDNA document: ${identity}`);
    return title;
  });
  const ranked = candidates.map((title) => scoreStoryGraphCandidate(model, title))
    .sort(scoredRecommendationCompare);
  const threadOrder = model.threads.map((thread) => thread.thread_id);
  const portfolio = selectStrongestFitPortfolio(ranked, threadOrder, STORY_GRAPH_VISIBLE_LIMIT);
  return {
    model_version: VOD_STORY_GRAPH_MODEL_VERSION,
    background: model.background,
    selected_k: model.selected_k,
    threads: model.threads,
    ranked,
    portfolio,
    dealer_cache: buildStoryDealerCache(ranked, threadOrder),
    loao: model.loao,
    diagnostics: model.diagnostics,
  };
}
