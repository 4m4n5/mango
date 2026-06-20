import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelSubtitle,
  keywordPattern,
  matchChannelsToRail,
  partitionChannelsBySportRails,
  searchableChannelText,
  type LiveChannelMeta,
  type LiveSportRail,
} from './live-rails.js';

function channel(partial: Partial<LiveChannelMeta> & Pick<LiveChannelMeta, 'id' | 'name'>): LiveChannelMeta {
  return {
    id: partial.id,
    name: partial.name,
    title: partial.title,
    description: partial.description,
    genre: partial.genre,
    poster: partial.poster,
    releaseInfo: partial.releaseInfo,
  };
}

test('live-rails matches cricket channels by keyword', () => {
  const rail: LiveSportRail = {
    id: 'live-cricket',
    label: 'cricket',
    keywords: ['cricket', 'ipl', 'star sports'],
    limit: 10,
  };
  const channels = [
    channel({ id: '1', name: 'Star Sports 1 HD', genre: 'sports' }),
    channel({ id: '2', name: 'HBO Movies' }),
    channel({ id: '3', name: 'Willow Cricket', description: 'live coverage' }),
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsToRail(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['1', '3']);
});

test('live-rails assigns each channel to the first matching rail only', () => {
  const rails: LiveSportRail[] = [
    { id: 'live-cricket', label: 'cricket', keywords: ['sport'], limit: 5 },
    { id: 'live-other', label: 'more', keywords: ['sport'], limit: 5 },
  ];
  const channels = [channel({ id: 'a', name: 'Sky Sport News' })];
  const byRail = partitionChannelsBySportRails(channels, rails);
  assert.deepEqual(byRail.get('live-cricket')?.map((item) => item.id), ['a']);
  assert.deepEqual(byRail.get('live-other'), []);
});

test('live-rails prefers EPG text for subtitles', () => {
  const text = searchableChannelText(channel({
    id: 'x',
    name: 'Fox Sports',
    releaseInfo: 'Liverpool vs Arsenal — 1st half',
  }));
  assert.equal(keywordPattern(['liverpool']).test(text), true);
  assert.equal(channelSubtitle(channel({
    id: 'x',
    name: 'Fox Sports',
    releaseInfo: 'Liverpool vs Arsenal — 1st half',
    genre: 'sports',
  })), 'Liverpool vs Arsenal — 1st half');
});
