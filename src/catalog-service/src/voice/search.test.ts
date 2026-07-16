import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIptvPackStyleTitle,
  isLiveSearchIntent,
  mergeLibraryAndLiveHits,
  scoreTitleMatch,
  type VoiceSearchHit,
} from './search.js';

test('scoreTitleMatch ranks exact and prefix matches highest', () => {
  assert.equal(scoreTitleMatch('Panchayat', 'panchayat'), 100);
  assert.ok(scoreTitleMatch('Panchayat Season 2', 'panch') >= 90);
  assert.ok(scoreTitleMatch('The Shawshank Redemption', 'shawshank') >= 70);
  assert.equal(scoreTitleMatch('Dark Knight', 'panchayat'), 0);
});

test('scoreTitleMatch handles multi-word partial matches', () => {
  const score = scoreTitleMatch('Breaking Bad', 'break bad');
  assert.ok(score >= 45);
});

test('isLiveSearchIntent detects IPTV-oriented queries', () => {
  assert.equal(isLiveSearchIntent('cartoons'), true);
  assert.equal(isLiveSearchIntent('put on cnn'), true);
  assert.equal(isLiveSearchIntent('NDTV 24x7'), true);
  assert.equal(isLiveSearchIntent('La Liga'), true);
  assert.equal(isLiveSearchIntent('friends'), false);
  assert.equal(isLiveSearchIntent('Friends the sitcom'), false);
});

test('isIptvPackStyleTitle catches FRIENDS S01 4K style labels', () => {
  assert.equal(isIptvPackStyleTitle('FRIENDS 4K', 'friends'), true);
  assert.equal(isIptvPackStyleTitle('FRIENDS S01 4K', 'friends'), true);
  assert.equal(isIptvPackStyleTitle('FRIENDS ᴿᴬᵂ', 'friends'), true);
  assert.equal(isIptvPackStyleTitle('FRIENDS', 'friends'), false);
});

test('mergeLibraryAndLiveHits does not let IPTV packs hide missing VOD Friends', () => {
  const live: VoiceSearchHit[] = [
    { type: 'tv', id: 'area69:1', title: 'FRIENDS 4K', tab: 'live', score: 92 },
    { type: 'tv', id: 'area69:2', title: 'FRIENDS S01 4K', tab: 'live', score: 92 },
    { type: 'tv', id: 'area69:3', title: 'FRIENDS ᴿᴬᵂ', tab: 'live', score: 92 },
  ];
  const merged = mergeLibraryAndLiveHits([], live, 'friends', 8);
  assert.equal(merged.length, 0);
});

test('mergeLibraryAndLiveHits keeps VOD ahead of live for title queries', () => {
  const vod: VoiceSearchHit[] = [
    { type: 'series', id: 'tt0108778', title: 'Friends', tab: 'series', score: 100 },
  ];
  const live: VoiceSearchHit[] = [
    { type: 'tv', id: 'area69:1', title: 'FRIENDS 4K', tab: 'live', score: 92 },
  ];
  const merged = mergeLibraryAndLiveHits(vod, live, 'friends', 8);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, 'tt0108778');
});

test('mergeLibraryAndLiveHits still surfaces live for live-intent queries', () => {
  const live: VoiceSearchHit[] = [
    { type: 'tv', id: 'area69:1', title: 'Cartoon Network', tab: 'live', score: 92 },
  ];
  const merged = mergeLibraryAndLiveHits([], live, 'cartoons', 8);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.tab, 'live');
});
