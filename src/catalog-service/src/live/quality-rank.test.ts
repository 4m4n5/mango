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
