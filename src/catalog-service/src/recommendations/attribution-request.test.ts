import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasRecommendationAttributionIntent,
  isRecommendationPlaybackIdentityCompatible,
} from './attribution-request.js';

test('ordinary catalog rail metadata does not opt playback into recommendation attribution', () => {
  assert.equal(hasRecommendationAttributionIntent({}), false);
  assert.equal(hasRecommendationAttributionIntent({ rail_id: 'popular' } as Record<string, unknown>), false);
});

test('every recommendation-only field requires strict validation even when malformed', () => {
  assert.equal(hasRecommendationAttributionIntent({ attribution_token: '' }), true);
  assert.equal(hasRecommendationAttributionIntent({ slate_revision: 0 }), true);
  assert.equal(hasRecommendationAttributionIntent({ recommendation_item_type: '' }), true);
  assert.equal(hasRecommendationAttributionIntent({ recommendation_item_id: null }), true);
});

test('playback identity must match the served recommendation card', () => {
  assert.equal(isRecommendationPlaybackIdentityCompatible(
    { type: 'movie', id: 'tt-one' },
    { type: 'movie', id: 'tt-one' },
  ), true);
  assert.equal(isRecommendationPlaybackIdentityCompatible(
    { type: 'youtube_video', id: 'AbC_123' },
    { type: 'youtube_video', id: 'AbC_123' },
  ), true);
  assert.equal(isRecommendationPlaybackIdentityCompatible(
    { type: 'movie', id: 'tt-one' },
    { type: 'movie', id: 'tt-two' },
  ), false);
  assert.equal(isRecommendationPlaybackIdentityCompatible(
    { type: 'movie', id: 'tt-one' },
    { type: 'series', id: 'tt-one' },
  ), false);
});

test('a served series may play an exact episode but not a prefix collision', () => {
  assert.equal(isRecommendationPlaybackIdentityCompatible(
    { type: 'series', id: 'tt-series' },
    { type: 'series', id: 'tt-series:2:7' },
  ), true);
  assert.equal(isRecommendationPlaybackIdentityCompatible(
    { type: 'series', id: 'tt-series' },
    { type: 'series', id: 'tt-series-copy:2:7' },
  ), false);
  assert.equal(isRecommendationPlaybackIdentityCompatible(
    { type: 'series', id: 'tt-series' },
    { type: 'series', id: 'tt-series:episode' },
  ), false);
});
