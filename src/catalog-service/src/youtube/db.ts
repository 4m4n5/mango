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

CREATE INDEX IF NOT EXISTS idx_youtube_items_updated ON youtube_items(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_items_channel ON youtube_items(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_rail_added ON youtube_rail_items(rail_id, score DESC, added_at DESC);
`);
  db.prepare('INSERT OR IGNORE INTO youtube_migrations(version, applied_at) VALUES (1, ?)')
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
`).all({ kind, limit: Math.max(1, Math.min(500, limit)) }) as YoutubeItem[];
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
`).all({ rail_id: railId, limit: Math.max(1, Math.min(100, limit)) }) as YoutubeRailItem[];
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
