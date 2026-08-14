import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
  getYoutubeSearchCache,
  getYoutubeItem,
  initYoutubeDb,
  incrementYoutubeQuota,
  latestYoutubeV2Generation,
  listYoutubeProfileCandidateStates,
  listYoutubeV2CandidateProvenance,
  publishYoutubeV2Generation,
  YOUTUBE_V2_GENERATION_RETENTION,
  recordYoutubeImpressions,
  putYoutubeSearchCache,
  pruneYoutubeMaintenance,
  resetYoutubeDbForTests,
  setYoutubeProfileCandidateState,
  setYoutubeState,
  upsertYoutubeItems,
  upsertYoutubeV2CandidateProvenance,
  youtubeV2ServingEpoch,
  youtubeQuotaDecision,
  youtubeRefreshStatus,
  youtubeSearchCacheSummary,
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
    assert.deepEqual(
    rows.map((row) => row.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  );
  } finally {
    db.close();
  }
}));

test('official thematic metadata round-trips additively through youtube_items', () => withTempYoutube(() => {
  const item = {
    ...sampleItem('rich'),
    category_id: '27',
    default_language: 'hi',
    default_audio_language: 'en',
    tags: ['cinema', 'India'],
  };
  upsertYoutubeItems([item]);
  assert.deepEqual(getYoutubeItem('video', 'rich'), item);
}));

test('published generation snapshot stays hot, immutable, and refreshes active metadata', () => withTempYoutube(() => {
  const active = { ...sampleItem('active'), tags: ['documentary'] };
  publishYoutubeV2Generation({
    model_version: 'snapshot-cache-test',
    source_hash: 'snapshot-cache-source',
    watch_count: 1,
    subscription_count: 0,
    generated_at: 1_000,
    items: [{
      rail_id: 'for_you',
      item: active,
      score: 0.8,
      reason: 'snapshot-cache-test',
      provenance: 'history_topic',
      provenance_ref: 'history-seed',
      source_expires_at: 10_000,
    }],
  });

  const initial = latestYoutubeV2Generation()!;
  assert.equal(latestYoutubeV2Generation(), initial);
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(Object.isFrozen(initial.items), true);
  assert.equal(Object.isFrozen(initial.items[0]), true);
  assert.equal(Object.isFrozen(initial.items[0]?.tags), true);
  assert.throws(() => {
    initial.items[0]!.title = 'Caller mutation';
  }, TypeError);
  assert.throws(() => {
    initial.items[0]!.tags!.push('caller-mutation');
  }, TypeError);
  assert.throws(() => {
    initial.items.splice(0, 1);
  }, TypeError);
  assert.equal(latestYoutubeV2Generation(), initial);
  assert.equal(initial.items[0]?.title, active.title);
  assert.deepEqual(initial.items[0]?.tags, ['documentary']);

  upsertYoutubeItems([sampleItem('unrelated')]);
  assert.equal(latestYoutubeV2Generation(), initial);

  upsertYoutubeItems([{ ...active, title: 'Updated active title', updated_at: 2_000 }]);
  const refreshed = latestYoutubeV2Generation()!;
  assert.notEqual(refreshed, initial);
  assert.equal(refreshed.items[0]?.title, 'Updated active title');
  assert.equal(latestYoutubeV2Generation(), refreshed);
}));

test('published generation snapshot detects active metadata commits from another connection', () => withTempYoutube((dir) => {
  const active = sampleItem('active-external');
  publishYoutubeV2Generation({
    model_version: 'snapshot-cache-external-test',
    source_hash: 'snapshot-cache-external-source',
    watch_count: 1,
    subscription_count: 0,
    generated_at: 1_000,
    items: [{
      rail_id: 'for_you',
      item: active,
      score: 0.8,
      reason: 'snapshot-cache-external-test',
      provenance: 'history_topic',
      provenance_ref: 'history-seed',
      source_expires_at: 10_000,
    }],
  });
  const initial = latestYoutubeV2Generation()!;

  const external = new Database(join(dir, 'youtube.db'));
  try {
    external.prepare(`
UPDATE youtube_items
SET title = ?, updated_at = ?
WHERE kind = 'video' AND id = ?
`).run('Updated by another connection', 2_000, active.id);
  } finally {
    external.close();
  }

  const refreshed = latestYoutubeV2Generation()!;
  assert.notEqual(refreshed, initial);
  assert.equal(refreshed.items[0]?.title, 'Updated by another connection');
  assert.equal(latestYoutubeV2Generation(), refreshed);
}));

test('startup prunes unused v1 candidate rows and keeps the schema', () => withTempYoutube((dir) => {
  initYoutubeDb();
  const path = join(dir, 'youtube.db');
  resetYoutubeDbForTests();
  const before = new Database(path);
  before.prepare(`
INSERT INTO youtube_items(
  kind, id, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, raw_json, first_seen_at, updated_at
) VALUES ('video', 'HistoricalCandidate', 'Historical candidate', '', NULL, NULL,
  NULL, NULL, NULL, NULL, 'none', NULL, NULL, 1, 1)
`).run();
  before.prepare(`
INSERT INTO youtube_for_you_candidates(
  kind, id, lane, source, source_weight, topic_cluster, score,
  score_breakdown, reason, created_at, updated_at
) VALUES ('video', 'HistoricalCandidate', 'legacy', 'legacy', 1, 'legacy', 1,
  '{}', 'preserved', 1, 1)
`).run();
  before.close();

  initYoutubeDb();
  resetYoutubeDbForTests();
  const after = new Database(path, { readonly: true });
  try {
    assert.equal(
      (after.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_for_you_candidates'")
        .get() as { name: string } | undefined)?.name,
      'youtube_for_you_candidates',
    );
    assert.equal(
      (after.prepare("SELECT COUNT(*) AS count FROM youtube_for_you_candidates WHERE id = 'HistoricalCandidate'")
        .get() as { count: number }).count,
      0,
    );
  } finally {
    after.close();
  }
}));

test('YouTube v2 publication retains only current and previous generations', () => withTempYoutube(() => {
  for (let index = 0; index < YOUTUBE_V2_GENERATION_RETENTION + 3; index += 1) {
    const item = sampleItem(`gen-${index}`);
    publishYoutubeV2Generation({
      model_version: 'retention-test',
      source_hash: `source-${index}`,
      watch_count: 1,
      subscription_count: 0,
      generated_at: 1_000 + index,
      items: [{
        rail_id: 'for_you',
        item,
        score: 0.8,
        reason: 'retention-test',
        provenance: 'history_topic',
        provenance_ref: 'history-seed',
        source_expires_at: 10_000 + index,
      }],
    });
  }
  const db = new Database(process.env.MANGO_YOUTUBE_DB_PATH!, { readonly: true });
  try {
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM youtube_v2_generations').get() as { count: number }).count,
      YOUTUBE_V2_GENERATION_RETENTION,
    );
    assert.equal(latestYoutubeV2Generation()?.items[0]?.id, 'gen-4');
  } finally {
    db.close();
  }
}));

test('v15 preserves provenance while allowing lane generations to coexist', () => withTempYoutube((dir) => {
  const item = sampleItem('LaneMigration');
  upsertYoutubeV2CandidateProvenance([{
    item,
    provenance: 'history_topic',
    provenance_ref: 'seed',
    source_generation: 'more_like:old',
    acquired_at: 1000,
    expires_at: 2000,
  }]);
  resetYoutubeDbForTests();
  const legacy = new Database(join(dir, 'youtube.db'));
  legacy.exec(`
DROP INDEX idx_youtube_v2_candidate_expiry;
DROP INDEX idx_youtube_v2_candidate_source;
CREATE TABLE youtube_v2_candidate_provenance_v14 (
  kind TEXT NOT NULL DEFAULT 'video' CHECK(kind = 'video'),
  id TEXT NOT NULL,
  provenance TEXT NOT NULL,
  provenance_ref TEXT NOT NULL,
  source_generation TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id, provenance, provenance_ref),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);
INSERT INTO youtube_v2_candidate_provenance_v14
SELECT kind, id, provenance, provenance_ref, source_generation, acquired_at, expires_at
FROM youtube_v2_candidate_provenance;
DROP TABLE youtube_v2_candidate_provenance;
ALTER TABLE youtube_v2_candidate_provenance_v14 RENAME TO youtube_v2_candidate_provenance;
CREATE INDEX idx_youtube_v2_candidate_expiry ON youtube_v2_candidate_provenance(expires_at);
CREATE INDEX idx_youtube_v2_candidate_source
  ON youtube_v2_candidate_provenance(provenance, source_generation, acquired_at DESC);
DELETE FROM youtube_migrations WHERE version = 15;
`);
  legacy.close();

  initYoutubeDb();
  upsertYoutubeV2CandidateProvenance([{
    item,
    provenance: 'history_topic',
    provenance_ref: 'seed',
    source_generation: 'beyond:new',
    acquired_at: 1100,
    expires_at: 2100,
  }]);
  assert.deepEqual(
    listYoutubeV2CandidateProvenance({ at: 0 })
      .filter((row) => row.item.id === item.id)
      .map((row) => row.source_generation)
      .sort(),
    ['beyond:new', 'more_like:old'],
  );
}));

test('v17 adds nullable quality evidence and preserves legacy provenance', () => withTempYoutube((dir) => {
  const legacyItem = sampleItem('LegacyQualityEvidence');
  upsertYoutubeV2CandidateProvenance([{
    item: legacyItem,
    provenance: 'history_topic',
    provenance_ref: 'legacy-seed',
    source_generation: 'legacy-generation',
    acquired_at: 1000,
    expires_at: 5000,
  }]);
  resetYoutubeDbForTests();
  const legacy = new Database(join(dir, 'youtube.db'));
  legacy.exec(`
ALTER TABLE youtube_v2_candidate_provenance RENAME TO youtube_v2_candidate_provenance_v17;
CREATE TABLE youtube_v2_candidate_provenance (
  kind TEXT NOT NULL DEFAULT 'video' CHECK(kind = 'video'),
  id TEXT NOT NULL,
  provenance TEXT NOT NULL,
  provenance_ref TEXT NOT NULL,
  source_generation TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id, provenance, provenance_ref, source_generation)
);
INSERT INTO youtube_v2_candidate_provenance(
  kind, id, provenance, provenance_ref, source_generation, acquired_at, expires_at
)
SELECT kind, id, provenance, provenance_ref, source_generation, acquired_at, expires_at
FROM youtube_v2_candidate_provenance_v17;
DROP TABLE youtube_v2_candidate_provenance_v17;
DELETE FROM youtube_migrations WHERE version = 17;
`);
  legacy.close();

  initYoutubeDb();
  const [row] = listYoutubeV2CandidateProvenance({ at: 0 });
  assert.equal(row?.item.id, legacyItem.id);
  assert.equal(row?.relation_type, null);
  assert.equal(row?.source_rank, null);
  const migrated = new Database(join(dir, 'youtube.db'), { readonly: true });
  try {
    assert.ok(migrated.prepare('SELECT 1 FROM youtube_migrations WHERE version = 17').get());
    assert.deepEqual(
      (migrated.prepare('PRAGMA table_info(youtube_v2_candidate_provenance)').all() as Array<{ name: string }>)
        .map((column) => column.name)
        .filter((name) => name === 'relation_type' || name === 'source_rank'),
      ['relation_type', 'source_rank'],
    );
  } finally {
    migrated.close();
  }
}));

test('provenance refresh keeps strongest relation and best observed source rank', () => withTempYoutube(() => {
  const item = sampleItem('BestEvidence');
  const base = {
    item,
    provenance: 'history_topic' as const,
    provenance_ref: 'quality-seed',
    source_generation: 'quality-generation',
  };
  upsertYoutubeV2CandidateProvenance([{
    ...base, acquired_at: 1000, expires_at: 5000, relation_type: 'wildcard', source_rank: 42,
  }]);
  upsertYoutubeV2CandidateProvenance([{
    ...base, acquired_at: 2000, expires_at: 6000, relation_type: 'same_topic', source_rank: 7,
  }]);
  upsertYoutubeV2CandidateProvenance([{
    ...base, acquired_at: 1500, expires_at: 5500, relation_type: 'deeper_dive', source_rank: 18,
  }]);
  const [row] = listYoutubeV2CandidateProvenance({ at: 0 });
  assert.equal(row?.relation_type, 'same_topic');
  assert.equal(row?.source_rank, 7);
  assert.equal(row?.acquired_at, 2000);
  assert.equal(row?.expires_at, 6000);
}));

test('serving policy rollout resets legacy epoch once and then advances normally', () => withTempYoutube(() => {
  setYoutubeState('youtube_v2_serving_epoch', {
    generation: 9,
    shuffle_epoch: 37,
    slate_sequence: 80,
  });
  assert.deepEqual(youtubeV2ServingEpoch(9, false), {
    generation: 9,
    shuffle_epoch: 0,
    slate_sequence: 81,
    serving_policy: 'independent_weighted_v1',
  });
  assert.deepEqual(youtubeV2ServingEpoch(9, false), {
    generation: 9,
    shuffle_epoch: 0,
    slate_sequence: 81,
    serving_policy: 'independent_weighted_v1',
  });
  assert.deepEqual(youtubeV2ServingEpoch(9, true), {
    generation: 9,
    shuffle_epoch: 1,
    slate_sequence: 82,
    serving_policy: 'independent_weighted_v1',
  });
}));

test('rendered impressions are idempotent per profile slate but independent across profiles', () => withTempYoutube(() => {
  const base = { slate_sequence: 7, rail_id: 'for_you', item_ids: ['a', 'b'], impressed_at: 1000 };
  assert.deepEqual(recordYoutubeImpressions({ ...base, profile_id: 'household' }), ['a', 'b']);
  assert.deepEqual(recordYoutubeImpressions({ ...base, profile_id: 'household' }), []);
  assert.deepEqual(
    listYoutubeProfileCandidateStates({ profile_id: 'household', rail_id: 'for_you' })
      .map((state) => [state.id, state.exposure_count, state.last_recommended_at]),
    [['a', 1, 1000], ['b', 1, 1000]],
  );
  assert.deepEqual(
    listYoutubeProfileCandidateStates({ profile_id: 'viewer-2', rail_id: 'for_you' }),
    [],
  );
  assert.deepEqual(recordYoutubeImpressions({ ...base, profile_id: 'viewer-2' }), ['a', 'b']);
  assert.deepEqual(recordYoutubeImpressions({ ...base, profile_id: 'household', slate_sequence: 8 }), ['a', 'b']);
  assert.equal(
    listYoutubeProfileCandidateStates({ profile_id: 'household', rail_id: 'for_you' })[0]?.exposure_count,
    2,
  );
  assert.equal(
    listYoutubeProfileCandidateStates({ profile_id: 'viewer-2', rail_id: 'for_you' })[0]?.exposure_count,
    1,
  );
}));

test('profile candidate state keeps rail contexts and counters isolated', () => withTempYoutube(() => {
  setYoutubeProfileCandidateState({
    profile_id: 'alice',
    rail_id: 'more_like',
    context_id: 'seed-a',
    id: 'follow-up',
    last_recommended_at: 2000,
    exposure_count: 3,
    quick_stop_count: 1,
  });
  assert.equal(listYoutubeProfileCandidateStates({
    profile_id: 'alice', rail_id: 'more_like', context_id: 'seed-a',
  })[0]?.exposure_count, 3);
  assert.deepEqual(listYoutubeProfileCandidateStates({
    profile_id: 'alice', rail_id: 'more_like', context_id: 'seed-b',
  }), []);
  assert.deepEqual(listYoutubeProfileCandidateStates({
    profile_id: 'bob', rail_id: 'more_like', context_id: 'seed-a',
  }), []);
}));

test('YouTube query cache keys SafeSearch and expires after its TTL', () => withTempYoutube(() => {
  const input = {
    normalized_query: 'dune trailer',
    kind_scope: 'videos',
    safe_search: 'moderate',
    region_code: 'US',
    language: 'en',
  };
  const groups = { videos: [sampleItem('video-1')], channels: [], playlists: [] };
  putYoutubeSearchCache(input, groups, { fetched_at: 1_000, ttl_ms: 60_000 });
  assert.deepEqual(getYoutubeSearchCache(input, 30_000)?.groups.videos.map((item) => item.id), ['video-1']);
  assert.equal(getYoutubeSearchCache({ ...input, safe_search: 'strict' }, 30_000), null);
  assert.equal(getYoutubeSearchCache(input, 61_001), null);
}));

test('YouTube query cache prunes least recently used keys to its bound', () => withTempYoutube(() => {
  for (let index = 0; index < 4; index += 1) {
    putYoutubeSearchCache({
      normalized_query: `query ${index}`,
      kind_scope: 'youtube',
      safe_search: 'moderate',
      region_code: 'US',
      language: 'en',
    }, { videos: [sampleItem(`video-${index}`)], channels: [], playlists: [] }, {
      fetched_at: 1_000 + index,
      max_entries: 3,
    });
  }
  assert.equal(youtubeSearchCacheSummary(2_000).entries, 3);
  assert.equal(getYoutubeSearchCache({
    normalized_query: 'query 0',
    kind_scope: 'youtube',
    safe_search: 'moderate',
    region_code: 'US',
    language: 'en',
  }, 2_000), null);
}));

test('YouTube quota reserve pauses background work but remains available to couch search', () => withTempYoutube(() => {
  incrementYoutubeQuota(7_500);
  assert.equal(youtubeQuotaDecision(1, 'background').allowed, false);
  assert.equal(youtubeQuotaDecision(2_500, 'interactive').allowed, true);
  assert.equal(youtubeQuotaDecision(2_501, 'interactive').allowed, false);
}));

test('YouTube search calls use their own reserve instead of general API units', () => withTempYoutube(() => {
  for (let index = 0; index < 75; index += 1) incrementYoutubeQuota(1, true);
  assert.equal(youtubeQuotaDecision(1, 'background', true).allowed, false);
  assert.equal(youtubeQuotaDecision(1, 'interactive', true).allowed, true);
  for (let index = 0; index < 25; index += 1) incrementYoutubeQuota(1, true);
  assert.equal(youtubeQuotaDecision(1, 'interactive', true).allowed, false);
  const status = youtubeRefreshStatus();
  assert.equal(status.quota_used_today, 0);
  assert.equal(status.search_calls_today, 100);
}));

test('YouTube quota reader normalizes an existing old-model daily record', () => withTempYoutube(() => {
  const day = youtubeRefreshStatus().quota_reset_day;
  setYoutubeState('quota', {
    day,
    units: 201,
    search_calls: 2,
    api_calls: 3,
  });
  const normalized = youtubeRefreshStatus();
  assert.equal(normalized.quota_used_today, 1);
  assert.equal(normalized.search_calls_today, 2);
  incrementYoutubeQuota(1);
  assert.equal(youtubeRefreshStatus().quota_used_today, 2);
}));

test('YouTube prune nulls raw_json, retains recent impressions, and keeps candidate state', () => withTempYoutube((dir) => {
  initYoutubeDb();
  upsertYoutubeItems([sampleItem('keep')]);
  const db = new Database(join(dir, 'youtube.db'));
  db.prepare('UPDATE youtube_items SET raw_json = ? WHERE id = ?').run('{"blob":true}', 'keep');
  db.close();
  recordYoutubeImpressions({
    profile_id: 'household',
    slate_sequence: 1,
    rail_id: 'for_you',
    item_ids: ['old'],
    impressed_at: 1000,
  });
  recordYoutubeImpressions({
    profile_id: 'household',
    slate_sequence: 80,
    rail_id: 'for_you',
    item_ids: ['fresh'],
    impressed_at: 2000,
  });
  const beforeState = listYoutubeProfileCandidateStates({
    profile_id: 'household',
    rail_id: 'for_you',
  }).length;
  assert.ok(beforeState >= 1);
  const stats = pruneYoutubeMaintenance();
  assert.equal(stats.raw_json, 1);
  assert.equal(stats.impressions, 1);
  const after = new Database(join(dir, 'youtube.db'));
  try {
    const raw = after.prepare('SELECT raw_json FROM youtube_items WHERE id = ?').get('keep') as { raw_json: string | null };
    assert.equal(raw.raw_json, null);
    const sequences = after.prepare(
      'SELECT slate_sequence FROM youtube_profile_impressions ORDER BY slate_sequence',
    ).all() as Array<{ slate_sequence: number }>;
    assert.deepEqual(sequences.map((row) => row.slate_sequence), [80]);
  } finally {
    after.close();
  }
  assert.equal(
    listYoutubeProfileCandidateStates({ profile_id: 'household', rail_id: 'for_you' }).length,
    beforeState,
  );
}));
