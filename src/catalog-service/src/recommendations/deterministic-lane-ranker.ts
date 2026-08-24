/**
 * Deterministic 0/1/2-lane content-profile ranker.
 *
 * Replaces the runtime Bayesian K=1..3 / LOAO-fitted taste model with a
 * closed-form ranker that reads Fire/Water explicit ratings plus weaker
 * recency-decayed implicit signals, chooses at most two lanes over a stable
 * dissimilar positive-seed pair, and produces a full ranked candidate
 * universe with the required 3+3 (two lanes) or 6 (one lane) slate shape.
 *
 * Complexity contract (each operation runs at most once per lane in {0,1,2}):
 *   1. Build corpus IDF over the feature vocabulary.                O(C * F)
 *   2. Choose primary seed from strong positives.                   O(A log A)
 *   3. Choose farthest secondary seed by IDF-weighted cosine.       O(A * F)
 *   4. Assign each candidate to a lane by arg-max cosine.           O(C * F)
 *   5. Aggregate one weighted centroid per lane.                    O(A * F)
 *   6. Score each candidate against ≤ 2 centroids and its seed.     O(C * F)
 *
 * where A = anchors, C = candidates, F = mean non-zero feature count
 * per title. Feature vectors are sparse `ReadonlyMap<string, number>` maps;
 * the ranker never materializes a dense per-item vector of dictionary size.
 * The IDF table is vocab-only memory (`Map<featureKey, idf>`). Item
 * identities are typed `${type}:${id}` so no id from a different type can
 * collide during Map/Set lookups.
 *
 * Invariants (see `deterministic-lane-ranker.test.ts` for coverage):
 *   1. Stable dissimilar positive seeds. Primary = strongest positive by
 *      explicit anchor strength (Fire/Water) + implicit strength, with
 *      title asc / id asc for ties; secondary = the anchor with maximum
 *      1 - IDF-weighted-cosine(primary, candidate) distance.
 *   2. Deterministic lane assignment. Every candidate (not just anchors)
 *      is assigned to its arg-max IDF-weighted cosine seed. Ties break
 *      by seed order. The assignment map is exposed for adapters.
 *   3. Sparse-anchor collapse. Any positive → at least one lane. Two lanes
 *      appear only when both have ≥ `min_support_per_lane` anchors after
 *      assignment; otherwise all positives collapse into the primary lane.
 *   4. Order invariance. Input order does not change output: seeds, IDF,
 *      anchor assignment, centroids, and candidate scoring all sort by
 *      (score desc, title asc, id asc) with stable tiebreaks.
 *   5. Fire/Water semantics preserved bit-identically. `positiveEvidence`
 *      matches `story-graph-v1.positiveRatingEvidence`; anchor strength
 *      matches `story-graph-v1.storyRatingAnchorStrength`. 2.5/3/3.5 are
 *      positive (>0 evidence); 1–2 are neutral (0 evidence) but never
 *      excluded from the candidate universe; strict negatives (<1) are
 *      handled upstream by eligibility, never in this ranker.
 *   6. Weaker implicit signals. Saved and completion contribute a bounded
 *      fraction of one explicit rating with exponential decay per day.
 *   7. Exact exclusions. Any typed identity in `exclude` is dropped before
 *      IDF, seeding, assignment, and scoring.
 *   8. Complete accounting. `ranked` contains every non-excluded candidate;
 *      `unaccounted` lists any candidate that fell outside slate + reserve.
 *   9. 3+3 slotting is lane-alternating with per-lane dedup then reserve.
 *  10. Passive compatibility with StoryDNA / content-profile-v2 via the
 *      sparse `features` map — callers plug their existing coordinate keys.
 *  11. Corpus IDF weighting. Rare features contribute more per-key mass
 *      than generic format/genre coordinates, so lanes are shaped by what
 *      is *distinctive* about a title, not what every corpus row shares.
 *
 * This module is pure: no database access, no environment reads. It
 * intentionally re-derives the Fire/Water evidence formula locally to
 * avoid a runtime dependency on story-graph-v1's Bayesian model, but a
 * source-scan test in `deterministic-lane-ranker.test.ts` proves that
 * the local formula agrees with `positiveRatingEvidence` and
 * `storyRatingAnchorStrength` bit-for-bit.
 */

export type DeterministicLaneIdentity = `movie:${string}` | `series:${string}`;

export type DeterministicLaneItem = {
  /** Typed identity: `${type}:${id}`. Never collides across content types. */
  identity: DeterministicLaneIdentity;
  id: string;
  title: string;
  type: 'movie' | 'series';
  /** Sparse feature map keyed by ontology coordinate. Values in [0, 1]. */
  features: ReadonlyMap<string, number>;
  fire?: number | null;
  water?: number | null;
  implicit?: {
    saved_at?: number | null;
    completed_at?: number | null;
    watched_at?: number | null;
  } | null;
};

export type DeterministicLaneInput = {
  items: readonly DeterministicLaneItem[];
  as_of: number;
  /** Set of typed identities to drop before seeding and scoring. */
  exclude?: ReadonlySet<DeterministicLaneIdentity>;
  /**
   * Minimum anchors per lane for a two-lane result. Defaults to 2. Below
   * this threshold on either lane, the ranker collapses to one lane
   * containing all positive anchors.
   */
  min_support_per_lane?: number;
  implicit_half_life_ms?: number;
  slate_size?: number;
};

export type DeterministicLaneEntry = {
  identity: DeterministicLaneIdentity;
  lane: number;
  score: number;
};

export type DeterministicLaneOutput = {
  lanes: 0 | 1 | 2;
  seeds: DeterministicLaneIdentity[];
  slate: DeterministicLaneEntry[];
  reserve: DeterministicLaneEntry[];
  /** Every non-excluded candidate, scored against its assigned lane. */
  ranked: DeterministicLaneEntry[];
  /**
   * Canonical lane assignment for every non-excluded candidate. Adapters
   * MUST read from this map rather than recompute their own so lane
   * bookkeeping matches the scores in `ranked` exactly.
   */
  assignments: ReadonlyMap<DeterministicLaneIdentity, number>;
  unaccounted: DeterministicLaneIdentity[];
  decisions: string[];
};

// ---- Fire/Water contract (mirrors story-graph-v1) -----------------------

const PREFERENCE_FLOOR = 2;
const PREFERENCE_RANGE = 3;

/**
 * Exact mirror of `story-graph-v1.positiveRatingEvidence`. Verified by a
 * source-scan test that imports both and asserts numeric equality across
 * the 0..5 half-step grid.
 */
export function positiveEvidence(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  const clamped = Math.max(0, Math.min(5, rating));
  return (Math.max(0, clamped - PREFERENCE_FLOOR) / PREFERENCE_RANGE) ** 2;
}

/** Exact mirror of `story-graph-v1.storyRatingAnchorStrength`. */
export function explicitAnchorStrength(fire: number, water: number): number {
  const positiveFire = positiveEvidence(fire);
  const positiveWater = positiveEvidence(water);
  return 0.75 * Math.max(positiveFire, positiveWater)
    + 0.25 * Math.min(positiveFire, positiveWater);
}

// ---- Constants ----------------------------------------------------------

const DEFAULT_MIN_SUPPORT_PER_LANE = 2;
const DEFAULT_IMPLICIT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_SLATE_SIZE = 6;
const IMPLICIT_POSITIVE_STRENGTH = 0.4;
const SEED_SCORE_WEIGHT = 0.7;
const CENTROID_SCORE_WEIGHT = 0.3;
const IDF_MAX = 4;

// ---- Feature-space math -------------------------------------------------

function stableCompare(left: DeterministicLaneItem, right: DeterministicLaneItem): number {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

/**
 * Bounded corpus IDF over the observed feature vocabulary. df is a single
 * pass over every candidate's sparse feature keys, so total memory is
 * `Θ(|vocab|)`. `Math.log((N+1)/(df+1)) + 1` guarantees every returned
 * weight lies in `[1, IDF_MAX]`: common format/genre coordinates weigh
 * ~1, rare distinctive coordinates get amplified up to `IDF_MAX`.
 */
export function computeCorpusIdf(
  items: readonly DeterministicLaneItem[],
): ReadonlyMap<string, number> {
  const df = new Map<string, number>();
  for (const item of items) {
    for (const key of item.features.keys()) df.set(key, (df.get(key) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  const N = items.length;
  for (const [key, dfCount] of df) {
    const raw = Math.log((N + 1) / (dfCount + 1)) + 1;
    idf.set(key, Math.max(1, Math.min(IDF_MAX, raw)));
  }
  return idf;
}

/**
 * Sparse IDF-weighted cosine over feature maps. Never allocates a dense
 * or re-scaled per-item vector: the IDF weight is applied at read time,
 * so total memory across all cosine calls stays `Θ(|vocab|)`.
 */
export function sparseCosineIdf(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  idf: ReadonlyMap<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [key, va] of small) {
    const vb = big.get(key);
    if (vb === undefined) continue;
    const w = idf.get(key) ?? 1;
    dot += va * vb * w * w;
  }
  if (dot === 0) return 0;
  let na = 0;
  for (const [key, va] of a) {
    const w = idf.get(key) ?? 1;
    na += va * va * w * w;
  }
  let nb = 0;
  for (const [key, vb] of b) {
    const w = idf.get(key) ?? 1;
    nb += vb * vb * w * w;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// ---- Signal strengths ---------------------------------------------------

function implicitStrength(item: DeterministicLaneItem, asOf: number, halfLife: number): number {
  if (!item.implicit) return 0;
  const events: number[] = [];
  if (typeof item.implicit.saved_at === 'number' && Number.isFinite(item.implicit.saved_at)) {
    events.push(item.implicit.saved_at);
  }
  if (typeof item.implicit.completed_at === 'number' && Number.isFinite(item.implicit.completed_at)) {
    events.push(item.implicit.completed_at);
  }
  if (typeof item.implicit.watched_at === 'number' && Number.isFinite(item.implicit.watched_at)) {
    events.push(item.implicit.watched_at);
  }
  if (events.length === 0) return 0;
  const mostRecent = Math.max(...events);
  const ageMs = Math.max(0, asOf - mostRecent);
  const decay = Math.exp(-Math.LN2 * (ageMs / halfLife));
  return Math.min(IMPLICIT_POSITIVE_STRENGTH * decay, IMPLICIT_POSITIVE_STRENGTH);
}

/**
 * Total anchor strength for seed choice and centroid weighting. Combines
 * quadratic Fire/Water positive evidence with recency-decayed implicit
 * mass. Neutral ratings (1–2 on both axes) contribute 0, matching the
 * `story-graph-v1` contract.
 */
export function anchorStrength(item: DeterministicLaneItem, asOf: number, halfLife: number): number {
  const explicit = explicitAnchorStrength(item.fire ?? 0, item.water ?? 0);
  const implicit = implicitStrength(item, asOf, halfLife);
  return explicit + implicit;
}

/**
 * Positive anchors are those with any explicit-evidence >0 on either
 * Fire/Water axis OR any recency-decayed implicit signal. Neutral 1–2
 * ratings alone are NOT positive but remain in the candidate universe.
 * Strict-negative <1 vetos are handled by upstream eligibility and are
 * not filtered here.
 */
function isPositive(item: DeterministicLaneItem, asOf: number, halfLife: number): boolean {
  return explicitAnchorStrength(item.fire ?? 0, item.water ?? 0) > 0
    || implicitStrength(item, asOf, halfLife) > 0;
}

// ---- Seeding, assignment, centroid --------------------------------------

function chooseSeeds(
  positives: readonly DeterministicLaneItem[],
  asOf: number,
  halfLife: number,
  idf: ReadonlyMap<string, number>,
): DeterministicLaneItem[] {
  if (positives.length === 0) return [];
  const primary = [...positives].sort((left, right) => {
    const strengthLeft = anchorStrength(left, asOf, halfLife);
    const strengthRight = anchorStrength(right, asOf, halfLife);
    if (strengthRight !== strengthLeft) return strengthRight - strengthLeft;
    return stableCompare(left, right);
  })[0]!;
  if (positives.length === 1) return [primary];
  let bestSecondary: DeterministicLaneItem | null = null;
  let bestDissimilarity = -Infinity;
  for (const candidate of positives) {
    if (candidate.identity === primary.identity) continue;
    const dissim = 1 - sparseCosineIdf(primary.features, candidate.features, idf);
    if (dissim > bestDissimilarity
      || (dissim === bestDissimilarity && bestSecondary && stableCompare(candidate, bestSecondary) < 0)) {
      bestDissimilarity = dissim;
      bestSecondary = candidate;
    }
  }
  return bestSecondary ? [primary, bestSecondary] : [primary];
}

/**
 * Canonical lane assignment: arg-max IDF-weighted cosine to seed features.
 * Ties break by seed order (lane 0 wins). Exported so adapters can prove
 * assignment identity in tests without cloning private math.
 */
export function assignLane(
  features: ReadonlyMap<string, number>,
  seeds: readonly DeterministicLaneItem[],
  idf: ReadonlyMap<string, number>,
): number {
  if (seeds.length === 0) return -1;
  let bestLane = 0;
  let bestScore = -Infinity;
  for (let lane = 0; lane < seeds.length; lane += 1) {
    const score = sparseCosineIdf(features, seeds[lane]!.features, idf);
    if (score > bestScore) {
      bestScore = score;
      bestLane = lane;
    }
  }
  return bestLane;
}

function laneCentroid(
  anchors: readonly DeterministicLaneItem[],
  asOf: number,
  halfLife: number,
): ReadonlyMap<string, number> {
  const centroid = new Map<string, number>();
  let totalWeight = 0;
  for (const anchor of anchors) {
    const weight = Math.max(0, anchorStrength(anchor, asOf, halfLife));
    if (weight <= 0) continue;
    totalWeight += weight;
    for (const [key, value] of anchor.features) {
      centroid.set(key, (centroid.get(key) ?? 0) + value * weight);
    }
  }
  if (totalWeight > 0) {
    for (const [key, value] of centroid) centroid.set(key, value / totalWeight);
  }
  return centroid;
}

// ---- The ranker ---------------------------------------------------------

/**
 * Pure deterministic ranker. See module doc for invariants and complexity.
 */
export function rankDeterministicLanes(input: DeterministicLaneInput): DeterministicLaneOutput {
  const minSupport = Math.max(1, input.min_support_per_lane ?? DEFAULT_MIN_SUPPORT_PER_LANE);
  const halfLife = input.implicit_half_life_ms ?? DEFAULT_IMPLICIT_HALF_LIFE_MS;
  const slateSize = input.slate_size ?? DEFAULT_SLATE_SIZE;
  const exclude = input.exclude ?? new Set<DeterministicLaneIdentity>();
  const decisions: string[] = [];

  const candidates = input.items.filter((item) => !exclude.has(item.identity));
  const positives = candidates.filter((item) => isPositive(item, input.as_of, halfLife));

  const idf = computeCorpusIdf(candidates);

  if (positives.length === 0) {
    decisions.push('no_positive_evidence');
    return {
      lanes: 0,
      seeds: [],
      slate: [],
      reserve: [],
      ranked: candidates.map((item) => ({ identity: item.identity, lane: -1, score: 0 })),
      assignments: new Map<DeterministicLaneIdentity, number>(),
      unaccounted: candidates.map((item) => item.identity),
      decisions,
    };
  }

  const initialSeeds = chooseSeeds(positives, input.as_of, halfLife, idf);
  decisions.push(`chose_seeds:${initialSeeds.map((seed) => seed.identity).join(',')}`);

  // Assign each POSITIVE to a candidate lane using arg-max IDF cosine.
  const positiveAnchorsByLane: DeterministicLaneItem[][] = initialSeeds.map(() => []);
  for (const positive of positives) {
    const lane = assignLane(positive.features, initialSeeds, idf);
    if (lane >= 0) positiveAnchorsByLane[lane]!.push(positive);
  }

  // Collapse rules: any positive → at least 1 lane. Two lanes only when
  // BOTH lanes have >= minSupport positive anchors. Otherwise fold every
  // positive into the primary lane.
  let activeSeeds: DeterministicLaneItem[];
  let activeAnchors: DeterministicLaneItem[][];
  if (initialSeeds.length === 2
    && positiveAnchorsByLane[0]!.length >= minSupport
    && positiveAnchorsByLane[1]!.length >= minSupport) {
    activeSeeds = initialSeeds;
    activeAnchors = positiveAnchorsByLane;
    decisions.push('two_lanes_both_supported');
  } else {
    activeSeeds = [initialSeeds[0]!];
    activeAnchors = [positives.slice()];
    decisions.push(initialSeeds.length === 2
      ? 'collapsed_to_one_lane_below_min_support'
      : 'single_positive_one_lane');
  }

  const centroids = activeAnchors.map((anchors) => laneCentroid(anchors, input.as_of, halfLife));

  // Canonical assignment for EVERY candidate (positives, neutrals, and
  // weak negatives). Adapters read this map so lane bookkeeping stays in
  // lock-step with `ranked` scoring.
  const assignments = new Map<DeterministicLaneIdentity, number>();
  const ranked: DeterministicLaneEntry[] = [];
  for (const item of candidates) {
    const lane = assignLane(item.features, activeSeeds, idf);
    assignments.set(item.identity, lane);
    const seed = activeSeeds[lane]!;
    const centroid = centroids[lane]!;
    const seedScore = sparseCosineIdf(item.features, seed.features, idf);
    const centroidScore = sparseCosineIdf(item.features, centroid, idf);
    const score = SEED_SCORE_WEIGHT * seedScore + CENTROID_SCORE_WEIGHT * centroidScore;
    ranked.push({ identity: item.identity, lane, score });
  }

  // Index by identity for stable tiebreak sorting below.
  const itemByIdentity = new Map<DeterministicLaneIdentity, DeterministicLaneItem>(
    candidates.map((item) => [item.identity, item]),
  );
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const li = itemByIdentity.get(left.identity)!;
    const ri = itemByIdentity.get(right.identity)!;
    return li.title.localeCompare(ri.title) || li.id.localeCompare(ri.id);
  });

  // Slate: 3+3 (two lanes) or 6 (one lane), lane-alternating.
  const scoredByLane: DeterministicLaneEntry[][] = activeSeeds.map(() => []);
  for (const entry of ranked) scoredByLane[entry.lane]!.push(entry);
  const cursors = activeSeeds.map(() => 0);
  const takenIds = new Set<DeterministicLaneIdentity>();
  const slate: DeterministicLaneEntry[] = [];
  const perLane = activeSeeds.length === 2
    ? Math.floor(slateSize / 2)
    : slateSize;
  const laneCounts = activeSeeds.map(() => 0);
  while (slate.length < slateSize) {
    let progress = false;
    for (let lane = 0; lane < activeSeeds.length; lane += 1) {
      if (activeSeeds.length === 2 && laneCounts[lane]! >= perLane) continue;
      if (slate.length >= slateSize) break;
      const list = scoredByLane[lane]!;
      while (cursors[lane]! < list.length && takenIds.has(list[cursors[lane]!]!.identity)) {
        cursors[lane]! += 1;
      }
      if (cursors[lane]! >= list.length) continue;
      const pick = list[cursors[lane]!]!;
      cursors[lane]! += 1;
      takenIds.add(pick.identity);
      laneCounts[lane]! += 1;
      slate.push(pick);
      progress = true;
    }
    if (!progress) break;
  }

  const reserve: DeterministicLaneEntry[] = [];
  for (let lane = 0; lane < activeSeeds.length; lane += 1) {
    const list = scoredByLane[lane]!;
    for (let i = cursors[lane]!; i < list.length && reserve.length < slateSize; i += 1) {
      const candidate = list[i]!;
      if (!takenIds.has(candidate.identity)) {
        reserve.push(candidate);
        takenIds.add(candidate.identity);
      }
    }
  }

  const unaccounted = candidates
    .filter((item) => !takenIds.has(item.identity))
    .map((item) => item.identity);

  return {
    lanes: (activeSeeds.length === 2 ? 2 : 1) as 0 | 1 | 2,
    seeds: activeSeeds.map((seed) => seed.identity),
    slate,
    reserve,
    ranked,
    assignments,
    unaccounted,
    decisions,
  };
}
