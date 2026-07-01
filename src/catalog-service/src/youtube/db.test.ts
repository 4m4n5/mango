import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
  getYoutubeItem,
  initYoutubeDb,
  listBecauseYouWatchedCandidates,
  listFreshFindCandidates,
  listForYouCandidates,
  listLiveNowCandidates,
  listPopularCandidates,
  listYoutubeRailItems,
  noteBecauseYouWatchedExposures,
  noteFreshFindExposures,
  noteForYouExposures,
  noteLiveNowExposures,
  notePopularExposures,
  replaceYoutubeRailItems,
  resetYoutubeDbForTests,
  setBecauseYouWatchedCandidateStats,
  setFreshFindCandidateStats,
  setForYouCandidateStats,
  setLiveNowCandidateStats,
  setPopularCandidateStats,
  upsertBecauseYouWatchedCandidates,
  upsertFreshFindCandidates,
  upsertForYouCandidates,
  upsertLiveNowCandidates,
  upsertPopularCandidates,
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
    assert.deepEqual(rows.map((row) => row.version), [1, 2, 3, 4, 5, 6]);
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

test('live now reservoir stores lane, ttl, and exposure state', () => withTempYoutube(() => {
  const item = { ...sampleItem('LiveCandidate1'), live_status: 'live' as const };
  upsertLiveNowCandidates([{
    item,
    source_lane: 'news_events',
    query: 'breaking news live',
    topic_cluster: 'breaking:news',
    score: 4.2,
    score_breakdown: { lane: 'news_events', quality: 0.8 },
    reason: 'live_now:news_events',
    last_verified_at: 5000,
    expires_at: 7_205_000,
  }]);
  let candidates = listLiveNowCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.source_lane, 'news_events');
  assert.equal(candidates[0]?.query, 'breaking news live');
  assert.equal(candidates[0]?.last_verified_at, 5000);
  assert.equal(candidates[0]?.expires_at, 7_205_000);
  assert.deepEqual(candidates[0]?.score_breakdown, { lane: 'news_events', quality: 0.8 });
  assert.equal(candidates[0]?.exposure_count, 0);

  noteLiveNowExposures(['LiveCandidate1'], 6000);
  setLiveNowCandidateStats('LiveCandidate1', { quick_stop_count: 3 });
  candidates = listLiveNowCandidates();
  assert.equal(candidates[0]?.last_recommended_at, 6000);
  assert.equal(candidates[0]?.exposure_count, 1);
  assert.equal(candidates[0]?.ignore_count, 1);
  assert.equal(candidates[0]?.quick_stop_count, 3);
}));

test('popular reservoir stores region, category, and exposure state', () => withTempYoutube(() => {
  const item = sampleItem('PopularCandidate1');
  upsertPopularCandidates([{
    item,
    source_region: 'IN',
    category_id: '24',
    category_label: 'entertainment',
    topic_cluster: 'popular:entertainment',
    score: 2.9,
    score_breakdown: { rank: 1, region: 'IN' },
    reason: 'popular:entertainment:IN',
  }]);
  let candidates = listPopularCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.source_region, 'IN');
  assert.equal(candidates[0]?.category_id, '24');
  assert.equal(candidates[0]?.category_label, 'entertainment');
  assert.deepEqual(candidates[0]?.score_breakdown, { rank: 1, region: 'IN' });
  assert.equal(candidates[0]?.exposure_count, 0);

  notePopularExposures(['PopularCandidate1'], 7000);
  setPopularCandidateStats('PopularCandidate1', { quick_stop_count: 4 });
  candidates = listPopularCandidates();
  assert.equal(candidates[0]?.last_recommended_at, 7000);
  assert.equal(candidates[0]?.exposure_count, 1);
  assert.equal(candidates[0]?.ignore_count, 1);
  assert.equal(candidates[0]?.quick_stop_count, 4);
}));

test('because you watched reservoir is seed-scoped and tracks exposure state', () => withTempYoutube(() => {
  const item = sampleItem('FollowUpCandidate1');
  upsertBecauseYouWatchedCandidates([{
    item,
    seed_video_id: 'SeedVideo1',
    seed_watched_at: 7000,
    relation_type: 'same_topic',
    query: 'seed topic explained',
    topic_cluster: 'seed:topic',
    score: 3.4,
    score_breakdown: { seed: 1, topic: 0.9 },
    reason: 'because_you_watched:same_topic',
  }, {
    item,
    seed_video_id: 'SeedVideo2',
    seed_watched_at: 8000,
    relation_type: 'wildcard',
    query: 'adjacent topic',
    topic_cluster: 'adjacent:topic',
    score: 1.2,
    score_breakdown: { wildcard: 1 },
    reason: 'because_you_watched:wildcard',
  }]);

  let seedOne = listBecauseYouWatchedCandidates('SeedVideo1');
  const seedTwo = listBecauseYouWatchedCandidates('SeedVideo2');
  assert.equal(seedOne.length, 1);
  assert.equal(seedTwo.length, 1);
  assert.equal(seedOne[0]?.relation_type, 'same_topic');
  assert.equal(seedTwo[0]?.relation_type, 'wildcard');
  assert.deepEqual(seedOne[0]?.score_breakdown, { seed: 1, topic: 0.9 });

  noteBecauseYouWatchedExposures('SeedVideo1', ['FollowUpCandidate1'], 9000);
  setBecauseYouWatchedCandidateStats('SeedVideo1', 'FollowUpCandidate1', { quick_stop_count: 2 });
  seedOne = listBecauseYouWatchedCandidates('SeedVideo1');
  const unchangedSeedTwo = listBecauseYouWatchedCandidates('SeedVideo2');
  assert.equal(seedOne[0]?.last_recommended_at, 9000);
  assert.equal(seedOne[0]?.exposure_count, 1);
  assert.equal(seedOne[0]?.ignore_count, 1);
  assert.equal(seedOne[0]?.quick_stop_count, 2);
  assert.equal(unchangedSeedTwo[0]?.last_recommended_at, null);
  assert.equal(unchangedSeedTwo[0]?.exposure_count, 0);
}));
