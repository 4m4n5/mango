import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordLibraryWatch, resetLibraryDbForTests, saveLibraryItem } from '../library/db.js';
import {
  replaceYoutubeRailItems,
  resetYoutubeDbForTests,
  setBecauseYouWatchedCandidateStats,
  setFreshFindCandidateStats,
  setForYouCandidateStats,
  setLiveNowCandidateStats,
  upsertBecauseYouWatchedCandidates,
  upsertFreshFindCandidates,
  upsertForYouCandidates,
  upsertLiveNowCandidates,
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

function upsertLiveCandidates(items: Array<{
  item: YoutubeItem;
  lane?: 'subscription_live' | 'news_events' | 'sports' | 'music_performance' | 'gaming' | 'culture_talks' | 'wildcard';
  topic?: string;
  score?: number;
  verifiedAt?: number;
  expiresAt?: number;
}>): void {
  const now = Date.now();
  upsertLiveNowCandidates(items.map((entry, index) => ({
    item: { ...entry.item, live_status: entry.item.live_status === 'live' ? 'live' : entry.item.live_status },
    source_lane: entry.lane || 'news_events',
    query: entry.lane || 'news_events',
    topic_cluster: entry.topic || entry.item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: entry.score ?? (1 - index * 0.001),
    score_breakdown: { test: true },
    reason: `live_now:${entry.lane || 'news_events'}`,
    last_verified_at: entry.verifiedAt ?? now,
    expires_at: entry.expiresAt ?? (now + 2 * 60 * 60 * 1000),
  })));
}

function upsertBecauseCandidates(
  seed: YoutubeItem,
  seedWatchedAt: number,
  items: Array<{
    item: YoutubeItem;
    relation?: 'same_channel' | 'same_topic' | 'deeper_dive' | 'wildcard';
    topic?: string;
    score?: number;
  }>,
): void {
  upsertBecauseYouWatchedCandidates(items.map((entry, index) => ({
    item: entry.item,
    seed_video_id: seed.id,
    seed_watched_at: seedWatchedAt,
    relation_type: entry.relation || 'same_topic',
    query: entry.relation || 'same_topic',
    topic_cluster: entry.topic || entry.item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: entry.score ?? (1 - index * 0.001),
    score_breakdown: { test: true },
    reason: `because_you_watched:${entry.relation || 'same_topic'}`,
  })));
}

function apiErrorResponse(message = 'quota exceeded', status = 403): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
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

test('cached search token-matches multi-word queries across metadata', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    {
      item: {
        ...sampleVideo('CachedLofiLive', 'live', 'lofi-channel', 'lofi hip hop radio'),
        description: '24/7 live beats for focus',
      },
      score: 1,
      reason: 'test',
    },
  ]);
  const service = new YoutubeService();
  const response = await service.search('lofi live', 5) as {
    cached_only: boolean;
    groups: { videos: YoutubeItem[] };
  };
  assert.equal(response.cached_only, true);
  assert.deepEqual(response.groups.videos.map((item) => item.id), ['CachedLofiLive']);
}));

test('search falls back to local cache when YouTube API quota fails', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('LocalQuotaFallback', 'none', 'quota-channel', 'Local quota fallback'), score: 1, reason: 'test' },
  ]);
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded', 429)) as typeof fetch;
  const service = new YoutubeService();
  const response = await service.search('local quota', 5) as {
    cached_only: boolean;
    api_error: string | null;
    groups: { videos: YoutubeItem[] };
  };
  assert.equal(response.cached_only, true);
  assert.match(response.api_error || '', /quota exceeded/);
  assert.deepEqual(response.groups.videos.map((item) => item.id), ['LocalQuotaFallback']);
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
  upsertLiveCandidates([
    { item: sampleVideo('LiveNow', 'live'), lane: 'news_events', score: 1 },
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

test('live now filters stale, non-live, loop, and not-interested candidates', () => withTempState(async () => {
  const expiredAt = Date.now() - 1000;
  upsertLiveCandidates([
    { item: sampleVideo('LiveKeep', 'live', 'live-keep', 'Breaking news live'), lane: 'news_events', score: 1 },
    { item: sampleVideo('LiveExpired', 'live', 'live-expired', 'Expired live'), lane: 'news_events', score: 0.9, expiresAt: expiredAt },
    { item: sampleVideo('LiveLoop', 'live', 'live-loop', 'lofi hip hop radio 24/7'), lane: 'music_performance', score: 0.8 },
    { item: sampleVideo('LiveBlocked', 'live', 'live-blocked', 'Blocked live'), lane: 'sports', score: 0.7 },
    { item: sampleVideo('NotActuallyLive', 'none', 'not-live', 'Normal video'), lane: 'wildcard', score: 0.6 },
  ]);
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'LiveBlocked', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const liveNow = response.rails.find((rail) => rail.rail_id === 'live_now');
  assert.ok(liveNow);
  assert.deepEqual(liveNow.items.map((item) => item.id), ['LiveKeep']);
}));

test('live now returns nine diverse live cards and reshuffle samples cache only', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return apiErrorResponse('should not fetch on shuffle');
  }) as typeof fetch;
  const lanes = ['news_events', 'sports', 'music_performance', 'gaming', 'culture_talks', 'wildcard'] as const;
  upsertLiveCandidates(Array.from({ length: 14 }, (_, index) => ({
    item: sampleVideo(`LiveDiverse${index}`, 'live', `live-channel-${index}`, `Live ${TOPIC_WORDS[index]} event`),
    lane: lanes[index % lanes.length],
    score: 1 - index * 0.001,
  })));
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const liveNow = response.rails.find((rail) => rail.rail_id === 'live_now');
  assert.ok(liveNow);
  assert.equal(liveNow.items.length, 9);
  assert.equal(new Set(liveNow.items.map((item) => item.channel_id)).size, 9);
  assert.equal(fetchCalls, 0);
}));

test('live now suppresses recently exposed cards when enough alternatives exist', () => withTempState(async () => {
  upsertLiveCandidates(Array.from({ length: 10 }, (_, index) => ({
    item: sampleVideo(`LiveExposure${index}`, 'live', `exposure-channel-${index}`, `Live exposure ${TOPIC_WORDS[index]}`),
    lane: index === 0 ? 'news_events' : 'wildcard',
    score: 1 - index * 0.001,
  })));
  setLiveNowCandidateStats('LiveExposure0', { last_recommended_at: Date.now(), exposure_count: 3, ignore_count: 3 });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const liveNow = response.rails.find((rail) => rail.rail_id === 'live_now');
  assert.ok(liveNow);
  assert.equal(liveNow.items.length, 9);
  assert.ok(!liveNow.items.some((item) => item.id === 'LiveExposure0'));
}));

test('live now quota refresh falls back to existing reservoir', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  upsertLiveCandidates(Array.from({ length: 9 }, (_, index) => ({
    item: sampleVideo(`LiveStale${index}`, 'live', `live-stale-${index}`, `Stale live ${TOPIC_WORDS[index]}`),
    lane: index < 3 ? 'news_events' : 'wildcard',
  })));
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded')) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_live_failure');
  assert.equal(refresh.ok, true);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'live_now' && phase.ok));
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const liveNow = response.rails.find((rail) => rail.rail_id === 'live_now');
  assert.ok(liveNow);
  assert.equal(liveNow.items.length, 9);
  assert.ok(liveNow.items.every((item) => item.id.startsWith('LiveStale')));
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
  assert.equal(refresh.ok, true);
  assert.match(refresh.refresh.last_error || '', /partial refresh/);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'popular' && !phase.ok));
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'for_you_reservoir' && phase.ok));
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
    { ...sampleVideo('FreshUnderEight', 'none', 'under-eight-channel', 'Short-form official video'), duration_sec: 300 },
    sampleVideo('FreshLowSignal', 'none', 'low-signal-channel', 'SSC MTS result 2025 cutoff today'),
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
  assert.ok(!ids.includes('FreshUnderEight'));
  assert.ok(!ids.includes('FreshLowSignal'));
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

test('fresh finds relaxes sub-eight-minute filter only when thin', () => withTempState(async () => {
  const longRows: Array<{
    item: YoutubeItem;
    bucket: 'taste_adjacent' | 'quality_fresh';
    topic: string;
  }> = Array.from({ length: 8 }, (_, index) => ({
    item: sampleVideo(`FreshLongThin${index}`, 'none', `long-thin-${index}`, `Long thin ${TOPIC_WORDS[index]}`),
    bucket: index < 3 ? 'taste_adjacent' : 'quality_fresh',
    topic: `long-thin-topic-${index}`,
  }));
  upsertFreshCandidates([
    ...longRows,
    {
      item: { ...sampleVideo('FreshShortFallback', 'none', 'short-fallback', 'Short fallback'), duration_sec: 300 },
      bucket: 'wildcard',
      topic: 'short-fallback-topic',
    },
  ]);
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  assert.ok(rail.items.some((item) => item.id === 'FreshShortFallback'));
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

test('because you watched failed refresh keeps cached seed reservoir visible', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const seed = sampleVideo('SeedStale', 'none', 'seed-stale-channel', 'Stale cooking tour');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  upsertBecauseCandidates(seed, 5000, Array.from({ length: 9 }, (_, index) => ({
    item: sampleVideo(`BecauseStale${index}`, 'none', `because-stale-${index}`, `Stale cooking follow up ${TOPIC_WORDS[index]}`),
    relation: index < 3 ? 'same_topic' : index < 6 ? 'deeper_dive' : 'wildcard',
    topic: `stale-because-${index}`,
  })));
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded')) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_failure');
  assert.equal(refresh.ok, true);
  assert.match(refresh.refresh.last_error || '', /partial refresh/);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'popular' && !phase.ok));
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'because_you_watched' && phase.ok));
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  assert.ok(rail.items.every((item) => item.id.startsWith('BecauseStale')));
}));

test('because you watched excludes watched saved live shorts blocked low signal recent exposure and short duration', () => withTempState(async () => {
  const seed = sampleVideo('BecauseSeed', 'none', 'seed-channel', 'Travel food documentary');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'BecauseWatched',
    title: 'Watched follow up',
    tab: 'youtube',
    event: 'play',
    watched_at: 4000,
  });
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'BecauseSaved',
    title: 'Saved follow up',
    tab: 'youtube',
  });
  const candidates = [
    sampleVideo('BecauseWatched', 'none', 'watched-channel', 'Watched follow up'),
    sampleVideo('BecauseSaved', 'none', 'saved-channel', 'Saved follow up'),
    sampleVideo('BecauseLive', 'live', 'live-channel', 'Live follow up'),
    { ...sampleVideo('BecauseShort', 'none', 'short-channel', 'Short follow up'), duration_sec: 45 },
    { ...sampleVideo('BecauseUnderEight', 'none', 'under-eight-channel', 'Under eight follow up'), duration_sec: 300 },
    sampleVideo('BecauseLowSignal', 'none', 'low-signal-channel', 'SSC MTS result cutoff follow up'),
    sampleVideo('BecauseBlocked', 'none', 'blocked-channel', 'Blocked follow up'),
    sampleVideo('BecauseRecent', 'none', 'recent-channel', 'Recent follow up'),
    ...Array.from({ length: 9 }, (_, index) => (
      sampleVideo(`BecauseEligible${index}`, 'none', `because-eligible-${index}`, `Travel food follow up ${TOPIC_WORDS[index]}`)
    )),
  ];
  upsertBecauseCandidates(seed, 5000, candidates.map((item, index) => ({
    item,
    relation: index % 3 === 0 ? 'same_topic' : index % 3 === 1 ? 'deeper_dive' : 'wildcard',
    topic: `because-filter-${index}`,
  })));
  setBecauseYouWatchedCandidateStats(seed.id, 'BecauseRecent', { last_recommended_at: Date.now() });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'BecauseBlocked', reason: 'user' });
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  const ids = rail.items.map((item) => item.id);
  assert.equal(ids.length, 9);
  assert.ok(!ids.includes('BecauseWatched'));
  assert.ok(!ids.includes('BecauseSaved'));
  assert.ok(!ids.includes('BecauseLive'));
  assert.ok(!ids.includes('BecauseShort'));
  assert.ok(!ids.includes('BecauseUnderEight'));
  assert.ok(!ids.includes('BecauseLowSignal'));
  assert.ok(!ids.includes('BecauseBlocked'));
  assert.ok(!ids.includes('BecauseRecent'));
}));

test('because you watched enforces channel and topic diversity before relaxing', () => withTempState(async () => {
  const seed = sampleVideo('BecauseDiversitySeed', 'none', 'seed-channel', 'Mango topic documentary');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  const sameChannel = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`BecauseSameChannel${index}`, 'none', 'same-channel', `Mango channel follow up ${index}`)
  ));
  const sameTopic = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`BecauseSameTopic${index}`, 'none', `topic-channel-${index}`, `Mango shared topic ${index}`)
  ));
  const filler = Array.from({ length: 9 }, (_, index) => (
    sampleVideo(`BecauseFiller${index}`, 'none', `because-filler-${index}`, `Distinct ${TOPIC_WORDS[index]}`)
  ));
  upsertBecauseCandidates(seed, 5000, [
    ...sameChannel.map((item) => ({ item, relation: 'same_channel' as const, topic: `same-channel-${item.id}` })),
    ...sameTopic.map((item) => ({ item, relation: 'same_topic' as const, topic: 'shared-topic' })),
    ...filler.map((item, index) => ({ item, relation: 'wildcard' as const, topic: `filler-topic-${index}` })),
  ]);
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  assert.ok(rail.items.filter((item) => item.channel_id === 'same-channel').length <= 1);
  assert.ok(rail.items.filter((item) => item.title.startsWith('Mango shared topic')).length <= 2);
}));

test('because you watched reshuffle avoids recently exposed cached follow-ups when deep enough', () => withTempState(async () => {
  const seed = sampleVideo('BecauseShuffleSeed', 'none', 'seed-channel', 'Shuffle cooking travel');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  upsertBecauseCandidates(seed, 5000, Array.from({ length: 18 }, (_, index) => ({
    item: sampleVideo(`BecauseShuffle${index}`, 'none', `because-shuffle-${index}`, `Shuffle cooking travel ${TOPIC_WORDS[index % TOPIC_WORDS.length]}`),
    relation: index % 4 === 0
      ? 'same_channel'
      : index % 4 === 1
        ? 'same_topic'
        : index % 4 === 2
          ? 'deeper_dive'
          : 'wildcard',
    topic: `because-shuffle-${index}`,
  })));
  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstRail = first.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(firstRail);
  assert.equal(firstRail.items.length, 9);
  const second = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const secondRail = second.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(secondRail);
  assert.equal(secondRail.items.length, 9);
  const firstIds = new Set(firstRail.items.map((item) => item.id));
  assert.equal(secondRail.items.some((item) => firstIds.has(item.id)), false);
}));

test('because you watched relaxes recent exposure and duration only when thin', () => withTempState(async () => {
  const seed = sampleVideo('BecauseThinSeed', 'none', 'seed-channel', 'Thin cooking travel');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  const rows = [
    ...Array.from({ length: 7 }, (_, index) => (
      sampleVideo(`BecauseThin${index}`, 'none', `because-thin-${index}`, `Thin cooking travel ${TOPIC_WORDS[index]}`)
    )),
    sampleVideo('BecauseRecentFallback', 'none', 'because-thin-recent', 'Recent fallback cooking'),
    { ...sampleVideo('BecauseShortDurationFallback', 'none', 'because-thin-short', 'Short duration fallback cooking'), duration_sec: 300 },
  ];
  upsertBecauseCandidates(seed, 5000, rows.map((item, index) => ({
    item,
    relation: index < 3 ? 'same_topic' : 'wildcard',
    topic: `because-thin-${index}`,
  })));
  setBecauseYouWatchedCandidateStats(seed.id, 'BecauseRecentFallback', { last_recommended_at: Date.now() });
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  assert.equal(rail.items.length, 9);
  const ids = rail.items.map((item) => item.id);
  assert.ok(ids.includes('BecauseRecentFallback'));
  assert.ok(ids.includes('BecauseShortDurationFallback'));
}));
