import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
  getYoutubeItem,
  initYoutubeDb,
  listYoutubeRailItems,
  replaceYoutubeRailItems,
  resetYoutubeDbForTests,
  youtubeCacheSummary,
} from './db.js';
import type { YoutubeItem } from './types.js';

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

function withTempYoutube<T>(fn: (dir: string) => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-'));
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  resetYoutubeDbForTests();
  const cleanup = () => {
    resetYoutubeDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn(dir);
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

test('initYoutubeDb creates WAL cache schema', () => withTempYoutube((dir) => {
  initYoutubeDb();
  const db = new Database(join(dir, 'youtube.db'));
  try {
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(String(mode).toLowerCase(), 'wal');
    const rows = db.prepare('SELECT version FROM youtube_migrations').all() as Array<{ version: number }>;
    assert.deepEqual(rows.map((row) => row.version), [1]);
  } finally {
    db.close();
  }
}));

test('rail replacement upserts cached items and keeps case-sensitive ids', () => withTempYoutube(() => {
  const item = sampleItem('AbC_123-XyZ');
  replaceYoutubeRailItems('popular', [{ item, score: 1, reason: 'test' }]);
  assert.equal(getYoutubeItem('video', 'AbC_123-XyZ')?.id, 'AbC_123-XyZ');
  assert.equal(listYoutubeRailItems('popular').length, 1);
  assert.deepEqual(youtubeCacheSummary().rail_ids, ['popular']);
}));
