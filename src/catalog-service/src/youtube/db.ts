import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { loadYoutubeConfig } from './config.js';
import type { YoutubeItem, YoutubeItemKind, YoutubeLiveStatus, YoutubeRailItem, YoutubeRefreshStatus } from './types.js';

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

CREATE INDEX IF NOT EXISTS idx_youtube_items_updated ON youtube_items(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_items_channel ON youtube_items(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_rail_added ON youtube_rail_items(rail_id, score DESC, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_for_you_score ON youtube_for_you_candidates(score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_for_you_lane ON youtube_for_you_candidates(lane, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_for_you_exposure ON youtube_for_you_candidates(last_recommended_at);
CREATE INDEX IF NOT EXISTS idx_youtube_fresh_find_score ON youtube_fresh_find_candidates(score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_fresh_find_bucket ON youtube_fresh_find_candidates(source_bucket, score DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_fresh_find_exposure ON youtube_fresh_find_candidates(last_recommended_at);
`);
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (1, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (2, ?)')
    .run(nowMs());
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (3, ?)')
    .run(nowMs());
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
`).all({ kind, limit: Math.max(1, Math.min(2000, limit)) }) as YoutubeItem[];
  return rows;
}

export function searchCachedYoutubeItems(query: string, limit = 25): YoutubeItem[] {
  const like = `%${query.trim().toLowerCase()}%`;
  if (like === '%%') {
    return listYoutubeItems(null, limit);
  }
  return ensureDb().prepare(`
SELECT id, kind, title, subtitle, description, thumbnail, channel_id, channel_title,
  published_at, duration_sec, live_status, playlist_id, updated_at
FROM youtube_items
WHERE lower(title) LIKE @like OR lower(COALESCE(channel_title, '')) LIKE @like
ORDER BY updated_at DESC
LIMIT @limit;
`).all({ like, limit: Math.max(1, Math.min(100, limit)) }) as YoutubeItem[];
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
  const stmt = db.prepare(`
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
  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      stmt.run({
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
      });
    }
  });
  tx();
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
    ignore_count = ignore_count + 1,
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
    ignore_count = ignore_count + 1,
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

export function incrementYoutubeQuota(units: number): void {
  const day = todayPacific();
  const current = getYoutubeState<{ day: string; units: number }>('quota', { day, units: 0 });
  const next = current.day === day
    ? { day, units: current.units + units }
    : { day, units };
  setYoutubeState('quota', next);
}

export function youtubeRefreshStatus(): YoutubeRefreshStatus {
  const quota = getYoutubeState<{ day: string; units: number }>('quota', { day: todayPacific(), units: 0 });
  return {
    last_refresh_at: getYoutubeState<number | null>('last_refresh_at', null),
    last_success_at: getYoutubeState<number | null>('last_success_at', null),
    last_error: getYoutubeState<string | null>('last_error', null),
    last_reason: getYoutubeState<string | null>('last_reason', null),
    quota_used_today: quota.day === todayPacific() ? quota.units : 0,
    quota_reset_day: todayPacific(),
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
