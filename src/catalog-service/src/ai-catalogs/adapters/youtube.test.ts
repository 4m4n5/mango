import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { youtubeAdapter } from './youtube.js';
import { resetYoutubeDbForTests, upsertYoutubeItems } from '../../youtube/db.js';
import type { YoutubeItem } from '../../youtube/types.js';

function sampleItem(id: string): YoutubeItem {
  return {
    id,
    kind: 'video',
    title: `Video ${id}`,
    subtitle: 'Channel',
    description: null,
    thumbnail: `https://img.example/${id}.jpg`,
    channel_id: 'channel-1',
    channel_title: 'Channel One',
    published_at: '2026-06-01T00:00:00Z',
    duration_sec: 600,
    live_status: 'none',
    playlist_id: null,
    updated_at: 1000,
  };
}

function withTempYoutube<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-'));
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_YOUTUBE_API_KEY = '';
  process.env.MANGO_YOUTUBE_API_KEY_FILE = join(dir, 'no-such.key');
  resetYoutubeDbForTests();
  const cleanup = () => {
    resetYoutubeDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_YOUTUBE_API_KEY;
    delete process.env.MANGO_YOUTUBE_API_KEY_FILE;
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

test('youtubeAdapter resolvePlan maps cached videos to youtube_video seeds', async () => withTempYoutube(async () => {
  upsertYoutubeItems([sampleItem('cached1'), sampleItem('cached2')]);
  const plan = await youtubeAdapter.resolvePlan(
    {
      label: 'Cached',
      tab: 'youtube',
      content_type: 'youtube_video',
      theme: 'cached',
    },
    { searchLibrary: async () => [] },
  );
  assert.equal(plan.sources.length, 0);
  assert.equal(plan.catalogs_to_activate.length, 0);
  assert.equal(plan.fallback_level, 0);
  assert.equal(plan.thematic_score, 80);
  assert.ok(plan.seed_titles.length >= 1);
  const first = plan.seed_titles[0];
  assert.equal(first?.type, 'youtube_video');
  assert.equal(first?.id, 'cached1');
  assert.equal(first?.title, 'Video cached1');
  assert.equal(first?.poster, 'https://img.example/cached1.jpg');
  assert.equal(plan.llm_hints.theme, 'cached');
}));

test('youtubeAdapter resolvePlan returns empty seeds when cache is empty', async () => withTempYoutube(async () => {
  const plan = await youtubeAdapter.resolvePlan(
    {
      label: 'Empty',
      tab: 'youtube',
      content_type: 'youtube_video',
    },
    { searchLibrary: async () => [] },
  );
  assert.equal(plan.seed_titles.length, 0);
  assert.equal(plan.sources.length, 0);
  assert.equal(plan.thematic_score, 80);
}));
