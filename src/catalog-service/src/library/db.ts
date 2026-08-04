import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { CatalogTab } from '../rails.js';
import { seriesBareId } from '../playability/ids.js';

export const DEFAULT_LIBRARY_DB_PATH = '/etc/mango/library.db';
export const DEFAULT_USER_PINS_PATH = join(process.env.HOME || '/tmp', '.config/mango/user-pins.json');
export const LIBRARY_SOURCE_MANGO = 'mango';
export const LIBRARY_SAVED_RAIL_ID = 'saved';
export const LIBRARY_CONTEXT_ID = 'launcher';
export const LIBRARY_FINISHED_PCT = 0.90;
export const FIRE_WATER_SCHEMA_VERSION = 4;
export const PERSONALIZATION_SCHEMA_VERSION = 5;
export const PROFILE_SIGNALS_SCHEMA_VERSION = 6;
export const RECOMMENDATION_ATTRIBUTION_SCHEMA_VERSION = 7;
export const PROFILE_RECOMMENDATION_METRICS_SCHEMA_VERSION = 8;
export const RECOMMENDATION_SERVED_SLATE_SCHEMA_VERSION = 9;
export const PROFILE_WATCH_STATE_SCHEMA_VERSION = 10;
export const RECOMMENDATION_SERVED_SLATE_CONTEXT_SCHEMA_VERSION = 11;
const VOD_REWATCH_SIGNAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const RECOMMENDATION_SERVED_SLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type LibrarySource = string;

export type LibraryItemInput = {
  source?: LibrarySource;
  type: string;
  id: string;
  title?: string | null;
  poster?: string | null;
  year?: string | number | null;
  description?: string | null;
  tab?: CatalogTab | null;
};

export type SavedLibraryItem = {
  source: string;
  item_key: string;
  type: string;
  id: string;
  title: string;
  poster: string | null;
  year: string | null;
  description: string | null;
  tab: CatalogTab;
  saved_at: number;
  saved_by: string;
};

export type LibraryState = {
  source: string;
  item_key: string;
  type: string;
  id: string;
  title: string | null;
  poster: string | null;
  tab: CatalogTab;
  saved: boolean;
  saved_at: number | null;
  latest_watch: WatchState | null;
  finished: boolean;
  finished_at: number | null;
  hidden: boolean;
  hidden_at: number | null;
  hide_reason: string | null;
  blocked: boolean;
  blocked_at: number | null;
  block_reason: string | null;
};

export type LibraryFeedbackRow = {
  source: string;
  item_key: string;
  type: string;
  id: string;
  title: string | null;
  poster: string | null;
  tab: string | null;
  feedback: string;
  reason: string | null;
  created_at: number;
  updated_at: number;
};

export type ProfileLibraryFeedbackRow = LibraryFeedbackRow & {
  profile_id: string;
};

export type SearchSafeSearch = 'moderate' | 'strict' | 'none';

export type SearchHistoryRow = {
  normalized_query: string;
  display_query: string;
  last_searched_at: number;
  search_count: number;
};

export type SearchSelectionRow = {
  normalized_query: string;
  entity_key: string;
  source: string;
  type: string;
  id: string;
  title: string;
  selected_at: number;
  selection_count: number;
};

export type SearchPreferences = {
  youtube_safe_search: SearchSafeSearch;
  updated_at: number;
};

export type SearchStarterItem = {
  source: string;
  type: string;
  id: string;
  title: string;
  poster: string | null;
  tab: CatalogTab;
  activity_at: number;
};

export type ViewerProfile = {
  profile_id: string;
  name: string;
  kind: 'household' | 'personal';
  onboarding_complete: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type PersonalizationState = {
  active_profile_id: string;
  mood: string | null;
  mood_started_at: number | null;
  mood_expires_at: number | null;
  updated_at: number;
};

export type ProfileRecommendationEvent = {
  event_id: number;
  profile_id: string;
  domain: 'vod' | 'youtube';
  event_type: string;
  item_type: string;
  item_id: string;
  title: string | null;
  strength: number;
  context: Record<string, unknown>;
  occurred_at: number;
};

export type ProfileRecommendationSignal = {
  domain: 'vod' | 'youtube';
  item_type: string;
  item_id: string;
  title: string | null;
  watched: boolean;
  saved: boolean;
  not_interested: boolean;
  last_not_interested_at: number;
  strongest_positive: number;
  last_positive_at: number;
  last_event_at: number;
};

export type RecommendationAttribution = {
  profile_id: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  item_type: string;
  item_id: string;
  detail_opened_at: number | null;
  play_started_at: number | null;
  max_progress_pct: number;
  completed_at: number | null;
  updated_at: number;
};

export type RecommendationLibrarySignal = {
  type: string;
  id: string;
  saved: boolean;
  started: boolean;
  completed: boolean;
  hidden: boolean;
  blocked: boolean;
  not_interested: boolean;
};

export type WatchState = {
  play_id: string | null;
  position_sec: number;
  duration_sec: number;
  progress_pct: number;
  last_watched_at: number;
};

export type WatchHistoryRow = {
  history_id: number;
  source: string;
  item_key: string;
  type: string;
  id: string;
  play_id: string | null;
  title: string | null;
  poster: string | null;
  position_sec: number;
  duration_sec: number;
  progress_pct: number;
  event: string;
  watched_at: number;
};

export type LibraryContext = {
  profile_id: string;
  source: string;
  item_key: string;
  type: string;
  id: string;
  title: string;
  poster: string | null;
  tab: CatalogTab;
  updated_at: number;
};

type LegacyPin = {
  tab?: CatalogTab;
  type?: string;
  id?: string;
  title?: string;
  poster?: string;
  pinned_at?: number;
};

type SavedRow = SavedLibraryItem;

type StateRow = {
  source: string;
  item_key: string;
  type: string;
  id: string;
  title: string | null;
  poster: string | null;
  tab: CatalogTab | null;
  saved_at: number | null;
  saved_by: string | null;
  latest_play_id: string | null;
  position_sec: number | null;
  duration_sec: number | null;
  progress_pct: number | null;
  last_watched_at: number | null;
  finished_at: number | null;
  hidden: number | null;
  hidden_at: number | null;
  hide_reason: string | null;
  blocked: number | null;
  blocked_at: number | null;
  block_reason: string | null;
};

type FeedbackRow = LibraryFeedbackRow;

let dbSingleton: Database.Database | null = null;
let initialized = false;

export function resetLibraryDbForTests(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  initialized = false;
}

export function libraryDbPath(): string {
  return process.env.MANGO_LIBRARY_DB_PATH || DEFAULT_LIBRARY_DB_PATH;
}

export function legacyPinsPath(): string {
  return process.env.MANGO_USER_PINS_PATH?.trim() || DEFAULT_USER_PINS_PATH;
}

function openDb(): Database.Database {
  if (!dbSingleton) {
    mkdirSync(dirname(libraryDbPath()), { recursive: true });
    dbSingleton = new Database(libraryDbPath());
  }
  return dbSingleton;
}

function normalizeSource(source: string | undefined | null): string {
  const normalized = (source || LIBRARY_SOURCE_MANGO).trim().toLowerCase();
  return normalized || LIBRARY_SOURCE_MANGO;
}

export function normalizeLibraryType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'film') return 'movie';
  if (normalized === 'channel' || normalized === 'live') return 'tv';
  return normalized || 'movie';
}

function normalizeLibraryId(type: string, id: string): string {
  const trimmed = id.trim();
  if (normalizeLibraryType(type).startsWith('youtube_')) {
    return trimmed;
  }
  if (normalizeLibraryType(type) === 'series') {
    return (seriesBareId(trimmed) ?? trimmed).toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function libraryItemKey(source: string | undefined, type: string, id: string): string {
  return `${normalizeSource(source)}:${normalizeLibraryType(type)}:${normalizeLibraryId(type, id)}`;
}

export function libraryTabForType(type: string, fallback?: CatalogTab | null): CatalogTab {
  if (fallback === 'movies' || fallback === 'series' || fallback === 'live' || fallback === 'youtube') {
    return fallback;
  }
  const normalized = normalizeLibraryType(type);
  if (normalized === 'series') return 'series';
  if (normalized === 'tv') return 'live';
  return 'movies';
}

function nowMs(): number {
  return Date.now();
}

function progressPct(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(positionSec) || !Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, positionSec / durationSec));
}

function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
CREATE TABLE IF NOT EXISTS library_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_items (
  item_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT,
  poster TEXT,
  year TEXT,
  description TEXT,
  tab TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER,
  hide_reason TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  blocked_at INTEGER,
  block_reason TEXT,
  first_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source, type, id)
);

CREATE TABLE IF NOT EXISTS saved_items (
  item_key TEXT PRIMARY KEY REFERENCES library_items(item_key) ON DELETE CASCADE,
  saved_at INTEGER NOT NULL,
  saved_by TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS watch_state (
  item_key TEXT PRIMARY KEY REFERENCES library_items(item_key) ON DELETE CASCADE,
  latest_play_id TEXT,
  position_sec REAL NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  progress_pct REAL NOT NULL DEFAULT 0,
  last_watched_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS watch_history (
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL REFERENCES library_items(item_key) ON DELETE CASCADE,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  play_id TEXT,
  title TEXT,
  poster TEXT,
  position_sec REAL NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  progress_pct REAL NOT NULL DEFAULT 0,
  event TEXT NOT NULL,
  watched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_context (
  context_id TEXT PRIMARY KEY,
  item_key TEXT NOT NULL REFERENCES library_items(item_key) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_imports (
  import_name TEXT PRIMARY KEY,
  source_path TEXT,
  imported_at INTEGER NOT NULL,
  item_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_items_source_type_id ON library_items(source, type, id);
CREATE INDEX IF NOT EXISTS idx_library_items_tab ON library_items(tab, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_items_saved_at ON saved_items(saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_history_item ON watch_history(item_key, watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_history_watched_at ON watch_history(watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_state_last_watched ON watch_state(last_watched_at DESC);
`);
  db.prepare(`
INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (1, ?)
`).run(nowMs());
  applyLibraryMigrations(db);
}

function applyLibraryMigrations(db: Database.Database): void {
  // Schema, data backfills, and their version markers are one atomic startup
  // commit. Every statement is idempotent for crash recovery, but atomicity
  // prevents a later migration failure from leaving an unmarked partial graph.
  const migrate = db.transaction(() => {
  const migrated = new Set(
    (db.prepare('SELECT version FROM library_migrations').all() as Array<{ version: number }>)
      .map((row) => row.version),
  );
  if (!migrated.has(2)) {
    db.exec(`
CREATE TABLE IF NOT EXISTS library_feedback (
  item_key TEXT NOT NULL REFERENCES library_items(item_key) ON DELETE CASCADE,
  feedback TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(item_key, feedback)
);
CREATE INDEX IF NOT EXISTS idx_library_feedback_feedback ON library_feedback(feedback, updated_at DESC);
`);
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (2, ?)')
      .run(nowMs());
  }
  if (!migrated.has(3)) {
    db.exec(`
CREATE TABLE IF NOT EXISTS search_history (
  normalized_query TEXT PRIMARY KEY,
  display_query TEXT NOT NULL,
  last_searched_at INTEGER NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_search_history_recent
  ON search_history(last_searched_at DESC);

CREATE TABLE IF NOT EXISTS search_selections (
  normalized_query TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  selected_at INTEGER NOT NULL,
  selection_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(normalized_query, entity_key)
);
CREATE INDEX IF NOT EXISTS idx_search_selections_recent
  ON search_selections(selected_at DESC);

CREATE TABLE IF NOT EXISTS search_preferences (
  preferences_id INTEGER PRIMARY KEY CHECK(preferences_id = 1),
  youtube_safe_search TEXT NOT NULL DEFAULT 'moderate'
    CHECK(youtube_safe_search IN ('moderate', 'strict', 'none')),
  updated_at INTEGER NOT NULL
);
`);
    db.prepare(`
INSERT OR IGNORE INTO search_preferences(preferences_id, youtube_safe_search, updated_at)
VALUES (1, 'moderate', ?)
`).run(nowMs());
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (3, ?)')
      .run(nowMs());
  }
  if (!migrated.has(FIRE_WATER_SCHEMA_VERSION)) {
    db.exec(`
CREATE TABLE IF NOT EXISTS content_ratings (
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  title TEXT NOT NULL,
  year TEXT,
  fire_steps INTEGER NOT NULL CHECK(fire_steps BETWEEN 0 AND 10),
  water_steps INTEGER NOT NULL CHECK(water_steps BETWEEN 0 AND 10),
  origin TEXT NOT NULL CHECK(origin IN ('seed', 'couch')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  seed_manifest TEXT,
  seed_manifest_hash TEXT,
  caption_hash TEXT,
  taste_tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(content_type, content_id)
);

CREATE TABLE IF NOT EXISTS content_rating_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('set', 'edit', 'clear', 'import')),
  origin TEXT NOT NULL CHECK(origin IN ('seed', 'couch')),
  previous_fire_steps INTEGER,
  previous_water_steps INTEGER,
  fire_steps INTEGER,
  water_steps INTEGER,
  revision INTEGER NOT NULL,
  manifest_name TEXT,
  manifest_hash TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_rating_events_identity
  ON content_rating_events(content_type, content_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS rating_prompt_state (
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  eligible_at INTEGER,
  presented_at INTEGER,
  disposition TEXT CHECK(disposition IN ('dismissed', 'rated', 'left_detail')),
  resolved_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(content_type, content_id)
);

CREATE TABLE IF NOT EXISTS rating_seed_imports (
  manifest_name TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  imported_count INTEGER NOT NULL,
  skipped_couch_count INTEGER NOT NULL,
  PRIMARY KEY(manifest_name, manifest_hash)
);

CREATE TABLE IF NOT EXISTS recommendation_features (
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK(provenance IN ('metadata', 'ai', 'seed')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  features_json TEXT NOT NULL,
  model_version TEXT,
  prompt_version TEXT,
  input_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(content_type, content_id, feature_version)
);

CREATE TABLE IF NOT EXISTS household_taste_snapshots (
  snapshot_version INTEGER PRIMARY KEY AUTOINCREMENT,
  model_version TEXT NOT NULL,
  ratings_hash TEXT NOT NULL,
  taste_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  tab TEXT NOT NULL CHECK(tab IN ('movies', 'series')),
  revision INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  model_kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready', 'fallback')),
  candidate_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  daily_seed TEXT NOT NULL,
  PRIMARY KEY(tab, revision)
);

CREATE TABLE IF NOT EXISTS recommendation_snapshot_items (
  tab TEXT NOT NULL,
  revision INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  title TEXT NOT NULL,
  poster TEXT,
  year TEXT,
  bucket TEXT NOT NULL CHECK(bucket IN ('close', 'adjacent', 'explore', 'fallback')),
  affinity REAL NOT NULL,
  diversity REAL NOT NULL,
  predicted_fire REAL NOT NULL,
  predicted_water REAL NOT NULL,
  generation_reason TEXT NOT NULL,
  PRIMARY KEY(tab, revision, rank),
  FOREIGN KEY(tab, revision) REFERENCES recommendation_snapshots(tab, revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recommendation_snapshot_items_identity
  ON recommendation_snapshot_items(content_type, content_id);

CREATE TABLE IF NOT EXISTS recommendation_metrics (
  metric_name TEXT PRIMARY KEY,
  metric_value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(FIRE_WATER_SCHEMA_VERSION, nowMs());
  }
  if (!migrated.has(PERSONALIZATION_SCHEMA_VERSION)) {
    const timestamp = nowMs();
    db.exec(`
CREATE TABLE IF NOT EXISTS viewer_profiles (
  profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('household', 'personal')),
  onboarding_complete INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personalization_state (
  state_id INTEGER PRIMARY KEY CHECK(state_id = 1),
  active_profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id),
  mood TEXT,
  mood_started_at INTEGER,
  mood_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_content_ratings (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  title TEXT NOT NULL,
  year TEXT,
  fire_steps INTEGER NOT NULL CHECK(fire_steps BETWEEN 0 AND 10),
  water_steps INTEGER NOT NULL CHECK(water_steps BETWEEN 0 AND 10),
  origin TEXT NOT NULL CHECK(origin IN ('seed', 'couch')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  seed_manifest TEXT,
  seed_manifest_hash TEXT,
  caption_hash TEXT,
  taste_tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, content_type, content_id)
);

CREATE TABLE IF NOT EXISTS profile_content_rating_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('set', 'edit', 'clear', 'import')),
  origin TEXT NOT NULL CHECK(origin IN ('seed', 'couch')),
  previous_fire_steps INTEGER,
  previous_water_steps INTEGER,
  fire_steps INTEGER,
  water_steps INTEGER,
  revision INTEGER NOT NULL,
  manifest_name TEXT,
  manifest_hash TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_rating_events_identity
  ON profile_content_rating_events(profile_id, content_type, content_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS profile_rating_prompt_state (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  eligible_at INTEGER,
  presented_at INTEGER,
  disposition TEXT CHECK(disposition IN ('dismissed', 'rated', 'left_detail')),
  resolved_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, content_type, content_id)
);

CREATE TABLE IF NOT EXISTS profile_recommendation_snapshots (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  tab TEXT NOT NULL CHECK(tab IN ('movies', 'series')),
  revision INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  model_kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready', 'fallback')),
  candidate_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  daily_seed TEXT NOT NULL,
  PRIMARY KEY(profile_id, tab, revision)
);

CREATE TABLE IF NOT EXISTS profile_recommendation_snapshot_items (
  profile_id TEXT NOT NULL,
  tab TEXT NOT NULL,
  revision INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'series')),
  content_id TEXT NOT NULL,
  title TEXT NOT NULL,
  poster TEXT,
  year TEXT,
  bucket TEXT NOT NULL CHECK(bucket IN ('close', 'adjacent', 'explore', 'fallback')),
  affinity REAL NOT NULL,
  diversity REAL NOT NULL,
  predicted_fire REAL NOT NULL,
  predicted_water REAL NOT NULL,
  generation_reason TEXT NOT NULL,
  PRIMARY KEY(profile_id, tab, revision, rank),
  FOREIGN KEY(profile_id, tab, revision)
    REFERENCES profile_recommendation_snapshots(profile_id, tab, revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_profile_recommendation_identity
  ON profile_recommendation_snapshot_items(profile_id, content_type, content_id);

CREATE TABLE IF NOT EXISTS profile_recommendation_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('vod', 'youtube')),
  event_type TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT,
  strength REAL NOT NULL DEFAULT 0,
  context_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_recommendation_events_recent
  ON profile_recommendation_events(profile_id, occurred_at DESC);
`);
    db.prepare(`
INSERT OR IGNORE INTO viewer_profiles(
  profile_id, name, kind, onboarding_complete, sort_order, created_at, updated_at
) VALUES ('household', 'Household', 'household', 1, 0, ?, ?)
`).run(timestamp, timestamp);
    db.prepare(`
INSERT OR IGNORE INTO personalization_state(
  state_id, active_profile_id, mood, mood_started_at, mood_expires_at, updated_at
) VALUES (1, 'household', NULL, NULL, NULL, ?)
`).run(timestamp);
    db.exec(`
INSERT OR IGNORE INTO profile_content_ratings
SELECT 'household', content_type, content_id, title, year, fire_steps, water_steps,
       origin, revision, seed_manifest, seed_manifest_hash, caption_hash,
       taste_tags_json, created_at, updated_at
FROM content_ratings;

INSERT OR IGNORE INTO profile_content_rating_events(
  event_id, profile_id, content_type, content_id, action, origin,
  previous_fire_steps, previous_water_steps, fire_steps, water_steps, revision,
  manifest_name, manifest_hash, occurred_at
)
SELECT event_id, 'household', content_type, content_id, action, origin,
       previous_fire_steps, previous_water_steps, fire_steps, water_steps, revision,
       manifest_name, manifest_hash, occurred_at
FROM content_rating_events;

INSERT OR IGNORE INTO profile_rating_prompt_state
SELECT 'household', content_type, content_id, eligible_at, presented_at,
       disposition, resolved_at, updated_at
FROM rating_prompt_state;

INSERT OR IGNORE INTO profile_recommendation_snapshots
SELECT 'household', tab, revision, model_version, model_kind, status,
       candidate_count, generated_at, daily_seed
FROM recommendation_snapshots;

INSERT OR IGNORE INTO profile_recommendation_snapshot_items
SELECT 'household', tab, revision, rank, content_type, content_id, title, poster,
       year, bucket, affinity, diversity, predicted_fire, predicted_water,
       generation_reason
FROM recommendation_snapshot_items;
`);
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(PERSONALIZATION_SCHEMA_VERSION, timestamp);
  }
  if (!migrated.has(PROFILE_SIGNALS_SCHEMA_VERSION)) {
    const timestamp = nowMs();
    db.exec(`
CREATE TABLE IF NOT EXISTS profile_saved_items (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  item_key TEXT NOT NULL REFERENCES library_items(item_key) ON DELETE CASCADE,
  saved_at INTEGER NOT NULL,
  saved_by TEXT NOT NULL DEFAULT 'user',
  PRIMARY KEY(profile_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_profile_saved_items_recent
  ON profile_saved_items(profile_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS profile_watch_history (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  history_id INTEGER NOT NULL REFERENCES watch_history(history_id) ON DELETE CASCADE,
  PRIMARY KEY(profile_id, history_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_watch_history_profile
  ON profile_watch_history(profile_id, history_id DESC);

CREATE TABLE IF NOT EXISTS profile_library_feedback (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  item_key TEXT NOT NULL REFERENCES library_items(item_key) ON DELETE CASCADE,
  feedback TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, item_key, feedback)
);
CREATE INDEX IF NOT EXISTS idx_profile_library_feedback_lookup
  ON profile_library_feedback(profile_id, feedback, updated_at DESC);

INSERT OR IGNORE INTO profile_saved_items(profile_id, item_key, saved_at, saved_by)
SELECT 'household', item_key, saved_at, saved_by FROM saved_items;

INSERT OR IGNORE INTO profile_watch_history(profile_id, history_id)
SELECT 'household', history_id FROM watch_history;

INSERT OR IGNORE INTO profile_library_feedback(
  profile_id, item_key, feedback, reason, created_at, updated_at
)
SELECT 'household', item_key, feedback, reason, created_at, updated_at
FROM library_feedback;

INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title,
  strength, context_json, occurred_at
)
SELECT
  'household',
  CASE WHEN wh.source = 'youtube' THEN 'youtube' ELSE 'vod' END,
  wh.event,
  wh.type,
  wh.id,
  COALESCE(wh.title, li.title),
  CASE
    WHEN wh.progress_pct >= 0.9 THEN 1.0
    WHEN wh.progress_pct >= 0.25 THEN 0.55
    ELSE 0.05
  END,
  json_object(
    'legacy_history_id', wh.history_id,
    'play_id', wh.play_id,
    'position_sec', wh.position_sec,
    'duration_sec', wh.duration_sec,
    'progress_pct', wh.progress_pct
  ),
  wh.watched_at
FROM watch_history wh
JOIN library_items li ON li.item_key = wh.item_key
WHERE NOT EXISTS (
  SELECT 1 FROM profile_recommendation_events pre
  WHERE pre.profile_id = 'household'
    AND pre.domain = CASE WHEN wh.source = 'youtube' THEN 'youtube' ELSE 'vod' END
    AND pre.event_type = wh.event
    AND pre.item_type = wh.type
    AND pre.item_id = wh.id
    AND pre.occurred_at = wh.watched_at
);

INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title,
  strength, context_json, occurred_at
)
SELECT
  'household',
  CASE WHEN li.source = 'youtube' THEN 'youtube' ELSE 'vod' END,
  'saved', li.type, li.id, li.title, 0.8,
  json_object('legacy_item_key', li.item_key), si.saved_at
FROM saved_items si
JOIN library_items li ON li.item_key = si.item_key
WHERE NOT EXISTS (
  SELECT 1 FROM profile_recommendation_events pre
  WHERE pre.profile_id = 'household'
    AND pre.event_type = 'saved'
    AND pre.item_type = li.type
    AND pre.item_id = li.id
    AND pre.occurred_at = si.saved_at
);

INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title,
  strength, context_json, occurred_at
)
SELECT
  'household',
  CASE WHEN li.source = 'youtube' THEN 'youtube' ELSE 'vod' END,
  CASE WHEN lf.feedback = 'not_interested' THEN 'not_interested' ELSE 'feedback:' || lf.feedback END,
  li.type, li.id, li.title,
  CASE WHEN lf.feedback = 'not_interested' THEN -1.0 ELSE 0.0 END,
  json_object('reason', lf.reason, 'legacy_item_key', li.item_key),
  lf.updated_at
FROM library_feedback lf
JOIN library_items li ON li.item_key = lf.item_key
WHERE NOT EXISTS (
  SELECT 1 FROM profile_recommendation_events pre
  WHERE pre.profile_id = 'household'
    AND pre.event_type = CASE
      WHEN lf.feedback = 'not_interested' THEN 'not_interested'
      ELSE 'feedback:' || lf.feedback
    END
    AND pre.item_type = li.type
    AND pre.item_id = li.id
    AND pre.occurred_at = lf.updated_at
);
`);
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(PROFILE_SIGNALS_SCHEMA_VERSION, timestamp);
  }
  if (!migrated.has(RECOMMENDATION_ATTRIBUTION_SCHEMA_VERSION)) {
    const timestamp = nowMs();
    db.exec(`
CREATE TABLE IF NOT EXISTS profile_recommendation_impressions (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('vod', 'youtube')),
  rail_id TEXT NOT NULL,
  slate_revision INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  shown_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, domain, rail_id, slate_revision, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_recommendation_impressions_recent
  ON profile_recommendation_impressions(profile_id, shown_at DESC);

CREATE TABLE IF NOT EXISTS profile_recommendation_outcomes (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('vod', 'youtube')),
  rail_id TEXT NOT NULL,
  slate_revision INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  detail_opened_at INTEGER,
  play_started_at INTEGER,
  max_progress_pct REAL NOT NULL DEFAULT 0,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, domain, rail_id, slate_revision, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_recommendation_outcomes_recent
  ON profile_recommendation_outcomes(profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_runtime_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(RECOMMENDATION_ATTRIBUTION_SCHEMA_VERSION, timestamp);
  }
  if (!migrated.has(PROFILE_RECOMMENDATION_METRICS_SCHEMA_VERSION)) {
    const timestamp = nowMs();
    db.exec(`
CREATE TABLE IF NOT EXISTS profile_recommendation_metrics (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, metric_name)
);
CREATE INDEX IF NOT EXISTS idx_profile_recommendation_metrics_updated
  ON profile_recommendation_metrics(profile_id, updated_at DESC);
`);
    // Legacy recommendation_metrics rows are intentionally not copied: their
    // historical values cannot be attributed to a viewer profile safely.
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(PROFILE_RECOMMENDATION_METRICS_SCHEMA_VERSION, timestamp);
  }
  if (!migrated.has(RECOMMENDATION_SERVED_SLATE_SCHEMA_VERSION)) {
    const timestamp = nowMs();
    db.exec(`
CREATE TABLE IF NOT EXISTS profile_recommendation_served_slates (
  attribution_token TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('vod', 'youtube')),
  rail_id TEXT NOT NULL,
  slate_revision INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(profile_id, domain, rail_id, slate_revision)
);
CREATE INDEX IF NOT EXISTS idx_profile_recommendation_served_slates_lookup
  ON profile_recommendation_served_slates(profile_id, domain, rail_id, slate_revision);
CREATE INDEX IF NOT EXISTS idx_profile_recommendation_served_slates_expiry
  ON profile_recommendation_served_slates(expires_at);

CREATE TABLE IF NOT EXISTS profile_recommendation_served_items (
  attribution_token TEXT NOT NULL REFERENCES profile_recommendation_served_slates(attribution_token) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY(attribution_token, item_type, item_id),
  UNIQUE(attribution_token, rank)
);
`);
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(RECOMMENDATION_SERVED_SLATE_SCHEMA_VERSION, timestamp);
  }
  if (!migrated.has(PROFILE_WATCH_STATE_SCHEMA_VERSION)) {
    const timestamp = nowMs();
    db.exec(`
CREATE TABLE IF NOT EXISTS profile_watch_state (
  profile_id TEXT NOT NULL REFERENCES viewer_profiles(profile_id) ON DELETE CASCADE,
  item_key TEXT NOT NULL REFERENCES library_items(item_key) ON DELETE CASCADE,
  latest_play_id TEXT,
  position_sec REAL NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  progress_pct REAL NOT NULL DEFAULT 0,
  last_watched_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY(profile_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_profile_watch_state_recent
  ON profile_watch_state(profile_id, last_watched_at DESC);

-- A pre-profile watch_state row has exactly one safe owner. Preserve the
-- legacy table unchanged for rollback and copy it once into Household.
INSERT OR IGNORE INTO profile_watch_state(
  profile_id, item_key, latest_play_id, position_sec, duration_sec,
  progress_pct, last_watched_at, finished_at
)
SELECT
  'household', item_key, latest_play_id, position_sec, duration_sec,
  progress_pct, last_watched_at, finished_at
FROM watch_state;

-- If profiles were already exercised while this feature branch was in
-- development, their mapped history still gives us an unambiguous latest
-- position. Backfill those personal rows without reassigning legacy state.
INSERT OR IGNORE INTO profile_watch_state(
  profile_id, item_key, latest_play_id, position_sec, duration_sec,
  progress_pct, last_watched_at, finished_at
)
WITH ranked AS (
  SELECT
    pwh.profile_id,
    wh.item_key,
    wh.play_id,
    wh.position_sec,
    wh.duration_sec,
    wh.progress_pct,
    wh.watched_at,
    wh.history_id,
    ROW_NUMBER() OVER (
      PARTITION BY pwh.profile_id, wh.item_key
      ORDER BY wh.watched_at DESC, wh.history_id DESC
    ) AS state_rank,
    MAX(CASE WHEN wh.progress_pct >= 0.9 THEN wh.watched_at END) OVER (
      PARTITION BY pwh.profile_id, wh.item_key
    ) AS finished_at
  FROM profile_watch_history pwh
  JOIN watch_history wh ON wh.history_id = pwh.history_id
  WHERE pwh.profile_id != 'household'
)
SELECT
  profile_id, item_key, play_id, position_sec, duration_sec,
  progress_pct, watched_at, finished_at
FROM ranked
WHERE state_rank = 1;
`);
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(PROFILE_WATCH_STATE_SCHEMA_VERSION, timestamp);
  }
  if (!migrated.has(RECOMMENDATION_SERVED_SLATE_CONTEXT_SCHEMA_VERSION)) {
    const timestamp = nowMs();
    const columns = db.prepare('PRAGMA table_info(profile_recommendation_served_slates)')
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'context_id')) {
      db.exec(`
ALTER TABLE profile_recommendation_served_slates
ADD COLUMN context_id TEXT NOT NULL DEFAULT '';
`);
    }
    db.prepare('INSERT OR IGNORE INTO library_migrations(version, applied_at) VALUES (?, ?)')
      .run(RECOMMENDATION_SERVED_SLATE_CONTEXT_SCHEMA_VERSION, timestamp);
  }
  });
  migrate.immediate();
}

function ensureDb(): Database.Database {
  const db = openDb();
  if (!initialized) {
    initSchema(db);
    importLegacyPinsOnce(db);
    initialized = true;
  }
  return db;
}

export function initLibraryDb(): void {
  ensureDb();
}

/** Internal transactional handle for modules that extend the canonical library schema. */
export function libraryDatabase(): Database.Database {
  return ensureDb();
}

export function listViewerProfiles(): ViewerProfile[] {
  const rows = ensureDb().prepare(`
SELECT profile_id, name, kind, onboarding_complete, sort_order, created_at, updated_at
FROM viewer_profiles
ORDER BY sort_order, created_at, profile_id
`).all() as Array<Omit<ViewerProfile, 'onboarding_complete'> & { onboarding_complete: number }>;
  return rows.map((row) => ({ ...row, onboarding_complete: Boolean(row.onboarding_complete) }));
}

function normalizeViewerProfileId(profileIdInput: string): string {
  return profileIdInput.trim().toLowerCase().slice(0, 32);
}

function normalizeViewerProfileName(nameInput: string): string {
  return nameInput.trim().replace(/\s+/g, ' ').slice(0, 32);
}

export function getViewerProfile(profileIdInput: string): ViewerProfile | null {
  const profileId = normalizeViewerProfileId(profileIdInput);
  if (!profileId) return null;
  return listViewerProfiles().find((profile) => profile.profile_id === profileId) ?? null;
}

export function activeViewerProfileId(): string {
  const row = ensureDb().prepare(`
SELECT active_profile_id FROM personalization_state WHERE state_id = 1
`).get() as { active_profile_id?: string } | undefined;
  return row?.active_profile_id || 'household';
}

export function getPersonalizationState(at = nowMs()): PersonalizationState {
  const db = ensureDb();
  const row = db.prepare(`
SELECT active_profile_id, mood, mood_started_at, mood_expires_at, updated_at
FROM personalization_state WHERE state_id = 1
`).get() as PersonalizationState;
  if (row.mood_expires_at !== null && row.mood_expires_at <= at) {
    db.prepare(`
UPDATE personalization_state
SET mood = NULL, mood_started_at = NULL, mood_expires_at = NULL,
    updated_at = MAX(updated_at + 1, ?)
WHERE state_id = 1
`).run(at);
    return getPersonalizationState(at);
  }
  return row;
}

export function createViewerProfile(nameInput: string): ViewerProfile {
  const db = ensureDb();
  const name = normalizeViewerProfileName(nameInput);
  if (!name) throw new Error('profile name is required');
  if (listViewerProfiles().filter((profile) => profile.kind === 'personal').length >= 7) {
    throw new Error('profile limit reached');
  }
  const duplicateName = db.prepare('SELECT 1 FROM viewer_profiles WHERE LOWER(name) = LOWER(?)').get(name);
  if (duplicateName) throw new Error('profile name already exists');
  const base = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'viewer';
  let profileId = base.slice(0, 32);
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM viewer_profiles WHERE profile_id = ?').get(profileId)) {
    profileId = `${base.slice(0, 27)}-${suffix}`;
    suffix += 1;
  }
  const timestamp = nowMs();
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM viewer_profiles')
    .get() as { value: number }).value;
  db.prepare(`
INSERT INTO viewer_profiles(profile_id, name, kind, onboarding_complete, sort_order, created_at, updated_at)
VALUES (?, ?, 'personal', 0, ?, ?, ?)
`).run(profileId, name, order, timestamp, timestamp);
  return listViewerProfiles().find((profile) => profile.profile_id === profileId)!;
}

export function renameViewerProfile(profileIdInput: string, nameInput: string): ViewerProfile {
  const db = ensureDb();
  const profileId = normalizeViewerProfileId(profileIdInput);
  const name = normalizeViewerProfileName(nameInput);
  if (!profileId) throw new Error('profile id is required');
  if (!name) throw new Error('profile name is required');
  const current = getViewerProfile(profileId);
  if (!current) throw new Error('unknown viewer profile');
  if (current.kind === 'household') throw new Error('Household profile cannot be renamed');
  const duplicateName = db.prepare(`
SELECT 1 FROM viewer_profiles WHERE LOWER(name) = LOWER(?) AND profile_id != ?
`).get(name, profileId);
  if (duplicateName) throw new Error('profile name already exists');
  if (current.name === name) return current;
  const timestamp = nowMs();
  db.prepare('UPDATE viewer_profiles SET name = ?, updated_at = ? WHERE profile_id = ?')
    .run(name, timestamp, profileId);
  return getViewerProfile(profileId)!;
}

export function completeViewerProfileOnboarding(profileIdInput: string): ViewerProfile {
  const db = ensureDb();
  const profileId = normalizeViewerProfileId(profileIdInput);
  if (!profileId) throw new Error('profile id is required');
  const current = getViewerProfile(profileId);
  if (!current) throw new Error('unknown viewer profile');
  // Household is a permanent, already-complete invariant. Keeping this call
  // idempotent makes companion retries safe without reopening setup.
  if (current.onboarding_complete) return current;
  const timestamp = nowMs();
  db.prepare(`
UPDATE viewer_profiles SET onboarding_complete = 1, updated_at = ? WHERE profile_id = ?
`).run(timestamp, profileId);
  return getViewerProfile(profileId)!;
}

export function activateViewerProfile(profileIdInput: string): PersonalizationState {
  const db = ensureDb();
  const profileId = normalizeViewerProfileId(profileIdInput);
  const exists = db.prepare('SELECT 1 FROM viewer_profiles WHERE profile_id = ?').get(profileId);
  if (!exists) throw new Error('unknown viewer profile');
  const timestamp = nowMs();
  db.prepare(`
UPDATE personalization_state
SET active_profile_id = ?, mood = NULL, mood_started_at = NULL,
    mood_expires_at = NULL, updated_at = MAX(updated_at + 1, ?)
WHERE state_id = 1
`).run(profileId, timestamp);
  return getPersonalizationState(timestamp);
}

export function setViewerMood(moodInput: string | null, ttlMs = 4 * 60 * 60 * 1000): PersonalizationState {
  const db = ensureDb();
  const mood = moodInput?.trim().replace(/\s+/g, ' ').slice(0, 80) || null;
  const timestamp = nowMs();
  db.prepare(`
UPDATE personalization_state
SET mood = ?, mood_started_at = ?, mood_expires_at = ?,
    updated_at = MAX(updated_at + 1, ?)
WHERE state_id = 1
`).run(
    mood,
    mood ? timestamp : null,
    mood ? timestamp + Math.max(15 * 60 * 1000, Math.min(12 * 60 * 60 * 1000, ttlMs)) : null,
    timestamp,
  );
  return getPersonalizationState(timestamp);
}

export function appendProfileRecommendationEvent(input: {
  profile_id?: string;
  domain: 'vod' | 'youtube';
  event_type: string;
  item_type: string;
  item_id: string;
  title?: string | null;
  strength?: number;
  context?: Record<string, unknown>;
  occurred_at?: number;
}): number {
  const result = ensureDb().prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    input.profile_id ?? activeViewerProfileId(),
    input.domain,
    input.event_type.trim().slice(0, 40),
    input.item_type.trim().slice(0, 40),
    input.item_id.trim(),
    input.title?.trim() || null,
    Number.isFinite(input.strength) ? Math.max(-1, Math.min(1, input.strength!)) : 0,
    JSON.stringify(input.context ?? {}),
    input.occurred_at ?? nowMs(),
  );
  return Number(result.lastInsertRowid);
}

function parseRecommendationEventContext(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function listProfileRecommendationEvents(options: {
  profile_id?: string;
  domain?: 'vod' | 'youtube';
  event_types?: string[];
  household_blend?: boolean;
  limit?: number;
} = {}): ProfileRecommendationEvent[] {
  const profileId = options.profile_id?.trim().toLowerCase() || activeViewerProfileId();
  const householdBlend = options.household_blend !== false && profileId === 'household';
  const eventTypes = [...new Set((options.event_types ?? [])
    .map((value) => value.trim())
    .filter(Boolean))];
  const params: Record<string, string | number> = {
    profile_id: profileId,
    household_blend: householdBlend ? 1 : 0,
    domain: options.domain ?? '',
    limit: Math.max(1, Math.min(10_000, Math.floor(options.limit ?? 500))),
  };
  const eventTypeClause = eventTypes.length > 0
    ? `AND event_type IN (${eventTypes.map((_, index) => `@event_type_${index}`).join(', ')})`
    : '';
  eventTypes.forEach((eventType, index) => {
    params[`event_type_${index}`] = eventType;
  });
  const rows = ensureDb().prepare(`
SELECT event_id, profile_id, domain, event_type, item_type, item_id, title,
       strength, context_json, occurred_at
FROM profile_recommendation_events
WHERE (@household_blend = 1 OR profile_id = @profile_id)
  AND (@domain = '' OR domain = @domain)
  ${eventTypeClause}
ORDER BY occurred_at DESC, event_id DESC
LIMIT @limit
`).all(params) as Array<Omit<ProfileRecommendationEvent, 'context'> & { context_json: string }>;
  return rows.map(({ context_json, ...row }) => ({
    ...row,
    strength: Number(row.strength),
    context: parseRecommendationEventContext(context_json),
  }));
}

export function clearProfileRecommendationEvents(options: {
  profile_id?: string;
  domain?: 'vod' | 'youtube';
  event_types?: string[];
} = {}): number {
  const profileId = options.profile_id?.trim().toLowerCase() || activeViewerProfileId();
  const eventTypes = [...new Set((options.event_types ?? [])
    .map((value) => value.trim())
    .filter(Boolean))];
  const params: Record<string, string> = {
    profile_id: profileId,
    domain: options.domain ?? '',
  };
  const eventTypeClause = eventTypes.length > 0
    ? `AND event_type IN (${eventTypes.map((_, index) => `@event_type_${index}`).join(', ')})`
    : '';
  eventTypes.forEach((eventType, index) => {
    params[`event_type_${index}`] = eventType;
  });
  return ensureDb().prepare(`
DELETE FROM profile_recommendation_events
WHERE profile_id = @profile_id
  AND (@domain = '' OR domain = @domain)
  ${eventTypeClause}
`).run(params).changes;
}

export function listProfileRecommendationSignals(options: {
  profile_id?: string;
  domain?: 'vod' | 'youtube';
  household_blend?: boolean;
  limit?: number;
} = {}): ProfileRecommendationSignal[] {
  const events = listProfileRecommendationEvents({
    ...options,
    limit: options.limit ?? 10_000,
  });
  type PerProfileState = {
    title: string | null;
    watched: boolean;
    saved: boolean;
    savedKnown: boolean;
    notInterested: boolean;
    feedbackKnown: boolean;
    notInterestedAt: number;
    strongestPositive: number;
    lastPositiveAt: number;
    lastEventAt: number;
  };
  const byItem = new Map<string, {
    domain: 'vod' | 'youtube';
    item_type: string;
    item_id: string;
    profiles: Map<string, PerProfileState>;
  }>();
  for (const event of events) {
    if (event.event_type === 'search') continue;
    const key = `${event.domain}:${event.item_type}:${event.item_id}`;
    let item = byItem.get(key);
    if (!item) {
      item = {
        domain: event.domain,
        item_type: event.item_type,
        item_id: event.item_id,
        profiles: new Map(),
      };
      byItem.set(key, item);
    }
    let state = item.profiles.get(event.profile_id);
    if (!state) {
      state = {
        title: event.title,
        watched: false,
        saved: false,
        savedKnown: false,
        notInterested: false,
        feedbackKnown: false,
        notInterestedAt: 0,
        strongestPositive: 0,
        lastPositiveAt: 0,
        lastEventAt: event.occurred_at,
      };
      item.profiles.set(event.profile_id, state);
    }
    if (!state.title && event.title) state.title = event.title;
    state.lastEventAt = Math.max(state.lastEventAt, event.occurred_at);
    state.strongestPositive = Math.max(state.strongestPositive, event.strength, 0);
    if (event.strength > 0) {
      state.lastPositiveAt = Math.max(state.lastPositiveAt, event.occurred_at);
    }
    if (event.event_type === 'saved' && !state.savedKnown) {
      state.saved = true;
      state.savedKnown = true;
    } else if (event.event_type === 'unsaved' && !state.savedKnown) {
      state.saved = false;
      state.savedKnown = true;
    } else if (event.event_type === 'not_interested' && !state.feedbackKnown) {
      state.notInterested = true;
      state.notInterestedAt = event.occurred_at;
      state.feedbackKnown = true;
    } else if (event.event_type === 'not_interested_cleared' && !state.feedbackKnown) {
      state.notInterested = false;
      state.notInterestedAt = 0;
      state.feedbackKnown = true;
    } else if (!event.event_type.startsWith('feedback:')
      && !event.event_type.startsWith('feedback_cleared:')
      && event.strength >= 0) {
      // A play/start is intentionally a tiny positive. Early exit is never negative.
      state.watched = true;
    }
  }
  return [...byItem.values()].map((item) => {
    const states = [...item.profiles.values()];
    const newest = states.reduce<PerProfileState | null>(
      (current, candidate) => !current || candidate.lastEventAt > current.lastEventAt ? candidate : current,
      null,
    );
    return {
      domain: item.domain,
      item_type: item.item_type,
      item_id: item.item_id,
      title: newest?.title ?? null,
      watched: states.some((state) => state.watched),
      saved: states.some((state) => state.saved),
      // Household aggregation deliberately treats any exact dislike as a veto.
      not_interested: states.some((state) => state.notInterested),
      last_not_interested_at: Math.max(
        0,
        ...states.filter((state) => state.notInterested).map((state) => state.notInterestedAt),
      ),
      strongest_positive: Math.max(0, ...states.map((state) => state.strongestPositive)),
      // Neutral reversals (unsave / feedback clear) must not make old positive
      // evidence look fresh to a dual-horizon ranker.
      last_positive_at: Math.max(0, ...states.map((state) => state.lastPositiveAt)),
      last_event_at: newest?.lastEventAt ?? 0,
    };
  }).sort((left, right) => right.last_event_at - left.last_event_at);
}

function normalizeRecommendationAttribution(input: {
  profile_id?: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  item_type: string;
  item_id: string;
}): Omit<RecommendationAttribution, 'detail_opened_at' | 'play_started_at' | 'max_progress_pct' | 'completed_at' | 'updated_at'> {
  const profileId = normalizeViewerProfileId(input.profile_id ?? activeViewerProfileId());
  if (!getViewerProfile(profileId)) throw new Error('unknown viewer profile');
  const railId = input.rail_id.trim().slice(0, 120);
  const itemType = input.item_type.trim().slice(0, 80);
  const itemId = input.item_id.trim().slice(0, 240);
  const slateRevision = Math.max(0, Math.floor(input.slate_revision));
  if (!railId || !itemType || !itemId || !Number.isFinite(input.slate_revision)) {
    throw new Error('invalid recommendation attribution');
  }
  return {
    profile_id: profileId,
    domain: input.domain,
    rail_id: railId,
    slate_revision: slateRevision,
    item_type: itemType,
    item_id: itemId,
  };
}

export type RecommendationServedSlate = {
  attribution_token: string;
  profile_id: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  source_revision: number;
  context_id: string;
  items: Array<{ type: string; id: string; rank: number }>;
  created_at: number;
  expires_at: number;
};

function normalizeServedItems(
  items: Array<{ type: string; id: string; rank: number }>,
): Array<{ type: string; id: string; rank: number }> {
  if (items.length === 0 || items.length > 40) {
    throw new Error('served recommendation slate requires 1-40 items');
  }
  const normalized = items.map((item) => ({
    type: item.type.trim().slice(0, 80),
    id: item.id.trim().slice(0, 240),
    rank: Math.max(0, Math.floor(item.rank)),
  }));
  if (normalized.some((item) => !item.type || !item.id || !Number.isFinite(item.rank))) {
    throw new Error('invalid served recommendation item');
  }
  const identities = new Set(normalized.map((item) => `${item.type}\u0000${item.id}`));
  const ranks = new Set(normalized.map((item) => item.rank));
  if (identities.size !== normalized.length || ranks.size !== normalized.length) {
    throw new Error('served recommendation items must have unique identities and ranks');
  }
  return normalized.sort((left, right) => left.rank - right.rank);
}

/**
 * Persist the exact profile-owned card opportunity before it is returned to a
 * client. The opaque token is the authority for later impression/action/play
 * attribution; callers never get to nominate a profile id.
 */
export function registerRecommendationServedSlate(input: {
  profile_id: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  source_revision: number;
  context_id?: string;
  items: Array<{ type: string; id: string; rank: number }>;
  now?: number;
}): RecommendationServedSlate {
  const profileId = normalizeViewerProfileId(input.profile_id);
  if (!getViewerProfile(profileId)) throw new Error('unknown viewer profile');
  const railId = input.rail_id.trim().slice(0, 120);
  const sourceRevision = Math.max(0, Math.floor(input.source_revision));
  const contextId = input.context_id?.trim().slice(0, 240) ?? '';
  if (!railId || !Number.isFinite(input.source_revision)) {
    throw new Error('invalid served recommendation slate');
  }
  if (input.domain === 'youtube' && railId === 'because_you_watched' && !contextId) {
    throw new Error('Because You Watched served slate requires an attribution context');
  }
  const items = normalizeServedItems(input.items);
  const createdAt = input.now ?? nowMs();
  const expiresAt = createdAt + RECOMMENDATION_SERVED_SLATE_TTL_MS;
  const attributionToken = randomUUID();
  const db = ensureDb();
  return db.transaction(() => {
    const revisionMetric = `served_slate_revision:${input.domain}:${railId}`;
    const revisionRow = db.prepare(`
INSERT INTO profile_recommendation_metrics(profile_id, metric_name, metric_value, updated_at)
VALUES (?, ?, 1, ?)
ON CONFLICT(profile_id, metric_name) DO UPDATE SET
  metric_value = profile_recommendation_metrics.metric_value + 1,
  updated_at = excluded.updated_at
RETURNING metric_value AS revision
`).get(profileId, revisionMetric, createdAt) as { revision: number };
    db.prepare('DELETE FROM profile_recommendation_served_slates WHERE expires_at < ?')
      .run(createdAt);
    db.prepare(`
INSERT INTO profile_recommendation_served_slates(
  attribution_token, profile_id, domain, rail_id, slate_revision,
  source_revision, context_id, created_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      attributionToken,
      profileId,
      input.domain,
      railId,
      revisionRow.revision,
      sourceRevision,
      contextId,
      createdAt,
      expiresAt,
    );
    const insertItem = db.prepare(`
INSERT INTO profile_recommendation_served_items(
  attribution_token, item_type, item_id, rank
) VALUES (?, ?, ?, ?)
`);
    for (const item of items) {
      insertItem.run(attributionToken, item.type, item.id, item.rank);
    }
    return {
      attribution_token: attributionToken,
      profile_id: profileId,
      domain: input.domain,
      rail_id: railId,
      slate_revision: revisionRow.revision,
      source_revision: sourceRevision,
      context_id: contextId,
      items,
      created_at: createdAt,
      expires_at: expiresAt,
    };
  })();
}

/** Validate an opaque served-slate token and recover its immutable owner. */
export function resolveRecommendationServedSlate(input: {
  attribution_token: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  items?: Array<{ type: string; id: string; rank: number }>;
  item?: { type: string; id: string };
  now?: number;
}): RecommendationServedSlate {
  const token = input.attribution_token.trim().slice(0, 160);
  const railId = input.rail_id.trim().slice(0, 120);
  const revision = Math.max(0, Math.floor(input.slate_revision));
  if (!token || !railId || !Number.isFinite(input.slate_revision)) {
    throw new Error('invalid recommendation attribution token');
  }
  const db = ensureDb();
  const row = db.prepare(`
SELECT attribution_token, profile_id, domain, rail_id, slate_revision,
       source_revision, context_id, created_at, expires_at
FROM profile_recommendation_served_slates
WHERE attribution_token = ?
`).get(token) as Omit<RecommendationServedSlate, 'items'> | undefined;
  const now = input.now ?? nowMs();
  if (!row || row.expires_at < now) throw new Error('unknown or expired recommendation slate');
  if (row.domain !== input.domain || row.rail_id !== railId || row.slate_revision !== revision) {
    throw new Error('recommendation slate ownership mismatch');
  }
  const items = db.prepare(`
SELECT item_type AS type, item_id AS id, rank
FROM profile_recommendation_served_items
WHERE attribution_token = ?
ORDER BY rank
`).all(token) as Array<{ type: string; id: string; rank: number }>;
  if (input.items) {
    const submitted = normalizeServedItems(input.items);
    if (submitted.length !== items.length || submitted.some((item, index) => (
      item.type !== items[index]?.type || item.id !== items[index]?.id || item.rank !== items[index]?.rank
    ))) {
      throw new Error('recommendation slate items do not match rendered membership');
    }
  }
  if (input.item) {
    const type = input.item.type.trim().slice(0, 80);
    const id = input.item.id.trim().slice(0, 240);
    if (!items.some((item) => item.type === type && item.id === id)) {
      throw new Error('recommendation item is not in the served slate');
    }
  }
  return { ...row, items };
}

export function recordRecommendationImpressions(input: {
  profile_id?: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  items: Array<{ type: string; id: string; rank: number }>;
  shown_at?: number;
}): number {
  const shownAt = input.shown_at ?? nowMs();
  const db = ensureDb();
  const insert = db.prepare(`
INSERT OR IGNORE INTO profile_recommendation_impressions(
  profile_id, domain, rail_id, slate_revision, item_type, item_id, rank, shown_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
  return db.transaction(() => {
    let changes = 0;
    for (const item of input.items.slice(0, 40)) {
      const normalized = normalizeRecommendationAttribution({
        ...input,
        item_type: item.type,
        item_id: item.id,
      });
      changes += insert.run(
        normalized.profile_id,
        normalized.domain,
        normalized.rail_id,
        normalized.slate_revision,
        normalized.item_type,
        normalized.item_id,
        Math.max(0, Math.floor(item.rank)),
        shownAt,
      ).changes;
    }
    return changes;
  })();
}

function upsertRecommendationOutcome(
  input: {
    profile_id?: string;
    domain: 'vod' | 'youtube';
    rail_id: string;
    slate_revision: number;
    item_type: string;
    item_id: string;
  },
  update: 'detail' | 'play',
  at = nowMs(),
): boolean {
  const row = normalizeRecommendationAttribution(input);
  const detailAt = update === 'detail' ? at : null;
  const playAt = update === 'play' ? at : null;
  const firstRecordedColumn = update === 'detail' ? 'detail_opened_at' : 'play_started_at';
  const recorded = ensureDb().prepare(`
INSERT INTO profile_recommendation_outcomes(
  profile_id, domain, rail_id, slate_revision, item_type, item_id,
  detail_opened_at, play_started_at, max_progress_pct, completed_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
ON CONFLICT(profile_id, domain, rail_id, slate_revision, item_type, item_id) DO UPDATE SET
  detail_opened_at = COALESCE(profile_recommendation_outcomes.detail_opened_at, excluded.detail_opened_at),
  play_started_at = COALESCE(profile_recommendation_outcomes.play_started_at, excluded.play_started_at),
  updated_at = MAX(profile_recommendation_outcomes.updated_at, excluded.updated_at)
WHERE profile_recommendation_outcomes.${firstRecordedColumn} IS NULL
RETURNING 1 AS recorded
`).get(
    row.profile_id,
    row.domain,
    row.rail_id,
    row.slate_revision,
    row.item_type,
    row.item_id,
    detailAt,
    playAt,
    at,
  ) as { recorded: number } | undefined;
  return recorded?.recorded === 1;
}

export function recordRecommendationDetailOpen(input: {
  profile_id?: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  item_type: string;
  item_id: string;
  occurred_at?: number;
}): void {
  upsertRecommendationOutcome(input, 'detail', input.occurred_at);
}

export function recordRecommendationPlayStart(input: {
  profile_id?: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  item_type: string;
  item_id: string;
  occurred_at?: number;
}): boolean {
  return upsertRecommendationOutcome(input, 'play', input.occurred_at);
}

export function recordRecommendationProgress(input: {
  profile_id: string;
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  item_type: string;
  item_id: string;
  progress_pct: number;
  occurred_at?: number;
}): void {
  const row = normalizeRecommendationAttribution(input);
  const progress = Math.max(0, Math.min(1, Number(input.progress_pct) || 0));
  const at = input.occurred_at ?? nowMs();
  ensureDb().prepare(`
INSERT INTO profile_recommendation_outcomes(
  profile_id, domain, rail_id, slate_revision, item_type, item_id,
  detail_opened_at, play_started_at, max_progress_pct, completed_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
ON CONFLICT(profile_id, domain, rail_id, slate_revision, item_type, item_id) DO UPDATE SET
  max_progress_pct = MAX(profile_recommendation_outcomes.max_progress_pct, excluded.max_progress_pct),
  completed_at = CASE
    WHEN profile_recommendation_outcomes.completed_at IS NOT NULL
      THEN profile_recommendation_outcomes.completed_at
    ELSE excluded.completed_at
  END,
  updated_at = MAX(profile_recommendation_outcomes.updated_at, excluded.updated_at)
`).run(
    row.profile_id,
    row.domain,
    row.rail_id,
    row.slate_revision,
    row.item_type,
    row.item_id,
    progress,
    progress >= 0.9 ? at : null,
    at,
  );
}

export function listRecommendationAttribution(profileId = activeViewerProfileId()): RecommendationAttribution[] {
  return ensureDb().prepare(`
SELECT profile_id, domain, rail_id, slate_revision, item_type, item_id,
       detail_opened_at, play_started_at, max_progress_pct, completed_at, updated_at
FROM profile_recommendation_outcomes
WHERE profile_id = ?
ORDER BY updated_at DESC, rail_id, item_id
`).all(normalizeViewerProfileId(profileId)) as RecommendationAttribution[];
}

/**
 * Create exactly one WAL-consistent pre-v4 backup using SQLite's online backup API.
 * The caller must await this before initLibraryDb() applies the ratings migration.
 */
export async function backupLibraryDbBeforeFireWaterMigration(): Promise<string | null> {
  const path = libraryDbPath();
  if (!existsSync(path)) return null;
  const destination = `${path}.pre-fire-water-v${FIRE_WATER_SCHEMA_VERSION}.bak`;
  if (existsSync(destination)) return destination;

  const source = new Database(path);
  try {
    const table = source.prepare(`
SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'library_migrations'
`).get() as { name?: string } | undefined;
    if (table) {
      const migrated = source.prepare('SELECT 1 AS applied FROM library_migrations WHERE version = ?')
        .get(FIRE_WATER_SCHEMA_VERSION) as { applied?: number } | undefined;
      if (migrated?.applied) return null;
    }
    await source.backup(destination);
    return destination;
  } finally {
    source.close();
  }
}

function normalizeInput(input: LibraryItemInput): Required<Pick<LibraryItemInput, 'source' | 'type' | 'id'>> & LibraryItemInput {
  const source = normalizeSource(input.source);
  const type = normalizeLibraryType(input.type);
  const id = normalizeLibraryId(type, input.id);
  if (!id) {
    throw new Error('library item requires id');
  }
  return { ...input, source, type, id };
}

function upsertLibraryItem(db: Database.Database, input: LibraryItemInput, timestamp = nowMs()): string {
  const normalized = normalizeInput(input);
  const itemKey = libraryItemKey(normalized.source, normalized.type, normalized.id);
  db.prepare(`
INSERT INTO library_items (
  item_key, source, type, id, title, poster, year, description, tab, first_seen_at, updated_at
) VALUES (
  @item_key, @source, @type, @id, @title, @poster, @year, @description, @tab, @first_seen_at, @updated_at
)
ON CONFLICT(item_key) DO UPDATE SET
  title = COALESCE(excluded.title, library_items.title),
  poster = COALESCE(excluded.poster, library_items.poster),
  year = COALESCE(excluded.year, library_items.year),
  description = COALESCE(excluded.description, library_items.description),
  tab = excluded.tab,
  updated_at = excluded.updated_at;
`).run({
    item_key: itemKey,
    source: normalized.source,
    type: normalized.type,
    id: normalized.id,
    title: input.title?.trim() || null,
    poster: input.poster?.trim() || null,
    year: input.year != null ? String(input.year) : null,
    description: input.description?.trim() || null,
    tab: libraryTabForType(normalized.type, input.tab ?? null),
    first_seen_at: timestamp,
    updated_at: timestamp,
  });
  return itemKey;
}

export function saveLibraryItem(input: LibraryItemInput & { saved_by?: string; saved_at?: number }): SavedLibraryItem {
  const db = ensureDb();
  const savedAt = input.saved_at ?? nowMs();
  const profileId = activeViewerProfileId();
  const transaction = db.transaction(() => {
    const itemKey = upsertLibraryItem(db, input, savedAt);
    db.prepare(`
INSERT INTO saved_items (item_key, saved_at, saved_by)
VALUES (@item_key, @saved_at, @saved_by)
ON CONFLICT(item_key) DO UPDATE SET
  saved_at = excluded.saved_at,
  saved_by = excluded.saved_by;
`).run({
      item_key: itemKey,
      saved_at: savedAt,
      saved_by: input.saved_by?.trim() || 'user',
    });
    db.prepare(`
INSERT INTO profile_saved_items(profile_id, item_key, saved_at, saved_by)
VALUES (@profile_id, @item_key, @saved_at, @saved_by)
ON CONFLICT(profile_id, item_key) DO UPDATE SET
  saved_at = excluded.saved_at,
  saved_by = excluded.saved_by;
`).run({
      profile_id: profileId,
      item_key: itemKey,
      saved_at: savedAt,
      saved_by: input.saved_by?.trim() || 'user',
    });
    const normalized = normalizeInput(input);
    db.prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES (?, ?, 'saved', ?, ?, ?, 0.8, '{}', ?)
`).run(
      profileId,
      normalized.source === 'youtube' ? 'youtube' : 'vod',
      normalized.type,
      normalized.id,
      input.title?.trim() || null,
      savedAt,
    );
    return itemKey;
  });
  const itemKey = transaction();
  const saved = getSavedLibraryItemByKey(itemKey);
  if (!saved) {
    throw new Error(`saved item missing after upsert: ${itemKey}`);
  }
  return saved;
}

export function unsaveLibraryItem(input: { source?: string; type: string; id: string }): boolean {
  const db = ensureDb();
  const key = libraryItemKey(input.source, input.type, input.id);
  const profileId = activeViewerProfileId();
  const transaction = db.transaction(() => {
    const item = db.prepare(`
SELECT source, type, id, title FROM library_items WHERE item_key = ?
`).get(key) as { source: string; type: string; id: string; title: string | null } | undefined;
    const result = db.prepare(`
DELETE FROM profile_saved_items WHERE profile_id = ? AND item_key = ?
`).run(profileId, key);
    if (result.changes > 0 && item) {
      db.prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES (?, ?, 'unsaved', ?, ?, ?, 0, '{}', ?)
`).run(
        profileId,
        item.source === 'youtube' ? 'youtube' : 'vod',
        item.type,
        item.id,
        item.title,
        nowMs(),
      );
    }
    const latest = db.prepare(`
SELECT saved_at, saved_by
FROM profile_saved_items
WHERE item_key = ?
ORDER BY saved_at DESC, profile_id
LIMIT 1
`).get(key) as { saved_at: number; saved_by: string } | undefined;
    if (latest) {
      db.prepare(`
INSERT INTO saved_items(item_key, saved_at, saved_by)
VALUES (?, ?, ?)
ON CONFLICT(item_key) DO UPDATE SET saved_at = excluded.saved_at, saved_by = excluded.saved_by
`).run(key, latest.saved_at, latest.saved_by);
    } else {
      db.prepare('DELETE FROM saved_items WHERE item_key = ?').run(key);
    }
    cleanupUnreferencedLibraryItem(db, key);
    return result.changes > 0;
  });
  return transaction();
}

export function listSavedLibraryItems(
  tab?: CatalogTab,
  limit = 100,
  options: { profile_id?: string | null; household_blend?: boolean } = {},
): SavedLibraryItem[] {
  const db = ensureDb();
  const profileId = options.profile_id?.trim().toLowerCase() || activeViewerProfileId();
  const householdBlend = options.household_blend !== false && profileId === 'household';
  const rows = db.prepare(`
WITH scoped_saved AS (
  SELECT item_key, MAX(saved_at) AS saved_at
  FROM profile_saved_items
  WHERE (@household_blend = 1 OR profile_id = @profile_id)
  GROUP BY item_key
), latest_saved AS (
  SELECT ps.item_key, ps.saved_at, MIN(ps.saved_by) AS saved_by
  FROM profile_saved_items ps
  JOIN scoped_saved ss ON ss.item_key = ps.item_key AND ss.saved_at = ps.saved_at
  WHERE (@household_blend = 1 OR ps.profile_id = @profile_id)
  GROUP BY ps.item_key, ps.saved_at
)
SELECT
  li.source,
  li.item_key,
  li.type,
  li.id,
  COALESCE(NULLIF(TRIM(li.title), ''), li.id) AS title,
  li.poster,
  li.year,
  li.description,
  li.tab,
  si.saved_at,
  si.saved_by
FROM latest_saved si
JOIN library_items li ON li.item_key = si.item_key
WHERE (@tab IS NULL OR li.tab = @tab)
ORDER BY si.saved_at DESC
LIMIT @limit;
`).all({
    profile_id: profileId,
    household_blend: householdBlend ? 1 : 0,
    tab: tab ?? null,
    limit: Math.max(1, Math.min(500, limit)),
  }) as SavedRow[];
  return rows;
}

export function getSavedLibraryItemByKey(itemKey: string): SavedLibraryItem | null {
  const db = ensureDb();
  const profileId = activeViewerProfileId();
  const row = db.prepare(`
WITH scoped_saved AS (
  SELECT item_key, MAX(saved_at) AS saved_at
  FROM profile_saved_items
  WHERE item_key = @item_key
    AND (@profile_id = 'household' OR profile_id = @profile_id)
  GROUP BY item_key
), latest_saved AS (
  SELECT ps.item_key, ps.saved_at, MIN(ps.saved_by) AS saved_by
  FROM profile_saved_items ps
  JOIN scoped_saved ss ON ss.item_key = ps.item_key AND ss.saved_at = ps.saved_at
  WHERE (@profile_id = 'household' OR ps.profile_id = @profile_id)
  GROUP BY ps.item_key, ps.saved_at
)
SELECT
  li.source,
  li.item_key,
  li.type,
  li.id,
  COALESCE(NULLIF(TRIM(li.title), ''), li.id) AS title,
  li.poster,
  li.year,
  li.description,
  li.tab,
  si.saved_at,
  si.saved_by
FROM latest_saved si
JOIN library_items li ON li.item_key = si.item_key
WHERE si.item_key = @item_key;
`).get({ item_key: itemKey, profile_id: profileId }) as SavedRow | undefined;
  return row ?? null;
}

export function getLibraryState(input: {
  source?: string;
  type: string;
  id: string;
  profile_id?: string | null;
}): LibraryState {
  const db = ensureDb();
  const source = normalizeSource(input.source);
  const type = normalizeLibraryType(input.type);
  const id = normalizeLibraryId(type, input.id);
  const key = libraryItemKey(source, type, id);
  const profileId = input.profile_id
    ? getViewerProfile(input.profile_id)?.profile_id
    : activeViewerProfileId();
  if (!profileId) throw new Error('unknown viewer profile');
  const row = db.prepare(`
WITH scoped_saved AS (
  SELECT item_key, MAX(saved_at) AS saved_at
  FROM profile_saved_items
  WHERE item_key = @item_key
    AND (@profile_id = 'household' OR profile_id = @profile_id)
  GROUP BY item_key
), latest_saved AS (
  SELECT ps.item_key, ps.saved_at, MIN(ps.saved_by) AS saved_by
  FROM profile_saved_items ps
  JOIN scoped_saved ss ON ss.item_key = ps.item_key AND ss.saved_at = ps.saved_at
  WHERE (@profile_id = 'household' OR ps.profile_id = @profile_id)
  GROUP BY ps.item_key, ps.saved_at
)
SELECT
  li.source,
  li.item_key,
  li.type,
  li.id,
  li.title,
  li.poster,
  li.tab,
  si.saved_at,
  si.saved_by,
  ws.latest_play_id,
  ws.position_sec,
  ws.duration_sec,
  ws.progress_pct,
  ws.last_watched_at,
  ws.finished_at,
  li.hidden,
  li.hidden_at,
  li.hide_reason,
  li.blocked,
  li.blocked_at,
  li.block_reason
FROM library_items li
LEFT JOIN latest_saved si ON si.item_key = li.item_key
LEFT JOIN profile_watch_state ws
  ON ws.item_key = li.item_key AND ws.profile_id = @profile_id
WHERE li.item_key = @item_key;
`).get({ item_key: key, profile_id: profileId }) as StateRow | undefined;
  if (!row) {
    return {
      source,
      item_key: key,
      type,
      id,
      title: null,
      poster: null,
      tab: libraryTabForType(type),
      saved: false,
      saved_at: null,
      latest_watch: null,
      finished: false,
      finished_at: null,
      hidden: false,
      hidden_at: null,
      hide_reason: null,
      blocked: false,
      blocked_at: null,
      block_reason: null,
    };
  }
  return rowToLibraryState(row);
}

function rowToLibraryState(row: StateRow): LibraryState {
  const latestWatch = row.last_watched_at
    ? {
      play_id: row.latest_play_id,
      position_sec: Number(row.position_sec ?? 0),
      duration_sec: Number(row.duration_sec ?? 0),
      progress_pct: Number(row.progress_pct ?? 0),
      last_watched_at: row.last_watched_at,
    }
    : null;
  return {
    source: row.source,
    item_key: row.item_key,
    type: row.type,
    id: row.id,
    title: row.title,
    poster: row.poster,
    tab: libraryTabForType(row.type, row.tab),
    saved: row.saved_at !== null,
    saved_at: row.saved_at,
    latest_watch: latestWatch,
    finished: row.finished_at !== null,
    finished_at: row.finished_at,
    hidden: Boolean(row.hidden),
    hidden_at: row.hidden_at,
    hide_reason: row.hide_reason,
    blocked: Boolean(row.blocked),
    blocked_at: row.blocked_at,
    block_reason: row.block_reason,
  };
}

export function recordLibraryWatch(input: LibraryItemInput & {
  /** Captured when playback was accepted; defaults to the currently active profile. */
  profile_id?: string;
  play_id?: string | null;
  position_sec?: number | null;
  duration_sec?: number | null;
  event?: string;
  watched_at?: number;
}): WatchHistoryRow {
  const db = ensureDb();
  const profileId = input.profile_id
    ? getViewerProfile(input.profile_id)?.profile_id
    : activeViewerProfileId();
  if (!profileId) throw new Error('unknown viewer profile');
  const watchedAt = input.watched_at ?? nowMs();
  const position = Math.max(0, Number(input.position_sec ?? 0));
  const duration = Math.max(0, Number(input.duration_sec ?? 0));
  const pct = progressPct(position, duration);
  const event = input.event || (pct >= LIBRARY_FINISHED_PCT ? 'finished' : 'progress');
  const finishedAt = pct >= LIBRARY_FINISHED_PCT ? watchedAt : null;
  let historyId = 0;
  const transaction = db.transaction(() => {
    const itemKey = upsertLibraryItem(db, input, watchedAt);
    const watchState = {
      profile_id: profileId,
      item_key: itemKey,
      latest_play_id: input.play_id ?? null,
      position_sec: position,
      duration_sec: duration,
      progress_pct: pct,
      last_watched_at: watchedAt,
      finished_at: finishedAt,
    };
    db.prepare(`
INSERT INTO profile_watch_state (
  profile_id, item_key, latest_play_id, position_sec, duration_sec,
  progress_pct, last_watched_at, finished_at
) VALUES (
  @profile_id, @item_key, @latest_play_id, @position_sec, @duration_sec,
  @progress_pct, @last_watched_at, @finished_at
)
ON CONFLICT(profile_id, item_key) DO UPDATE SET
  latest_play_id = excluded.latest_play_id,
  position_sec = excluded.position_sec,
  duration_sec = excluded.duration_sec,
  progress_pct = excluded.progress_pct,
  last_watched_at = excluded.last_watched_at,
  finished_at = CASE
    WHEN excluded.finished_at IS NOT NULL THEN excluded.finished_at
    ELSE profile_watch_state.finished_at
  END;
`).run(watchState);
    // Maintain the legacy global table only for Household rollback. A personal
    // profile must never be observable through an older unscoped reader.
    if (profileId === 'household') {
      db.prepare(`
INSERT INTO watch_state (
  item_key, latest_play_id, position_sec, duration_sec, progress_pct, last_watched_at, finished_at
) VALUES (
  @item_key, @latest_play_id, @position_sec, @duration_sec, @progress_pct, @last_watched_at, @finished_at
)
ON CONFLICT(item_key) DO UPDATE SET
  latest_play_id = excluded.latest_play_id,
  position_sec = excluded.position_sec,
  duration_sec = excluded.duration_sec,
  progress_pct = excluded.progress_pct,
  last_watched_at = excluded.last_watched_at,
  finished_at = CASE
    WHEN excluded.finished_at IS NOT NULL THEN excluded.finished_at
    ELSE watch_state.finished_at
  END;
`).run(watchState);
    }
    const result = db.prepare(`
INSERT INTO watch_history (
  item_key, source, type, id, play_id, title, poster,
  position_sec, duration_sec, progress_pct, event, watched_at
) VALUES (
  @item_key, @source, @type, @id, @play_id, @title, @poster,
  @position_sec, @duration_sec, @progress_pct, @event, @watched_at
);
`).run({
      item_key: itemKey,
      source: normalizeSource(input.source),
      type: normalizeLibraryType(input.type),
      id: normalizeLibraryId(input.type, input.id),
      play_id: input.play_id ?? null,
      title: input.title?.trim() || null,
      poster: input.poster?.trim() || null,
      position_sec: position,
      duration_sec: duration,
      progress_pct: pct,
      event,
      watched_at: watchedAt,
    });
    historyId = Number(result.lastInsertRowid);

    const normalizedType = normalizeLibraryType(input.type);
    const domain = normalizeSource(input.source) === 'youtube' ? 'youtube' : 'vod';
    const strength = pct >= LIBRARY_FINISHED_PCT ? 1 : pct >= 0.25 ? 0.55 : 0.05;
    db.prepare(`
INSERT OR IGNORE INTO profile_watch_history(profile_id, history_id)
VALUES (?, ?)
`).run(profileId, historyId);
    const previousSignal = db.prepare(`
SELECT strength, event_type, occurred_at
FROM profile_recommendation_events
WHERE profile_id = ? AND domain = ? AND item_type = ? AND item_id = ?
  AND event_type NOT IN ('saved', 'unsaved', 'not_interested', 'not_interested_cleared', 'search')
ORDER BY occurred_at DESC, event_id DESC
LIMIT 1
`).get(
      profileId,
      domain,
      normalizedType,
      normalizeLibraryId(input.type, input.id),
    ) as { strength: number; event_type: string; occurred_at: number } | undefined;
    const isCooledDownVodRewatch = domain === 'vod'
      && Boolean(previousSignal)
      && Number(previousSignal?.strength) >= 1
      && strength === 0.05
      && watchedAt - Number(previousSignal?.occurred_at ?? watchedAt) >= VOD_REWATCH_SIGNAL_COOLDOWN_MS;
    const signalStrength = isCooledDownVodRewatch ? 0.7 : strength;
    const signalEvent = isCooledDownVodRewatch ? 'rewatch' : event;
    const shouldAppendSignal = isCooledDownVodRewatch
      || !previousSignal
      || strength > Number(previousSignal.strength)
      || (event === 'finished' && previousSignal.event_type !== 'finished');
    if (shouldAppendSignal) db.prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      profileId,
      domain,
      signalEvent,
      normalizedType,
      normalizeLibraryId(input.type, input.id),
      input.title?.trim() || null,
      signalStrength,
      JSON.stringify({
        history_id: historyId,
        play_id: input.play_id ?? null,
        position_sec: position,
        progress_pct: pct,
        duration_sec: duration,
      }),
      watchedAt,
    );
    const movieEligible = normalizedType === 'movie' && pct >= LIBRARY_FINISHED_PCT;
    let seriesEligible = false;
    if (normalizedType === 'series' && pct >= LIBRARY_FINISHED_PCT) {
      const distinct = db.prepare(`
SELECT COUNT(DISTINCT wh.play_id) AS count
FROM watch_history wh
JOIN profile_watch_history pwh ON pwh.history_id = wh.history_id
WHERE pwh.profile_id = @profile_id
  AND wh.item_key = @item_key
  AND wh.play_id IS NOT NULL
  AND wh.play_id != ''
  AND wh.progress_pct >= @finished_pct
`).get({
        profile_id: profileId,
        item_key: itemKey,
        finished_pct: LIBRARY_FINISHED_PCT,
      }) as { count: number };
      seriesEligible = distinct.count >= 3 || event === 'season_finale_finished';
    }
    if (movieEligible || seriesEligible) {
      db.prepare(`
INSERT INTO profile_rating_prompt_state(profile_id, content_type, content_id, eligible_at, updated_at)
SELECT @profile_id, @content_type, @content_id, @eligible_at, @updated_at
WHERE NOT EXISTS (
  SELECT 1 FROM profile_content_ratings
  WHERE profile_id = @profile_id AND content_type = @content_type AND content_id = @content_id
)
ON CONFLICT(profile_id, content_type, content_id) DO UPDATE SET
  eligible_at = CASE
    WHEN profile_rating_prompt_state.resolved_at IS NULL THEN COALESCE(profile_rating_prompt_state.eligible_at, excluded.eligible_at)
    ELSE profile_rating_prompt_state.eligible_at
  END,
  updated_at = excluded.updated_at
`).run({
        profile_id: profileId,
        content_type: normalizedType,
        content_id: normalizeLibraryId(normalizedType, input.id),
        eligible_at: watchedAt,
        updated_at: watchedAt,
      });
    }
  });
  transaction();
  const row = db.prepare(`
SELECT
  wh.history_id,
  wh.source,
  wh.item_key,
  wh.type,
  wh.id,
  wh.play_id,
  wh.title,
  wh.poster,
  wh.position_sec,
  wh.duration_sec,
  wh.progress_pct,
  wh.event,
  wh.watched_at
FROM watch_history wh
WHERE wh.history_id = ?;
`).get(historyId) as WatchHistoryRow | undefined;
  if (!row) {
    throw new Error(`watch history missing after insert: ${historyId}`);
  }
  return row;
}

export function setLibraryFeedback(input: LibraryItemInput & {
  feedback: string;
  reason?: string | null;
  created_at?: number;
}): LibraryFeedbackRow {
  const db = ensureDb();
  const timestamp = input.created_at ?? nowMs();
  const feedback = input.feedback.trim().toLowerCase();
  if (!feedback) {
    throw new Error('library feedback requires feedback');
  }
  const profileId = activeViewerProfileId();
  const transaction = db.transaction(() => {
    const itemKey = upsertLibraryItem(db, input, timestamp);
    db.prepare(`
INSERT INTO profile_library_feedback(profile_id, item_key, feedback, reason, created_at, updated_at)
VALUES (@profile_id, @item_key, @feedback, @reason, @created_at, @updated_at)
ON CONFLICT(profile_id, item_key, feedback) DO UPDATE SET
  reason = COALESCE(excluded.reason, profile_library_feedback.reason),
  updated_at = excluded.updated_at;
`).run({
      profile_id: profileId,
      item_key: itemKey,
      feedback,
      reason: input.reason?.trim() || null,
      created_at: timestamp,
      updated_at: timestamp,
    });
    // Keep the pre-profile table as an exact household rollback mirror. Personal
    // feedback must never leak through legacy global reads.
    if (profileId === 'household') {
      db.prepare(`
INSERT INTO library_feedback (item_key, feedback, reason, created_at, updated_at)
VALUES (@item_key, @feedback, @reason, @created_at, @updated_at)
ON CONFLICT(item_key, feedback) DO UPDATE SET
  reason = COALESCE(excluded.reason, library_feedback.reason),
  updated_at = excluded.updated_at;
`).run({
        item_key: itemKey,
        feedback,
        reason: input.reason?.trim() || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
    const normalized = normalizeInput(input);
    db.prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      profileId,
      normalized.source === 'youtube' ? 'youtube' : 'vod',
      feedback === 'not_interested' ? 'not_interested' : `feedback:${feedback}`,
      normalized.type,
      normalized.id,
      input.title?.trim() || null,
      feedback === 'not_interested' ? -1 : 0,
      JSON.stringify({ reason: input.reason?.trim() || null }),
      timestamp,
    );
    return itemKey;
  });
  const itemKey = transaction();
  const profileRow = db.prepare(`
SELECT li.source, li.item_key, li.type, li.id, li.title, li.poster, li.tab,
       pf.feedback, pf.reason,
       pf.created_at, pf.updated_at
FROM profile_library_feedback pf
JOIN library_items li ON li.item_key = pf.item_key
WHERE pf.profile_id = ? AND pf.item_key = ? AND pf.feedback = ?
`).get(profileId, itemKey, feedback) as FeedbackRow | undefined;
  if (!profileRow) {
    throw new Error(`library feedback missing after upsert: ${itemKey}`);
  }
  return profileRow;
}

export function listLibraryFeedback(feedback: string, source?: string): LibraryFeedbackRow[] {
  const db = ensureDb();
  const profileId = activeViewerProfileId();
  const normalizedFeedback = feedback.trim().toLowerCase();
  const normalizedSource = source ? normalizeSource(source) : null;
  return db.prepare(`
WITH ranked_feedback AS (
  SELECT pf.*,
    ROW_NUMBER() OVER (
      PARTITION BY pf.item_key, pf.feedback
      ORDER BY pf.updated_at DESC, pf.profile_id
    ) AS item_rank
  FROM profile_library_feedback pf
  WHERE (@profile_id = 'household' OR pf.profile_id = @profile_id)
    AND pf.feedback = @feedback
)
SELECT
  li.source,
  li.item_key,
  li.type,
  li.id,
  li.title,
  li.poster,
  li.tab,
  lf.feedback,
  lf.reason,
  lf.created_at,
  lf.updated_at
FROM ranked_feedback lf
JOIN library_items li ON li.item_key = lf.item_key
WHERE lf.item_rank = 1
  AND (@source IS NULL OR li.source = @source)
ORDER BY lf.updated_at DESC;
`).all({
    profile_id: profileId,
    feedback: normalizedFeedback,
    source: normalizedSource,
  }) as FeedbackRow[];
}

export function listProfileLibraryFeedback(
  feedback: string,
  source?: string,
  options: { profile_id?: string; household_blend?: boolean } = {},
): ProfileLibraryFeedbackRow[] {
  const profileId = options.profile_id?.trim().toLowerCase() || activeViewerProfileId();
  const householdBlend = options.household_blend !== false && profileId === 'household';
  return ensureDb().prepare(`
SELECT pf.profile_id, li.source, li.item_key, li.type, li.id,
       li.title, li.poster, li.tab, pf.feedback,
       pf.reason, pf.created_at, pf.updated_at
FROM profile_library_feedback pf
JOIN library_items li ON li.item_key = pf.item_key
WHERE (@household_blend = 1 OR pf.profile_id = @profile_id)
  AND pf.feedback = @feedback
  AND (@source IS NULL OR li.source = @source)
ORDER BY pf.updated_at DESC, pf.profile_id, li.item_key
`).all({
    profile_id: profileId,
    household_blend: householdBlend ? 1 : 0,
    feedback: feedback.trim().toLowerCase(),
    source: source ? normalizeSource(source) : null,
  }) as ProfileLibraryFeedbackRow[];
}

export function clearLibraryFeedback(input: {
  source?: string;
  type: string;
  id: string;
  feedback: string;
}): boolean {
  const db = ensureDb();
  const key = libraryItemKey(input.source, input.type, input.id);
  const feedback = input.feedback.trim().toLowerCase();
  if (!feedback) return false;
  const profileId = activeViewerProfileId();
  return db.transaction(() => {
    const item = db.prepare('SELECT source, type, id, title FROM library_items WHERE item_key = ?')
      .get(key) as { source: string; type: string; id: string; title: string | null } | undefined;
    const result = db.prepare(`
DELETE FROM profile_library_feedback
WHERE profile_id = ? AND item_key = ? AND feedback = ?
`).run(profileId, key, feedback);
    if (profileId === 'household') {
      db.prepare('DELETE FROM library_feedback WHERE item_key = ? AND feedback = ?').run(key, feedback);
    }
    if (result.changes > 0 && item) {
      db.prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, 0, '{}', ?)
`).run(
        profileId,
        item.source === 'youtube' ? 'youtube' : 'vod',
        feedback === 'not_interested' ? 'not_interested_cleared' : `feedback_cleared:${feedback}`,
        item.type,
        item.id,
        item.title,
        nowMs(),
      );
    }
    cleanupUnreferencedLibraryItem(db, key);
    return result.changes > 0;
  })();
}

export function listWatchHistory(
  limitOrOptions: number | {
    limit?: number;
    source?: string | null;
    type?: string | null;
    profile_id?: string | null;
    household_blend?: boolean;
  } = 50,
): WatchHistoryRow[] {
  const db = ensureDb();
  const options = typeof limitOrOptions === 'number'
    ? { limit: limitOrOptions }
    : limitOrOptions;
  const profileId = options.profile_id
    ? getViewerProfile(options.profile_id)?.profile_id
    : activeViewerProfileId();
  if (!profileId) throw new Error('unknown viewer profile');
  const householdBlend = options.household_blend !== false && profileId === 'household';
  return db.prepare(`
SELECT
  wh.history_id,
  wh.source,
  wh.item_key,
  wh.type,
  wh.id,
  wh.play_id,
  COALESCE(wh.title, li.title) AS title,
  COALESCE(wh.poster, li.poster) AS poster,
  wh.position_sec,
  wh.duration_sec,
  wh.progress_pct,
  wh.event,
  wh.watched_at
FROM watch_history wh
JOIN library_items li ON li.item_key = wh.item_key
WHERE EXISTS (
  SELECT 1 FROM profile_watch_history pwh
  WHERE pwh.history_id = wh.history_id
    AND (@household_blend = 1 OR pwh.profile_id = @profile_id)
)
  AND (@source IS NULL OR wh.source = @source)
  AND (@type IS NULL OR wh.type = @type)
ORDER BY wh.watched_at DESC, wh.history_id DESC
LIMIT @limit;
`).all({
  profile_id: profileId,
  household_blend: householdBlend ? 1 : 0,
  source: options.source ? normalizeSource(options.source) : null,
  type: options.type ? normalizeLibraryType(options.type) : null,
  limit: Math.max(1, Math.min(500, options.limit ?? 50)),
  }) as WatchHistoryRow[];
}

export function listRecommendationLibrarySignals(
  options: { profile_id?: string | null } = {},
): RecommendationLibrarySignal[] {
  const db = ensureDb();
  const profileId = options.profile_id
    ? getViewerProfile(options.profile_id)?.profile_id
    : activeViewerProfileId();
  if (!profileId) throw new Error('unknown viewer profile');
  const rows = db.prepare(`
WITH scoped_saved AS (
  SELECT DISTINCT item_key
  FROM profile_saved_items
  WHERE (@profile_id = 'household' OR profile_id = @profile_id)
), scoped_watch AS (
  SELECT wh.item_key,
    MAX(CASE WHEN wh.position_sec > 0 THEN 1 ELSE 0 END) AS started,
    MAX(CASE WHEN wh.progress_pct >= @finished_pct THEN 1 ELSE 0 END) AS completed
  FROM profile_watch_history pwh
  JOIN watch_history wh ON wh.history_id = pwh.history_id
  WHERE (@profile_id = 'household' OR pwh.profile_id = @profile_id)
  GROUP BY wh.item_key
), scoped_feedback AS (
  SELECT DISTINCT item_key
  FROM profile_library_feedback
  WHERE feedback = 'not_interested'
    AND (@profile_id = 'household' OR profile_id = @profile_id)
)
SELECT
  li.type,
  li.id,
  MAX(CASE WHEN si.item_key IS NOT NULL THEN 1 ELSE 0 END) AS saved,
  MAX(COALESCE(sw.started, 0)) AS started,
  MAX(COALESCE(sw.completed, 0)) AS completed,
  MAX(li.hidden) AS hidden,
  MAX(li.blocked) AS blocked,
  MAX(CASE WHEN sf.item_key IS NOT NULL THEN 1 ELSE 0 END) AS not_interested
FROM library_items li
LEFT JOIN scoped_saved si ON si.item_key = li.item_key
LEFT JOIN scoped_watch sw ON sw.item_key = li.item_key
LEFT JOIN scoped_feedback sf ON sf.item_key = li.item_key
WHERE li.type IN ('movie', 'series')
GROUP BY li.type, li.id
`).all({ profile_id: profileId, finished_pct: LIBRARY_FINISHED_PCT }) as Array<{
    type: string;
    id: string;
    saved: number;
    started: number;
    completed: number;
    hidden: number;
    blocked: number;
    not_interested: number;
  }>;
  return rows.map((row) => ({
    type: row.type,
    id: row.id,
    saved: Boolean(row.saved),
    started: Boolean(row.started),
    completed: Boolean(row.completed),
    hidden: Boolean(row.hidden),
    blocked: Boolean(row.blocked),
    not_interested: Boolean(row.not_interested),
  }));
}

/** Latest watch_history row per episode play_id for a series (for per-episode resume). */
export type EpisodeWatchProgress = {
  play_id: string;
  position_sec: number;
  duration_sec: number;
  progress_pct: number;
  watched_at: number;
};

export function listLatestEpisodeWatchProgress(
  seriesId: string,
  options: { source?: string | null; profile_id?: string | null } = {},
): EpisodeWatchProgress[] {
  const db = ensureDb();
  const itemKey = libraryItemKey(options.source ?? undefined, 'series', seriesId);
  const profileId = options.profile_id
    ? getViewerProfile(options.profile_id)?.profile_id
    : activeViewerProfileId();
  if (!profileId) throw new Error('unknown viewer profile');
  return db.prepare(`
SELECT
  wh.play_id,
  wh.position_sec,
  wh.duration_sec,
  wh.progress_pct,
  wh.watched_at
FROM watch_history wh
WHERE wh.item_key = @item_key
  AND EXISTS (
    SELECT 1 FROM profile_watch_history scoped
    WHERE scoped.history_id = wh.history_id AND scoped.profile_id = @profile_id
  )
  AND wh.play_id IS NOT NULL
  AND wh.play_id != ''
  AND NOT EXISTS (
    SELECT 1
    FROM watch_history newer
    WHERE newer.item_key = wh.item_key
      AND newer.play_id = wh.play_id
      AND EXISTS (
        SELECT 1 FROM profile_watch_history newer_scoped
        WHERE newer_scoped.history_id = newer.history_id
          AND newer_scoped.profile_id = @profile_id
      )
      AND (
        newer.watched_at > wh.watched_at
        OR (newer.watched_at = wh.watched_at AND newer.history_id > wh.history_id)
      )
  )
ORDER BY wh.watched_at DESC, wh.history_id DESC;
`).all({ item_key: itemKey, profile_id: profileId }) as EpisodeWatchProgress[];
}

export function getLatestEpisodeWatchProgress(
  seriesId: string,
  episodeId: string,
  options: { source?: string | null; profile_id?: string | null } = {},
): EpisodeWatchProgress | null {
  const db = ensureDb();
  const itemKey = libraryItemKey(options.source ?? undefined, 'series', seriesId);
  const profileId = options.profile_id
    ? getViewerProfile(options.profile_id)?.profile_id
    : activeViewerProfileId();
  if (!profileId) throw new Error('unknown viewer profile');
  const row = db.prepare(`
SELECT
  wh.play_id,
  wh.position_sec,
  wh.duration_sec,
  wh.progress_pct,
  wh.watched_at
FROM watch_history wh
WHERE wh.item_key = @item_key
  AND wh.play_id = @play_id
  AND EXISTS (
    SELECT 1 FROM profile_watch_history scoped
    WHERE scoped.history_id = wh.history_id AND scoped.profile_id = @profile_id
  )
ORDER BY wh.watched_at DESC, wh.history_id DESC
LIMIT 1;
`).get({
    item_key: itemKey,
    play_id: episodeId.trim(),
    profile_id: profileId,
  }) as EpisodeWatchProgress | undefined;
  return row ?? null;
}

export function listUniqueWatchHistory(options: {
  source?: string | null;
  type?: string | null;
  limit?: number | null;
  profile_id?: string | null;
  household_blend?: boolean;
} = {}): WatchHistoryRow[] {
  const db = ensureDb();
  const profileId = options.profile_id?.trim().toLowerCase() || activeViewerProfileId();
  const householdBlend = options.household_blend !== false && profileId === 'household';
  const params: Record<string, string | number> = {
    profile_id: profileId,
    household_blend: householdBlend ? 1 : 0,
  };
  const clauses = [];
  if (options.source) {
    clauses.push('wh.source = @source');
    params.source = normalizeSource(options.source);
  }
  if (options.type) {
    clauses.push('wh.type = @type');
    params.type = normalizeLibraryType(options.type);
  }
  clauses.push(`
EXISTS (
  SELECT 1 FROM profile_watch_history scoped
  WHERE scoped.history_id = wh.history_id
    AND (@household_blend = 1 OR scoped.profile_id = @profile_id)
)`);
  clauses.push(`
NOT EXISTS (
  SELECT 1
  FROM watch_history newer
  WHERE newer.item_key = wh.item_key
    AND EXISTS (
      SELECT 1 FROM profile_watch_history newer_scoped
      WHERE newer_scoped.history_id = newer.history_id
        AND (@household_blend = 1 OR newer_scoped.profile_id = @profile_id)
    )
    AND (
      newer.watched_at > wh.watched_at
      OR (newer.watched_at = wh.watched_at AND newer.history_id > wh.history_id)
    )
)`);
  const limitSql = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? 'LIMIT @limit'
    : '';
  if (limitSql) {
    params.limit = Math.max(1, Math.min(5000, Math.floor(options.limit || 1)));
  }
  return db.prepare(`
SELECT
  wh.history_id,
  wh.source,
  wh.item_key,
  wh.type,
  wh.id,
  wh.play_id,
  COALESCE(wh.title, li.title) AS title,
  COALESCE(wh.poster, li.poster) AS poster,
  wh.position_sec,
  wh.duration_sec,
  wh.progress_pct,
  wh.event,
  wh.watched_at
FROM watch_history wh
JOIN library_items li ON li.item_key = wh.item_key
WHERE ${clauses.join('\n  AND ')}
ORDER BY wh.watched_at DESC, wh.history_id DESC
${limitSql};
`).all(params) as WatchHistoryRow[];
}

export function recordSearchQuery(
  normalizedQuery: string,
  displayQuery: string,
  searchedAt = nowMs(),
): SearchHistoryRow {
  const db = ensureDb();
  const normalized = normalizedQuery.trim();
  const display = displayQuery.trim();
  if (!normalized || !display) {
    throw new Error('search query requires normalized and display text');
  }
  const transaction = db.transaction(() => {
    db.prepare(`
INSERT INTO search_history(normalized_query, display_query, last_searched_at, search_count)
VALUES (@normalized_query, @display_query, @last_searched_at, 1)
ON CONFLICT(normalized_query) DO UPDATE SET
  display_query = excluded.display_query,
  last_searched_at = excluded.last_searched_at,
  search_count = search_history.search_count + 1;
`).run({
      normalized_query: normalized,
      display_query: display,
      last_searched_at: searchedAt,
    });
    db.prepare(`
DELETE FROM search_history
WHERE normalized_query NOT IN (
  SELECT normalized_query
  FROM search_history
  ORDER BY last_searched_at DESC, normalized_query ASC
  LIMIT 12
);
`).run();
  });
  transaction();
  const row = db.prepare(`
SELECT normalized_query, display_query, last_searched_at, search_count
FROM search_history
WHERE normalized_query = ?;
`).get(normalized) as SearchHistoryRow | undefined;
  if (!row) {
    throw new Error('search history write failed');
  }
  return row;
}

export function listSearchHistory(limit = 12): SearchHistoryRow[] {
  return ensureDb().prepare(`
SELECT normalized_query, display_query, last_searched_at, search_count
FROM search_history
ORDER BY last_searched_at DESC, normalized_query ASC
LIMIT @limit;
`).all({ limit: Math.max(1, Math.min(12, Math.floor(limit))) }) as SearchHistoryRow[];
}

export function recordSearchSelection(input: {
  normalized_query: string;
  entity_key: string;
  source: string;
  type: string;
  id: string;
  title: string;
  selected_at?: number;
}): SearchSelectionRow {
  const db = ensureDb();
  const normalizedQuery = input.normalized_query.trim();
  const entityKey = input.entity_key.trim();
  if (!normalizedQuery || !entityKey || !input.id.trim() || !input.title.trim()) {
    throw new Error('search selection requires query, entity, id, and title');
  }
  const selectedAt = input.selected_at ?? nowMs();
  db.prepare(`
INSERT INTO search_selections(
  normalized_query, entity_key, source, type, id, title, selected_at, selection_count
) VALUES (
  @normalized_query, @entity_key, @source, @type, @id, @title, @selected_at, 1
)
ON CONFLICT(normalized_query, entity_key) DO UPDATE SET
  source = excluded.source,
  type = excluded.type,
  id = excluded.id,
  title = excluded.title,
  selected_at = excluded.selected_at,
  selection_count = search_selections.selection_count + 1;
`).run({
    normalized_query: normalizedQuery,
    entity_key: entityKey,
    source: normalizeSource(input.source),
    type: normalizeLibraryType(input.type),
    id: input.id.trim(),
    title: input.title.trim(),
    selected_at: selectedAt,
  });
  const row = db.prepare(`
SELECT normalized_query, entity_key, source, type, id, title, selected_at, selection_count
FROM search_selections
WHERE normalized_query = ? AND entity_key = ?;
`).get(normalizedQuery, entityKey) as SearchSelectionRow | undefined;
  if (!row) {
    throw new Error('search selection write failed');
  }
  return row;
}

export function listSearchSelections(normalizedQuery: string, limit = 100): SearchSelectionRow[] {
  return ensureDb().prepare(`
SELECT normalized_query, entity_key, source, type, id, title, selected_at, selection_count
FROM search_selections
WHERE normalized_query = @normalized_query
ORDER BY selected_at DESC
LIMIT @limit;
`).all({
    normalized_query: normalizedQuery.trim(),
    limit: Math.max(1, Math.min(500, Math.floor(limit))),
  }) as SearchSelectionRow[];
}

export function clearSearchActivity(): { history: number; selections: number } {
  const db = ensureDb();
  return db.transaction(() => ({
    history: db.prepare('DELETE FROM search_history').run().changes,
    selections: db.prepare('DELETE FROM search_selections').run().changes,
  }))();
}

export function getSearchPreferences(): SearchPreferences {
  const db = ensureDb();
  const row = db.prepare(`
SELECT youtube_safe_search, updated_at
FROM search_preferences
WHERE preferences_id = 1;
`).get() as SearchPreferences | undefined;
  if (row) {
    return row;
  }
  const timestamp = nowMs();
  db.prepare(`
INSERT INTO search_preferences(preferences_id, youtube_safe_search, updated_at)
VALUES (1, 'moderate', ?)
`).run(timestamp);
  return { youtube_safe_search: 'moderate', updated_at: timestamp };
}

export function setSearchPreferences(input: {
  youtube_safe_search: SearchSafeSearch;
}): SearchPreferences {
  const safeSearch = input.youtube_safe_search;
  if (safeSearch !== 'moderate' && safeSearch !== 'strict' && safeSearch !== 'none') {
    throw new Error('youtube_safe_search must be moderate, strict, or none');
  }
  const updatedAt = nowMs();
  ensureDb().prepare(`
INSERT INTO search_preferences(preferences_id, youtube_safe_search, updated_at)
VALUES (1, @youtube_safe_search, @updated_at)
ON CONFLICT(preferences_id) DO UPDATE SET
  youtube_safe_search = excluded.youtube_safe_search,
  updated_at = excluded.updated_at;
`).run({ youtube_safe_search: safeSearch, updated_at: updatedAt });
  return { youtube_safe_search: safeSearch, updated_at: updatedAt };
}

export function listSearchStarterItems(limit = 12): SearchStarterItem[] {
  const db = ensureDb();
  return db.prepare(`
WITH candidates AS (
  SELECT
    li.source,
    li.type,
    li.id,
    COALESCE(NULLIF(TRIM(li.title), ''), li.id) AS title,
    li.poster,
    li.tab,
    si.saved_at AS activity_at
  FROM saved_items si
  JOIN library_items li ON li.item_key = si.item_key
  UNION ALL
  SELECT
    li.source,
    li.type,
    li.id,
    COALESCE(NULLIF(TRIM(li.title), ''), li.id) AS title,
    li.poster,
    li.tab,
    ws.last_watched_at AS activity_at
  FROM watch_state ws
  JOIN library_items li ON li.item_key = ws.item_key
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY source, type, id
      ORDER BY activity_at DESC
    ) AS item_rank
  FROM candidates
)
SELECT source, type, id, title, poster, tab, activity_at
FROM ranked
WHERE item_rank = 1
ORDER BY activity_at DESC
LIMIT @limit;
`).all({ limit: Math.max(1, Math.min(24, Math.floor(limit))) }) as SearchStarterItem[];
}

function profileLibraryContextId(profileIdInput: string): string {
  const profileId = normalizeViewerProfileId(profileIdInput);
  if (!profileId) throw new Error('library context requires a profile owner');
  return `${LIBRARY_CONTEXT_ID}:${profileId}`;
}

/**
 * Publish the current Detail context for one immutable viewer profile.
 *
 * `openedAt` is the launcher's monotonic view timestamp. Local fetches can
 * complete out of order, so the UPSERT must not let an older Detail overwrite a
 * newer one merely because its request reached SQLite later.
 */
export function setLibraryContext(
  input: LibraryItemInput,
  options: { profile_id?: string; opened_at?: number } = {},
): LibraryContext {
  const db = ensureDb();
  const profileId = normalizeViewerProfileId(options.profile_id ?? activeViewerProfileId());
  const contextId = profileLibraryContextId(profileId);
  const requestedOpenedAt = options.opened_at;
  const updatedAt = Number.isSafeInteger(requestedOpenedAt) && Number(requestedOpenedAt) > 0
    ? Number(requestedOpenedAt)
    : nowMs();
  const transaction = db.transaction(() => {
    const itemKey = upsertLibraryItem(db, input, updatedAt);
    db.prepare(`
INSERT INTO library_context (context_id, item_key, updated_at)
VALUES (@context_id, @item_key, @updated_at)
ON CONFLICT(context_id) DO UPDATE SET
  item_key = excluded.item_key,
  updated_at = excluded.updated_at
WHERE excluded.updated_at >= library_context.updated_at;
`).run({
      context_id: contextId,
      item_key: itemKey,
      updated_at: updatedAt,
    });
    return itemKey;
  });
  const itemKey = transaction();
  const context = getLibraryContext(profileId);
  if (!context) {
    throw new Error('library context write failed');
  }
  // A different item is the expected result when this request was stale and a
  // newer Detail context had already committed for the same owner.
  if (context.updated_at === updatedAt && context.item_key !== itemKey) {
    throw new Error('library context write returned an inconsistent item');
  }
  return context;
}

export function getLibraryContext(profileIdInput = activeViewerProfileId()): LibraryContext | null {
  const db = ensureDb();
  const profileId = normalizeViewerProfileId(profileIdInput);
  const row = db.prepare(`
SELECT
  li.source,
  li.item_key,
  li.type,
  li.id,
  COALESCE(NULLIF(TRIM(li.title), ''), li.id) AS title,
  li.poster,
  li.tab,
  lc.updated_at
FROM library_context lc
JOIN library_items li ON li.item_key = lc.item_key
WHERE lc.context_id = ?;
`).get(profileLibraryContextId(profileId)) as Omit<LibraryContext, 'profile_id'> | undefined;
  return row ? { profile_id: profileId, ...row } : null;
}

export function clearWatchHistoryForSource(source: string): number {
  const db = ensureDb();
  const normalizedSource = normalizeSource(source);
  const profileId = activeViewerProfileId();
  return db.transaction(() => {
    const rows = db.prepare(`
SELECT pwh.history_id
FROM profile_watch_history pwh
JOIN watch_history wh ON wh.history_id = pwh.history_id
WHERE pwh.profile_id = ? AND wh.source = ?
`).all(profileId, normalizedSource) as Array<{ history_id: number }>;
    if (rows.length === 0) return 0;
    const ids = rows.map((row) => row.history_id);
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(`
DELETE FROM profile_watch_history
WHERE profile_id = ? AND history_id IN (${placeholders})
`).run(profileId, ...ids);
    db.prepare(`
DELETE FROM watch_history
WHERE history_id IN (${placeholders})
  AND NOT EXISTS (
    SELECT 1 FROM profile_watch_history pwh
    WHERE pwh.history_id = watch_history.history_id
  )
`).run(...ids);
    db.prepare(`
DELETE FROM profile_recommendation_events
WHERE profile_id = ?
  AND domain = ?
  AND event_type NOT IN ('saved', 'unsaved', 'not_interested', 'not_interested_cleared', 'search')
`).run(profileId, normalizedSource === 'youtube' ? 'youtube' : 'vod');
    return rows.length;
  })();
}

export function clearLibraryFeedbackForSource(feedback: string, source: string): number {
  const db = ensureDb();
  const normalizedFeedback = feedback.trim().toLowerCase();
  const normalizedSource = normalizeSource(source);
  const profileId = activeViewerProfileId();
  return db.transaction(() => {
    const rows = db.prepare(`
SELECT pf.item_key, li.type, li.id, li.title
FROM profile_library_feedback pf
JOIN library_items li ON li.item_key = pf.item_key
WHERE pf.profile_id = @profile_id AND pf.feedback = @feedback AND li.source = @source
`).all({
      profile_id: profileId,
      feedback: normalizedFeedback,
      source: normalizedSource,
    }) as Array<{ item_key: string; type: string; id: string; title: string | null }>;
    const result = db.prepare(`
DELETE FROM profile_library_feedback
WHERE profile_id = @profile_id AND feedback = @feedback
  AND item_key IN (SELECT item_key FROM library_items WHERE source = @source)
`).run({
      profile_id: profileId,
      feedback: normalizedFeedback,
      source: normalizedSource,
    });
    if (profileId === 'household') {
      db.prepare(`
DELETE FROM library_feedback
WHERE feedback = @feedback
  AND item_key IN (SELECT item_key FROM library_items WHERE source = @source)
`).run({ feedback: normalizedFeedback, source: normalizedSource });
    }
    const occurredAt = nowMs();
    const insert = db.prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, 0, '{}', ?)
`);
    for (const row of rows) {
      insert.run(
        profileId,
        normalizedSource === 'youtube' ? 'youtube' : 'vod',
        normalizedFeedback === 'not_interested'
          ? 'not_interested_cleared'
          : `feedback_cleared:${normalizedFeedback}`,
        row.type,
        row.id,
        row.title,
        occurredAt,
      );
    }
    return result.changes;
  })();
}

export function clearLibraryContext(profileIdInput = activeViewerProfileId()): number {
  const db = ensureDb();
  const contextId = profileLibraryContextId(profileIdInput);
  const transaction = db.transaction(() => {
    const existing = db.prepare('SELECT item_key FROM library_context WHERE context_id = ?')
      .get(contextId) as { item_key: string } | undefined;
    const result = db.prepare('DELETE FROM library_context WHERE context_id = ?').run(contextId);
    if (existing) {
      cleanupUnreferencedLibraryItem(db, existing.item_key);
    }
    return result.changes;
  });
  return transaction();
}

function cleanupUnreferencedLibraryItem(db: Database.Database, itemKey: string): void {
  const row = db.prepare(`
SELECT
  (SELECT COUNT(*) FROM saved_items WHERE item_key = @item_key)
  + (SELECT COUNT(*) FROM profile_saved_items WHERE item_key = @item_key)
  + (SELECT COUNT(*) FROM watch_state WHERE item_key = @item_key)
  + (SELECT COUNT(*) FROM profile_watch_state WHERE item_key = @item_key)
  + (SELECT COUNT(*) FROM watch_history WHERE item_key = @item_key)
  + (SELECT COUNT(*) FROM profile_library_feedback WHERE item_key = @item_key)
  + (SELECT COUNT(*) FROM library_context WHERE item_key = @item_key)
  AS ref_count;
`).get({ item_key: itemKey }) as { ref_count: number } | undefined;
  if ((row?.ref_count ?? 0) === 0) {
    db.prepare('DELETE FROM library_items WHERE item_key = ?').run(itemKey);
  }
}

function importLegacyPinsOnce(db: Database.Database): void {
  const filePath = legacyPinsPath();
  if (!existsSync(filePath)) {
    return;
  }
  const importName = `user-pins:${filePath}`;
  const existing = db.prepare('SELECT import_name FROM library_imports WHERE import_name = ?').get(importName);
  if (existing) {
    return;
  }
  let pins: LegacyPin[] = [];
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { pins?: LegacyPin[] };
    pins = Array.isArray(raw.pins) ? raw.pins : [];
  } catch {
    pins = [];
  }
  const importedAt = nowMs();
  const transaction = db.transaction(() => {
    let count = 0;
    for (const pin of pins) {
      if (!pin.type || !pin.id) {
        continue;
      }
      saveLegacyPinInTransaction(db, pin, importedAt);
      count += 1;
    }
    db.prepare(`
INSERT INTO library_imports (import_name, source_path, imported_at, item_count)
VALUES (?, ?, ?, ?);
`).run(importName, filePath, importedAt, count);
  });
  transaction();
}

function saveLegacyPinInTransaction(db: Database.Database, pin: LegacyPin, importedAt: number): void {
  const savedAt = Number.isFinite(pin.pinned_at) ? Number(pin.pinned_at) : importedAt;
  const itemKey = upsertLibraryItem(db, {
    source: LIBRARY_SOURCE_MANGO,
    type: pin.type || 'movie',
    id: pin.id || '',
    title: pin.title,
    poster: pin.poster,
    tab: pin.tab ?? null,
  }, importedAt);
  db.prepare(`
INSERT INTO saved_items (item_key, saved_at, saved_by)
VALUES (@item_key, @saved_at, 'import:user-pins')
ON CONFLICT(item_key) DO NOTHING;
`).run({
    item_key: itemKey,
    saved_at: savedAt,
  });
  db.prepare(`
INSERT INTO profile_saved_items(profile_id, item_key, saved_at, saved_by)
VALUES ('household', @item_key, @saved_at, 'import:user-pins')
ON CONFLICT(profile_id, item_key) DO NOTHING;
`).run({
    item_key: itemKey,
    saved_at: savedAt,
  });
  const normalizedType = normalizeLibraryType(pin.type || 'movie');
  db.prepare(`
INSERT INTO profile_recommendation_events(
  profile_id, domain, event_type, item_type, item_id, title, strength, context_json, occurred_at
) VALUES ('household', 'vod', 'saved', ?, ?, ?, 0.8, '{"legacy":"user-pins"}', ?)
`).run(
    normalizedType,
    normalizeLibraryId(normalizedType, pin.id || ''),
    pin.title?.trim() || null,
    savedAt,
  );
}
