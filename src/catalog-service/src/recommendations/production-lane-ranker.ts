/**
 * Production adapter: `StoryGraphTitle` corpus + household evidence →
 * `StoryGraphRankResult` produced by the deterministic 0/1/2-lane ranker.
 *
 * This module is the sole live rank path. The legacy K=1..3 / LOAO fitting
 * in `story-graph-v1.buildStoryTasteModelWithBackground` remains exported for
 * serving-profile calibration deps, but no production code path reaches it.
 *
 * Complexity contract (see `deterministic-lane-ranker.ts` for details):
 *   - Feature encoding is sparse: each title's `features` is a `Map<string,
 *     number>` sized to its edge count, never to a shared corpus dictionary.
 *   - IDF is a single vocab-only map; rare features get amplified so lanes
 *     are shaped by what is distinctive, not by generic format/genre.
 *   - All identity lookups go through Map<identity, DeterministicLaneItem>.
 *     No O(N²) `Array.find` scans anywhere in the pipeline.
 *   - Every candidate is scored against its assigned lane's seed and
 *     centroid inside the pure ranker; the adapter reads the full
 *     `ranked` list back and never re-scores tail candidates with
 *     seed-only cosine, which previously broke For You X.
 *   - Portfolio and dealer cache are produced by the canonical
 *     `selectStrongestFitPortfolio` and `buildStoryDealerCache` helpers
 *     from `story-graph-v1`; we do not hand-build a 1/rank cache.
 *
 * Non-lossy encoding: every `StoryGraphEdge` on every title contributes to
 * the sparse feature map keyed by `(family, node_key, ordinal_flag)`.
 * Ordinal edges use `intensity / 4 * confidence`; categorical edges use
 * `intensity * confidence`. Fire/Water semantics, passive StoryDNA edges,
 * exact exclusions, and complete accounting are all preserved by
 * construction. Lane assignment is delegated to the pure ranker's
 * exported `assignLane` helper — identity of assignment is asserted by
 * `deterministic-lane-ranker.test.ts`.
 */

import {
  assignLane,
  computeCorpusIdf,
  rankDeterministicLanes,
  type DeterministicLaneIdentity,
  type DeterministicLaneItem,
} from './deterministic-lane-ranker.js';
import {
  buildStoryDealerCache,
  positiveRatingEvidence,
  selectStrongestFitPortfolio,
  storyHolisticAffinity,
  storyRatingAnchorStrength,
  STORY_GRAPH_WATCH_HALF_LIFE_DAYS,
  VOD_STORY_GRAPH_MODEL_VERSION,
  type StoryGraphBackground,
  type StoryGraphContentId,
  type StoryGraphExplicitRating,
  type StoryGraphImplicitSignal,
  type StoryGraphRankInput,
  type StoryGraphRankResult,
  type StoryGraphScoredRecommendation,
  type StoryGraphTitle,
  type StoryTasteThread,
} from './story-graph-v1.js';

export const VOD_DETERMINISTIC_LANE_RANK_KIND = 'deterministic-lanes-v1' as const;
// Keep persisted thread diagnostics compatible with the historical [0, 1]
// posterior contract and its small neutral prior.
const THREAD_AXIS_PRIOR_STRENGTH = 0.25;

/** Preserve legacy `total_implicit_mass` semantics for diagnostic parity. */
function legacyImplicitSignalStrength(signal: StoryGraphImplicitSignal, asOf: number): number {
  if (!Number.isFinite(signal.occurred_at) || signal.occurred_at < 0) return 0;
  if (signal.kind === 'saved') return 0.8;
  const ageDays = Math.max(0, asOf - signal.occurred_at) / (24 * 60 * 60 * 1_000);
  const decay = 2 ** (-ageDays / STORY_GRAPH_WATCH_HALF_LIFE_DAYS);
  return (signal.kind === 'completion' ? 1 : 0.55) * decay;
}

function identityOf(type: 'movie' | 'series', id: string): DeterministicLaneIdentity {
  return `${type}:${id}` as DeterministicLaneIdentity;
}

function contentKey(type: 'movie' | 'series', id: string): StoryGraphContentId {
  return `${type}:${id}`;
}

function featureCoordinate(family: string, node_key: string, ordinal: boolean): string {
  return `${family}|${node_key}|${ordinal ? 'o' : 'c'}`;
}

function edgeValue(edge: NonNullable<StoryGraphTitle['edges']>[number]): number {
  const raw = edge.ordinal ? edge.intensity / 4 : edge.intensity;
  const confidence = Number.isFinite(edge.confidence) ? Math.max(0, Math.min(1, edge.confidence)) : 1;
  return Math.max(0, Math.min(1, raw)) * confidence;
}

/** Sparse per-title feature map. Size ≤ edge count, never vocab-wide. */
function encodeTitleFeatures(title: StoryGraphTitle): Map<string, number> {
  const features = new Map<string, number>();
  for (const edge of title.edges ?? []) {
    const key = featureCoordinate(edge.family, edge.node_key, edge.ordinal);
    const value = edgeValue(edge);
    if (value === 0) continue;
    const existing = features.get(key);
    if (existing === undefined || value > existing) features.set(key, value);
  }
  return features;
}

function toDeterministicItem(
  title: StoryGraphTitle,
  rating: StoryGraphExplicitRating | null,
  signal: StoryGraphImplicitSignal | null,
): DeterministicLaneItem {
  return {
    identity: identityOf(title.type, title.id),
    id: title.id,
    title: title.title,
    type: title.type,
    features: encodeTitleFeatures(title),
    fire: rating?.fire ?? null,
    water: rating?.water ?? null,
    implicit: signal
      ? {
        saved_at: signal.kind === 'saved' ? signal.occurred_at : null,
        completed_at: signal.kind === 'completion' ? signal.occurred_at : null,
        watched_at: signal.kind === 'partial' ? signal.occurred_at : null,
      }
      : null,
  };
}

/**
 * Predicted Fire/Water for a candidate is the anchor-strength-weighted
 * mean of the assigned lane's rated anchors. When the lane has no rated
 * anchor mass (e.g. implicit-only), fall back to a neutral 3.5/3.5 that
 * `storyHolisticAffinity` maps to a mid-band holistic — matching the
 * legacy ranker's cold-lane behaviour.
 */
function inferFireWaterForLane(
  anchors: Array<{ fire: number; water: number; strength: number }>,
): { fire: number; water: number } {
  let fireWeighted = 0;
  let waterWeighted = 0;
  let totalWeight = 0;
  for (const entry of anchors) {
    const weight = Math.max(0, entry.strength);
    if (weight <= 0) continue;
    fireWeighted += entry.fire * weight;
    waterWeighted += entry.water * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) return { fire: 3.5, water: 3.5 };
  return {
    fire: Math.max(1, Math.min(5, fireWeighted / totalWeight)),
    water: Math.max(1, Math.min(5, waterWeighted / totalWeight)),
  };
}

/**
 * Convention matches the legacy service's persistence layer, which maps
 * per-item best_thread_id via `thread-index:${lane}` regardless of the
 * ranker's internal label. Preserving this keeps cached-slate
 * threadIndex bookkeeping compatible without a schema change.
 */
function threadIdForLane(index: number): string {
  return `thread-index:${index}`;
}

function synthesizeThread(
  index: number,
  seed: StoryGraphContentId,
  anchorContentIds: readonly StoryGraphContentId[],
  ratings: readonly StoryGraphExplicitRating[],
  signals: readonly StoryGraphImplicitSignal[],
  asOf: number,
): StoryTasteThread {
  const anchorSet = new Set(anchorContentIds);
  const explicitAnchors = ratings.filter((rating) => anchorSet.has(contentKey(rating.type, rating.id)));
  const implicitAnchors = signals.filter((signal) => anchorSet.has(contentKey(signal.type, signal.id)));
  const explicitMass = explicitAnchors.reduce(
    (sum, r) => sum + storyRatingAnchorStrength(r.fire, r.water),
    0,
  );
  const implicitMass = implicitAnchors.reduce(
    (sum, signal) => sum + legacyImplicitSignalStrength(signal, asOf),
    0,
  );
  const fireNumerator = explicitAnchors.reduce((sum, rating) => (
    sum + storyRatingAnchorStrength(rating.fire, rating.water) * positiveRatingEvidence(rating.fire)
  ), 0);
  const waterNumerator = explicitAnchors.reduce((sum, rating) => (
    sum + storyRatingAnchorStrength(rating.fire, rating.water) * positiveRatingEvidence(rating.water)
  ), 0);
  const uncertainty = Math.max(0.1, 1 / (1 + explicitAnchors.length));
  return {
    thread_id: threadIdForLane(index),
    seed_id: seed,
    member_ids: [...anchorSet] as StoryGraphContentId[],
    effective_evidence_mass: explicitMass + implicitMass,
    explicit_evidence_mass: explicitMass,
    implicit_evidence_mass: implicitMass,
    fire_uplift: Math.max(0, Math.min(1, fireNumerator / (explicitMass + THREAD_AXIS_PRIOR_STRENGTH))),
    water_uplift: Math.max(0, Math.min(1, waterNumerator / (explicitMass + THREAD_AXIS_PRIOR_STRENGTH))),
    fire_uncertainty: uncertainty,
    water_uncertainty: uncertainty,
    explicit_profile: { total_mass: explicitMass, families: {} },
    implicit_profile: { total_mass: implicitMass, families: {} },
  };
}

function coldStartScore(features: ReadonlyMap<string, number>, idf: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const [key, value] of features) {
    const weight = idf.get(key) ?? 1;
    sum += Math.max(0, value) * weight;
  }
  return sum;
}

/**
 * Cold-start result: every candidate scored with IDF-weighted feature
 * mass so verified-corpus accounting stays complete. The service's
 * `published` gate refuses activation because `selected_k === 0`, and
 * the activation-gate layer emits the truthful Top Picks fallback.
 */
function coldStartRankResult(input: {
  background: StoryGraphBackground;
  candidateIds: readonly StoryGraphContentId[];
  itemByIdentity: ReadonlyMap<DeterministicLaneIdentity, DeterministicLaneItem>;
  documents: ReadonlyMap<StoryGraphContentId, StoryGraphTitle>;
  qualifyingExplicit: number;
  ignoredLowRatings: number;
  qualifyingImplicit: number;
  idf: ReadonlyMap<string, number>;
}): StoryGraphRankResult {
  const ranked = input.candidateIds
    .flatMap((contentId) => {
      const title = input.documents.get(contentId);
      if (!title) return [];
      const identity = identityOf(title.type, title.id);
      const item = input.itemByIdentity.get(identity);
      const features = item?.features ?? new Map<string, number>();
      const score = coldStartScore(features, input.idf);
      const rec: StoryGraphScoredRecommendation = {
        type: title.type,
        id: title.id,
        title: title.title,
        year: title.year ?? null,
        predicted_fire: 3.5,
        predicted_water: 3.5,
        holistic: storyHolisticAffinity(3.5, 3.5),
        affinity: score,
        posterior_standard_deviation: 1,
        rank_score: score,
        best_thread_id: null,
        explicit_support: 0,
        implicit_support: 0,
        feature_confidence: 0,
        thread_matches: [],
      };
      return [rec];
    })
    .sort((left, right) => (
      right.rank_score - left.rank_score
        || left.title.localeCompare(right.title)
        || left.id.localeCompare(right.id)
    ));
  return {
    model_version: VOD_STORY_GRAPH_MODEL_VERSION,
    background: input.background,
    selected_k: 0,
    threads: [],
    ranked,
    portfolio: ranked.slice(0, 6),
    dealer_cache: {
      model_version: VOD_STORY_GRAPH_MODEL_VERSION,
      weight_policy: 'rank',
      thread_order: [],
      items: ranked.map((recommendation, index) => ({
        rank: index + 1,
        dealer_weight: 1 / (1 + index),
        recommendation,
      })),
    },
    loao: [],
    diagnostics: {
      qualifying_explicit: input.qualifyingExplicit,
      ignored_low_ratings: input.ignoredLowRatings,
      qualifying_implicit: input.qualifyingImplicit,
      missing_evidence_documents: 0,
      total_explicit_mass: 0,
      total_implicit_mass: 0,
    },
  };
}

/**
 * Deterministic production rank. Never fits K=1..3, never runs LOAO.
 * Uses the pure ranker's full `ranked` output for every candidate and
 * delegates portfolio/dealer selection to the canonical helpers so the
 * fit floor and complete reserve stay in force. The returned
 * `StoryGraphRankResult` has empty `loao`, `selected_k <= 2`, and
 * `threads.length === selected_k`.
 */
export async function rankStoryGraphDeterministic(
  input: StoryGraphRankInput,
): Promise<StoryGraphRankResult> {
  const now = input.as_of;
  const documentsByContent = new Map<StoryGraphContentId, StoryGraphTitle>(
    input.documents.map((title) => [contentKey(title.type, title.id), title]),
  );
  const backgroundIds = input.background_ids ?? [...documentsByContent.keys()];
  const background: StoryGraphBackground = input.background ?? {
    document_count: backgroundIds.length,
    families: {},
  };
  const ratingsByKey = new Map<StoryGraphContentId, StoryGraphExplicitRating>(
    input.explicit_ratings.map((rating) => [contentKey(rating.type, rating.id), rating]),
  );
  const signalsByKey = new Map<StoryGraphContentId, StoryGraphImplicitSignal>();
  for (const signal of input.implicit_signals ?? []) {
    const key = contentKey(signal.type, signal.id);
    const existing = signalsByKey.get(key);
    if (!existing || existing.occurred_at < signal.occurred_at) signalsByKey.set(key, signal);
  }
  const candidateIds = input.candidate_ids ?? [...documentsByContent.keys()];
  const candidateSet = new Set(candidateIds);
  const qualifyingExplicit = input.explicit_ratings.filter((rating) => (
    positiveRatingEvidence(rating.fire) > 0 || positiveRatingEvidence(rating.water) > 0
  )).length;
  const qualifyingImplicit = (input.implicit_signals ?? []).length;

  const itemByIdentity = new Map<DeterministicLaneIdentity, DeterministicLaneItem>();
  for (const [key, title] of documentsByContent) {
    if (!candidateSet.has(key)) continue;
    const item = toDeterministicItem(
      title,
      ratingsByKey.get(key) ?? null,
      signalsByKey.get(key) ?? null,
    );
    itemByIdentity.set(item.identity, item);
  }
  // Retained rated/signalled titles outside the candidate universe still
  // teach household taste. Include them for seeding/assignment but they
  // will NOT appear in the ranked output because they're excluded via
  // the candidate identity set.
  const evidenceItems: DeterministicLaneItem[] = [];
  for (const key of ratingsByKey.keys()) {
    if (candidateSet.has(key)) continue;
    const title = documentsByContent.get(key);
    if (!title) continue;
    evidenceItems.push(toDeterministicItem(title, ratingsByKey.get(key) ?? null, signalsByKey.get(key) ?? null));
  }
  for (const key of signalsByKey.keys()) {
    if (candidateSet.has(key)) continue;
    if (ratingsByKey.has(key)) continue;
    const title = documentsByContent.get(key);
    if (!title) continue;
    evidenceItems.push(toDeterministicItem(title, null, signalsByKey.get(key) ?? null));
  }
  for (const item of evidenceItems) {
    if (!itemByIdentity.has(item.identity)) itemByIdentity.set(item.identity, item);
  }

  const items = [...itemByIdentity.values()];
  const idf = computeCorpusIdf(items);
  if (items.length === 0 || items.every((item) => item.features.size === 0)) {
    return coldStartRankResult({
      background,
      candidateIds,
      itemByIdentity,
      documents: documentsByContent,
      qualifyingExplicit,
      ignoredLowRatings: input.explicit_ratings.length - qualifyingExplicit,
      qualifyingImplicit,
      idf,
    });
  }

  const ranked = rankDeterministicLanes({
    items,
    as_of: now,
    exclude: new Set<DeterministicLaneIdentity>(),
    slate_size: 6,
    // Two lanes require >=2 supported anchors each; any positive → one lane.
    min_support_per_lane: 2,
  });
  if (ranked.lanes === 0) {
    if (input.on_page) await input.on_page(candidateIds.length, candidateIds.length);
    return coldStartRankResult({
      background,
      candidateIds,
      itemByIdentity,
      documents: documentsByContent,
      qualifyingExplicit,
      ignoredLowRatings: input.explicit_ratings.length - qualifyingExplicit,
      qualifyingImplicit,
      idf,
    });
  }

  // Lane assignment MUST come from the pure ranker so score ↔ lane
  // agreement is exact. The adapter never re-derives it from raw dot
  // products. `assignLane` is exported for tests that prove parity.
  const laneCount = ranked.lanes;
  const laneSeeds = ranked.seeds
    .map((seedIdentity) => itemByIdentity.get(seedIdentity)!)
    .slice(0, laneCount);
  const laneAnchorsForFireWater = new Map<number, Array<{ fire: number; water: number; strength: number }>>();
  const laneAnchorContentIds = new Map<number, StoryGraphContentId[]>();
  for (let lane = 0; lane < laneCount; lane += 1) {
    laneAnchorsForFireWater.set(lane, []);
    laneAnchorContentIds.set(lane, []);
  }
  for (const [identity, lane] of ranked.assignments) {
    if (lane < 0 || lane >= laneCount) continue;
    const item = itemByIdentity.get(identity);
    if (!item) continue;
    const contentId = contentKey(item.type, item.id);
    const fire = item.fire ?? 0;
    const water = item.water ?? 0;
    const explicit = storyRatingAnchorStrength(fire, water);
    const implicit = item.implicit;
    const hasImplicit = implicit !== null && implicit !== undefined
      && (implicit.saved_at != null
        || implicit.completed_at != null
        || implicit.watched_at != null);
    if (explicit > 0) {
      laneAnchorsForFireWater.get(lane)!.push({ fire, water, strength: explicit });
    }
    // Any anchor (explicit-positive OR implicit-positive) belongs on the
    // thread's member list so `synthesizeThread` counts its implicit mass.
    // Fire/Water inference stays weighted by explicit anchors only, so an
    // unrated Saved item does not paint the lane with a neutral 3.5/3.5.
    if (explicit > 0 || hasImplicit) {
      laneAnchorContentIds.get(lane)!.push(contentId);
    }
  }
  // Assignment-identity sanity: recompute one lane via the exported
  // helper for the primary seed and assert it matches the ranker's map.
  // This is a runtime safety net only; the contract itself is proved by
  // `deterministic-lane-ranker.test.ts` on realistic corpora.
  for (const item of items) {
    if (!candidateSet.has(contentKey(item.type, item.id))) continue;
    const recomputed = assignLane(item.features, laneSeeds, idf);
    const recorded = ranked.assignments.get(item.identity);
    if (recomputed !== recorded) {
      throw new Error(`lane assignment mismatch for ${item.identity}: recomputed ${recomputed}, ranker ${recorded}`);
    }
    break;
  }

  const scoreByIdentity = new Map<DeterministicLaneIdentity, { lane: number; score: number }>();
  for (const entry of ranked.ranked) scoreByIdentity.set(entry.identity, { lane: entry.lane, score: entry.score });

  const scoredRecommendations: StoryGraphScoredRecommendation[] = [];
  for (const [contentId, title] of documentsByContent) {
    if (!candidateSet.has(contentId)) continue;
    const identity = identityOf(title.type, title.id);
    const entry = scoreByIdentity.get(identity);
    if (!entry) continue;
    const lane = entry.lane >= 0 && entry.lane < laneCount ? entry.lane : 0;
    const anchors = laneAnchorsForFireWater.get(lane) ?? [];
    const { fire, water } = inferFireWaterForLane(anchors);
    scoredRecommendations.push({
      type: title.type,
      id: title.id,
      title: title.title,
      year: title.year ?? null,
      predicted_fire: fire,
      predicted_water: water,
      holistic: storyHolisticAffinity(fire, water),
      affinity: entry.score,
      posterior_standard_deviation: 1 / (1 + anchors.length),
      rank_score: entry.score,
      best_thread_id: threadIdForLane(lane),
      explicit_support: anchors.reduce((sum, e) => sum + e.strength, 0),
      implicit_support: signalsByKey.get(contentId) ? 1 : 0,
      feature_confidence: title.family_coverage
        ? Object.values(title.family_coverage).reduce((sum, coverage) => (
          sum + (coverage?.confidence ?? 0)
        ), 0) / Math.max(1, Object.keys(title.family_coverage).length)
        : 1,
      thread_matches: [],
    });
  }
  scoredRecommendations.sort((left, right) => (
    right.rank_score - left.rank_score
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id)
  ));

  if (input.on_page) await input.on_page(candidateIds.length, candidateIds.length);

  const threadSeeds = laneSeeds.map((seed, lane) => synthesizeThread(
    lane,
    contentKey(seed.type, seed.id),
    laneAnchorContentIds.get(lane) ?? [],
    input.explicit_ratings,
    input.implicit_signals ?? [],
    now,
  ));
  const threadOrder = threadSeeds.map((thread) => thread.thread_id);

  // Delegate portfolio + dealer cache to the canonical helpers so the
  // fit floor, per-thread quotas, and complete reserve stay in force.
  const portfolio = selectStrongestFitPortfolio(scoredRecommendations, threadOrder);
  const dealerCache = buildStoryDealerCache(scoredRecommendations, threadOrder);

  const totalExplicitMass = threadSeeds.reduce(
    (sum, thread) => sum + thread.explicit_evidence_mass,
    0,
  );
  const totalImplicitMass = threadSeeds.reduce(
    (sum, thread) => sum + thread.implicit_evidence_mass,
    0,
  );

  return {
    model_version: VOD_STORY_GRAPH_MODEL_VERSION,
    background,
    selected_k: laneCount,
    threads: threadSeeds,
    ranked: scoredRecommendations,
    portfolio,
    dealer_cache: dealerCache,
    loao: [],
    diagnostics: {
      qualifying_explicit: qualifyingExplicit,
      ignored_low_ratings: input.explicit_ratings.length - qualifyingExplicit,
      qualifying_implicit: qualifyingImplicit,
      missing_evidence_documents: 0,
      total_explicit_mass: totalExplicitMass,
      total_implicit_mass: totalImplicitMass,
    },
  };
}
