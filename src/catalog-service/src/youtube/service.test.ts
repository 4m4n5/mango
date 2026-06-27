import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetLibraryDbForTests } from '../library/db.js';
import { replaceYoutubeRailItems, resetYoutubeDbForTests } from './db.js';
import { YoutubeService } from './service.js';
import type { YoutubeItem, YoutubeRail } from './types.js';

function sampleVideo(id: string): YoutubeItem {
  return {
    id,
    kind: 'video',
    title: `Video ${id}`,
    subtitle: 'Channel',
    description: 'A cached YouTube video',
    thumbnail: null,
    channel_id: 'channel-1',
    channel_title: 'Channel One',
    published_at: '2026-06-01T00:00:00Z',
    duration_sec: 600,
    live_status: 'none',
    playlist_id: null,
    updated_at: 1000,
  };
}

function withTempState<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-service-'));
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  delete process.env.MANGO_YOUTUBE_API_KEY;
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const cleanup = () => {
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
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
