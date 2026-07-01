import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
	  getYoutubeItem,
	  initYoutubeDb,
	  listFreshFindCandidates,
	  listForYouCandidates,
	  listYoutubeRailItems,
	  noteFreshFindExposures,
	  noteForYouExposures,
	  replaceYoutubeRailItems,
	  resetYoutubeDbForTests,
	  setFreshFindCandidateStats,
	  setForYouCandidateStats,
	  upsertFreshFindCandidates,
	  upsertForYouCandidates,
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
	    assert.deepEqual(rows.map((row) => row.version), [1, 2, 3]);
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

test('for you reservoir stores source, score breakdown, and exposure state', () => withTempYoutube(() => {
  const item = sampleItem('Candidate1');
  upsertForYouCandidates([{
    item,
    lane: 'familiar',
    source: 'history',
    source_weight: 1.05,
    topic_cluster: 'deep:dive',
    score: 3.2,
    score_breakdown: { channel: 1, topic: 0.7 },
    reason: 'for_you:history',
  }]);
  let candidates = listForYouCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.source, 'history');
  assert.equal(candidates[0]?.lane, 'familiar');
  assert.deepEqual(candidates[0]?.score_breakdown, { channel: 1, topic: 0.7 });
  assert.equal(candidates[0]?.exposure_count, 0);

  noteForYouExposures(['Candidate1'], 5000);
  setForYouCandidateStats('Candidate1', { quick_stop_count: 2 });
  candidates = listForYouCandidates();
  assert.equal(candidates[0]?.last_recommended_at, 5000);
  assert.equal(candidates[0]?.exposure_count, 1);
  assert.equal(candidates[0]?.ignore_count, 1);
	  assert.equal(candidates[0]?.quick_stop_count, 2);
	}));

test('fresh finds reservoir stores source bucket, stats, and exposure state', () => withTempYoutube(() => {
  const item = sampleItem('FreshCandidate1');
  upsertFreshFindCandidates([{
    item,
    source_bucket: 'emerging_creator',
    query: 'small channel science explained',
    topic_cluster: 'science:explained',
    score: 2.8,
    score_breakdown: { freshness: 1, creator: 0.45 },
    creator_subscriber_count: 120000,
    creator_video_count: 85,
    reason: 'fresh_find:emerging_creator',
  }]);
  let candidates = listFreshFindCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.source_bucket, 'emerging_creator');
  assert.equal(candidates[0]?.query, 'small channel science explained');
  assert.equal(candidates[0]?.creator_subscriber_count, 120000);
  assert.deepEqual(candidates[0]?.score_breakdown, { freshness: 1, creator: 0.45 });
  assert.equal(candidates[0]?.exposure_count, 0);

  noteFreshFindExposures(['FreshCandidate1'], 6000);
  setFreshFindCandidateStats('FreshCandidate1', { quick_stop_count: 1 });
  candidates = listFreshFindCandidates();
  assert.equal(candidates[0]?.last_recommended_at, 6000);
  assert.equal(candidates[0]?.exposure_count, 1);
  assert.equal(candidates[0]?.ignore_count, 1);
  assert.equal(candidates[0]?.quick_stop_count, 1);
}));
