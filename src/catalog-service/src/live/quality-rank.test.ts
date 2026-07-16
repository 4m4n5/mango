import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareLiveChannelsByQuality,
  liveChannelQualityScore,
  sortLiveChannelsByQuality,
} from './quality-rank.js';

test('liveChannelQualityScore prefers live 8K over ended HD', () => {
  const live8k = liveChannelQualityScore(
    'Live | Francia - Suecia | Copa Mundial de la FIFA™ | 8K EXCLUSIVE',
  );
  const endedHd = liveChannelQualityScore('End | World Cup Today | HD');
  assert.ok(live8k > endedHd);
});

test('sortLiveChannelsByQuality orders by quality tier', () => {
  const sorted = sortLiveChannelsByQuality([
    { id: 'sd', name: 'Star Sports 1 (576p)' },
    { id: '8k', name: 'Live | FIFA World Cup | 8K EXCLUSIVE' },
    { id: 'hd', name: 'FOX CRICKET HD' },
    { id: '4k', name: '4K: SKY SPORTS F1 ᵁᴴᴰ ³⁸⁴⁰ᴾ' },
  ]);
  assert.equal(sorted[0].id, '8k');
  assert.equal(sorted[1].id, '4k');
  assert.equal(sorted[2].id, 'hd');
  assert.equal(sorted[3].id, 'sd');
});

test('2160p and 3840 are 4K; only explicit 8K or 4320p enters the 8K tier', () => {
  assert.equal(liveChannelQualityScore('World Cup 2160p'), liveChannelQualityScore('World Cup 4K'));
  assert.equal(liveChannelQualityScore('World Cup 3840'), liveChannelQualityScore('World Cup UHD'));
  assert.ok(liveChannelQualityScore('World Cup 4320p') > liveChannelQualityScore('World Cup 2160p'));
  assert.ok(liveChannelQualityScore('World Cup 8K') > liveChannelQualityScore('World Cup 4K'));
});

test('resolution outranks commentary, then English or Hindi breaks quality ties', () => {
  const sorted = sortLiveChannelsByQuality([
    { id: 'foreign-4k', name: 'Match 4K', languages: ['Spanish'] },
    { id: 'english-hd', name: 'Match 1080p', languages: ['English'] },
    { id: 'foreign-hd', name: 'Match 1080p', languages: ['French'] },
    { id: 'hindi-hd', name: 'Match 1080p', languages: ['Hindi'] },
  ]);
  assert.equal(sorted[0].id, 'foreign-4k');
  assert.deepEqual(sorted.slice(1, 3).map((item) => item.id), ['english-hd', 'hindi-hd']);
  assert.equal(sorted[3].id, 'foreign-hd');
});
