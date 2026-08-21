import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelAffinityFactor,
  channelPenaltyFactor,
  decayedWatchStrength,
  rewatchScore,
  TAKEOUT_STRENGTH,
  WATCH_PER_VIDEO_STRENGTH_CAP,
  youtubeCreatorKey,
  youtubeScoringVariant,
  type YoutubeWatchAnchor,
} from './taste.js';
import { buildYoutubeIdfTable, idfWeightedOverlap, tokenOverlapScore, youtubeTitleTokens } from './tokens.js';
import {
  cosineSimilarity,
  embeddingRelationFactor,
  hashEmbedText,
  youtubeEmbeddingBackend,
  youtubeEmbeddingsEnabled,
  youtubeSimilarityMode,
} from './embeddings.js';

test('local and Takeout watches share strength and decay', () => {
  const at = 1_000_000_000_000;
  assert.equal(decayedWatchStrength(TAKEOUT_STRENGTH, at, at), TAKEOUT_STRENGTH);
  const aged = decayedWatchStrength(TAKEOUT_STRENGTH, at - 90 * 24 * 60 * 60 * 1000, at);
  assert.ok(Math.abs(aged - TAKEOUT_STRENGTH / 2) < 1e-9);
});

test('watch-weighted affinity outranks a dormant subscription', () => {
  const dormant = channelAffinityFactor({
    subscriptionBacked: true, channelStrength: 0, variant: 'v3',
  });
  const watched = channelAffinityFactor({
    subscriptionBacked: true,
    channelStrength: WATCH_PER_VIDEO_STRENGTH_CAP,
    variant: 'v3',
  });
  const historyOnly = channelAffinityFactor({
    subscriptionBacked: false,
    channelStrength: WATCH_PER_VIDEO_STRENGTH_CAP,
    variant: 'v3',
  });
  assert.equal(dormant, 0.75);
  assert.equal(watched, 1);
  assert.equal(historyOnly, 1);
  assert.ok(watched > dormant);
  assert.equal(channelAffinityFactor({
    subscriptionBacked: true, channelStrength: 0, variant: 'legacy',
  }), 1);
});

test('Not-for-me channel penalty decays and undo is absence of events', () => {
  const at = Date.now();
  const key = youtubeCreatorKey({ channel_id: 'chan-1', channel_title: 'One' });
  const one = channelPenaltyFactor(key, [{ channel_key: key, updated_at: at }], at, 'v3');
  const two = channelPenaltyFactor(key, [
    { channel_key: key, updated_at: at },
    { channel_key: key, updated_at: at - 1000 },
  ], at, 'v3');
  assert.equal(one, 0.6);
  assert.ok(two < one);
  assert.ok(two >= 0.25);
  assert.equal(channelPenaltyFactor(key, [], at, 'v3'), 1);
  assert.equal(channelPenaltyFactor(key, [{ channel_key: key, updated_at: at }], at, 'legacy'), 1);
});

test('rewatch score requires repeats and prefers recent frequency', () => {
  const at = Date.now();
  const once: YoutubeWatchAnchor = {
    id: 'once', title: 'Once', channel_id: 'c', channel_title: 'C',
    watched_at: at, base_strength: 0.55, decayed_strength: 0.55,
    event_count: 1, event_times: [at], source: 'local',
  };
  const twice: YoutubeWatchAnchor = {
    ...once, id: 'twice', event_count: 2, event_times: [at - 2 * 24 * 60 * 60 * 1000, at],
    decayed_strength: 1.1,
  };
  const stale: YoutubeWatchAnchor = {
    ...twice, id: 'stale',
    event_times: [at - 400 * 24 * 60 * 60 * 1000, at - 390 * 24 * 60 * 60 * 1000],
  };
  assert.equal(rewatchScore(once, at), 0);
  assert.ok(rewatchScore(twice, at) > rewatchScore(stale, at));
});

test('IDF overlap down-weights common tokens versus raw overlap', () => {
  const left = youtubeTitleTokens('the fermentation science documentary');
  const right = youtubeTitleTokens('fermentation science analysis documentary');
  const table = buildYoutubeIdfTable([
    'the fermentation science documentary',
    'fermentation science analysis documentary',
    'unrelated cricket highlights live',
  ]);
  assert.ok(idfWeightedOverlap(left, right, table) > 0);
  assert.notEqual(idfWeightedOverlap(left, right, table), tokenOverlapScore(left, right));
});

test('embeddings stay off by default and hashed vectors are deterministic', () => {
  delete process.env.MANGO_YOUTUBE_EMBEDDINGS;
  delete process.env.MANGO_YOUTUBE_SIM;
  assert.equal(youtubeEmbeddingsEnabled(), false);
  assert.equal(youtubeSimilarityMode(), 'lexical');
  assert.equal(youtubeEmbeddingBackend(), 'minilm');
  const left = hashEmbedText('fermentation science kitchen');
  const right = hashEmbedText('fermentation science kitchen');
  assert.equal(cosineSimilarity(left, right), 1);
  assert.equal(embeddingRelationFactor(0.8), 1);
  assert.equal(youtubeScoringVariant(), 'v3');
  assert.equal(youtubeScoringVariant('legacy'), 'legacy');
});
