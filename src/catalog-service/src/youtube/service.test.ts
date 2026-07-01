import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordLibraryWatch, resetLibraryDbForTests, saveLibraryItem } from '../library/db.js';
import {
  replaceYoutubeRailItems,
  resetYoutubeDbForTests,
  setFreshFindCandidateStats,
  setForYouCandidateStats,
  upsertFreshFindCandidates,
  upsertForYouCandidates,
} from './db.js';
import { YoutubeService } from './service.js';
import type { YoutubeItem, YoutubeRail } from './types.js';

const TOPIC_WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
  'mango',
  'nectar',
  'orchid',
  'papaya',
  'quartz',
  'rocket',
  'saffron',
  'tango',
];

function sampleVideo(
  id: string,
  liveStatus: YoutubeItem['live_status'] = 'none',
  channelId = 'channel-1',
  title = `Video ${id}`,
): YoutubeItem {
  return {
    id,
    kind: 'video',
    title,
    subtitle: 'Channel',
    description: 'A cached YouTube video',
    thumbnail: null,
    channel_id: channelId,
    channel_title: `Channel ${channelId}`,
    published_at: '2026-06-01T00:00:00Z',
    duration_sec: 600,
    live_status: liveStatus,
    playlist_id: null,
    updated_at: 1000,
  };
}

function upsertFreshCandidates(items: Array<{
  item: YoutubeItem;
  bucket?: 'quality_fresh' | 'taste_adjacent' | 'emerging_creator' | 'zeitgeist_light' | 'wildcard';
  topic?: string;
  score?: number;
}>): void {
  upsertFreshFindCandidates(items.map((entry, index) => ({
    item: entry.item,
    source_bucket: entry.bucket || 'quality_fresh',
    query: entry.bucket || 'quality_fresh',
    topic_cluster: entry.topic || entry.item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: entry.score ?? (1 - index * 0.001),
    score_breakdown: { test: true },
    reason: `fresh_find:${entry.bucket || 'quality_fresh'}`,
  })));
}

function apiErrorResponse(message = 'quota exceeded'): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

function withTempState<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-service-'));
  const originalFetch = globalThis.fetch;
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  process.env.MANGO_YOUTUBE_API_KEY_FILE = join(dir, 'missing-youtube-api.key');
  process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE = join(dir, 'missing-youtube-oauth-client.json');
  delete process.env.MANGO_YOUTUBE_API_KEY;
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const cleanup = () => {
    globalThis.fetch = originalFetch;
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    delete process.env.MANGO_YOUTUBE_API_KEY_FILE;
    delete process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE;
    delete process.env.MANGO_YOUTUBE_API_KEY;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('not interested removes cached video from YouTube rails', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('KeepMe'), score: 1, reason: 'test' },
    { item: sampleVideo('DropMe'), score: 0.9, reason: 'test' },
  ]);
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'DropMe', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const popular = response.rails.find((rail) => rail.rail_id === 'popular');
  assert.ok(popular);
  assert.deepEqual(popular.items.map((item) => item.id), ['KeepMe']);
}));

test('saved YouTube videos stay in Saved until explicitly unsaved', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('KeepMe'), score: 1, reason: 'test' },
    { item: sampleVideo('SavedVideo'), score: 0.9, reason: 'test' },
  ]);
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SavedVideo',
    title: 'Saved video',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'SavedVideo', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const saved = response.rails.find((rail) => rail.rail_id === 'saved');
  const popular = response.rails.find((rail) => rail.rail_id === 'popular');
  assert.ok(saved);
  assert.deepEqual(saved.items.map((item) => item.id), ['SavedVideo']);
  assert.ok(popular);
  assert.deepEqual(popular.items.map((item) => item.id), ['KeepMe']);
}));

test('search falls back to local cache when API key is absent', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('LocalOnly'), score: 1, reason: 'test' },
  ]);
  const service = new YoutubeService();
  const response = await service.search('local', 5) as {
    cached_only: boolean;
    groups: { videos: YoutubeItem[] };
  };
  assert.equal(response.cached_only, true);
  assert.deepEqual(response.groups.videos.map((item) => item.id), ['LocalOnly']);
}));

test('for you rail excludes live videos', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('NormalVideo'), score: 1, reason: 'test' },
    { item: sampleVideo('LiveVideo', 'live'), score: 0.9, reason: 'test' },
  ]);
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  assert.ok(forYou.items.some((item) => item.id === 'NormalVideo'));
  assert.ok(!forYou.items.some((item) => item.id === 'LiveVideo'));
}));

test('cached discovery rails keep live videos in live now only', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('PopularNormal'), score: 1, reason: 'test' },
    { item: sampleVideo('PopularLive', 'live'), score: 0.9, reason: 'test' },
  ]);
  replaceYoutubeRailItems('live_now', [
    { item: sampleVideo('LiveNow', 'live'), score: 1, reason: 'test' },
  ]);
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const popular = response.rails.find((rail) => rail.rail_id === 'popular');
  const liveNow = response.rails.find((rail) => rail.rail_id === 'live_now');
  assert.ok(popular);
  assert.ok(liveNow);
  assert.deepEqual(popular.items.map((item) => item.id), ['PopularNormal']);
  assert.deepEqual(liveNow.items.map((item) => item.id), ['LiveNow']);
}));

test('YouTube rails return at most nine cards', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', Array.from({ length: 14 }, (_, index) => ({
    item: sampleVideo(`Popular${index}`),
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  for (const rail of response.rails) {
    assert.ok(rail.items.length <= 9, `${rail.rail_id} has ${rail.items.length} items`);
  }
  const popular = response.rails.find((rail) => rail.rail_id === 'popular');
  assert.equal(popular?.items.length, 9);
}));

test('fresh finds is hidden when empty', () => withTempState(async () => {
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  assert.equal(response.rails.some((rail) => rail.rail_id === 'fresh_finds'), false);
}));

test('fresh finds failed refresh keeps existing cached pool visible', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  upsertFreshCandidates(Array.from({ length: 9 }, (_, index) => ({
    item: sampleVideo(`FreshStale${index}`, 'none', `fresh-stale-${index}`, `Stale ${TOPIC_WORDS[index]}`),
    bucket: index < 3
      ? 'taste_adjacent'
      : index < 6
        ? 'quality_fresh'
        : 'emerging_creator',
    topic: `stale-topic-${index}`,
  })));
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded')) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_failure');
  assert.equal(refresh.ok, false);
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  assert.ok(rail.items.every((item) => item.id.startsWith('FreshStale')));
}));

test('fresh finds excludes watched saved subscribed live shorts blocked and recent exposure', () => withTempState(async () => {
  replaceYoutubeRailItems('new_from_subscriptions', [
    { item: sampleVideo('SubReference', 'none', 'subscribed-channel', 'Subscribed reference'), score: 1, reason: 'subscription' },
  ]);
  const candidates = [
    sampleVideo('FreshWatched', 'none', 'watched-channel', 'Watched fresh'),
    sampleVideo('FreshSaved', 'none', 'saved-channel', 'Saved fresh'),
    sampleVideo('FreshSubscribed', 'none', 'subscribed-channel', 'Subscribed fresh'),
    sampleVideo('FreshLive', 'live', 'live-channel', 'Live fresh'),
    { ...sampleVideo('FreshShort', 'none', 'short-channel', 'Short fresh'), duration_sec: 45 },
    sampleVideo('FreshBlocked', 'none', 'blocked-channel', 'Blocked fresh'),
    sampleVideo('FreshRecent', 'none', 'recent-channel', 'Recent fresh'),
    ...Array.from({ length: 9 }, (_, index) => (
      sampleVideo(`FreshEligible${index}`, 'none', `fresh-channel-${index}`, `Fresh eligible ${TOPIC_WORDS[index]}`)
    )),
  ];
  upsertFreshCandidates(candidates.map((item, index) => ({
    item,
    bucket: index % 3 === 0 ? 'taste_adjacent' : 'quality_fresh',
    topic: `topic-${index}`,
  })));
  setFreshFindCandidateStats('FreshRecent', { last_recommended_at: Date.now() });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'FreshWatched',
    title: 'Watched fresh',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'FreshSaved',
    title: 'Saved fresh',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'FreshBlocked', reason: 'user' });
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  const ids = rail.items.map((item) => item.id);
  assert.equal(ids.length, 9);
  assert.ok(!ids.includes('FreshWatched'));
  assert.ok(!ids.includes('FreshSaved'));
  assert.ok(!ids.includes('FreshSubscribed'));
  assert.ok(!ids.includes('FreshLive'));
  assert.ok(!ids.includes('FreshShort'));
  assert.ok(!ids.includes('FreshBlocked'));
  assert.ok(!ids.includes('FreshRecent'));
  const channelCounts = new Map<string, number>();
  for (const item of rail.items) {
    channelCounts.set(item.channel_id || item.id, (channelCounts.get(item.channel_id || item.id) ?? 0) + 1);
  }
  assert.ok([...channelCounts.values()].every((count) => count <= 1));
}));

test('fresh finds relaxes saved subscribed and exposure filters only when thin', () => withTempState(async () => {
  replaceYoutubeRailItems('new_from_subscriptions', [
    { item: sampleVideo('SubReference', 'none', 'thin-subscribed', 'Thin subscribed reference'), score: 1, reason: 'subscription' },
  ]);
  const rows = [
    ...Array.from({ length: 7 }, (_, index) => (
      sampleVideo(`FreshThin${index}`, 'none', `thin-channel-${index}`, `Thin ${TOPIC_WORDS[index]}`)
    )),
    sampleVideo('FreshSavedFallback', 'none', 'thin-saved', 'Saved fallback'),
    sampleVideo('FreshSubscribedFallback', 'none', 'thin-subscribed', 'Subscribed fallback'),
    sampleVideo('FreshRecentFallback', 'none', 'thin-recent', 'Recent fallback'),
  ];
  upsertFreshCandidates(rows.map((item, index) => ({
    item,
    bucket: index < 3 ? 'taste_adjacent' : 'quality_fresh',
    topic: `thin-topic-${index}`,
  })));
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'FreshSavedFallback',
    title: 'Saved fallback',
    tab: 'youtube',
  });
  setFreshFindCandidateStats('FreshRecentFallback', { last_recommended_at: Date.now() });
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  const ids = rail.items.map((item) => item.id);
  assert.ok(ids.includes('FreshSavedFallback'));
  assert.ok(ids.includes('FreshSubscribedFallback'));
  assert.ok(!ids.includes('FreshRecentFallback'));
}));

test('fresh finds relaxes recent exposure when still thin', () => withTempState(async () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => (
      sampleVideo(`FreshRecentThin${index}`, 'none', `recent-thin-${index}`, `Recent thin ${TOPIC_WORDS[index]}`)
    )),
    sampleVideo('FreshRecentOnlyFallback', 'none', 'recent-thin-fallback', 'Recent only fallback'),
  ];
  upsertFreshCandidates(rows.map((item, index) => ({
    item,
    bucket: index < 3 ? 'taste_adjacent' : 'quality_fresh',
    topic: `recent-thin-topic-${index}`,
  })));
  setFreshFindCandidateStats('FreshRecentOnlyFallback', { last_recommended_at: Date.now() });
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  assert.ok(rail.items.some((item) => item.id === 'FreshRecentOnlyFallback'));
}));

test('fresh finds reshuffle uses exposure cooldown to show a different cached set', () => withTempState(async () => {
  upsertFreshCandidates(Array.from({ length: 18 }, (_, index) => ({
    item: sampleVideo(`FreshShuffle${index}`, 'none', `fresh-shuffle-${index}`, `Shuffle ${TOPIC_WORDS[index % TOPIC_WORDS.length]}`),
    bucket: index % 4 === 0
      ? 'taste_adjacent'
      : index % 4 === 1
        ? 'quality_fresh'
        : index % 4 === 2
          ? 'emerging_creator'
          : 'zeitgeist_light',
    topic: `shuffle-topic-${index}`,
  })));
  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstRail = first.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(firstRail);
  assert.equal(firstRail.items.length, 9);
  const second = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const secondRail = second.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(secondRail);
  assert.equal(secondRail.items.length, 9);
  const firstIds = new Set(firstRail.items.map((item) => item.id));
  assert.equal(secondRail.items.some((item) => firstIds.has(item.id)), false);
}));

test('new from subscriptions is an unwatched diverse creator inbox', () => withTempState(async () => {
  const rows = [
    sampleVideo('SubWatched', 'none', 'sub-a', 'Already watched'),
    sampleVideo('SubSaved', 'none', 'sub-b', 'Already saved'),
    sampleVideo('SubLive', 'live', 'sub-c', 'Live upload'),
    { ...sampleVideo('SubShort', 'none', 'sub-d', 'Short upload'), duration_sec: 45 },
    sampleVideo('SubBlocked', 'none', 'sub-e', 'Blocked upload'),
    sampleVideo('SubA1', 'none', 'sub-a', 'Fresh A one'),
    sampleVideo('SubA2', 'none', 'sub-a', 'Fresh A two'),
    sampleVideo('SubB1', 'none', 'sub-b', 'Fresh B one'),
    sampleVideo('SubC1', 'none', 'sub-c', 'Fresh C one'),
    sampleVideo('SubD1', 'none', 'sub-d', 'Fresh D one'),
    sampleVideo('SubE1', 'none', 'sub-e', 'Fresh E one'),
    sampleVideo('SubF1', 'none', 'sub-f', 'Fresh F one'),
    sampleVideo('SubG1', 'none', 'sub-g', 'Fresh G one'),
    sampleVideo('SubH1', 'none', 'sub-h', 'Fresh H one'),
    sampleVideo('SubI1', 'none', 'sub-i', 'Fresh I one'),
    sampleVideo('SubJ1', 'none', 'sub-j', 'Fresh J one'),
  ];
  replaceYoutubeRailItems('new_from_subscriptions', rows.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SubWatched',
    title: 'Already watched',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SubSaved',
    title: 'Already saved',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'SubBlocked', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'new_from_subscriptions');
  assert.ok(rail);
  const ids = rail.items.map((item) => item.id);
  assert.equal(ids.length, 9);
  assert.ok(!ids.includes('SubWatched'));
  assert.ok(!ids.includes('SubSaved'));
  assert.ok(!ids.includes('SubLive'));
  assert.ok(!ids.includes('SubShort'));
  assert.ok(!ids.includes('SubBlocked'));
  const channelCounts = new Map<string, number>();
  for (const item of rail.items) {
    channelCounts.set(item.channel_id || item.id, (channelCounts.get(item.channel_id || item.id) ?? 0) + 1);
  }
  assert.ok([...channelCounts.values()].every((count) => count <= 1));
}));

test('new from subscriptions relaxes saved exclusion only when needed', () => withTempState(async () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => (
      sampleVideo(`SubThin${index}`, 'none', `thin-${index}`, `Thin ${index}`)
    )),
    sampleVideo('SubSavedFallback', 'none', 'thin-saved', 'Saved fallback'),
  ];
  replaceYoutubeRailItems('new_from_subscriptions', rows.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SubSavedFallback',
    title: 'Saved fallback',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'new_from_subscriptions');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  assert.ok(rail.items.some((item) => item.id === 'SubSavedFallback'));
}));

test('new from subscriptions relaxes channel diversity to max two when thin', () => withTempState(async () => {
  const rows = Array.from({ length: 12 }, (_, index) => (
    sampleVideo(`SubChannel${index}`, 'none', `thin-channel-${index % 3}`, `Channel ${index}`)
  ));
  replaceYoutubeRailItems('new_from_subscriptions', rows.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'new_from_subscriptions');
  assert.ok(rail);
  assert.equal(rail.items.length, 6);
  const channelCounts = new Map<string, number>();
  for (const item of rail.items) {
    channelCounts.set(item.channel_id || item.id, (channelCounts.get(item.channel_id || item.id) ?? 0) + 1);
  }
  assert.ok([...channelCounts.values()].every((count) => count <= 2));
}));

test('for you excludes watched shorts live not interested and recent exposures', () => withTempState(async () => {
  const candidates = [
    sampleVideo('WatchedVideo', 'none', 'watched-channel', 'Watched topic'),
    { ...sampleVideo('ShortVideo', 'none', 'short-channel', 'Short topic'), duration_sec: 45 },
    sampleVideo('LiveVideo', 'live', 'live-channel', 'Live topic'),
    sampleVideo('BlockedVideo', 'none', 'blocked-channel', 'Blocked topic'),
    sampleVideo('RecentExposure', 'none', 'recent-channel', 'Recent topic'),
    ...Array.from({ length: 9 }, (_, index) => (
      sampleVideo(`Eligible${index}`, 'none', `eligible-channel-${index}`, `Eligible ${TOPIC_WORDS[index]}`)
    )),
  ];
  replaceYoutubeRailItems('popular', candidates.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  upsertForYouCandidates([{
    item: sampleVideo('RecentExposure', 'none', 'recent-channel', 'Recent topic'),
    lane: 'wildcard',
    source: 'popular',
    source_weight: 0.12,
    topic_cluster: 'recent:topic',
    score: 10,
    reason: 'test',
  }]);
  setForYouCandidateStats('RecentExposure', { last_recommended_at: Date.now() });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchedVideo',
    title: 'Watched topic',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'BlockedVideo', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  const ids = forYou.items.map((item) => item.id);
  assert.equal(ids.length, 9);
  assert.ok(!ids.includes('WatchedVideo'));
  assert.ok(!ids.includes('ShortVideo'));
  assert.ok(!ids.includes('LiveVideo'));
  assert.ok(!ids.includes('BlockedVideo'));
  assert.ok(!ids.includes('RecentExposure'));
}));

test('for you samples the locked familiar discovery wildcard mix', () => withTempState(async () => {
  replaceYoutubeRailItems('new_from_subscriptions', Array.from({ length: 6 }, (_, index) => ({
    item: sampleVideo(`Sub${index}`, 'none', `sub-channel-${index}`, `Subscription ${TOPIC_WORDS[index]}`),
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  replaceYoutubeRailItems('fresh_finds', Array.from({ length: 4 }, (_, index) => ({
    item: sampleVideo(`Fresh${index}`, 'none', `fresh-channel-${index}`, `Fresh ${TOPIC_WORDS[index + 6]}`),
    score: 1 - index * 0.01,
    reason: 'fresh',
  })));
  replaceYoutubeRailItems('popular', Array.from({ length: 4 }, (_, index) => ({
    item: sampleVideo(`Wild${index}`, 'none', `wild-channel-${index}`, `Wildcard ${TOPIC_WORDS[index + 10]}`),
    score: 1 - index * 0.01,
    reason: 'popular',
  })));
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  const ids = forYou.items.map((item) => item.id);
  assert.equal(ids.length, 9);
  assert.equal(ids.filter((id) => id.startsWith('Sub')).length, 5);
  assert.equal(ids.filter((id) => id.startsWith('Fresh')).length, 3);
  assert.equal(ids.filter((id) => id.startsWith('Wild')).length, 1);
}));

test('for you enforces channel and topic diversity', () => withTempState(async () => {
  const sameChannel = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`SameChannel${index}`, 'none', 'same-channel', `Shared topic ${index}`)
  ));
  const sameTopic = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`SameTopic${index}`, 'none', `topic-channel-${index}`, 'Deep dive mango')
  ));
  const filler = Array.from({ length: 9 }, (_, index) => (
    sampleVideo(`Filler${index}`, 'none', `filler-channel-${index}`, `Unique ${TOPIC_WORDS[index]}`)
  ));
  replaceYoutubeRailItems('popular', [...sameChannel, ...sameTopic, ...filler].map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  assert.equal(forYou.items.length, 9);
  assert.ok(forYou.items.filter((item) => item.channel_id === 'same-channel').length <= 1);
  assert.ok(forYou.items.filter((item) => item.title === 'Deep dive mango').length <= 2);
}));

test('for you reshuffle avoids recently exposed cards when reservoir is deep enough', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', Array.from({ length: 18 }, (_, index) => ({
    item: sampleVideo(`Shuffle${index}`, 'none', `shuffle-channel-${index}`, `Shuffle ${TOPIC_WORDS[index]}`),
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstForYou = first.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(firstForYou);
  assert.equal(firstForYou.items.length, 9);
  const second = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const secondForYou = second.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(secondForYou);
  assert.equal(secondForYou.items.length, 9);
  const firstIds = new Set(firstForYou.items.map((item) => item.id));
  assert.equal(secondForYou.items.some((item) => firstIds.has(item.id)), false);
}));

test('history rail shows latest nine Mango-local YouTube videos', () => withTempState(async () => {
  for (let index = 0; index < 12; index += 1) {
    recordLibraryWatch({
      source: 'youtube',
      type: 'youtube_video',
      id: `History${index}`,
      title: `History video ${index}`,
      tab: 'youtube',
      event: 'play',
      watched_at: 1000 + index,
    });
  }
  recordLibraryWatch({
    source: 'mango',
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    tab: 'movies',
    event: 'play',
    watched_at: 5000,
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'History11', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const history = response.rails.find((rail) => rail.rail_id === 'history');
  assert.ok(history);
  assert.deepEqual(
    history.items.map((item) => item.id),
    ['History11', 'History10', 'History9', 'History8', 'History7', 'History6', 'History5', 'History4', 'History3'],
  );
}));

test('history rail reshuffle samples from all Mango-local YouTube history', () => withTempState(async () => {
  for (let index = 0; index < 12; index += 1) {
    recordLibraryWatch({
      source: 'youtube',
      type: 'youtube_video',
      id: `History${index}`,
      title: `History video ${index}`,
      tab: 'youtube',
      event: 'play',
      watched_at: 1000 + index,
    });
  }
  const service = new YoutubeService();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    const history = response.rails.find((rail) => rail.rail_id === 'history');
    assert.ok(history);
    const ids = history.items.map((item) => item.id);
    assert.equal(ids.length, 9);
    assert.equal(new Set(ids).size, 9);
    assert.ok(ids.includes('History2'), `expected reshuffle to reach beyond the latest nine: ${ids.join(', ')}`);
  } finally {
    Math.random = originalRandom;
  }
}));

test('because you watched follows the latest watched YouTube video from cache', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('WatchOld', 'none', 'old-channel', 'Old documentary'), score: 1, reason: 'test' },
    { item: sampleVideo('OldCandidate', 'none', 'old-channel', 'Another old documentary'), score: 0.9, reason: 'test' },
    { item: sampleVideo('WatchNew', 'none', 'new-channel', 'New cooking tour'), score: 0.8, reason: 'test' },
    { item: sampleVideo('NewCandidate', 'none', 'new-channel', 'Another cooking tour'), score: 0.7, reason: 'test' },
  ]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchOld',
    title: 'Old documentary',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchNew',
    title: 'New cooking tour',
    tab: 'youtube',
    event: 'play',
    watched_at: 2000,
  });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const because = response.rails.find((rail) => rail.rail_id === 'because_you_watched');
  assert.ok(because);
  assert.equal(because.items[0]?.id, 'NewCandidate');
}));

test('because you watched scans past repeated live history to find a non-live seed', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('LiveSeed', 'live', 'live-channel', 'lofi radio live'), score: 1, reason: 'test' },
    { item: sampleVideo('WatchNew', 'none', 'new-channel', 'New cooking tour'), score: 0.9, reason: 'test' },
    { item: sampleVideo('NewCandidate', 'none', 'new-channel', 'Another cooking tour'), score: 0.8, reason: 'test' },
  ]);
  for (let index = 0; index < 8; index += 1) {
    recordLibraryWatch({
      source: 'youtube',
      type: 'youtube_video',
      id: 'LiveSeed',
      title: 'lofi radio live',
      tab: 'youtube',
      event: 'play',
      watched_at: 2000 + index,
    });
  }
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchNew',
    title: 'New cooking tour',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const because = response.rails.find((rail) => rail.rail_id === 'because_you_watched');
  assert.ok(because);
  assert.equal(because.items[0]?.id, 'NewCandidate');
}));
