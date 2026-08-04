import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { loadYoutubeConfig } from './config.js';
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

export function resetYoutubeDbForTests(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  initialized = false;
}

export function youtubeDbPath(): string {
  return process.env.MANGO_YOUTUBE_DB_PATH || loadYoutubeConfig().db_path;
}

function openDb(): Database.Database {
  if (!dbSingleton) {
    mkdirSync(dirname(youtubeDbPath()), { recursive: true });
    dbSingleton = new Database(youtubeDbPath());
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
}

function ensureDb(): Database.Database {
  const db = openDb();
  if (!initialized) {
    initSchema(db);
    initialized = true;
  }
  return db;
}

export function initYoutubeDb(): void {
  ensureDb();
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

export function upsertYoutubeItems(items: YoutubeItem[], rawJsonById: Map<string, unknown> = new Map()): void {
  const db = ensureDb();
  const timestamp = nowMs();
  const stmt = db.prepare(`
INSERT INTO youtube_items (
  id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, raw_json, first_seen_at, updated_at
) VALUES (
  @id, @kind, @title, @subtitle, @description, @thumbnail, @channel_id, @channel_title,
  @published_at, @duration_sec, @live_status, @playlist_id, @raw_json, @first_seen_at, @updated_at
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
  raw_json = COALESCE(excluded.raw_json, youtube_items.raw_json),
  updated_at = excluded.updated_at;
`);
  const tx = db.transaction(() => {
    for (const item of items) {
      stmt.run({
        ...item,
        kind: normalizeKind(item.kind),
        live_status: normalizeLiveStatus(item.live_status),
        raw_json: rawJsonById.has(item.id) ? JSON.stringify(rawJsonById.get(item.id)) : null,
        first_seen_at: item.updated_at || timestamp,
        updated_at: item.updated_at || timestamp,
      });
    }
  });
  tx();
}

export function getYoutubeItem(kind: string, id: string): YoutubeItem | null {
  const row = ensureDb().prepare(`
SELECT id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, updated_at
FROM youtube_items
WHERE kind = ? AND id = ?;
`).get(normalizeKind(kind), id) as YoutubeItem | undefined;
  return row ?? null;
}

export function listYoutubeItems(kind: YoutubeItemKind | null = null, limit = 50): YoutubeItem[] {
  const rows = ensureDb().prepare(`
SELECT id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, updated_at
FROM youtube_items
WHERE (@kind IS NULL OR kind = @kind)
ORDER BY updated_at DESC
  LIMIT @limit;
`).all({ kind, limit: Math.max(1, Math.min(20_000, limit)) }) as YoutubeItem[];
  return rows;
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
  published_at, duration_sec, live_status, playlist_id, updated_at
FROM youtube_items
WHERE lower(title) LIKE @like
  OR lower(COALESCE(channel_title, '')) LIKE @like
  OR lower(COALESCE(description, '')) LIKE @like
ORDER BY updated_at DESC
LIMIT @limit;
`).all({ like, limit: boundedLimit }) as YoutubeItem[];
  if (exactRows.length > 0) {
    return exactRows;
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

export function replaceYoutubeRailItems(
  railId: string,
  items: Array<{ item: YoutubeItem; score: number; reason?: string | null }>,
): void {
  const db = ensureDb();
  const timestamp = nowMs();
  upsertYoutubeItems(items.map((entry) => entry.item));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM youtube_rail_items WHERE rail_id = ?').run(railId);
    const insert = db.prepare(`
INSERT INTO youtube_rail_items (rail_id, kind, id, score, reason, added_at)
VALUES (@rail_id, @kind, @id, @score, @reason, @added_at);
`);
    for (const entry of items) {
      insert.run({
        rail_id: railId,
        kind: entry.item.kind,
        id: entry.item.id,
        score: entry.score,
        reason: entry.reason ?? null,
        added_at: timestamp,
      });
    }
  });
  tx();
}

export function listYoutubeRailIds(): string[] {
  const rows = ensureDb().prepare(`
SELECT DISTINCT rail_id
FROM youtube_rail_items
ORDER BY rail_id;
`).all() as Array<{ rail_id: string }>;
  return rows.map((row) => row.rail_id);
}

export function listYoutubeRailItems(railId: string, limit = 40): YoutubeRailItem[] {
  return ensureDb().prepare(`
SELECT
  yi.id, yi.kind, yi.title, yi.subtitle, yi.description, yi.thumbnail, yi.channel_id,
  yi.channel_title, yi.published_at, yi.duration_sec, yi.live_status, yi.playlist_id,
  yi.updated_at, yri.score, yri.reason
FROM youtube_rail_items yri
JOIN youtube_items yi ON yi.kind = yri.kind AND yi.id = yri.id
WHERE yri.rail_id = @rail_id
ORDER BY yri.score DESC, yri.added_at DESC
LIMIT @limit;
`).all({ rail_id: railId, limit: Math.max(1, Math.min(2000, limit)) }) as YoutubeRailItem[];
}

export type YoutubeForYouCandidateInput = {
  item: YoutubeItem;
  lane: string;
  source: string;
  source_weight: number;
  topic_cluster: string;
  score: number;
  score_breakdown?: Record<string, unknown>;
  reason?: string | null;
};

export type YoutubeForYouCandidate = YoutubeRailItem & {
  lane: string;
  source: string;
  source_weight: number;
  topic_cluster: string;
  score_breakdown: Record<string, unknown>;
  last_recommended_at: number | null;
  exposure_count: number;
  ignore_count: number;
  quick_stop_count: number;
};

function forYouCandidateParams(
  candidate: YoutubeForYouCandidateInput,
  timestamp: number,
): Record<string, string | number | null> {
  return {
    kind: normalizeKind(candidate.item.kind),
    id: candidate.item.id,
    lane: candidate.lane,
    source: candidate.source,
    source_weight: candidate.source_weight,
    topic_cluster: candidate.topic_cluster,
    score: candidate.score,
    score_breakdown: JSON.stringify(candidate.score_breakdown || {}),
    reason: candidate.reason ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function prepareForYouCandidateUpsert(db: Database.Database): Database.Statement {
  return db.prepare(`
INSERT INTO youtube_for_you_candidates (
  kind, id, lane, source, source_weight, topic_cluster, score,
  score_breakdown, reason, created_at, updated_at
) VALUES (
  @kind, @id, @lane, @source, @source_weight, @topic_cluster, @score,
  @score_breakdown, @reason, @created_at, @updated_at
)
ON CONFLICT(kind, id) DO UPDATE SET
  lane = excluded.lane,
  source = excluded.source,
  source_weight = excluded.source_weight,
  topic_cluster = excluded.topic_cluster,
  score = excluded.score,
  score_breakdown = excluded.score_breakdown,
  reason = excluded.reason,
  updated_at = excluded.updated_at;
`);
}

function parseBreakdown(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function upsertForYouCandidates(candidates: YoutubeForYouCandidateInput[]): void {
  if (candidates.length === 0) return;
  const db = ensureDb();
  const timestamp = nowMs();
  upsertYoutubeItems(candidates.map((entry) => entry.item));
  const stmt = prepareForYouCandidateUpsert(db);
  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      stmt.run(forYouCandidateParams(candidate, timestamp));
    }
  });
  tx();
}

/**
 * Atomically publishes one complete shared acquisition generation. Candidate
 * rows omitted by the new generation are removed, while UPSERT deliberately
 * leaves legacy aggregate counters and profile-owned exposure state unchanged
 * for retained identities. An empty rebuild is treated as a failed acquisition
 * and retains the last-good reservoir.
 */
export function replaceForYouCandidates(candidates: YoutubeForYouCandidateInput[]): void {
  if (candidates.length === 0) return;
  const db = ensureDb();
  upsertYoutubeItems(candidates.map((entry) => entry.item));
  const upsert = prepareForYouCandidateUpsert(db);
  db.transaction(() => {
    const latest = db.prepare(`
SELECT COALESCE(MAX(updated_at), 0) AS updated_at
FROM youtube_for_you_candidates
`).get() as { updated_at: number };
    // A strictly monotonic generation marker makes replacement correct even
    // when two refreshes complete within the same millisecond.
    const generation = Math.max(nowMs(), latest.updated_at + 1);
    for (const candidate of candidates) {
      upsert.run(forYouCandidateParams(candidate, generation));
    }
    db.prepare(`
DELETE FROM youtube_for_you_candidates
WHERE updated_at != ?
`).run(generation);
    // Profile state is independent from acquisition. Retain counters for every
    // still-eligible identity and prune only orphaned For-You state; unrelated
    // profiles' other rails and contextual recommendation state are untouched.
    db.prepare(`
DELETE FROM youtube_profile_candidate_state
WHERE rail_id = 'for_you'
  AND context_id = ''
  AND NOT EXISTS (
    SELECT 1
    FROM youtube_for_you_candidates fy
    WHERE fy.kind = youtube_profile_candidate_state.kind
      AND fy.id = youtube_profile_candidate_state.id
  )
`).run();
  })();
}

export function listForYouCandidates(limit = 1000): YoutubeForYouCandidate[] {
  const rows = ensureDb().prepare(`
SELECT
  yi.id, yi.kind, yi.title, yi.subtitle, yi.description, yi.thumbnail, yi.channel_id,
  yi.channel_title, yi.published_at, yi.duration_sec, yi.live_status, yi.playlist_id,
  yi.updated_at, fy.score, fy.reason, fy.lane, fy.source, fy.source_weight,
  fy.topic_cluster, fy.score_breakdown, fy.last_recommended_at, fy.exposure_count,
  fy.ignore_count, fy.quick_stop_count
FROM youtube_for_you_candidates fy
JOIN youtube_items yi ON yi.kind = fy.kind AND yi.id = fy.id
ORDER BY fy.score DESC, fy.updated_at DESC
LIMIT @limit;
`).all({ limit: Math.max(1, Math.min(2000, limit)) }) as Array<YoutubeForYouCandidate & { score_breakdown: string }>;
  return rows.map((row) => ({
    ...row,
    score_breakdown: parseBreakdown(row.score_breakdown),
  }));
}

export function noteForYouExposures(ids: string[], at = nowMs()): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const db = ensureDb();
  const stmt = db.prepare(`
UPDATE youtube_for_you_candidates
SET last_recommended_at = @at,
    exposure_count = exposure_count + 1,
    updated_at = @at
WHERE kind = 'video' AND id = @id;
`);
  const tx = db.transaction(() => {
    for (const id of unique) {
      stmt.run({ id, at });
    }
  });
  tx();
}

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

export function setForYouCandidateStats(
  id: string,
  stats: Partial<Pick<YoutubeForYouCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'>>,
): void {
  const current = ensureDb().prepare(`
SELECT last_recommended_at, exposure_count, ignore_count, quick_stop_count
FROM youtube_for_you_candidates
WHERE kind = 'video' AND id = ?;
`).get(id) as Pick<YoutubeForYouCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'> | undefined;
  if (!current) return;
  ensureDb().prepare(`
UPDATE youtube_for_you_candidates
SET last_recommended_at = @last_recommended_at,
    exposure_count = @exposure_count,
    ignore_count = @ignore_count,
    quick_stop_count = @quick_stop_count,
    updated_at = @updated_at
WHERE kind = 'video' AND id = @id;
`).run({
    id,
    last_recommended_at: stats.last_recommended_at !== undefined ? stats.last_recommended_at : current.last_recommended_at,
    exposure_count: stats.exposure_count !== undefined ? stats.exposure_count : current.exposure_count,
    ignore_count: stats.ignore_count !== undefined ? stats.ignore_count : current.ignore_count,
    quick_stop_count: stats.quick_stop_count !== undefined ? stats.quick_stop_count : current.quick_stop_count,
    updated_at: nowMs(),
  });
}

export type YoutubeFreshFindCandidateInput = {
  item: YoutubeItem;
  source_bucket: string;
  query: string;
  topic_cluster: string;
  score: number;
  score_breakdown?: Record<string, unknown>;
  reason?: string | null;
  creator_subscriber_count?: number | null;
  creator_video_count?: number | null;
};

export type YoutubeFreshFindCandidate = YoutubeRailItem & {
  source_bucket: string;
  query: string;
  topic_cluster: string;
  score_breakdown: Record<string, unknown>;
  creator_subscriber_count: number | null;
  creator_video_count: number | null;
  last_recommended_at: number | null;
  exposure_count: number;
  ignore_count: number;
  quick_stop_count: number;
};

export function upsertFreshFindCandidates(candidates: YoutubeFreshFindCandidateInput[]): void {
  if (candidates.length === 0) return;
  const db = ensureDb();
  const timestamp = nowMs();
  upsertYoutubeItems(candidates.map((entry) => entry.item));
  const stmt = db.prepare(`
INSERT INTO youtube_fresh_find_candidates (
  kind, id, source_bucket, query, topic_cluster, score, score_breakdown, reason,
  creator_subscriber_count, creator_video_count, created_at, updated_at
) VALUES (
  @kind, @id, @source_bucket, @query, @topic_cluster, @score, @score_breakdown, @reason,
  @creator_subscriber_count, @creator_video_count, @created_at, @updated_at
)
ON CONFLICT(kind, id) DO UPDATE SET
  source_bucket = excluded.source_bucket,
  query = excluded.query,
  topic_cluster = excluded.topic_cluster,
  score = excluded.score,
  score_breakdown = excluded.score_breakdown,
  reason = excluded.reason,
  creator_subscriber_count = excluded.creator_subscriber_count,
  creator_video_count = excluded.creator_video_count,
  updated_at = excluded.updated_at;
`);
  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      stmt.run({
        kind: normalizeKind(candidate.item.kind),
        id: candidate.item.id,
        source_bucket: candidate.source_bucket,
        query: candidate.query,
        topic_cluster: candidate.topic_cluster,
        score: candidate.score,
        score_breakdown: JSON.stringify(candidate.score_breakdown || {}),
        reason: candidate.reason ?? null,
        creator_subscriber_count: candidate.creator_subscriber_count ?? null,
        creator_video_count: candidate.creator_video_count ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
  });
  tx();
}

export function listFreshFindCandidates(limit = 300): YoutubeFreshFindCandidate[] {
  const rows = ensureDb().prepare(`
SELECT
  yi.id, yi.kind, yi.title, yi.subtitle, yi.description, yi.thumbnail, yi.channel_id,
  yi.channel_title, yi.published_at, yi.duration_sec, yi.live_status, yi.playlist_id,
  yi.updated_at, ff.score, ff.reason, ff.source_bucket, ff.query, ff.topic_cluster,
  ff.score_breakdown, ff.creator_subscriber_count, ff.creator_video_count,
  ff.last_recommended_at, ff.exposure_count, ff.ignore_count, ff.quick_stop_count
FROM youtube_fresh_find_candidates ff
JOIN youtube_items yi ON yi.kind = ff.kind AND yi.id = ff.id
ORDER BY ff.score DESC, ff.updated_at DESC
LIMIT @limit;
`).all({ limit: Math.max(1, Math.min(2000, limit)) }) as Array<YoutubeFreshFindCandidate & { score_breakdown: string }>;
  return rows.map((row) => ({
    ...row,
    score_breakdown: parseBreakdown(row.score_breakdown),
  }));
}

export function noteFreshFindExposures(ids: string[], at = nowMs()): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const db = ensureDb();
  const stmt = db.prepare(`
UPDATE youtube_fresh_find_candidates
SET last_recommended_at = @at,
    exposure_count = exposure_count + 1,
    updated_at = @at
WHERE kind = 'video' AND id = @id;
`);
  const tx = db.transaction(() => {
    for (const id of unique) {
      stmt.run({ id, at });
    }
  });
  tx();
}

export function setFreshFindCandidateStats(
  id: string,
  stats: Partial<Pick<YoutubeFreshFindCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'>>,
): void {
  const current = ensureDb().prepare(`
SELECT last_recommended_at, exposure_count, ignore_count, quick_stop_count
FROM youtube_fresh_find_candidates
WHERE kind = 'video' AND id = ?;
`).get(id) as Pick<YoutubeFreshFindCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'> | undefined;
  if (!current) return;
  ensureDb().prepare(`
UPDATE youtube_fresh_find_candidates
SET last_recommended_at = @last_recommended_at,
    exposure_count = @exposure_count,
    ignore_count = @ignore_count,
    quick_stop_count = @quick_stop_count,
    updated_at = @updated_at
WHERE kind = 'video' AND id = @id;
`).run({
    id,
    last_recommended_at: stats.last_recommended_at !== undefined ? stats.last_recommended_at : current.last_recommended_at,
    exposure_count: stats.exposure_count !== undefined ? stats.exposure_count : current.exposure_count,
    ignore_count: stats.ignore_count !== undefined ? stats.ignore_count : current.ignore_count,
    quick_stop_count: stats.quick_stop_count !== undefined ? stats.quick_stop_count : current.quick_stop_count,
    updated_at: nowMs(),
  });
}

export function pruneFreshFindCandidates(limit = 300): void {
  ensureDb().prepare(`
DELETE FROM youtube_fresh_find_candidates
WHERE rowid NOT IN (
  SELECT rowid
  FROM youtube_fresh_find_candidates
  ORDER BY score DESC, updated_at DESC
  LIMIT @limit
);
`).run({ limit: Math.max(1, Math.min(2000, limit)) });
}

export type YoutubeBecauseYouWatchedCandidateInput = {
  item: YoutubeItem;
  seed_video_id: string;
  seed_watched_at: number;
  relation_type: string;
  query: string;
  topic_cluster: string;
  score: number;
  score_breakdown?: Record<string, unknown>;
  reason?: string | null;
};

export type YoutubeBecauseYouWatchedCandidate = YoutubeRailItem & {
  seed_video_id: string;
  seed_watched_at: number;
  relation_type: string;
  query: string;
  topic_cluster: string;
  score_breakdown: Record<string, unknown>;
  last_recommended_at: number | null;
  exposure_count: number;
  ignore_count: number;
  quick_stop_count: number;
};

export function upsertBecauseYouWatchedCandidates(candidates: YoutubeBecauseYouWatchedCandidateInput[]): void {
  if (candidates.length === 0) return;
  const db = ensureDb();
  const timestamp = nowMs();
  upsertYoutubeItems(candidates.map((entry) => entry.item));
  const stmt = db.prepare(`
INSERT INTO youtube_because_you_watched_candidates (
  kind, id, seed_video_id, seed_watched_at, relation_type, query, topic_cluster,
  score, score_breakdown, reason, created_at, updated_at
) VALUES (
  @kind, @id, @seed_video_id, @seed_watched_at, @relation_type, @query, @topic_cluster,
  @score, @score_breakdown, @reason, @created_at, @updated_at
)
ON CONFLICT(seed_video_id, kind, id) DO UPDATE SET
  seed_watched_at = excluded.seed_watched_at,
  relation_type = excluded.relation_type,
  query = excluded.query,
  topic_cluster = excluded.topic_cluster,
  score = excluded.score,
  score_breakdown = excluded.score_breakdown,
  reason = excluded.reason,
  updated_at = excluded.updated_at;
`);
  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      stmt.run({
        kind: normalizeKind(candidate.item.kind),
        id: candidate.item.id,
        seed_video_id: candidate.seed_video_id,
        seed_watched_at: candidate.seed_watched_at,
        relation_type: candidate.relation_type,
        query: candidate.query,
        topic_cluster: candidate.topic_cluster,
        score: candidate.score,
        score_breakdown: JSON.stringify(candidate.score_breakdown || {}),
        reason: candidate.reason ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
  });
  tx();
}

export function listBecauseYouWatchedCandidates(seedVideoId: string, limit = 300): YoutubeBecauseYouWatchedCandidate[] {
  const rows = ensureDb().prepare(`
SELECT
  yi.id, yi.kind, yi.title, yi.subtitle, yi.description, yi.thumbnail, yi.channel_id,
  yi.channel_title, yi.published_at, yi.duration_sec, yi.live_status, yi.playlist_id,
  yi.updated_at, byw.score, byw.reason, byw.seed_video_id, byw.seed_watched_at,
  byw.relation_type, byw.query, byw.topic_cluster, byw.score_breakdown,
  byw.last_recommended_at, byw.exposure_count, byw.ignore_count, byw.quick_stop_count
FROM youtube_because_you_watched_candidates byw
JOIN youtube_items yi ON yi.kind = byw.kind AND yi.id = byw.id
WHERE byw.seed_video_id = @seed_video_id
ORDER BY byw.score DESC, byw.updated_at DESC
LIMIT @limit;
`).all({
    seed_video_id: seedVideoId,
    limit: Math.max(1, Math.min(2000, limit)),
  }) as Array<YoutubeBecauseYouWatchedCandidate & { score_breakdown: string }>;
  return rows.map((row) => ({
    ...row,
    score_breakdown: parseBreakdown(row.score_breakdown),
  }));
}

export function noteBecauseYouWatchedExposures(seedVideoId: string, ids: string[], at = nowMs()): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const db = ensureDb();
  const stmt = db.prepare(`
UPDATE youtube_because_you_watched_candidates
SET last_recommended_at = @at,
    exposure_count = exposure_count + 1,
    updated_at = @at
WHERE seed_video_id = @seed_video_id AND kind = 'video' AND id = @id;
`);
  const tx = db.transaction(() => {
    for (const id of unique) {
      stmt.run({ seed_video_id: seedVideoId, id, at });
    }
  });
  tx();
}

export function setBecauseYouWatchedCandidateStats(
  seedVideoId: string,
  id: string,
  stats: Partial<Pick<YoutubeBecauseYouWatchedCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'>>,
): void {
  const current = ensureDb().prepare(`
SELECT last_recommended_at, exposure_count, ignore_count, quick_stop_count
FROM youtube_because_you_watched_candidates
WHERE seed_video_id = @seed_video_id AND kind = 'video' AND id = @id;
`).get({ seed_video_id: seedVideoId, id }) as Pick<YoutubeBecauseYouWatchedCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'> | undefined;
  if (!current) return;
  ensureDb().prepare(`
UPDATE youtube_because_you_watched_candidates
SET last_recommended_at = @last_recommended_at,
    exposure_count = @exposure_count,
    ignore_count = @ignore_count,
    quick_stop_count = @quick_stop_count,
    updated_at = @updated_at
WHERE seed_video_id = @seed_video_id AND kind = 'video' AND id = @id;
`).run({
    seed_video_id: seedVideoId,
    id,
    last_recommended_at: stats.last_recommended_at !== undefined ? stats.last_recommended_at : current.last_recommended_at,
    exposure_count: stats.exposure_count !== undefined ? stats.exposure_count : current.exposure_count,
    ignore_count: stats.ignore_count !== undefined ? stats.ignore_count : current.ignore_count,
    quick_stop_count: stats.quick_stop_count !== undefined ? stats.quick_stop_count : current.quick_stop_count,
    updated_at: nowMs(),
  });
}

export function pruneBecauseYouWatchedCandidates(limit = 600): void {
  ensureDb().prepare(`
DELETE FROM youtube_because_you_watched_candidates
WHERE rowid NOT IN (
  SELECT rowid
  FROM youtube_because_you_watched_candidates
  ORDER BY seed_watched_at DESC, score DESC, updated_at DESC
  LIMIT @limit
);
`).run({ limit: Math.max(1, Math.min(5000, limit)) });
}

export type YoutubeLiveNowCandidateInput = {
  item: YoutubeItem;
  source_lane: string;
  query: string;
  topic_cluster: string;
  score: number;
  score_breakdown?: Record<string, unknown>;
  reason?: string | null;
  last_verified_at: number;
  expires_at: number;
};

export type YoutubeLiveNowCandidate = YoutubeRailItem & {
  source_lane: string;
  query: string;
  topic_cluster: string;
  score_breakdown: Record<string, unknown>;
  last_verified_at: number;
  expires_at: number;
  last_recommended_at: number | null;
  exposure_count: number;
  ignore_count: number;
  quick_stop_count: number;
};

export function upsertLiveNowCandidates(candidates: YoutubeLiveNowCandidateInput[]): void {
  if (candidates.length === 0) return;
  const db = ensureDb();
  const timestamp = nowMs();
  upsertYoutubeItems(candidates.map((entry) => entry.item));
  const stmt = db.prepare(`
INSERT INTO youtube_live_now_candidates (
  kind, id, source_lane, query, topic_cluster, score, score_breakdown, reason,
  last_verified_at, expires_at, created_at, updated_at
) VALUES (
  @kind, @id, @source_lane, @query, @topic_cluster, @score, @score_breakdown, @reason,
  @last_verified_at, @expires_at, @created_at, @updated_at
)
ON CONFLICT(kind, id) DO UPDATE SET
  source_lane = excluded.source_lane,
  query = excluded.query,
  topic_cluster = excluded.topic_cluster,
  score = excluded.score,
  score_breakdown = excluded.score_breakdown,
  reason = excluded.reason,
  last_verified_at = excluded.last_verified_at,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at;
`);
  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      stmt.run({
        kind: normalizeKind(candidate.item.kind),
        id: candidate.item.id,
        source_lane: candidate.source_lane,
        query: candidate.query,
        topic_cluster: candidate.topic_cluster,
        score: candidate.score,
        score_breakdown: JSON.stringify(candidate.score_breakdown || {}),
        reason: candidate.reason ?? null,
        last_verified_at: candidate.last_verified_at,
        expires_at: candidate.expires_at,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
  });
  tx();
}

export function listLiveNowCandidates(limit = 120): YoutubeLiveNowCandidate[] {
  const rows = ensureDb().prepare(`
SELECT
  yi.id, yi.kind, yi.title, yi.subtitle, yi.description, yi.thumbnail, yi.channel_id,
  yi.channel_title, yi.published_at, yi.duration_sec, yi.live_status, yi.playlist_id,
  yi.updated_at, ln.score, ln.reason, ln.source_lane, ln.query, ln.topic_cluster,
  ln.score_breakdown, ln.last_verified_at, ln.expires_at, ln.last_recommended_at,
  ln.exposure_count, ln.ignore_count, ln.quick_stop_count
FROM youtube_live_now_candidates ln
JOIN youtube_items yi ON yi.kind = ln.kind AND yi.id = ln.id
ORDER BY ln.score DESC, ln.updated_at DESC
LIMIT @limit;
`).all({ limit: Math.max(1, Math.min(2000, limit)) }) as Array<YoutubeLiveNowCandidate & { score_breakdown: string }>;
  return rows.map((row) => ({
    ...row,
    score_breakdown: parseBreakdown(row.score_breakdown),
  }));
}

export function noteLiveNowExposures(ids: string[], at = nowMs()): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const db = ensureDb();
  const stmt = db.prepare(`
UPDATE youtube_live_now_candidates
SET last_recommended_at = @at,
    exposure_count = exposure_count + 1,
    updated_at = @at
WHERE kind = 'video' AND id = @id;
`);
  const tx = db.transaction(() => {
    for (const id of unique) {
      stmt.run({ id, at });
    }
  });
  tx();
}

export function setLiveNowCandidateStats(
  id: string,
  stats: Partial<Pick<YoutubeLiveNowCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'>>,
): void {
  const current = ensureDb().prepare(`
SELECT last_recommended_at, exposure_count, ignore_count, quick_stop_count
FROM youtube_live_now_candidates
WHERE kind = 'video' AND id = ?;
`).get(id) as Pick<YoutubeLiveNowCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'> | undefined;
  if (!current) return;
  ensureDb().prepare(`
UPDATE youtube_live_now_candidates
SET last_recommended_at = @last_recommended_at,
    exposure_count = @exposure_count,
    ignore_count = @ignore_count,
    quick_stop_count = @quick_stop_count,
    updated_at = @updated_at
WHERE kind = 'video' AND id = @id;
`).run({
    id,
    last_recommended_at: stats.last_recommended_at !== undefined ? stats.last_recommended_at : current.last_recommended_at,
    exposure_count: stats.exposure_count !== undefined ? stats.exposure_count : current.exposure_count,
    ignore_count: stats.ignore_count !== undefined ? stats.ignore_count : current.ignore_count,
    quick_stop_count: stats.quick_stop_count !== undefined ? stats.quick_stop_count : current.quick_stop_count,
    updated_at: nowMs(),
  });
}

export function pruneLiveNowCandidates(limit = 120): void {
  ensureDb().prepare(`
DELETE FROM youtube_live_now_candidates
WHERE rowid NOT IN (
  SELECT rowid
  FROM youtube_live_now_candidates
  ORDER BY expires_at DESC, score DESC, updated_at DESC
  LIMIT @limit
);
`).run({ limit: Math.max(1, Math.min(2000, limit)) });
}

export type YoutubePopularCandidateInput = {
  item: YoutubeItem;
  source_region: string;
  category_id: string;
  category_label: string;
  topic_cluster: string;
  score: number;
  score_breakdown?: Record<string, unknown>;
  reason?: string | null;
};

export type YoutubePopularCandidate = YoutubeRailItem & {
  source_region: string;
  category_id: string;
  category_label: string;
  topic_cluster: string;
  score_breakdown: Record<string, unknown>;
  last_recommended_at: number | null;
  exposure_count: number;
  ignore_count: number;
  quick_stop_count: number;
};

export function upsertPopularCandidates(candidates: YoutubePopularCandidateInput[]): void {
  if (candidates.length === 0) return;
  const db = ensureDb();
  const timestamp = nowMs();
  upsertYoutubeItems(candidates.map((entry) => entry.item));
  const stmt = db.prepare(`
INSERT INTO youtube_popular_candidates (
  kind, id, source_region, category_id, category_label, topic_cluster,
  score, score_breakdown, reason, created_at, updated_at
) VALUES (
  @kind, @id, @source_region, @category_id, @category_label, @topic_cluster,
  @score, @score_breakdown, @reason, @created_at, @updated_at
)
ON CONFLICT(kind, id) DO UPDATE SET
  source_region = excluded.source_region,
  category_id = excluded.category_id,
  category_label = excluded.category_label,
  topic_cluster = excluded.topic_cluster,
  score = excluded.score,
  score_breakdown = excluded.score_breakdown,
  reason = excluded.reason,
  updated_at = excluded.updated_at;
`);
  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      stmt.run({
        kind: normalizeKind(candidate.item.kind),
        id: candidate.item.id,
        source_region: candidate.source_region,
        category_id: candidate.category_id,
        category_label: candidate.category_label,
        topic_cluster: candidate.topic_cluster,
        score: candidate.score,
        score_breakdown: JSON.stringify(candidate.score_breakdown || {}),
        reason: candidate.reason ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
  });
  tx();
}

export function listPopularCandidates(limit = 300): YoutubePopularCandidate[] {
  const rows = ensureDb().prepare(`
SELECT
  yi.id, yi.kind, yi.title, yi.subtitle, yi.description, yi.thumbnail, yi.channel_id,
  yi.channel_title, yi.published_at, yi.duration_sec, yi.live_status, yi.playlist_id,
  yi.updated_at, pc.score, pc.reason, pc.source_region, pc.category_id,
  pc.category_label, pc.topic_cluster, pc.score_breakdown, pc.last_recommended_at,
  pc.exposure_count, pc.ignore_count, pc.quick_stop_count
FROM youtube_popular_candidates pc
JOIN youtube_items yi ON yi.kind = pc.kind AND yi.id = pc.id
ORDER BY pc.score DESC, pc.updated_at DESC
LIMIT @limit;
`).all({ limit: Math.max(1, Math.min(2000, limit)) }) as Array<YoutubePopularCandidate & { score_breakdown: string }>;
  return rows.map((row) => ({
    ...row,
    score_breakdown: parseBreakdown(row.score_breakdown),
  }));
}

export function notePopularExposures(ids: string[], at = nowMs()): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const db = ensureDb();
  const stmt = db.prepare(`
UPDATE youtube_popular_candidates
SET last_recommended_at = @at,
    exposure_count = exposure_count + 1,
    updated_at = @at
WHERE kind = 'video' AND id = @id;
`);
  const tx = db.transaction(() => {
    for (const id of unique) {
      stmt.run({ id, at });
    }
  });
  tx();
}

export function setPopularCandidateStats(
  id: string,
  stats: Partial<Pick<YoutubePopularCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'>>,
): void {
  const current = ensureDb().prepare(`
SELECT last_recommended_at, exposure_count, ignore_count, quick_stop_count
FROM youtube_popular_candidates
WHERE kind = 'video' AND id = ?;
`).get(id) as Pick<YoutubePopularCandidate, 'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'> | undefined;
  if (!current) return;
  ensureDb().prepare(`
UPDATE youtube_popular_candidates
SET last_recommended_at = @last_recommended_at,
    exposure_count = @exposure_count,
    ignore_count = @ignore_count,
    quick_stop_count = @quick_stop_count,
    updated_at = @updated_at
WHERE kind = 'video' AND id = @id;
`).run({
    id,
    last_recommended_at: stats.last_recommended_at !== undefined ? stats.last_recommended_at : current.last_recommended_at,
    exposure_count: stats.exposure_count !== undefined ? stats.exposure_count : current.exposure_count,
    ignore_count: stats.ignore_count !== undefined ? stats.ignore_count : current.ignore_count,
    quick_stop_count: stats.quick_stop_count !== undefined ? stats.quick_stop_count : current.quick_stop_count,
    updated_at: nowMs(),
  });
}

export function prunePopularCandidates(limit = 300): void {
  ensureDb().prepare(`
DELETE FROM youtube_popular_candidates
WHERE rowid NOT IN (
  SELECT rowid
  FROM youtube_popular_candidates
  ORDER BY score DESC, updated_at DESC
  LIMIT @limit
);
`).run({ limit: Math.max(1, Math.min(2000, limit)) });
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

const PERSONALIZATION_CANDIDATE_TABLES = [
  'youtube_for_you_candidates',
  'youtube_fresh_find_candidates',
  'youtube_because_you_watched_candidates',
  'youtube_live_now_candidates',
  'youtube_popular_candidates',
] as const;

const PERSONALIZATION_RAIL_IDS = [
  'for_you',
  'fresh_finds',
  'because_you_watched',
  'live_now',
  'popular',
] as const;

export function clearYoutubePersonalizationReservoirs(): {
  candidates_cleared: number;
  rails_cleared: number;
} {
  const db = ensureDb();
  return db.transaction(() => {
    let candidatesCleared = 0;
    for (const table of PERSONALIZATION_CANDIDATE_TABLES) {
      candidatesCleared += db.prepare(`DELETE FROM ${table}`).run().changes;
    }
    let railsCleared = 0;
    for (const railId of PERSONALIZATION_RAIL_IDS) {
      railsCleared += db.prepare('DELETE FROM youtube_rail_items WHERE rail_id = ?').run(railId).changes;
    }
    return {
      candidates_cleared: candidatesCleared,
      rails_cleared: railsCleared,
    };
  })();
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
