import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordLibraryWatch, resetLibraryDbForTests } from '../library/db.js';
import { replaceYoutubeRailItems, resetYoutubeDbForTests } from './db.js';
import { YoutubeService } from './service.js';
import type { YoutubeItem, YoutubeRail } from './types.js';

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

function withTempState<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-service-'));
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  process.env.MANGO_YOUTUBE_API_KEY_FILE = join(dir, 'missing-youtube-api.key');
  process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE = join(dir, 'missing-youtube-oauth-client.json');
  delete process.env.MANGO_YOUTUBE_API_KEY;
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const cleanup = () => {
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
