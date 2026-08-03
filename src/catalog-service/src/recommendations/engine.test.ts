import assert from 'node:assert/strict';
import test from 'node:test';
import type { FireWaterRating } from '../library/ratings.js';
import {
  buildRecommendationFeature,
  cosineSimilarity,
  holisticAffinity,
  predictAxes,
  rankRecommendations,
  validateAiFeatureDocument,
  type RecommendationFeature,
} from './engine.js';

function rating(id: string, fire: number, water: number, type: 'movie' | 'series' = 'movie'): FireWaterRating {
  return {
    type,
    id,
    title: `Rated ${id}`,
    year: '2020',
    fire: fire as FireWaterRating['fire'],
    water: water as FireWaterRating['water'],
    revision: 1,
    origin: 'couch',
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
    vector,
    cluster: `cluster-${id}`,
    confidence: 1,
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

test('ranking is replay-stable and targets exact 8/3/1 buckets', () => {
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
  });
  const second = rankRecommendations({
    tab: 'movies', candidates, ratings, ratingFeatures, dailySeed: 'movies:2026-08-02',
  });
  assert.deepEqual(first.map((row) => row.id), second.map((row) => row.id));
  assert.equal(first.length, 12);
  assert.equal(first.filter((row) => row.bucket === 'close').length, 8);
  assert.equal(first.filter((row) => row.bucket === 'adjacent').length, 3);
  assert.equal(first.filter((row) => row.bucket === 'explore').length, 1);
  assert.equal(new Set(first.map((row) => row.id)).size, 12);

  const reserve = rankRecommendations({
    tab: 'movies',
    candidates,
    ratings,
    ratingFeatures,
    dailySeed: 'movies:2026-08-02',
    limit: 40,
  });
  assert.equal(reserve.length, 30);
  assert.deepEqual(
    reserve.slice(0, 12).map((row) => [row.id, row.bucket]),
    first.map((row) => [row.id, row.bucket]),
  );
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
