import assert from 'node:assert/strict';
import test from 'node:test';
import type { FireWaterRating } from '../library/ratings.js';
import {
  balancedHouseholdAffinity,
  buildRecommendationFeature,
  cosineSimilarity,
  holisticAffinity,
  predictAxes,
  rankRecommendations,
  recommendationRewatchCadence,
  validateAiFeatureDocument,
  type RecommendationFeature,
} from './engine.js';

function rating(id: string, fire: number, water: number, type: 'movie' | 'series' = 'movie'): FireWaterRating {
  return {
    profile_id: 'household',
    type,
    id,
    title: `Rated ${id}`,
    year: '2020',
    fire: fire as FireWaterRating['fire'],
    water: water as FireWaterRating['water'],
    revision: 1,
    origin: 'couch',
    taste_tags: [],
    updated_at: 1,
  };
}

function feature(id: string, vector: number[], type: 'movie' | 'series' = 'movie'): RecommendationFeature {
  return {
    type,
    id,
    title: `Candidate ${id}`,
    year: '2020',
    rail_id: `cluster-${id}`,
    rail_ids: [`cluster-${id}`],
    vector,
    cluster: `cluster-${id}`,
    confidence: 1,
  };
}

function clusteredFeature(id: string, vectorIndex: number, cluster: string): RecommendationFeature {
  const vector = Array<number>(16).fill(0);
  vector[vectorIndex] = 1;
  return {
    ...feature(id, vector),
    rail_id: cluster,
    rail_ids: [cluster],
    cluster,
  };
}

test('cosine similarity is bounded and dual axes predict independently', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  const ratings = [rating('fire', 5, 0), rating('water', 0, 5)];
  const features = new Map<string, RecommendationFeature>([
    ['movie:fire', feature('fire', [1, 0])],
    ['movie:water', feature('water', [0, 1])],
  ]);
  const towardFire = predictAxes({
    candidate: feature('new', [1, 0]),
    ratings,
    ratingFeatures: features,
    tab: 'movies',
  });
  assert.ok(towardFire.fire > towardFire.water);
});

test('single-axis excellence qualifies and high-high gets the balance bonus', () => {
  assert.equal(holisticAffinity(5, 0), 3.75);
  assert.equal(holisticAffinity(5, 5), 5);
  assert.ok(holisticAffinity(5, 1) > holisticAffinity(3, 3));
});

test('low-evidence axes use the same explainable neutral prior regardless of vector position', () => {
  const anchor = rating('anchor', 5, 1);
  const anchorFeature = clusteredFeature('anchor', 15, 'anchor');
  const ratingFeatures = new Map([['movie:anchor', anchorFeature]]);
  const first = predictAxes({
    candidate: clusteredFeature('first', 1, 'first'),
    ratings: [anchor],
    ratingFeatures,
    tab: 'movies',
  });
  const second = predictAxes({
    candidate: clusteredFeature('second', 9, 'second'),
    ratings: [anchor],
    ratingFeatures,
    tab: 'movies',
  });
  assert.equal(first.neighbor_weight, 0);
  assert.deepEqual(first, second);
  assert.equal(first.fire, 4.5);
  assert.ok(Math.abs(first.water - 1.3) < Number.EPSILON * 2);
});

test('series-only ratings never influence movie priors even for an identical feature', () => {
  const candidate = feature('movie-candidate', [1, 0], 'movie');
  const seriesRating = rating('series-loved', 5, 0, 'series');
  const seriesFeature = feature('series-loved', [1, 0], 'series');
  const fromSeriesOnly = predictAxes({
    candidate,
    ratings: [seriesRating],
    ratingFeatures: new Map([['series:series-loved', seriesFeature]]),
    tab: 'movies',
  });
  const fromNoRatings = predictAxes({
    candidate,
    ratings: [],
    ratingFeatures: new Map(),
    tab: 'movies',
  });

  assert.deepEqual(fromSeriesOnly, fromNoRatings);
  assert.deepEqual(fromSeriesOnly, { fire: 2.5, water: 2.5, neighbor_weight: 0 });
});

test('implicit-only cold start produces a complete deterministic slate without explicit ratings', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => clusteredFeature(
    `cold-${index}`,
    index % 12,
    `cold-cluster-${index}`,
  ));
  const taste = clusteredFeature('saved-anchor', 0, 'saved-anchor');
  const input = {
    tab: 'movies' as const,
    candidates,
    ratings: [],
    ratingFeatures: new Map<string, RecommendationFeature>(),
    implicitPreferences: [{ feature: taste, strength: 0.8 }],
    implicitPreferenceGroups: [[{ feature: taste, strength: 0.8 }]],
    dailySeed: 'cold-start-profile:2026-08-03',
    limit: 6,
    visibleLimit: 6,
  };
  const first = rankRecommendations(input);
  const second = rankRecommendations(input);
  assert.equal(first.length, 6);
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.deepEqual(first.map((item) => item.bucket), [
    'close', 'close', 'close', 'close', 'adjacent', 'explore',
  ]);
});

test('seed taste tags and catalog rail tags share one semantic space', () => {
  const seed = buildRecommendationFeature({
    type: 'movie', id: 'seed', title: 'Seed', taste_tags: ['hopeful', 'friendship'],
  });
  const matching = buildRecommendationFeature({
    type: 'movie', id: 'matching', title: 'Other', rail_ids: ['hopeful-friendship'],
  });
  const unrelated = buildRecommendationFeature({
    type: 'movie', id: 'unrelated', title: 'Elsewhere', rail_ids: ['grim-horror'],
  });
  assert.ok(cosineSimilarity(seed.vector, matching.vector) > cosineSimilarity(seed.vector, unrelated.vector));
  assert.ok(cosineSimilarity(seed.vector, matching.vector) > 0.25);
});

test('verified multi-rail features use a stable semantic cluster for global MMR', () => {
  const built = buildRecommendationFeature({
    type: 'movie', id: 'multi-rail', title: 'A Title', year: '2024',
    rail_ids: ['thriller', 'award-winners'],
  });
  assert.equal(built.cluster, 'award-winners');
  assert.equal(built.rail_id, 'award-winners');
});

test('household affinity rewards broadly satisfying picks over polarizing ones', () => {
  assert.ok(balancedHouseholdAffinity([4, 4]) > balancedHouseholdAffinity([5, 1]));
  assert.equal(balancedHouseholdAffinity([4]), 4);
});

test('household implicit taste balances viewers instead of activity volume', () => {
  const anchor = rating('anchor', 3, 3);
  const anchorFeature = feature('anchor', [0, 0, 1]);
  const majorityTaste = feature('majority-taste', [1, 0, 0]);
  const minorityTaste = feature('minority-taste', [0, 1, 0]);
  const towardMajority = feature('toward-majority', [0.9363291776, 0.3511234416, 0]);
  const towardMinority = feature('toward-minority', [0.3511234416, 0.9363291776, 0]);
  const majorityHistory = Array.from({ length: 20 }, () => ({ feature: majorityTaste, strength: 1 }));
  const minorityHistory = [{ feature: minorityTaste, strength: 1 }];
  const common = {
    tab: 'movies' as const,
    candidates: [towardMajority, towardMinority],
    ratings: [anchor],
    ratingFeatures: new Map([['movie:anchor', anchorFeature]]),
    dailySeed: 'viewer-balance',
    limit: 2,
  };
  const activityWeighted = rankRecommendations({
    ...common,
    implicitPreferences: [...majorityHistory, ...minorityHistory],
  });
  const viewerBalanced = rankRecommendations({
    ...common,
    implicitPreferenceGroups: [majorityHistory, minorityHistory],
  });
  assert.ok(
    activityWeighted.find((item) => item.id === towardMajority.id)!.affinity
      > activityWeighted.find((item) => item.id === towardMinority.id)!.affinity,
  );
  assert.ok(Math.abs(
    viewerBalanced.find((item) => item.id === towardMajority.id)!.affinity
      - viewerBalanced.find((item) => item.id === towardMinority.id)!.affinity,
  ) < 1e-10);
  assert.equal(
    viewerBalanced.find((item) => item.id === towardMajority.id)!.predicted_fire,
    viewerBalanced.find((item) => item.id === towardMinority.id)!.predicted_fire,
  );
});

test('implicit history and explicit mood are bounded positive refinements', () => {
  const neutralRating = rating('neutral', 3, 3);
  const neutralFeature = buildRecommendationFeature({
    type: 'movie', id: 'neutral', title: 'Neutral', rail_ids: ['documentary'],
  });
  const comedy = buildRecommendationFeature({
    type: 'movie', id: 'comedy', title: 'Comedy', rail_ids: ['comedy', 'funny'],
  });
  const drama = buildRecommendationFeature({
    type: 'movie', id: 'drama', title: 'Drama', rail_ids: ['drama', 'serious'],
  });
  const laughContext = buildRecommendationFeature({
    type: 'movie', id: 'mood:laugh', title: 'laugh', taste_tags: ['comedy', 'funny'],
  });
  const base = rankRecommendations({
    tab: 'movies', candidates: [comedy, drama], ratings: [neutralRating],
    ratingFeatures: new Map([['movie:neutral', neutralFeature]]), dailySeed: 'base', limit: 2,
  });
  const refined = rankRecommendations({
    tab: 'movies', candidates: [comedy, drama], ratings: [neutralRating],
    ratingFeatures: new Map([['movie:neutral', neutralFeature]]), dailySeed: 'refined', limit: 2,
    contextFeature: laughContext,
    implicitPreferences: [{ feature: comedy, strength: 1 }],
  });
  const baseComedy = base.find((item) => item.id === 'comedy')!;
  const refinedComedy = refined.find((item) => item.id === 'comedy')!;
  const refinedDrama = refined.find((item) => item.id === 'drama')!;
  assert.ok(refinedComedy.affinity > baseComedy.affinity);
  assert.ok(refinedComedy.affinity > refinedDrama.affinity);
  assert.ok(refinedComedy.affinity - baseComedy.affinity <= 0.20 + Number.EPSILON);
});

test('current semantic dislikes softly demote neighbors while explicit axes remain dominant', () => {
  const anchor = rating('anchor', 5, 4);
  const anchorFeature = feature('anchor', [1, 0, 0]);
  const similar = feature('similar', [1, 0, 0]);
  const unrelated = feature('unrelated', [0, 1, 0]);
  const common = {
    tab: 'movies' as const,
    candidates: [similar, unrelated],
    ratings: [anchor],
    ratingFeatures: new Map([['movie:anchor', anchorFeature]]),
    dailySeed: 'negative-signal',
    limit: 2,
  };
  const base = rankRecommendations(common);
  const fresh = rankRecommendations({
    ...common,
    negativePreferences: [{ feature: similar, strength: 1 }],
  });
  const stale = rankRecommendations({
    ...common,
    negativePreferences: [{ feature: similar, strength: 0.25 }],
  });
  const baseSimilar = base.find((item) => item.id === 'similar')!;
  const freshSimilar = fresh.find((item) => item.id === 'similar')!;
  const staleSimilar = stale.find((item) => item.id === 'similar')!;
  const baseUnrelated = base.find((item) => item.id === 'unrelated')!;
  const freshUnrelated = fresh.find((item) => item.id === 'unrelated')!;
  assert.ok(freshSimilar.affinity < staleSimilar.affinity);
  assert.ok(staleSimilar.affinity < baseSimilar.affinity);
  assert.ok(baseSimilar.affinity - freshSimilar.affinity <= 0.20 + Number.EPSILON);
  assert.equal(freshSimilar.predicted_fire, baseSimilar.predicted_fire);
  assert.equal(freshSimilar.predicted_water, baseSimilar.predicted_water);
  assert.equal(freshUnrelated.affinity, baseUnrelated.affinity);
  assert.ok(freshSimilar.affinity > 0);
});

test('series movie transfer decays to zero after twelve series ratings', () => {
  const candidate = feature('series-new', [1, 0], 'series');
  const movie = rating('movie-fire', 5, 0, 'movie');
  const ratingFeatures = new Map<string, RecommendationFeature>([
    ['movie:movie-fire', feature('movie-fire', [1, 0])],
  ]);
  const cold = predictAxes({ candidate, ratings: [movie], ratingFeatures, tab: 'series' });
  const seriesRatings = Array.from({ length: 12 }, (_, index) => rating(`series-${index}`, 2.5, 2.5, 'series'));
  for (const row of seriesRatings) ratingFeatures.set(`series:${row.id}`, feature(row.id, [0, 1], 'series'));
  const warm = predictAxes({ candidate, ratings: [movie, ...seriesRatings], ratingFeatures, tab: 'series' });
  assert.ok(cold.fire > cold.water);
  assert.ok(Math.abs(warm.fire - warm.water) < 0.25);
});

test('ranking is replay-stable and the visible six target exact 4/1/1 buckets', () => {
  const ratings = [rating('anchor', 5, 4.5)];
  const anchor = buildRecommendationFeature({
    type: 'movie', id: 'anchor', title: 'Bright Adventure', year: '2020', rail_id: 'action-adventure',
  });
  const ratingFeatures = new Map([['movie:anchor', anchor]]);
  const candidates = Array.from({ length: 30 }, (_, index) => buildRecommendationFeature({
    type: 'movie',
    id: `candidate-${index}`,
    title: index % 2 ? `Bright Story ${index}` : `Quiet Story ${index}`,
    year: String(1980 + index),
    rail_id: `genre-${index % 8}`,
  }));
  const first = rankRecommendations({
    tab: 'movies', candidates, ratings, ratingFeatures, dailySeed: 'movies:2026-08-02',
    limit: 12,
  });
  const second = rankRecommendations({
    tab: 'movies', candidates, ratings, ratingFeatures, dailySeed: 'movies:2026-08-02',
    limit: 12,
  });
  assert.deepEqual(first.map((row) => row.id), second.map((row) => row.id));
  assert.equal(first.length, 12);
  assert.equal(first.slice(0, 6).filter((row) => row.bucket === 'close').length, 4);
  assert.equal(first.slice(0, 6).filter((row) => row.bucket === 'adjacent').length, 1);
  assert.equal(first.slice(0, 6).filter((row) => row.bucket === 'explore').length, 1);
  assert.equal(new Set(first.map((row) => row.id)).size, 12);

  const reserve = rankRecommendations({
    tab: 'movies',
    candidates,
    ratings,
    ratingFeatures,
    dailySeed: 'movies:2026-08-02',
    limit: 40,
  });
  // Visible six stays strict; deeper reserve uses a softer cluster cap so shuffle
  // has a thematic pool well beyond one screen.
  assert.ok(reserve.length >= 24, `expected deep reserve, got ${reserve.length}`);
  assert.equal(reserve.slice(0, 6).filter((row) => row.bucket === 'close').length, 4);
  assert.equal(reserve.slice(0, 6).filter((row) => row.bucket === 'adjacent').length, 1);
  assert.equal(reserve.slice(0, 6).filter((row) => row.bucket === 'explore').length, 1);
  assert.deepEqual(
    reserve.slice(0, 6).map((row) => [row.id, row.bucket]),
    first.slice(0, 6).map((row) => [row.id, row.bucket]),
  );
  assert.ok(reserve.filter((row) => row.bucket === 'close').length >= 8);
  assert.ok(reserve.filter((row) => row.bucket === 'adjacent').length >= 3);
  assert.ok(
    reserve.filter((row) => row.bucket === 'explore' || row.bucket === 'fallback').length >= 3,
  );
});

test('deep reserve keeps visible cluster discipline while filling toward the limit', () => {
  const ratings = [rating('anchor', 5, 4.5)];
  const anchor = buildRecommendationFeature({
    type: 'movie', id: 'anchor', title: 'Bright Adventure', year: '2020', rail_id: 'action-adventure',
  });
  const ratingFeatures = new Map([['movie:anchor', anchor]]);
  const candidates = Array.from({ length: 220 }, (_, index) => buildRecommendationFeature({
    type: 'movie',
    id: `deep-${index}`,
    title: index % 2 ? `Bright Story ${index}` : `Quiet Story ${index}`,
    year: String(1980 + (index % 40)),
    rail_id: `genre-${index % 12}`,
  }));
  const ranked = rankRecommendations({
    tab: 'movies',
    candidates,
    ratings,
    ratingFeatures,
    dailySeed: 'movies:deep-reserve',
    limit: 200,
    visibleLimit: 6,
  });
  assert.equal(ranked.length, 200, `expected 200-deep reserve, got ${ranked.length}`);
  const visible = ranked.slice(0, 6);
  const visibleClusters = new Map<string, number>();
  for (const item of visible) {
    visibleClusters.set(item.cluster, (visibleClusters.get(item.cluster) ?? 0) + 1);
  }
  assert.ok(Math.max(...visibleClusters.values()) <= 2);
  assert.equal(visible.filter((row) => row.bucket === 'close').length, 4);
  assert.equal(visible.filter((row) => row.bucket === 'adjacent').length, 1);
  assert.equal(visible.filter((row) => row.bucket === 'explore').length, 1);
});

test('exploration obeys the global MMR cluster cap without changing the 4/1/1 slate', () => {
  const anchor = rating('anchor', 4, 3);
  const ratingFeatures = new Map([[
    'movie:anchor',
    clusteredFeature('anchor', 15, 'anchor'),
  ]]);
  // Cap 2 needs ≥3 clusters to complete a six-card 4/1/1 slate.
  const candidates = [
    ...Array.from({ length: 8 }, (_, index) => clusteredFeature(`a-crowded-${index}`, index, 'crowded')),
    ...Array.from({ length: 6 }, (_, index) => clusteredFeature(`b-other-${index}`, index + 8, 'other')),
    ...Array.from({ length: 6 }, (_, index) => clusteredFeature(`c-fresh-${index}`, index + 14, 'fresh')),
  ];
  const ranked = rankRecommendations({
    tab: 'movies',
    candidates,
    ratings: [anchor],
    ratingFeatures,
    dailySeed: 'cluster-1',
    limit: 6,
  });
  assert.equal(ranked.filter((item) => item.bucket === 'close').length, 4);
  assert.equal(ranked.filter((item) => item.bucket === 'adjacent').length, 1);
  assert.equal(ranked.filter((item) => item.bucket === 'explore').length, 1);
  const counts = new Map<string, number>();
  for (const item of ranked) counts.set(item.cluster, (counts.get(item.cluster) ?? 0) + 1);
  assert.ok(Math.max(...counts.values()) <= 2);
  assert.notEqual(ranked.find((item) => item.bucket === 'explore')?.cluster, 'crowded');
});

test('a cooled rewatch can occupy only the rare deterministic exploration slot', () => {
  assert.equal(recommendationRewatchCadence('rewatch-day-0'), false);
  assert.equal(recommendationRewatchCadence('rewatch-day-5'), true);
  const anchor = rating('anchor', 4, 3);
  const ratingFeatures = new Map([[
    'movie:anchor',
    clusteredFeature('anchor', 15, 'anchor'),
  ]]);
  const candidates = Array.from(
    { length: 12 },
    (_, index) => clusteredFeature(`candidate-${String(index).padStart(2, '0')}`, index, `cluster-${index % 6}`),
  );
  const rewatch = clusteredFeature('cooled-rewatch', 14, 'rewatch');
  const common = {
    tab: 'movies' as const,
    candidates,
    ratings: [anchor],
    ratingFeatures,
    rewatchCandidates: [rewatch],
    dailySeed: 'stable-ranking-seed',
    limit: 6,
  };
  const ordinaryDay = rankRecommendations({ ...common, rewatchCadenceSeed: 'rewatch-day-0' });
  const rewatchDay = rankRecommendations({ ...common, rewatchCadenceSeed: 'rewatch-day-5' });
  assert.equal(ordinaryDay.some((item) => item.id === rewatch.id), false);
  assert.equal(rewatchDay.filter((item) => item.id === rewatch.id).length, 1);
  assert.equal(rewatchDay.find((item) => item.id === rewatch.id)?.bucket, 'explore');
  assert.equal(rewatchDay.find((item) => item.id === rewatch.id)?.couch_provenance, 'watch_again');
  for (const slate of [ordinaryDay, rewatchDay]) {
    assert.equal(slate.length, 6);
    assert.equal(slate.filter((item) => item.bucket === 'close').length, 4);
    assert.equal(slate.filter((item) => item.bucket === 'adjacent').length, 1);
    assert.equal(slate.filter((item) => item.bucket === 'explore').length, 1);
  }
});

test('AI feature documents cannot invent ids or escape the bounded schema', () => {
  const document = {
    type: 'movie' as const,
    id: 'tt1',
    model_version: 'configured-model',
    prompt_version: 'fire-water-v1',
    input_hash: 'a'.repeat(64),
    themes: ['friendship'],
    tone: ['hopeful'],
    pace: 'moderate' as const,
    tension: 0.4,
    humor: 0.5,
    spectacle: 0.2,
    emotional_intensity: 0.8,
    tenderness: 0.9,
    narrative_complexity: 0.4,
  };
  assert.equal(validateAiFeatureDocument(document, new Set(['movie:tt1'])).id, 'tt1');
  assert.throws(() => validateAiFeatureDocument(
    { ...document, id: 'invented' },
    new Set(['movie:tt1']),
  ), /unknown stable id/);
  assert.throws(() => validateAiFeatureDocument(
    { ...document, tension: 2 },
    new Set(['movie:tt1']),
  ), /between 0 and 1/);
});
