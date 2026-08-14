import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
  latestYoutubeTakeoutImportAudit,
  listYoutubeTakeoutHistory,
  listYoutubeTakeoutHistoryIdsPage,
  recordYoutubeTakeoutImportAudit,
  upsertYoutubeTakeoutHistory,
  type YoutubeTakeoutHistoryEntry,
  type YoutubeTakeoutImportAudit,
} from '../library/db.js';
import { loadYoutubeConfig } from './config.js';
import { applySqliteHotPragmas } from '../sqlite-hot.js';
import type {
  YoutubeItem,
  YoutubeItemKind,
  YoutubeLiveStatus,
  YoutubeRailItem,
  YoutubeRefreshPhaseResult,
  YoutubeRefreshStatus,
  YoutubeSearchGroups,
} from './types.js';

let dbSingleton: Database.Database | null = null;
let initialized = false;
/** Last-good is the previous published generation; keep current + previous. */
export const YOUTUBE_V2_GENERATION_RETENTION = 2;
let legacyTakeoutMigrationComplete = false;
let legacyTakeoutMigrationResult = { history_inserted: 0, audits_copied: 0 };
let latestGenerationSnapshot: {
  db_path: string;
  generation: number;
  data_version: number;
  item_keys: Set<string>;
  value: YoutubeV2Generation;
} | null = null;

function invalidateLatestGenerationSnapshot(): void {
  latestGenerationSnapshot = null;
}

function youtubeDbDataVersion(db: Database.Database): number {
  return Number(db.pragma('data_version', { simple: true }));
}

function freezeYoutubeV2Generation(value: YoutubeV2Generation): YoutubeV2Generation {
  for (const item of value.items) {
    if (item.tags) Object.freeze(item.tags);
    Object.freeze(item);
  }
  Object.freeze(value.items);
  Object.freeze(value);
  return value;
}

export function resetYoutubeDbForTests(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  initialized = false;
  legacyTakeoutMigrationComplete = false;
  legacyTakeoutMigrationResult = { history_inserted: 0, audits_copied: 0 };
  invalidateLatestGenerationSnapshot();
}

export function youtubeDbPath(): string {
  return process.env.MANGO_YOUTUBE_DB_PATH || loadYoutubeConfig().db_path;
}

function openDb(): Database.Database {
  if (!dbSingleton) {
    mkdirSync(dirname(youtubeDbPath()), { recursive: true });
    const db = new Database(youtubeDbPath());
    applySqliteHotPragmas(db);
    dbSingleton = db;
  }
  return dbSingleton;
}

function nowMs(): number {
  return Date.now();
}

function todayPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
CREATE TABLE IF NOT EXISTS youtube_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_items (
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  description TEXT,
  thumbnail TEXT,
  channel_id TEXT,
  channel_title TEXT,
  published_at TEXT,
  duration_sec INTEGER,
  live_status TEXT NOT NULL DEFAULT 'none',
  playlist_id TEXT,
  category_id TEXT,
  default_language TEXT,
  default_audio_language TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  official_metadata_checked_at INTEGER,
  raw_json TEXT,
  first_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id)
);

CREATE TABLE IF NOT EXISTS youtube_rail_items (
  rail_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  reason TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY(rail_id, kind, id),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS youtube_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_search_cache (
  cache_key TEXT PRIMARY KEY,
  normalized_query TEXT NOT NULL,
  kind_scope TEXT NOT NULL,
  safe_search TEXT NOT NULL,
  region_code TEXT NOT NULL,
  language TEXT NOT NULL,
  result_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_auth_sessions (
  session_id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  interval_sec INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_poll_at INTEGER,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_for_you_candidates (
  kind TEXT NOT NULL DEFAULT 'video',
  id TEXT NOT NULL,
  lane TEXT NOT NULL,
  source TEXT NOT NULL,
  source_weight REAL NOT NULL DEFAULT 1,
  topic_cluster TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  last_recommended_at INTEGER,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  ignore_count INTEGER NOT NULL DEFAULT 0,
  quick_stop_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS youtube_fresh_find_candidates (
  kind TEXT NOT NULL DEFAULT 'video',
  id TEXT NOT NULL,
  source_bucket TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  topic_cluster TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  creator_subscriber_count INTEGER,
  creator_video_count INTEGER,
  last_recommended_at INTEGER,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  ignore_count INTEGER NOT NULL DEFAULT 0,
  quick_stop_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS youtube_because_you_watched_candidates (
  kind TEXT NOT NULL DEFAULT 'video',
  id TEXT NOT NULL,
  seed_video_id TEXT NOT NULL,
  seed_watched_at INTEGER NOT NULL DEFAULT 0,
  relation_type TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  topic_cluster TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  last_recommended_at INTEGER,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  ignore_count INTEGER NOT NULL DEFAULT 0,
  quick_stop_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(seed_video_id, kind, id),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS youtube_live_now_candidates (
  kind TEXT NOT NULL DEFAULT 'video',
  id TEXT NOT NULL,
  source_lane TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  topic_cluster TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  last_verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_recommended_at INTEGER,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  ignore_count INTEGER NOT NULL DEFAULT 0,
  quick_stop_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS youtube_popular_candidates (
  kind TEXT NOT NULL DEFAULT 'video',
  id TEXT NOT NULL,
  source_region TEXT NOT NULL,
  category_id TEXT NOT NULL DEFAULT '0',
  category_label TEXT NOT NULL DEFAULT 'all',
  topic_cluster TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  last_recommended_at INTEGER,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  ignore_count INTEGER NOT NULL DEFAULT 0,
  quick_stop_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS youtube_impressions (
  slate_sequence INTEGER NOT NULL,
  rail_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  impressed_at INTEGER NOT NULL,
  PRIMARY KEY(slate_sequence, rail_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_youtube_impressions_at ON youtube_impressions(impressed_at DESC);

CREATE TABLE IF NOT EXISTS youtube_profile_impressions (
  profile_id TEXT NOT NULL,
  slate_sequence INTEGER NOT NULL,
  rail_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  impressed_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, slate_sequence, rail_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_youtube_profile_impressions_at
  ON youtube_profile_impressions(profile_id, impressed_at DESC);

CREATE TABLE IF NOT EXISTS youtube_profile_candidate_state (
  profile_id TEXT NOT NULL,
  rail_id TEXT NOT NULL,
  context_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'video',
  id TEXT NOT NULL,
  last_recommended_at INTEGER,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  ignore_count INTEGER NOT NULL DEFAULT 0,
  quick_stop_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, rail_id, context_id, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_youtube_profile_candidate_cooldown
  ON youtube_profile_candidate_state(profile_id, rail_id, context_id, last_recommended_at);

-- Recommendation v2 deliberately owns its source records in youtube.db.  The
-- rows below are household-wide: profile, mood, search, Saved, VOD, global
-- charts, and AI output are not valid taste inputs for this model.
CREATE TABLE IF NOT EXISTS youtube_v2_subscriptions (
  channel_key TEXT PRIMARY KEY,
  channel_id TEXT,
  channel_title TEXT NOT NULL,
  channel_url TEXT,
  source TEXT NOT NULL CHECK(source IN ('oauth', 'takeout')),
  source_generation TEXT NOT NULL,
  subscribed_at INTEGER,
  imported_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_youtube_v2_subscriptions_id
  ON youtube_v2_subscriptions(channel_id);

CREATE TABLE IF NOT EXISTS youtube_v2_imported_history (
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  title_url TEXT,
  channel_id TEXT,
  channel_title TEXT,
  watched_at INTEGER NOT NULL,
  source_generation TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY(video_id, watched_at)
);
CREATE INDEX IF NOT EXISTS idx_youtube_v2_history_watched
  ON youtube_v2_imported_history(watched_at DESC);

CREATE TABLE IF NOT EXISTS youtube_v2_takeout_imports (
  generation TEXT PRIMARY KEY,
  format TEXT NOT NULL CHECK(format IN ('json', 'html', 'zip', 'mixed', 'unknown')),
  source_filename TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'partial', 'failed', 'noop')),
  history_count INTEGER NOT NULL DEFAULT 0,
  subscription_count INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  errors_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_youtube_v2_takeout_imported
  ON youtube_v2_takeout_imports(imported_at DESC);

CREATE TABLE IF NOT EXISTS youtube_v2_candidate_provenance (
  kind TEXT NOT NULL DEFAULT 'video' CHECK(kind = 'video'),
  id TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK(provenance IN (
    'subscription_upload', 'subscription_live', 'history_channel', 'history_topic'
  )),
  provenance_ref TEXT NOT NULL,
  source_generation TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  relation_type TEXT CHECK(relation_type IS NULL OR relation_type IN (
    'direct', 'same_topic', 'deeper_dive', 'wildcard'
  )),
  source_rank INTEGER CHECK(source_rank IS NULL OR source_rank >= 0),
  PRIMARY KEY(kind, id, provenance, provenance_ref, source_generation),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_youtube_v2_candidate_expiry
  ON youtube_v2_candidate_provenance(expires_at);
CREATE INDEX IF NOT EXISTS idx_youtube_v2_candidate_source
  ON youtube_v2_candidate_provenance(provenance, source_generation, acquired_at DESC);

CREATE TABLE IF NOT EXISTS youtube_v2_generations (
  generation INTEGER PRIMARY KEY AUTOINCREMENT,
  model_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready', 'empty')),
  watch_count INTEGER NOT NULL,
  subscription_count INTEGER NOT NULL,
  candidate_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_v2_generation_items (
  generation INTEGER NOT NULL,
  rail_id TEXT NOT NULL CHECK(rail_id IN (
    'for_you', 'beyond', 'more_like', 'new_from_subscriptions', 'live_now'
  )),
  rank INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'video' CHECK(kind = 'video'),
  id TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT,
  provenance TEXT NOT NULL CHECK(provenance IN (
    'subscription_upload', 'subscription_live', 'history_channel', 'history_topic'
  )),
  provenance_ref TEXT NOT NULL,
  context_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(generation, rail_id, rank),
  UNIQUE(generation, rail_id, kind, id),
  FOREIGN KEY(generation) REFERENCES youtube_v2_generations(generation) ON DELETE CASCADE,
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_youtube_v2_generation_rail
  ON youtube_v2_generation_items(generation, rail_id, rank);

CREATE INDEX IF NOT EXISTS idx_youtube_items_updated ON youtube_items(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_items_channel ON youtube_items(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_rail_added ON youtube_rail_items(rail_id, score DESC, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_for_you_score ON youtube_for_you_candidates(score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_for_you_lane ON youtube_for_you_candidates(lane, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_for_you_exposure ON youtube_for_you_candidates(last_recommended_at);
CREATE INDEX IF NOT EXISTS idx_youtube_fresh_find_score ON youtube_fresh_find_candidates(score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_fresh_find_bucket ON youtube_fresh_find_candidates(source_bucket, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_fresh_find_exposure ON youtube_fresh_find_candidates(last_recommended_at);
CREATE INDEX IF NOT EXISTS idx_youtube_because_seed_score ON youtube_because_you_watched_candidates(seed_video_id, score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_because_relation ON youtube_because_you_watched_candidates(relation_type, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_because_exposure ON youtube_because_you_watched_candidates(last_recommended_at);
CREATE INDEX IF NOT EXISTS idx_youtube_live_now_score ON youtube_live_now_candidates(score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_live_now_lane ON youtube_live_now_candidates(source_lane, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_live_now_expiry ON youtube_live_now_candidates(expires_at);
CREATE INDEX IF NOT EXISTS idx_youtube_live_now_exposure ON youtube_live_now_candidates(last_recommended_at);
CREATE INDEX IF NOT EXISTS idx_youtube_popular_score ON youtube_popular_candidates(score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_popular_region ON youtube_popular_candidates(source_region, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_popular_category ON youtube_popular_candidates(category_label, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_popular_exposure ON youtube_popular_candidates(last_recommended_at);
CREATE INDEX IF NOT EXISTS idx_youtube_search_cache_expiry
  ON youtube_search_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_youtube_search_cache_access
  ON youtube_search_cache(last_accessed_at DESC);
`);
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (1, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (2, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (3, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (4, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (5, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (6, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (7, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (8, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (9, ?)')
    .run(nowMs());
  const profileCandidateMigration = db.prepare(
    'SELECT 1 FROM youtube_migrations WHERE version = 10',
  ).get();
  if (!profileCandidateMigration) {
    const migratedAt = nowMs();
    db.transaction(() => {
      for (const source of [
        { table: 'youtube_for_you_candidates', rail: 'for_you', context: "''" },
        { table: 'youtube_fresh_find_candidates', rail: 'fresh_finds', context: "''" },
        { table: 'youtube_live_now_candidates', rail: 'live_now', context: "''" },
        { table: 'youtube_popular_candidates', rail: 'popular', context: "''" },
        { table: 'youtube_because_you_watched_candidates', rail: 'because_you_watched', context: 'seed_video_id' },
      ]) {
        db.exec(`
INSERT OR IGNORE INTO youtube_profile_candidate_state(
  profile_id, rail_id, context_id, kind, id, last_recommended_at,
  exposure_count, ignore_count, quick_stop_count, created_at, updated_at
)
SELECT
  'household', '${source.rail}', ${source.context}, kind, id, last_recommended_at,
  exposure_count, ignore_count, quick_stop_count, created_at, updated_at
FROM ${source.table}
WHERE last_recommended_at IS NOT NULL
   OR exposure_count > 0
   OR ignore_count > 0
   OR quick_stop_count > 0;
`);
      }
      db.prepare('INSERT INTO youtube_migrations(version, applied_at) VALUES (10, ?)')
        .run(migratedAt);
    })();
  }
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (11, ?)')
    .run(nowMs());
  const v2ProvenanceMigration = db.prepare(
    'SELECT 1 FROM youtube_migrations WHERE version = 12',
  ).get();
  if (!v2ProvenanceMigration) {
    const generationItemsSql = (db.prepare(`
SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'youtube_v2_generation_items'
`).get() as { sql?: string } | undefined)?.sql ?? '';
    if (generationItemsSql.includes('subscription_adjacent')) {
      db.transaction(() => {
        db.exec(`
CREATE TABLE youtube_v2_generation_items_v12 (
  generation INTEGER NOT NULL,
  rail_id TEXT NOT NULL CHECK(rail_id IN (
    'for_you', 'beyond', 'more_like', 'new_from_subscriptions', 'live_now'
  )),
  rank INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'video' CHECK(kind = 'video'),
  id TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT,
  provenance TEXT NOT NULL CHECK(provenance IN (
    'subscription_upload', 'subscription_live', 'history_channel', 'history_topic'
  )),
  provenance_ref TEXT NOT NULL,
  context_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(generation, rail_id, rank),
  UNIQUE(generation, rail_id, kind, id),
  FOREIGN KEY(generation) REFERENCES youtube_v2_generations(generation) ON DELETE CASCADE,
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);
INSERT INTO youtube_v2_generation_items_v12(
  generation, rail_id, rank, kind, id, score, reason,
  provenance, provenance_ref, context_id
)
SELECT
  generation, rail_id, rank, kind, id, score, reason,
  provenance, provenance_ref, context_id
FROM youtube_v2_generation_items
WHERE provenance IN (
  'subscription_upload', 'subscription_live', 'history_channel', 'history_topic'
);
DROP TABLE youtube_v2_generation_items;
ALTER TABLE youtube_v2_generation_items_v12 RENAME TO youtube_v2_generation_items;
CREATE INDEX idx_youtube_v2_generation_rail
  ON youtube_v2_generation_items(generation, rail_id, rank);
`);
      })();
    }
    db.prepare('INSERT INTO youtube_migrations(version, applied_at) VALUES (12, ?)')
      .run(nowMs());
  }
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (13, ?)')
    .run(nowMs());
  const v2GenerationExpiryMigration = db.prepare(
    'SELECT 1 FROM youtube_migrations WHERE version = 14',
  ).get();
  if (!v2GenerationExpiryMigration) {
    const columns = db.prepare('PRAGMA table_info(youtube_v2_generation_items)')
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'source_expires_at')) {
      db.exec(`
ALTER TABLE youtube_v2_generation_items
ADD COLUMN source_expires_at INTEGER NOT NULL DEFAULT 0;
`);
    }
    db.prepare('INSERT INTO youtube_migrations(version, applied_at) VALUES (14, ?)')
      .run(nowMs());
  }
  const v2ProvenanceGenerationKeyMigration = db.prepare(
    'SELECT 1 FROM youtube_migrations WHERE version = 15',
  ).get();
  if (!v2ProvenanceGenerationKeyMigration) {
    const provenanceSql = (db.prepare(`
SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'youtube_v2_candidate_provenance'
`).get() as { sql?: string } | undefined)?.sql ?? '';
    if (!/PRIMARY KEY\s*\(\s*kind\s*,\s*id\s*,\s*provenance\s*,\s*provenance_ref\s*,\s*source_generation\s*\)/i
      .test(provenanceSql)) {
      db.transaction(() => {
        db.exec(`
CREATE TABLE youtube_v2_candidate_provenance_v15 (
  kind TEXT NOT NULL DEFAULT 'video' CHECK(kind = 'video'),
  id TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK(provenance IN (
    'subscription_upload', 'subscription_live', 'history_channel', 'history_topic'
  )),
  provenance_ref TEXT NOT NULL,
  source_generation TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(kind, id, provenance, provenance_ref, source_generation),
  FOREIGN KEY(kind, id) REFERENCES youtube_items(kind, id) ON DELETE CASCADE
);
INSERT INTO youtube_v2_candidate_provenance_v15(
  kind, id, provenance, provenance_ref, source_generation, acquired_at, expires_at
)
SELECT kind, id, provenance, provenance_ref, source_generation, acquired_at, expires_at
FROM youtube_v2_candidate_provenance;
DROP TABLE youtube_v2_candidate_provenance;
ALTER TABLE youtube_v2_candidate_provenance_v15 RENAME TO youtube_v2_candidate_provenance;
CREATE INDEX idx_youtube_v2_candidate_expiry
  ON youtube_v2_candidate_provenance(expires_at);
CREATE INDEX idx_youtube_v2_candidate_source
  ON youtube_v2_candidate_provenance(provenance, source_generation, acquired_at DESC);
`);
      })();
    }
    db.prepare('INSERT INTO youtube_migrations(version, applied_at) VALUES (15, ?)')
      .run(nowMs());
  }
  const officialMetadataMigration = db.prepare(
    'SELECT 1 FROM youtube_migrations WHERE version = 16',
  ).get();
  if (!officialMetadataMigration) {
    const columns = db.prepare('PRAGMA table_info(youtube_items)')
      .all() as Array<{ name: string }>;
    const existing = new Set(columns.map((column) => column.name));
    for (const [name, definition] of [
      ['category_id', 'TEXT'],
      ['default_language', 'TEXT'],
      ['default_audio_language', 'TEXT'],
      ['tags_json', "TEXT NOT NULL DEFAULT '[]'"],
      ['official_metadata_checked_at', 'INTEGER'],
    ] as const) {
      if (!existing.has(name)) db.exec(`ALTER TABLE youtube_items ADD COLUMN ${name} ${definition};`);
    }
    db.prepare('INSERT INTO youtube_migrations(version, applied_at) VALUES (16, ?)')
      .run(nowMs());
  }
  const provenanceQualityColumns = db.prepare('PRAGMA table_info(youtube_v2_candidate_provenance)')
    .all() as Array<{ name: string }>;
  const provenanceQualityColumnNames = new Set(provenanceQualityColumns.map((column) => column.name));
  const provenanceQualityMigration = db.prepare(
    'SELECT 1 FROM youtube_migrations WHERE version = 17',
  ).get();
  if (!provenanceQualityMigration
    || !provenanceQualityColumnNames.has('relation_type')
    || !provenanceQualityColumnNames.has('source_rank')) {
    db.transaction(() => {
      if (!provenanceQualityColumnNames.has('relation_type')) {
        db.exec(`
ALTER TABLE youtube_v2_candidate_provenance
ADD COLUMN relation_type TEXT CHECK(relation_type IS NULL OR relation_type IN (
  'direct', 'same_topic', 'deeper_dive', 'wildcard'
));
`);
      }
      if (!provenanceQualityColumnNames.has('source_rank')) {
        db.exec(`
ALTER TABLE youtube_v2_candidate_provenance
ADD COLUMN source_rank INTEGER CHECK(source_rank IS NULL OR source_rank >= 0);
`);
      }
      db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (17, ?)')
        .run(nowMs());
    })();
  }
}

function ensureDb(): Database.Database {
  const db = openDb();
  if (!initialized) {
    initSchema(db);
    initialized = true;
    pruneYoutubeMaintenance();
  }
  return db;
}

export function initYoutubeDb(): void {
  ensureDb();
}

export type YoutubePruneStats = {
  generations: number;
  v1_candidates: number;
  orphan_items: number;
  raw_json: number;
  impressions: number;
};

/** Drop unused v1 reservoirs and generations beyond current + previous last-good. */
export function pruneYoutubeMaintenance(): YoutubePruneStats {
  const db = openDb();
  db.pragma('foreign_keys = ON');
  const generationCutoff = db.prepare(`
SELECT generation FROM youtube_v2_generations
ORDER BY generation DESC LIMIT 1 OFFSET ?
`).get(YOUTUBE_V2_GENERATION_RETENTION) as { generation: number } | undefined;
  let generations = 0;
  if (generationCutoff?.generation != null) {
    db.prepare('DELETE FROM youtube_v2_generation_items WHERE generation <= ?')
      .run(generationCutoff.generation);
    generations = db.prepare('DELETE FROM youtube_v2_generations WHERE generation <= ?')
      .run(generationCutoff.generation).changes;
  }
  const v1Candidates = [
    'youtube_for_you_candidates',
    'youtube_fresh_find_candidates',
    'youtube_because_you_watched_candidates',
    'youtube_live_now_candidates',
    'youtube_popular_candidates',
    'youtube_rail_items',
    'youtube_impressions',
  ].reduce((sum, table) => sum + db.prepare(`DELETE FROM ${table}`).run().changes, 0);
  const rawJson = db.prepare(`
UPDATE youtube_items SET raw_json = NULL WHERE raw_json IS NOT NULL
`).run().changes;
  const currentSequence = db.prepare(`
SELECT MAX(slate_sequence) AS seq FROM youtube_profile_impressions
`).get() as { seq: number | null } | undefined;
  const sequenceFloor = Math.max(0, Number(currentSequence?.seq ?? 0) - 32);
  const impressions = db.prepare(`
DELETE FROM youtube_profile_impressions WHERE slate_sequence < ?
`).run(sequenceFloor).changes;
  return { generations, v1_candidates: v1Candidates, orphan_items: 0, raw_json: rawJson, impressions };
}

/** Exclusive lock; never call on the couch path. */
export function vacuumYoutubeDatabase(): void {
  openDb().exec('VACUUM');
}

function normalizeKind(kind: string): YoutubeItemKind {
  if (kind === 'channel' || kind === 'playlist') {
    return kind;
  }
  return 'video';
}

function normalizeLiveStatus(status: string | null | undefined): YoutubeLiveStatus {
  if (status === 'live' || status === 'upcoming' || status === 'completed') {
    return status;
  }
  return 'none';
}

function youtubeItemFromRow(row: YoutubeItem & { tags_json?: string }): YoutubeItem {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json || '[]');
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string');
  } catch {
    tags = [];
  }
  const { tags_json: _tagsJson, ...item } = row;
  if (item.official_metadata_checked_at === null) {
    delete item.official_metadata_checked_at;
  }
  return { ...item, tags };
}

export function upsertYoutubeItems(items: YoutubeItem[], rawJsonById: Map<string, unknown> = new Map()): void {
  const db = ensureDb();
  const timestamp = nowMs();
  const stmt = db.prepare(`
INSERT INTO youtube_items (
  id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, category_id, default_language,
  default_audio_language, tags_json, official_metadata_checked_at, raw_json, first_seen_at, updated_at
) VALUES (
  @id, @kind, @title, @subtitle, @description, @thumbnail, @channel_id, @channel_title,
  @published_at, @duration_sec, @live_status, @playlist_id, @category_id, @default_language,
  @default_audio_language, @tags_json, @official_metadata_checked_at, @raw_json, @first_seen_at, @updated_at
)
ON CONFLICT(kind, id) DO UPDATE SET
  title = excluded.title,
  subtitle = excluded.subtitle,
  description = COALESCE(excluded.description, youtube_items.description),
  thumbnail = COALESCE(excluded.thumbnail, youtube_items.thumbnail),
  channel_id = COALESCE(excluded.channel_id, youtube_items.channel_id),
  channel_title = COALESCE(excluded.channel_title, youtube_items.channel_title),
  published_at = COALESCE(excluded.published_at, youtube_items.published_at),
  duration_sec = COALESCE(excluded.duration_sec, youtube_items.duration_sec),
  live_status = excluded.live_status,
  playlist_id = COALESCE(excluded.playlist_id, youtube_items.playlist_id),
  category_id = COALESCE(excluded.category_id, youtube_items.category_id),
  default_language = COALESCE(excluded.default_language, youtube_items.default_language),
  default_audio_language = COALESCE(excluded.default_audio_language, youtube_items.default_audio_language),
  tags_json = CASE WHEN excluded.tags_json = '[]' THEN youtube_items.tags_json ELSE excluded.tags_json END,
  official_metadata_checked_at = COALESCE(
    excluded.official_metadata_checked_at,
    youtube_items.official_metadata_checked_at
  ),
  raw_json = NULL,
  updated_at = excluded.updated_at;
`);
  const tx = db.transaction(() => {
    for (const item of items) {
      stmt.run({
        ...item,
        kind: normalizeKind(item.kind),
        live_status: normalizeLiveStatus(item.live_status),
        category_id: item.category_id ?? null,
        default_language: item.default_language ?? null,
        default_audio_language: item.default_audio_language ?? null,
        tags_json: JSON.stringify(item.tags ?? []),
        official_metadata_checked_at: item.official_metadata_checked_at ?? null,
        raw_json: rawJsonById.has(item.id) ? JSON.stringify(rawJsonById.get(item.id)) : null,
        first_seen_at: item.updated_at || timestamp,
        updated_at: item.updated_at || timestamp,
      });
    }
  });
  tx();
  const activeItemKeys = latestGenerationSnapshot?.item_keys;
  if (activeItemKeys && items.some((item) => (
    activeItemKeys.has(`${normalizeKind(item.kind)}:${item.id}`)
  ))) {
    // Active-generation metadata is joined from youtube_items. Keep that
    // observable behavior while allowing unrelated Search/cache writes to
    // leave the immutable published serving snapshot hot.
    invalidateLatestGenerationSnapshot();
  }
}

export function getYoutubeItem(kind: string, id: string): YoutubeItem | null {
  const row = ensureDb().prepare(`
SELECT id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, category_id, default_language,
  default_audio_language, tags_json, official_metadata_checked_at, updated_at
FROM youtube_items
WHERE kind = ? AND id = ?;
`).get(normalizeKind(kind), id) as (YoutubeItem & { tags_json?: string }) | undefined;
  return row ? youtubeItemFromRow(row) : null;
}

export function listYoutubeItems(kind: YoutubeItemKind | null = null, limit = 50): YoutubeItem[] {
  const rows = ensureDb().prepare(`
SELECT id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, category_id, default_language,
  default_audio_language, tags_json, official_metadata_checked_at, updated_at
FROM youtube_items
WHERE (@kind IS NULL OR kind = @kind)
ORDER BY updated_at DESC
  LIMIT @limit;
`).all({ kind, limit: Math.max(1, Math.min(20_000, limit)) }) as YoutubeItem[];
  return rows.map((row) => youtubeItemFromRow(row as YoutubeItem & { tags_json?: string }));
}

export function searchCachedYoutubeItems(query: string, limit = 25): YoutubeItem[] {
  const normalized = query.trim().toLowerCase();
  const like = `%${normalized}%`;
  if (like === '%%') {
    return listYoutubeItems(null, limit);
  }
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const exactRows = ensureDb().prepare(`
SELECT id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, category_id, default_language,
  default_audio_language, tags_json, official_metadata_checked_at, updated_at
FROM youtube_items
WHERE lower(title) LIKE @like
  OR lower(COALESCE(channel_title, '')) LIKE @like
  OR lower(COALESCE(description, '')) LIKE @like
ORDER BY updated_at DESC
LIMIT @limit;
`).all({ like, limit: boundedLimit }) as YoutubeItem[];
  if (exactRows.length > 0) {
    return exactRows.map((row) => youtubeItemFromRow(row as YoutubeItem & { tags_json?: string }));
  }
  const tokens = normalized
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 5);
  if (tokens.length <= 1) {
    return exactRows;
  }
  return listYoutubeItems(null, 2000)
    .filter((item) => {
      const haystack = `${item.title} ${item.channel_title || ''} ${item.description || ''} ${item.live_status}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, boundedLimit);
}

// Legacy rail tables remain in the schema. Unused v1 reservoir rows are pruned
// on startup; only the v2 generation and provenance APIs are executable.

export function listYoutubeRailIds(): string[] {
  const rows = ensureDb().prepare(`
SELECT DISTINCT rail_id
FROM youtube_rail_items
ORDER BY rail_id;
`).all() as Array<{ rail_id: string }>;
  return rows.map((row) => row.rail_id);
}

// Historical v1 candidate-reservoir tables remain for schema compatibility.
// Runtime serving reads v2 generations only; unused v1 rows are pruned.

export type YoutubeProfileCandidateState = {
  profile_id: string;
  rail_id: string;
  context_id: string;
  kind: YoutubeItemKind;
  id: string;
  last_recommended_at: number | null;
  exposure_count: number;
  ignore_count: number;
  quick_stop_count: number;
  created_at: number;
  updated_at: number;
};

function normalizedProfileCandidateKey(input: {
  profile_id: string;
  rail_id: string;
  context_id?: string;
}): { profile_id: string; rail_id: string; context_id: string } | null {
  const profileId = input.profile_id.trim().toLowerCase();
  const railId = input.rail_id.trim();
  if (!profileId || !railId) return null;
  return {
    profile_id: profileId,
    rail_id: railId,
    context_id: input.context_id?.trim() || '',
  };
}

export function listYoutubeProfileCandidateStates(input: {
  profile_id: string;
  rail_id: string;
  context_id?: string;
}): YoutubeProfileCandidateState[] {
  const key = normalizedProfileCandidateKey(input);
  if (!key) return [];
  return ensureDb().prepare(`
SELECT
  profile_id, rail_id, context_id, kind, id, last_recommended_at,
  exposure_count, ignore_count, quick_stop_count, created_at, updated_at
FROM youtube_profile_candidate_state
WHERE profile_id = @profile_id AND rail_id = @rail_id AND context_id = @context_id
ORDER BY updated_at DESC, id;
`).all(key) as YoutubeProfileCandidateState[];
}

export function clearYoutubeProfileCandidateStates(profileIdInput: string): number {
  const profileId = profileIdInput.trim().toLowerCase();
  if (!profileId) return 0;
  return ensureDb().prepare(
    'DELETE FROM youtube_profile_candidate_state WHERE profile_id = ?',
  ).run(profileId).changes;
}

export function setYoutubeProfileCandidateState(input: {
  profile_id: string;
  rail_id: string;
  context_id?: string;
  id: string;
  last_recommended_at?: number | null;
  exposure_count?: number;
  ignore_count?: number;
  quick_stop_count?: number;
  updated_at?: number;
}): void {
  const key = normalizedProfileCandidateKey(input);
  const id = input.id.trim();
  if (!key || !id) return;
  const db = ensureDb();
  const timestamp = input.updated_at ?? nowMs();
  const current = db.prepare(`
SELECT last_recommended_at, exposure_count, ignore_count, quick_stop_count, created_at
FROM youtube_profile_candidate_state
WHERE profile_id = @profile_id AND rail_id = @rail_id AND context_id = @context_id
  AND kind = 'video' AND id = @id;
`).get({ ...key, id }) as Pick<
    YoutubeProfileCandidateState,
    'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count' | 'created_at'
  > | undefined;
  db.prepare(`
INSERT INTO youtube_profile_candidate_state(
  profile_id, rail_id, context_id, kind, id, last_recommended_at,
  exposure_count, ignore_count, quick_stop_count, created_at, updated_at
) VALUES (
  @profile_id, @rail_id, @context_id, 'video', @id, @last_recommended_at,
  @exposure_count, @ignore_count, @quick_stop_count, @created_at, @updated_at
)
ON CONFLICT(profile_id, rail_id, context_id, kind, id) DO UPDATE SET
  last_recommended_at = excluded.last_recommended_at,
  exposure_count = excluded.exposure_count,
  ignore_count = excluded.ignore_count,
  quick_stop_count = excluded.quick_stop_count,
  updated_at = excluded.updated_at;
`).run({
    ...key,
    id,
    last_recommended_at: input.last_recommended_at !== undefined
      ? input.last_recommended_at
      : current?.last_recommended_at ?? null,
    exposure_count: input.exposure_count !== undefined
      ? Math.max(0, Math.trunc(input.exposure_count))
      : current?.exposure_count ?? 0,
    ignore_count: input.ignore_count !== undefined
      ? Math.max(0, Math.trunc(input.ignore_count))
      : current?.ignore_count ?? 0,
    quick_stop_count: input.quick_stop_count !== undefined
      ? Math.max(0, Math.trunc(input.quick_stop_count))
      : current?.quick_stop_count ?? 0,
    created_at: current?.created_at ?? timestamp,
    updated_at: timestamp,
  });
}

/**
 * Records only cards the launcher reports as rendered. Repeated Home renders
 * of the same slate are idempotent, so cooldowns describe real opportunities
 * to see a card rather than payload assembly or focus churn.
 */
export function recordYoutubeImpressions(input: {
  profile_id: string;
  slate_sequence: number;
  rail_id: string;
  context_id?: string;
  item_ids: string[];
  impressed_at?: number;
}): string[] {
  const sequence = Math.max(0, Math.trunc(input.slate_sequence));
  const key = normalizedProfileCandidateKey(input);
  if (!key) return [];
  const ids = [...new Set(input.item_ids.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
  if (ids.length === 0) return [];
  const db = ensureDb();
  const timestamp = input.impressed_at ?? nowMs();
  const insert = db.prepare(`
INSERT OR IGNORE INTO youtube_profile_impressions(
  profile_id, slate_sequence, rail_id, item_id, impressed_at
) VALUES (?, ?, ?, ?, ?)
`);
  const noteCandidate = db.prepare(`
INSERT INTO youtube_profile_candidate_state(
  profile_id, rail_id, context_id, kind, id, last_recommended_at,
  exposure_count, ignore_count, quick_stop_count, created_at, updated_at
) VALUES (?, ?, ?, 'video', ?, ?, 1, 0, 0, ?, ?)
ON CONFLICT(profile_id, rail_id, context_id, kind, id) DO UPDATE SET
  last_recommended_at = excluded.last_recommended_at,
  exposure_count = youtube_profile_candidate_state.exposure_count + 1,
  updated_at = excluded.updated_at;
`);
  const inserted: string[] = [];
  db.transaction(() => {
    for (const id of ids) {
      if (insert.run(key.profile_id, sequence, key.rail_id, id, timestamp).changes === 0) continue;
      noteCandidate.run(
        key.profile_id,
        key.rail_id,
        key.context_id,
        id,
        timestamp,
        timestamp,
        timestamp,
      );
      inserted.push(id);
    }
  })();
  return inserted;
}

export function setYoutubeState(key: string, value: unknown): void {
  ensureDb().prepare(`
INSERT INTO youtube_state (key, value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
`).run(key, JSON.stringify(value), nowMs());
}

export function deleteYoutubeState(key: string): void {
  ensureDb().prepare('DELETE FROM youtube_state WHERE key = ?').run(key);
}

export function getYoutubeState<T>(key: string, fallback: T): T {
  const row = ensureDb().prepare('SELECT value FROM youtube_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  if (!row) {
    return fallback;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export type YoutubeApiPurpose = 'interactive' | 'background';

export const YOUTUBE_DAILY_QUOTA_BUDGET = Math.max(
  100,
  Number(process.env.MANGO_YOUTUBE_DAILY_QUOTA_BUDGET || 10_000),
);
export const YOUTUBE_INTERACTIVE_QUOTA_RESERVE = Math.max(
  0,
  Math.min(
    YOUTUBE_DAILY_QUOTA_BUDGET,
    Number(process.env.MANGO_YOUTUBE_INTERACTIVE_QUOTA_RESERVE || 2_500),
  ),
);
export const YOUTUBE_DAILY_SEARCH_CALL_BUDGET = Math.max(
  1,
  Number(process.env.MANGO_YOUTUBE_DAILY_SEARCH_CALL_BUDGET || 100),
);
export const YOUTUBE_INTERACTIVE_SEARCH_CALL_RESERVE = Math.max(
  0,
  Math.min(
    YOUTUBE_DAILY_SEARCH_CALL_BUDGET,
    Number(process.env.MANGO_YOUTUBE_INTERACTIVE_SEARCH_CALL_RESERVE || 25),
  ),
);

type YoutubeQuotaRecord = {
  day: string;
  units: number;
  search_calls?: number;
  api_calls?: number;
  accounting_version?: number;
};

function currentYoutubeQuota(): YoutubeQuotaRecord {
  const day = todayPacific();
  const current = getYoutubeState<YoutubeQuotaRecord>(
    'quota',
    { day, units: 0, search_calls: 0, api_calls: 0, accounting_version: 2 },
  );
  if (current.day !== day) {
    return { day, units: 0, search_calls: 0, api_calls: 0, accounting_version: 2 };
  }
  if (current.accounting_version === 2) return current;
  // Before June 2026 Search was counted as 100 general units. Preserve all
  // runtime state while removing those historical charges from today's
  // general bucket; search_calls already tracked the independent count.
  return {
    ...current,
    units: Math.max(0, current.units - (current.search_calls ?? 0) * 100),
    accounting_version: 2,
  };
}

export function youtubeQuotaDecision(
  units: number,
  purpose: YoutubeApiPurpose,
  searchCall = false,
): {
  allowed: boolean;
  reason: string | null;
  used: number;
  limit: number;
  bucket: 'general' | 'search';
} {
  const cost = Math.max(1, Math.floor(units));
  const quota = currentYoutubeQuota();
  if (searchCall) {
    const used = quota.search_calls ?? 0;
    const limit = purpose === 'background'
      ? YOUTUBE_DAILY_SEARCH_CALL_BUDGET - YOUTUBE_INTERACTIVE_SEARCH_CALL_RESERVE
      : YOUTUBE_DAILY_SEARCH_CALL_BUDGET;
    const allowed = used + 1 <= limit;
    return {
      allowed,
      reason: allowed
        ? null
        : purpose === 'background'
          ? 'YouTube background search paused to preserve couch search'
          : 'YouTube daily search-call quota exhausted',
      used,
      limit,
      bucket: 'search',
    };
  }
  const limit = purpose === 'background'
    ? YOUTUBE_DAILY_QUOTA_BUDGET - YOUTUBE_INTERACTIVE_QUOTA_RESERVE
    : YOUTUBE_DAILY_QUOTA_BUDGET;
  const allowed = quota.units + cost <= limit;
  return {
    allowed,
    reason: allowed
      ? null
      : purpose === 'background'
        ? 'YouTube background quota paused to preserve couch search'
        : 'YouTube daily quota exhausted',
    used: quota.units,
    limit,
    bucket: 'general',
  };
}

export function incrementYoutubeQuota(units: number, searchCall = false): void {
  const day = todayPacific();
  const current = currentYoutubeQuota();
  const next = current.day === day
    ? {
      day,
      units: current.units + (searchCall ? 0 : units),
      search_calls: (current.search_calls ?? 0) + (searchCall ? 1 : 0),
      api_calls: (current.api_calls ?? 0) + 1,
      accounting_version: 2,
    }
    : {
      day,
      units: searchCall ? 0 : units,
      search_calls: searchCall ? 1 : 0,
      api_calls: 1,
      accounting_version: 2,
    };
  setYoutubeState('quota', next);
}

export function youtubeRefreshStatus(): YoutubeRefreshStatus {
  const quota = currentYoutubeQuota();
  const currentDay = quota.day === todayPacific();
  const used = currentDay ? quota.units : 0;
  return {
    last_refresh_at: getYoutubeState<number | null>('last_refresh_at', null),
    last_success_at: getYoutubeState<number | null>('last_success_at', null),
    last_error: getYoutubeState<string | null>('last_error', null),
    last_reason: getYoutubeState<string | null>('last_reason', null),
    phase_results: getYoutubeState<YoutubeRefreshPhaseResult[]>('last_phase_results', []),
    quota_used_today: used,
    search_calls_today: currentDay ? (quota.search_calls ?? 0) : 0,
    api_calls_today: currentDay ? (quota.api_calls ?? 0) : 0,
    quota_reset_day: todayPacific(),
    quota_budget: YOUTUBE_DAILY_QUOTA_BUDGET,
    interactive_reserve: YOUTUBE_INTERACTIVE_QUOTA_RESERVE,
    search_call_budget: YOUTUBE_DAILY_SEARCH_CALL_BUDGET,
    interactive_search_call_reserve: YOUTUBE_INTERACTIVE_SEARCH_CALL_RESERVE,
    background_remaining: Math.max(
      0,
      YOUTUBE_DAILY_QUOTA_BUDGET - YOUTUBE_INTERACTIVE_QUOTA_RESERVE - used,
    ),
    interactive_remaining: Math.max(0, YOUTUBE_DAILY_QUOTA_BUDGET - used),
    background_search_calls_remaining: Math.max(
      0,
      YOUTUBE_DAILY_SEARCH_CALL_BUDGET
        - YOUTUBE_INTERACTIVE_SEARCH_CALL_RESERVE
        - (currentDay ? (quota.search_calls ?? 0) : 0),
    ),
    interactive_search_calls_remaining: Math.max(
      0,
      YOUTUBE_DAILY_SEARCH_CALL_BUDGET - (currentDay ? (quota.search_calls ?? 0) : 0),
    ),
  };
}

/** Cheap generation token used by the launcher search index invalidator. */
export function youtubeSearchGeneration(): string {
  const row = ensureDb().prepare(`
SELECT COALESCE(MAX(updated_at), 0) AS updated_at, COUNT(*) AS row_count
FROM youtube_items;
`).get() as { updated_at: number; row_count: number };
  return `${row.updated_at}:${row.row_count}`;
}

export type YoutubeSearchCacheKeyInput = {
  normalized_query: string;
  kind_scope: string;
  safe_search: string;
  region_code: string;
  language: string;
};

export type YoutubeSearchCacheEntry = YoutubeSearchCacheKeyInput & {
  groups: YoutubeSearchGroups;
  fetched_at: number;
  expires_at: number;
};

export function youtubeSearchCacheKey(input: YoutubeSearchCacheKeyInput): string {
  return [
    input.normalized_query.trim().toLowerCase(),
    input.kind_scope.trim().toLowerCase(),
    input.safe_search.trim().toLowerCase(),
    input.region_code.trim().toUpperCase(),
    input.language.trim().toLowerCase(),
  ].join('|');
}

export function getYoutubeSearchCache(
  input: YoutubeSearchCacheKeyInput,
  timestamp = nowMs(),
): YoutubeSearchCacheEntry | null {
  const db = ensureDb();
  const key = youtubeSearchCacheKey(input);
  const row = db.prepare(`
SELECT normalized_query, kind_scope, safe_search, region_code, language,
  result_json, fetched_at, expires_at
FROM youtube_search_cache
WHERE cache_key = ? AND expires_at > ?;
`).get(key, timestamp) as {
    normalized_query: string;
    kind_scope: string;
    safe_search: string;
    region_code: string;
    language: string;
    result_json: string;
    fetched_at: number;
    expires_at: number;
  } | undefined;
  if (!row) {
    return null;
  }
  try {
    const groups = JSON.parse(row.result_json) as YoutubeSearchGroups;
    db.prepare('UPDATE youtube_search_cache SET last_accessed_at = ? WHERE cache_key = ?')
      .run(timestamp, key);
    return {
      normalized_query: row.normalized_query,
      kind_scope: row.kind_scope,
      safe_search: row.safe_search,
      region_code: row.region_code,
      language: row.language,
      groups,
      fetched_at: row.fetched_at,
      expires_at: row.expires_at,
    };
  } catch {
    db.prepare('DELETE FROM youtube_search_cache WHERE cache_key = ?').run(key);
    return null;
  }
}

export function putYoutubeSearchCache(
  input: YoutubeSearchCacheKeyInput,
  groups: YoutubeSearchGroups,
  options: { fetched_at?: number; ttl_ms?: number; max_entries?: number } = {},
): YoutubeSearchCacheEntry {
  const db = ensureDb();
  const fetchedAt = options.fetched_at ?? nowMs();
  const expiresAt = fetchedAt + Math.max(60_000, options.ttl_ms ?? 24 * 60 * 60 * 1000);
  const key = youtubeSearchCacheKey(input);
  const normalized: YoutubeSearchCacheKeyInput = {
    normalized_query: input.normalized_query.trim().toLowerCase(),
    kind_scope: input.kind_scope.trim().toLowerCase(),
    safe_search: input.safe_search.trim().toLowerCase(),
    region_code: input.region_code.trim().toUpperCase(),
    language: input.language.trim().toLowerCase(),
  };
  db.prepare(`
INSERT INTO youtube_search_cache(
  cache_key, normalized_query, kind_scope, safe_search, region_code, language,
  result_json, fetched_at, expires_at, last_accessed_at
) VALUES (
  @cache_key, @normalized_query, @kind_scope, @safe_search, @region_code, @language,
  @result_json, @fetched_at, @expires_at, @last_accessed_at
)
ON CONFLICT(cache_key) DO UPDATE SET
  result_json = excluded.result_json,
  fetched_at = excluded.fetched_at,
  expires_at = excluded.expires_at,
  last_accessed_at = excluded.last_accessed_at;
`).run({
    cache_key: key,
    ...normalized,
    result_json: JSON.stringify(groups),
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    last_accessed_at: fetchedAt,
  });
  db.prepare('DELETE FROM youtube_search_cache WHERE expires_at <= ?').run(fetchedAt);
  db.prepare(`
DELETE FROM youtube_search_cache
WHERE cache_key NOT IN (
  SELECT cache_key
  FROM youtube_search_cache
  ORDER BY last_accessed_at DESC
  LIMIT @max_entries
);
`).run({ max_entries: Math.max(1, Math.min(500, options.max_entries ?? 200)) });
  return { ...normalized, groups, fetched_at: fetchedAt, expires_at: expiresAt };
}

export function youtubeSearchCacheSummary(timestamp = nowMs()): {
  entries: number;
  fresh_entries: number;
  oldest_fetched_at: number | null;
  newest_fetched_at: number | null;
} {
  const row = ensureDb().prepare(`
SELECT
  COUNT(*) AS entries,
  SUM(CASE WHEN expires_at > @now THEN 1 ELSE 0 END) AS fresh_entries,
  MIN(fetched_at) AS oldest_fetched_at,
  MAX(fetched_at) AS newest_fetched_at
FROM youtube_search_cache;
`).get({ now: timestamp }) as {
    entries: number;
    fresh_entries: number;
    oldest_fetched_at: number | null;
    newest_fetched_at: number | null;
  };
  return {
    entries: Number(row.entries || 0),
    fresh_entries: Number(row.fresh_entries || 0),
    oldest_fetched_at: row.oldest_fetched_at,
    newest_fetched_at: row.newest_fetched_at,
  };
}

export type YoutubeV2Subscription = {
  channel_key: string;
  channel_id: string | null;
  channel_title: string;
  channel_url: string | null;
  source: 'oauth' | 'takeout';
  source_generation: string;
  subscribed_at: number | null;
  imported_at: number;
};

export type YoutubeV2HistoryEntry = YoutubeTakeoutHistoryEntry;

export function replaceYoutubeV2Subscriptions(
  subscriptions: Array<Omit<YoutubeV2Subscription, 'source_generation' | 'imported_at'>>,
  options: { source_generation: string; imported_at?: number },
): { replaced: number; noop: boolean } {
  const db = ensureDb();
  const sourceGeneration = options.source_generation.trim();
  if (!sourceGeneration) throw new Error('YouTube v2 subscription replacement requires a source generation');
  const stateKey = 'v2_subscription_source_generation';
  const current = db.prepare('SELECT value FROM youtube_state WHERE key = ?').get(stateKey) as { value: string } | undefined;
  if (current?.value === JSON.stringify(sourceGeneration)) {
    return { replaced: 0, noop: true };
  }
  const importedAt = options.imported_at ?? nowMs();
  const unique = new Map<string, Omit<YoutubeV2Subscription, 'source_generation' | 'imported_at'>>();
  for (const row of subscriptions) {
    const channelKey = row.channel_key.trim();
    const title = row.channel_title.trim();
    if (!channelKey || !title) continue;
    unique.set(channelKey, {
      ...row,
      channel_key: channelKey,
      channel_id: row.channel_id?.trim() || null,
      channel_title: title,
      channel_url: row.channel_url?.trim() || null,
    });
  }
  const insert = db.prepare(`
INSERT INTO youtube_v2_subscriptions(
  channel_key, channel_id, channel_title, channel_url, source,
  source_generation, subscribed_at, imported_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
  db.transaction(() => {
    db.prepare('DELETE FROM youtube_v2_subscriptions').run();
    for (const row of unique.values()) {
      insert.run(
        row.channel_key,
        row.channel_id,
        row.channel_title,
        row.channel_url,
        row.source,
        sourceGeneration,
        row.subscribed_at,
        importedAt,
      );
    }
    db.prepare(`
INSERT INTO youtube_state(key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`).run(stateKey, JSON.stringify(sourceGeneration), importedAt);
  })();
  return { replaced: unique.size, noop: false };
}

export function listYoutubeV2Subscriptions(): YoutubeV2Subscription[] {
  return ensureDb().prepare(`
SELECT channel_key, channel_id, channel_title, channel_url, source,
       source_generation, subscribed_at, imported_at
FROM youtube_v2_subscriptions
ORDER BY lower(channel_title), channel_key
`).all() as YoutubeV2Subscription[];
}

export function migrateLegacyYoutubeV2TakeoutToLibrary(): {
  history_inserted: number;
  audits_copied: number;
} {
  if (legacyTakeoutMigrationComplete) return legacyTakeoutMigrationResult;
  const db = ensureDb();
  let historyInserted = 0;
  let afterVideoId = '';
  let afterWatchedAt = -1;
  while (true) {
    const page = db.prepare(`
SELECT video_id, title, title_url, channel_id, channel_title, watched_at,
       source_generation, imported_at
FROM youtube_v2_imported_history
WHERE video_id > @after_video_id
   OR (video_id = @after_video_id AND watched_at > @after_watched_at)
ORDER BY video_id, watched_at
LIMIT 1000
`).all({
      after_video_id: afterVideoId,
      after_watched_at: afterWatchedAt,
    }) as YoutubeV2HistoryEntry[];
    if (page.length === 0) break;
    const groups = new Map<string, YoutubeV2HistoryEntry[]>();
    for (const row of page) {
      const key = `${row.source_generation}\u0000${row.imported_at}`;
      const rows = groups.get(key) ?? [];
      rows.push(row);
      groups.set(key, rows);
    }
    for (const rows of groups.values()) {
      const first = rows[0]!;
      historyInserted += upsertYoutubeTakeoutHistory(rows.map((row) => ({
        video_id: row.video_id,
        title: row.title,
        title_url: row.title_url,
        channel_id: row.channel_id,
        channel_title: row.channel_title,
        watched_at: row.watched_at,
      })), {
        source_generation: first.source_generation,
        imported_at: first.imported_at,
      }).inserted;
    }
    const last = page.at(-1)!;
    afterVideoId = last.video_id;
    afterWatchedAt = last.watched_at;
  }

  const parseMessages = (raw: string): string[] => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
      return [];
    }
  };
  const audits = db.prepare(`
SELECT generation, format, source_filename, source_hash, status,
       history_count, subscription_count, imported_at, warnings_json, errors_json
FROM youtube_v2_takeout_imports
ORDER BY imported_at, generation
`).all() as Array<Omit<YoutubeV2TakeoutImport, 'warnings' | 'errors'> & {
    warnings_json: string;
    errors_json: string;
  }>;
  let auditsCopied = 0;
  for (const row of audits) {
    auditsCopied += Number(recordYoutubeTakeoutImportAudit({
      generation: row.generation,
      format: row.format,
      source_filename: row.source_filename,
      source_hash: row.source_hash,
      status: row.status,
      history_count: row.history_count,
      subscription_count: row.subscription_count,
      imported_at: row.imported_at,
      warnings: parseMessages(row.warnings_json),
      errors: parseMessages(row.errors_json),
    }, { preserve_existing: true }));
  }
  legacyTakeoutMigrationResult = {
    history_inserted: historyInserted,
    audits_copied: auditsCopied,
  };
  legacyTakeoutMigrationComplete = true;
  return legacyTakeoutMigrationResult;
}

export function upsertYoutubeV2ImportedHistory(
  history: Array<Omit<YoutubeV2HistoryEntry, 'source_generation' | 'imported_at'>>,
  options: { source_generation: string; imported_at?: number },
): { inserted: number; noop: boolean } {
  migrateLegacyYoutubeV2TakeoutToLibrary();
  return upsertYoutubeTakeoutHistory(history, options);
}

export type YoutubeV2TakeoutImport = YoutubeTakeoutImportAudit;

export function recordYoutubeV2TakeoutImport(
  input: Omit<YoutubeV2TakeoutImport, 'source_filename' | 'warnings' | 'errors'> & {
    source_filename?: string | null;
    warnings?: readonly string[];
    errors?: readonly string[];
  },
): void {
  migrateLegacyYoutubeV2TakeoutToLibrary();
  recordYoutubeTakeoutImportAudit(input);
}

export function latestYoutubeV2TakeoutImport(): YoutubeV2TakeoutImport | null {
  migrateLegacyYoutubeV2TakeoutToLibrary();
  return latestYoutubeTakeoutImportAudit();
}

export function listYoutubeV2ImportedHistory(limit = 5000): YoutubeV2HistoryEntry[] {
  migrateLegacyYoutubeV2TakeoutToLibrary();
  return listYoutubeTakeoutHistory(limit);
}

export function listYoutubeV2ImportedHistoryIdsPage(options: {
  after_video_id?: string | null;
  watched_since?: number | null;
  limit?: number;
} = {}): string[] {
  migrateLegacyYoutubeV2TakeoutToLibrary();
  return listYoutubeTakeoutHistoryIdsPage(options);
}

export type YoutubeV2Provenance =
  | 'subscription_upload'
  | 'subscription_live'
  | 'history_channel'
  | 'history_topic';

export type YoutubeV2RelationType =
  | 'direct'
  | 'same_topic'
  | 'deeper_dive'
  | 'wildcard';

export type YoutubeV2CandidateProvenance = {
  item: YoutubeItem;
  provenance: YoutubeV2Provenance;
  provenance_ref: string;
  source_generation: string;
  acquired_at: number;
  expires_at: number;
  relation_type?: YoutubeV2RelationType | null;
  source_rank?: number | null;
};

export function upsertYoutubeV2CandidateProvenance(
  candidates: YoutubeV2CandidateProvenance[],
): { upserted: number } {
  const relationTypes = new Set<YoutubeV2RelationType>([
    'direct', 'same_topic', 'deeper_dive', 'wildcard',
  ]);
  const valid = candidates.filter((candidate) => {
    const relation = candidate.relation_type ?? null;
    const rank = candidate.source_rank ?? null;
    return candidate.item.kind === 'video'
      && Boolean(candidate.item.id.trim())
      && Boolean(candidate.provenance_ref.trim())
      && Boolean(candidate.source_generation.trim())
      && Number.isFinite(candidate.acquired_at)
      && Number.isFinite(candidate.expires_at)
      && candidate.expires_at > candidate.acquired_at
      && (relation === null || relationTypes.has(relation))
      && (rank === null || (Number.isFinite(rank) && rank >= 0));
  });
  upsertYoutubeItems(valid.map((candidate) => candidate.item));
  const db = ensureDb();
  const insert = db.prepare(`
INSERT INTO youtube_v2_candidate_provenance(
  kind, id, provenance, provenance_ref, source_generation, acquired_at, expires_at,
  relation_type, source_rank
) VALUES ('video', ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(kind, id, provenance, provenance_ref, source_generation) DO UPDATE SET
  acquired_at = MAX(youtube_v2_candidate_provenance.acquired_at, excluded.acquired_at),
  expires_at = MAX(youtube_v2_candidate_provenance.expires_at, excluded.expires_at),
  relation_type = CASE
    WHEN youtube_v2_candidate_provenance.relation_type IS NULL THEN excluded.relation_type
    WHEN excluded.relation_type IS NULL THEN youtube_v2_candidate_provenance.relation_type
    WHEN (CASE excluded.relation_type
      WHEN 'direct' THEN 4 WHEN 'same_topic' THEN 3
      WHEN 'deeper_dive' THEN 2 WHEN 'wildcard' THEN 1 ELSE 0 END)
      > (CASE youtube_v2_candidate_provenance.relation_type
        WHEN 'direct' THEN 4 WHEN 'same_topic' THEN 3
        WHEN 'deeper_dive' THEN 2 WHEN 'wildcard' THEN 1 ELSE 0 END)
      THEN excluded.relation_type
    ELSE youtube_v2_candidate_provenance.relation_type
  END,
  source_rank = CASE
    WHEN youtube_v2_candidate_provenance.source_rank IS NULL THEN excluded.source_rank
    WHEN excluded.source_rank IS NULL THEN youtube_v2_candidate_provenance.source_rank
    ELSE MIN(youtube_v2_candidate_provenance.source_rank, excluded.source_rank)
  END
`);
  const upserted = db.transaction(() => {
    let changes = 0;
    for (const candidate of valid) {
      changes += insert.run(
        candidate.item.id.trim(),
        candidate.provenance,
        candidate.provenance_ref.trim(),
        candidate.source_generation.trim(),
        Math.floor(candidate.acquired_at),
        Math.floor(candidate.expires_at),
        candidate.relation_type ?? null,
        candidate.source_rank === null || candidate.source_rank === undefined
          ? null
          : Math.floor(candidate.source_rank),
      ).changes;
    }
    return changes;
  })();
  return { upserted };
}

export function listYoutubeV2CandidateProvenance(options: {
  at?: number;
  limit?: number;
} = {}): YoutubeV2CandidateProvenance[] {
  const at = Math.floor(options.at ?? nowMs());
  const limit = Math.max(1, Math.min(50_000, Math.floor(options.limit ?? 20_000)));
  const rows = ensureDb().prepare(`
SELECT
  cp.provenance, cp.provenance_ref, cp.source_generation,
  cp.acquired_at, cp.expires_at, cp.relation_type, cp.source_rank,
  yi.id, yi.kind, yi.title, yi.subtitle, yi.description, yi.thumbnail,
  yi.channel_id, yi.channel_title, yi.published_at, yi.duration_sec,
  yi.live_status, yi.playlist_id, yi.category_id, yi.default_language,
  yi.default_audio_language, yi.tags_json, yi.official_metadata_checked_at, yi.updated_at
FROM youtube_v2_candidate_provenance cp
JOIN youtube_items yi ON yi.kind = cp.kind AND yi.id = cp.id
WHERE cp.expires_at > ?
ORDER BY cp.acquired_at DESC, cp.id, cp.provenance, cp.provenance_ref
LIMIT ?
`).all(at, limit) as Array<YoutubeItem & Omit<YoutubeV2CandidateProvenance, 'item'>>;
  return rows.map((row) => ({
    item: youtubeItemFromRow({
      id: row.id,
      kind: row.kind,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      thumbnail: row.thumbnail,
      channel_id: row.channel_id,
      channel_title: row.channel_title,
      published_at: row.published_at,
      duration_sec: row.duration_sec,
      live_status: row.live_status,
      playlist_id: row.playlist_id,
      category_id: row.category_id,
      default_language: row.default_language,
      default_audio_language: row.default_audio_language,
      tags_json: (row as YoutubeItem & { tags_json?: string }).tags_json,
      official_metadata_checked_at: row.official_metadata_checked_at,
      updated_at: row.updated_at,
    } as YoutubeItem & { tags_json?: string }),
    provenance: row.provenance,
    provenance_ref: row.provenance_ref,
    source_generation: row.source_generation,
    acquired_at: row.acquired_at,
    expires_at: row.expires_at,
    relation_type: row.relation_type ?? null,
    source_rank: row.source_rank ?? null,
  }));
}

/** All cache identities ever written through v2 acquisition, including expired rows. */
export function listAllYoutubeV2CandidateIds(): string[] {
  return (ensureDb().prepare(`
SELECT DISTINCT id
FROM youtube_v2_candidate_provenance
WHERE kind = 'video'
ORDER BY id
`).all() as Array<{ id: string }>).map((row) => row.id);
}

export function youtubeV2CandidateProvenanceSummary(at = nowMs()): {
  total: number;
  active: number;
  expired: number;
  next_expiry_at: number | null;
  by_provenance: Record<YoutubeV2Provenance, number>;
} {
  const db = ensureDb();
  const totals = db.prepare(`
SELECT COUNT(*) AS total,
       SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END) AS expired,
       MIN(CASE WHEN expires_at > ? THEN expires_at END) AS next_expiry_at
FROM youtube_v2_candidate_provenance
`).get(at, at, at) as { total: number; active: number; expired: number; next_expiry_at: number | null };
  const byProvenance: Record<YoutubeV2Provenance, number> = {
    subscription_upload: 0,
    subscription_live: 0,
    history_channel: 0,
    history_topic: 0,
  };
  for (const row of db.prepare(`
SELECT provenance, COUNT(*) AS count
FROM youtube_v2_candidate_provenance
WHERE expires_at > ?
GROUP BY provenance
`).all(at) as Array<{ provenance: YoutubeV2Provenance; count: number }>) {
    byProvenance[row.provenance] = Number(row.count);
  }
  return {
    total: Number(totals.total || 0),
    active: Number(totals.active || 0),
    expired: Number(totals.expired || 0),
    next_expiry_at: totals.next_expiry_at,
    by_provenance: byProvenance,
  };
}

export type YoutubeV2GenerationItemInput = {
  rail_id: 'for_you' | 'beyond' | 'more_like' | 'new_from_subscriptions' | 'live_now';
  item: YoutubeItem;
  score: number;
  reason: string | null;
  provenance: YoutubeV2Provenance;
  provenance_ref: string;
  source_expires_at: number;
  context_id?: string;
};

export type YoutubeV2Generation = {
  generation: number;
  model_version: string;
  source_hash: string;
  watch_count: number;
  subscription_count: number;
  candidate_count: number;
  generated_at: number;
  items: Array<YoutubeRailItem & {
    rail_id: YoutubeV2GenerationItemInput['rail_id'];
    rank: number;
    provenance: YoutubeV2Provenance;
    provenance_ref: string;
    source_expires_at: number;
    context_id: string;
  }>;
};

export type YoutubeV2GenerationRecord = Omit<YoutubeV2Generation, 'items'> & {
  status: 'ready' | 'empty';
};

export function publishYoutubeV2Generation(input: {
  model_version: string;
  source_hash: string;
  watch_count: number;
  subscription_count: number;
  items: YoutubeV2GenerationItemInput[];
  generated_at?: number;
}): number {
  const db = ensureDb();
  const generatedAt = input.generated_at ?? nowMs();
  const seen = new Set<string>();
  const items = input.items.filter((entry) => {
    const membershipKey = `${entry.rail_id}:${entry.item.id}`;
    if (
      entry.item.kind !== 'video'
      || !entry.item.id.trim()
      || !entry.provenance_ref.trim()
      || !Number.isFinite(entry.score)
      || !Number.isFinite(entry.source_expires_at)
      || entry.source_expires_at <= generatedAt
      || seen.has(membershipKey)
    ) return false;
    seen.add(membershipKey);
    return true;
  });
  upsertYoutubeItems(items.map((entry) => entry.item));
  const generation = db.transaction(() => {
    const generation = Number(db.prepare(`
INSERT INTO youtube_v2_generations(
  model_version, source_hash, status, watch_count, subscription_count,
  candidate_count, generated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
      input.model_version,
      input.source_hash,
      items.length > 0 ? 'ready' : 'empty',
      Math.max(0, Math.floor(input.watch_count)),
      Math.max(0, Math.floor(input.subscription_count)),
      items.length,
      generatedAt,
    ).lastInsertRowid);
    const insert = db.prepare(`
INSERT INTO youtube_v2_generation_items(
  generation, rail_id, rank, kind, id, score, reason,
  provenance, provenance_ref, source_expires_at, context_id
) VALUES (?, ?, ?, 'video', ?, ?, ?, ?, ?, ?, ?)
`);
    const ranks = new Map<string, number>();
    for (const entry of items) {
      const rank = ranks.get(entry.rail_id) ?? 0;
      insert.run(
        generation,
        entry.rail_id,
        rank,
        entry.item.id,
        entry.score,
        entry.reason,
        entry.provenance,
        entry.provenance_ref,
        entry.source_expires_at,
        entry.context_id?.trim() || '',
      );
      ranks.set(entry.rail_id, rank + 1);
    }
    db.prepare(`
DELETE FROM youtube_v2_generations
WHERE generation NOT IN (
  SELECT generation FROM youtube_v2_generations
  ORDER BY generation DESC LIMIT ${YOUTUBE_V2_GENERATION_RETENTION}
)
`).run();
    return generation;
  })();
  invalidateLatestGenerationSnapshot();
  return generation;
}

function readLatestYoutubeV2GenerationRecord(db: Database.Database): YoutubeV2GenerationRecord | null {
  return (db.prepare(`
SELECT generation, model_version, source_hash, status, watch_count, subscription_count,
       candidate_count, generated_at
FROM youtube_v2_generations
ORDER BY generation DESC
LIMIT 1
`).get() as YoutubeV2GenerationRecord | undefined) ?? null;
}

function readYoutubeV2GenerationItems(
  db: Database.Database,
  generation: number,
): YoutubeV2Generation['items'] {
  const items = db.prepare(`
SELECT
  gi.rail_id, gi.rank, gi.score, gi.reason, gi.provenance, gi.provenance_ref,
  gi.source_expires_at, gi.context_id, yi.id, yi.kind, yi.title, yi.subtitle, yi.description,
  yi.thumbnail, yi.channel_id, yi.channel_title, yi.published_at,
  yi.duration_sec, yi.live_status, yi.playlist_id, yi.category_id, yi.default_language,
  yi.default_audio_language, yi.tags_json, yi.official_metadata_checked_at, yi.updated_at
FROM youtube_v2_generation_items gi
JOIN youtube_items yi ON yi.kind = gi.kind AND yi.id = gi.id
WHERE gi.generation = ?
ORDER BY gi.rail_id, gi.rank
`).all(generation) as Array<YoutubeV2Generation['items'][number] & { tags_json?: string }>;
  return items.map((entry) => ({ ...entry, ...youtubeItemFromRow(entry) }));
}

function youtubeV2GenerationValue(
  generation: YoutubeV2GenerationRecord,
  items: YoutubeV2Generation['items'],
): YoutubeV2Generation {
  const { status: _status, ...ready } = generation;
  return freezeYoutubeV2Generation({ ...ready, items });
}

export function latestYoutubeV2GenerationRecord(): YoutubeV2GenerationRecord | null {
  return readLatestYoutubeV2GenerationRecord(ensureDb());
}

export function latestYoutubeV2Generation(): YoutubeV2Generation | null {
  const db = ensureDb();
  const dbPath = youtubeDbPath();
  const dataVersion = youtubeDbDataVersion(db);
  const latest = readLatestYoutubeV2GenerationRecord(db);
  if (!latest || latest.status !== 'ready') return null;
  if (latestGenerationSnapshot?.db_path === dbPath
    && latestGenerationSnapshot.generation === latest.generation
    && latestGenerationSnapshot.data_version === dataVersion) {
    return latestGenerationSnapshot.value;
  }

  // A second process is not part of the normal serving path, but operators and
  // maintenance can legitimately open this rebuildable database. Retry a
  // cache fill if such a commit races the two-table generation read, rather
  // than pinning a mixed snapshot to the newer data_version indefinitely.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const versionBefore = youtubeDbDataVersion(db);
    const generation = readLatestYoutubeV2GenerationRecord(db);
    if (!generation || generation.status !== 'ready') {
      if (versionBefore === youtubeDbDataVersion(db)) return null;
      continue;
    }
    const items = readYoutubeV2GenerationItems(db, generation.generation);
    const versionAfter = youtubeDbDataVersion(db);
    if (versionBefore !== versionAfter) continue;
    const value = youtubeV2GenerationValue(generation, items);
    latestGenerationSnapshot = {
      db_path: dbPath,
      generation: generation.generation,
      data_version: versionAfter,
      item_keys: new Set(value.items.map((item) => `${item.kind}:${item.id}`)),
      value,
    };
    return value;
  }

  // Sustained external writes should not make Home disappear. Return one
  // coherent SQLite read without caching it; the next request can try again.
  return db.transaction(() => {
    const generation = readLatestYoutubeV2GenerationRecord(db);
    if (!generation || generation.status !== 'ready') return null;
    return youtubeV2GenerationValue(
      generation,
      readYoutubeV2GenerationItems(db, generation.generation),
    );
  })();
}

export const YOUTUBE_V2_SERVING_POLICY_VERSION = 'independent_weighted_v1';

export function youtubeV2ServingEpoch(
  generation: number | null,
  advance: boolean,
): {
  generation: number | null;
  shuffle_epoch: number;
  slate_sequence: number;
  serving_policy: string;
} {
  type ServingEpoch = {
    generation: number | null;
    shuffle_epoch: number;
    slate_sequence: number;
    serving_policy: string;
  };
  const db = ensureDb();
  const key = 'youtube_v2_serving_epoch';
  return db.transaction(() => {
    const row = db.prepare('SELECT value FROM youtube_state WHERE key = ?').get(key) as { value: string } | undefined;
    let current: ServingEpoch | null = null;
    if (row) {
      try {
        const value = JSON.parse(row.value) as Partial<ServingEpoch>;
        if (Number.isInteger(value.shuffle_epoch) && Number.isInteger(value.slate_sequence)) {
          current = {
            generation: Number.isInteger(value.generation) ? Number(value.generation) : null,
            shuffle_epoch: Math.max(0, Number(value.shuffle_epoch)),
            slate_sequence: Math.max(0, Number(value.slate_sequence)),
            serving_policy: typeof value.serving_policy === 'string' ? value.serving_policy : '',
          };
        }
      } catch {
        current = null;
      }
    }
    const next: ServingEpoch = current === null
      ? {
          generation,
          shuffle_epoch: advance ? 1 : 0,
          slate_sequence: 1,
          serving_policy: YOUTUBE_V2_SERVING_POLICY_VERSION,
        }
      : current.serving_policy !== YOUTUBE_V2_SERVING_POLICY_VERSION
        ? {
            generation,
            shuffle_epoch: 0,
            slate_sequence: current.slate_sequence + 1,
            serving_policy: YOUTUBE_V2_SERVING_POLICY_VERSION,
          }
      : current.generation !== generation
        ? {
            generation,
            shuffle_epoch: 0,
            slate_sequence: current.slate_sequence + 1,
            serving_policy: YOUTUBE_V2_SERVING_POLICY_VERSION,
          }
        : advance
          ? {
              generation,
              shuffle_epoch: current.shuffle_epoch + 1,
              slate_sequence: current.slate_sequence + 1,
              serving_policy: YOUTUBE_V2_SERVING_POLICY_VERSION,
            }
          : current;
    if (next !== current) {
      db.prepare(`
INSERT INTO youtube_state(key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`).run(key, JSON.stringify(next), nowMs());
    }
    return next;
  })();
}

export function youtubeCacheSummary(): {
  videos: number;
  channels: number;
  playlists: number;
  rail_ids: string[];
} {
  const rows = ensureDb().prepare(`
SELECT kind, COUNT(*) AS count
FROM youtube_items
GROUP BY kind;
`).all() as Array<{ kind: YoutubeItemKind; count: number }>;
  const counts = new Map(rows.map((row) => [row.kind, Number(row.count)]));
  return {
    videos: counts.get('video') ?? 0,
    channels: counts.get('channel') ?? 0,
    playlists: counts.get('playlist') ?? 0,
    rail_ids: listYoutubeRailIds(),
  };
}

export type YoutubeAuthSession = {
  session_id: string;
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_at: number;
  interval_sec: number;
  created_at: number;
  last_poll_at: number | null;
  status: string;
};

export function saveYoutubeAuthSession(session: YoutubeAuthSession): void {
  ensureDb().prepare(`
INSERT INTO youtube_auth_sessions (
  session_id, device_code, user_code, verification_url, expires_at,
  interval_sec, created_at, last_poll_at, status
) VALUES (
  @session_id, @device_code, @user_code, @verification_url, @expires_at,
  @interval_sec, @created_at, @last_poll_at, @status
)
ON CONFLICT(session_id) DO UPDATE SET
  last_poll_at = excluded.last_poll_at,
  status = excluded.status;
`).run(session);
}

export function getYoutubeAuthSession(sessionId: string): YoutubeAuthSession | null {
  const row = ensureDb().prepare('SELECT * FROM youtube_auth_sessions WHERE session_id = ?')
    .get(sessionId) as YoutubeAuthSession | undefined;
  return row ?? null;
}

export function updateYoutubeAuthSession(
  sessionId: string,
  patch: { last_poll_at?: number | null; status?: string; interval_sec?: number },
): void {
  const current = getYoutubeAuthSession(sessionId);
  if (!current) {
    return;
  }
  saveYoutubeAuthSession({
    ...current,
    last_poll_at: patch.last_poll_at !== undefined ? patch.last_poll_at : current.last_poll_at,
    status: patch.status ?? current.status,
    interval_sec: patch.interval_sec ?? current.interval_sec,
  });
}

export function deleteYoutubeAuthSession(sessionId: string): void {
  ensureDb().prepare('DELETE FROM youtube_auth_sessions WHERE session_id = ?').run(sessionId);
}
