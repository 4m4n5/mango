import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activateViewerProfile,
  createViewerProfile,
  libraryDatabase,
  recordRecommendationDetailOpen,
  recordRecommendationImpressions,
  recordRecommendationPlayStart,
  recordRecommendationProgress,
  registerRecommendationServedSlate,
  resetLibraryDbForTests,
} from '../library/db.js';
import type { FireWaterRating } from '../library/ratings.js';
import { buildAiEnrichedRecommendationFeature, type RecommendationAiInput } from './ai.js';
import { buildRecommendationFeature, cosineSimilarity } from './engine.js';
import {
  isCooledRecommendationRewatch,
  incrementRecommendationMetric,
  mergeRatingWithVerifiedMetadata,
  recommendationDiagnostics,
  recommendationNegativeSignalStrength,
  recommendationPreferenceAiInputs,
  recommendationShuffleNonce,
  recommendationSignalPreferenceStrength,
  selectVisibleRecommendationSlate,
  setRecommendationMetric,
} from './service.js';

function withTempLibrary<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-recommendation-service-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  const cleanup = () => {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function seedRating(): FireWaterRating {
  return {
    profile_id: 'household',
    type: 'movie',
    id: 'tt-seed',
    title: 'Seed title',
    year: '1999',
    fire: 4.5,
    water: 4,
    revision: 1,
    origin: 'seed',
    taste_tags: ['hopeful', 'friendship'],
    updated_at: 1,
  };
}

test('reviewed seed tags merge with verified catalog metadata', () => {
  const rating = seedRating();
  const verified: RecommendationAiInput = {
    type: 'movie',
    id: rating.id,
    title: 'Canonical catalog title',
    year: '2000',
    rail_ids: ['uplifting-adventure'],
  };
  const merged = mergeRatingWithVerifiedMetadata(rating, verified);
  assert.deepEqual(merged, {
    ...verified,
    taste_tags: rating.taste_tags,
  });
  const feature = buildAiEnrichedRecommendationFeature(merged);
  const catalogConcept = buildRecommendationFeature({
    type: 'movie', id: 'catalog-concept', title: 'Other', rail_ids: ['uplifting-adventure'],
  });
  const reviewedConcept = buildRecommendationFeature({
    type: 'movie', id: 'reviewed-concept', title: 'Elsewhere', taste_tags: ['hopeful', 'friendship'],
  });
  assert.ok(cosineSimilarity(feature.vector, catalogConcept.vector) > 0.15);
  assert.ok(cosineSimilarity(feature.vector, reviewedConcept.vector) > 0.5);
  assert.throws(() => mergeRatingWithVerifiedMetadata(rating, {
    ...verified,
    id: 'different-id',
  }), /must match the rating stable id/);
});

test('watched saved and negative titles retain verified inputs for AI preference anchors', () => {
  const inputs = new Map<string, RecommendationAiInput>([
    ['movie:watched', { type: 'movie', id: 'watched', title: 'Watched', rail_ids: ['drama'] }],
    ['movie:saved', { type: 'movie', id: 'saved', title: 'Saved', rail_ids: ['comedy'] }],
    ['series:hidden', { type: 'series', id: 'hidden', title: 'Hidden', rail_ids: ['mystery'] }],
    ['movie:neutral', { type: 'movie', id: 'neutral', title: 'Neutral' }],
  ]);
  const signal = (item_type: string, item_id: string, state: Partial<{
    watched: boolean; saved: boolean; not_interested: boolean;
  }>) => ({
    domain: 'vod' as const,
    item_type,
    item_id,
    title: item_id,
    watched: false,
    saved: false,
    not_interested: false,
    last_not_interested_at: 0,
    strongest_positive: 0,
    last_positive_at: 0,
    last_event_at: 1,
    ...state,
  });
  assert.deepEqual(
    recommendationPreferenceAiInputs([
      signal('movie', 'watched', { watched: true }),
      signal('movie', 'saved', { saved: true }),
      signal('series', 'hidden', { not_interested: true }),
      signal('movie', 'neutral', {}),
      signal('youtube_video', 'outside-domain', { watched: true }),
      signal('movie', 'missing', { watched: true }),
      signal('movie', 'watched', { saved: true }),
    ], inputs).map((input) => `${input.type}:${input.id}`),
    ['movie:watched', 'movie:saved', 'series:hidden'],
  );
});

test('implicit decay is anchored to the last positive event, not newer neutral activity', () => {
  const now = Date.UTC(2026, 7, 3);
  const common = {
    strongest_positive: 0.8,
    saved: true,
    last_positive_at: now - 30 * 86_400_000,
  };
  const beforeNeutral = recommendationSignalPreferenceStrength({
    ...common,
    last_event_at: common.last_positive_at,
  }, now);
  const afterNeutral = recommendationSignalPreferenceStrength({
    ...common,
    last_event_at: now,
  }, now);
  assert.equal(beforeNeutral, afterNeutral);
  assert.equal(recommendationSignalPreferenceStrength({
    strongest_positive: 0,
    saved: false,
    last_positive_at: 0,
    last_event_at: now,
  }, now), 0);
});

test('semantic dislike strength decays without being rejuvenated by neutral events or surviving Undo', () => {
  const now = Date.UTC(2026, 7, 3);
  assert.equal(recommendationNegativeSignalStrength({
    not_interested: true,
    last_not_interested_at: now,
    last_event_at: now,
  }, now), 1);
  assert.ok(Math.abs(recommendationNegativeSignalStrength({
    not_interested: true,
    last_not_interested_at: now - 90 * 86_400_000,
    last_event_at: now,
  }, now) - 0.5) < Number.EPSILON);
  const beforeNeutral = recommendationNegativeSignalStrength({
    not_interested: true,
    last_not_interested_at: now - 180 * 86_400_000,
    last_event_at: now - 180 * 86_400_000,
  }, now);
  const afterNeutral = recommendationNegativeSignalStrength({
    not_interested: true,
    last_not_interested_at: now - 180 * 86_400_000,
    last_event_at: now,
  }, now);
  assert.equal(beforeNeutral, 0.25);
  assert.equal(afterNeutral, beforeNeutral);
  assert.equal(recommendationNegativeSignalStrength({
    not_interested: false,
    last_not_interested_at: 0,
    last_event_at: now,
  }, now), 0);
});

test('rewatch eligibility requires a long cooldown and no current dislike', () => {
  const now = Date.UTC(2026, 7, 3);
  const cooled = {
    watched: true,
    not_interested: false,
    last_positive_at: now - 181 * 86_400_000,
  };
  assert.equal(isCooledRecommendationRewatch(cooled, now), true);
  assert.equal(isCooledRecommendationRewatch({
    ...cooled,
    last_positive_at: now - 179 * 86_400_000,
  }, now), false);
  assert.equal(isCooledRecommendationRewatch({ ...cooled, not_interested: true }, now), false);
  assert.equal(isCooledRecommendationRewatch({ ...cooled, watched: false }, now), false);
});

test('load-time reserve healing preserves the exact visible 4/1/1 contract', () => {
  const row = (rank: number, bucket: 'close' | 'adjacent' | 'explore' | 'fallback') => ({
    revision: 3,
    rank,
    content_type: 'movie' as const,
    content_id: `${bucket}-${rank}`,
    title: `${bucket} ${rank}`,
    poster: null,
    year: '2024',
    bucket,
    generation_reason: bucket === 'explore' ? 'stable_daily_exploration' : 'dual_axis_affinity',
  });
  const visible = selectVisibleRecommendationSlate([
    row(1, 'close'), row(2, 'close'), row(3, 'close'), row(4, 'close'),
    row(6, 'explore'),
    // The original adjacent card was filtered after publication. A ranked
    // adjacent reserve heals that slot without changing the visible mix.
    row(7, 'close'), row(8, 'adjacent'), row(9, 'fallback'),
  ], 'movies', false);
  assert.deepEqual(visible.map((item) => item.bucket), [
    'close', 'close', 'close', 'close', 'adjacent', 'explore',
  ]);
  assert.equal(selectVisibleRecommendationSlate([
    row(1, 'close'), row(2, 'close'), row(3, 'close'), row(4, 'close'), row(5, 'adjacent'),
  ], 'movies', false).length, 0);
});

test('diagnostics expose only active-profile metrics and leave legacy global rows untouched', () => withTempLibrary(() => {
  const db = libraryDatabase();
  db.prepare(`
INSERT INTO recommendation_metrics(metric_name, metric_value, updated_at)
VALUES ('candidate_count_last_movies', 77, 123)
`).run();
  const alice = createViewerProfile('Alice');
  db.prepare(`
INSERT INTO profile_recommendation_snapshots(
  profile_id, tab, revision, model_version, model_kind, status,
  candidate_count, generated_at, daily_seed
) VALUES (?, 'movies', 7, 'test-model', 'content-shrinkage', 'ready', 20, 900, 'test-seed')
`).run(alice.profile_id);
  const served = registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'vod',
    rail_id: 'for-you-movies',
    source_revision: 7,
    items: [
      { type: 'movie', id: 'tt-one', rank: 0 },
      { type: 'movie', id: 'tt-two', rank: 1 },
    ],
  });
  const attribution = {
    profile_id: alice.profile_id,
    domain: 'vod' as const,
    rail_id: served.rail_id,
    slate_revision: served.slate_revision,
  };
  recordRecommendationImpressions({
    ...attribution,
    shown_at: 1_000,
    items: [
      { type: 'movie', id: 'tt-one', rank: 0 },
      { type: 'movie', id: 'tt-two', rank: 1 },
    ],
  });
  const selected = { ...attribution, item_type: 'movie', item_id: 'tt-one' };
  recordRecommendationDetailOpen({ ...selected, occurred_at: 1_100 });
  recordRecommendationPlayStart({ ...selected, occurred_at: 1_200 });
  recordRecommendationProgress({ ...selected, progress_pct: 0.95, occurred_at: 1_300 });
  setRecommendationMetric('candidate_count_last_movies', 6, 'household');
  setRecommendationMetric('candidate_count_last_movies', 12, alice.profile_id);
  assert.equal(recommendationShuffleNonce('movies', 'household'), 1);
  assert.equal(recommendationShuffleNonce('movies', 'household'), 2);
  activateViewerProfile(alice.profile_id);
  assert.equal(recommendationShuffleNonce('movies'), 1);
  incrementRecommendationMetric('captured_refreshes', 'household');
  const aliceDiagnostics = recommendationDiagnostics();
  assert.equal(aliceDiagnostics.active_profile_id, alice.profile_id);
  assert.deepEqual(aliceDiagnostics.metrics_scope, { kind: 'active_profile', profile_id: alice.profile_id });
  assert.equal(aliceDiagnostics.metrics.candidate_count_last_movies?.value, 12);
  assert.equal(aliceDiagnostics.metrics.shuffle_nonce_movies?.value, 1);
  assert.equal(Object.hasOwn(aliceDiagnostics.metrics, 'captured_refreshes'), false);
  assert.equal(aliceDiagnostics.legacy_global_metrics.candidate_count_last_movies?.value, 77);
  assert.deepEqual(aliceDiagnostics.attribution_rollup, [{
    domain: 'vod',
    rail_id: 'for-you-movies',
    slate_revision: served.slate_revision,
    model_version: 'test-model',
    impressions: 2,
    detail_opens: 1,
    play_starts: 1,
    completions_90pct: 1,
    last_activity_at: 1_300,
  }]);
  activateViewerProfile('household');
  const householdDiagnostics = recommendationDiagnostics();
  assert.equal(householdDiagnostics.metrics.candidate_count_last_movies?.value, 6);
  assert.equal(householdDiagnostics.metrics.shuffle_nonce_movies?.value, 2);
  assert.equal(householdDiagnostics.metrics.captured_refreshes?.value, 1);
  assert.deepEqual(householdDiagnostics.attribution_rollup, []);
  const legacy = db.prepare(`
SELECT metric_value, updated_at FROM recommendation_metrics WHERE metric_name = 'candidate_count_last_movies'
`).get() as { metric_value: number; updated_at: number };
  assert.deepEqual(legacy, { metric_value: 77, updated_at: 123 });
  const scoped = db.prepare(`
SELECT profile_id, metric_value
FROM profile_recommendation_metrics
WHERE metric_name = 'candidate_count_last_movies'
ORDER BY profile_id
`).all() as Array<{ profile_id: string; metric_value: number }>;
  assert.deepEqual(scoped, [
    { profile_id: 'alice', metric_value: 12 },
    { profile_id: 'household', metric_value: 6 },
  ]);
}));
