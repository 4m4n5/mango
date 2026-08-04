import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { CatalogTab } from '../rails.js';
import {
  CONTINUE_RAIL_ID,
  DEFAULT_PROGRESS_DB_PATH,
  PROGRESS_CONTINUE_LIMIT,
  PROGRESS_CONTINUE_MAX,
  PROGRESS_CONTINUE_MIN,
  PROGRESS_CONTINUE_MIN_SEC,
} from './config.js';
import {
  continueSubtitle,
  isContinueEligible,
  progressPct,
  progressTabForType,
  progressTitleKey,
} from './keys.js';
import {
  activeViewerProfileId,
  getViewerProfile,
  recordLibraryWatch,
} from '../library/db.js';

const PROFILE_PROGRESS_SCHEMA_VERSION = 2;

export type WatchProgressRecord = {
  /** Present on persisted rows; optional keeps pure formatting fixtures compatible. */
  profile_id?: string;
  progress_key: string;
  type: string;
  id: string;
  play_id: string;
  title: string | null;
  poster: string | null;
  position_sec: number;
  duration_sec: number;
  progress_pct: number;
  updated_at: number;
};

export type ContinueRailItem = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  poster: string;
  year?: number | string;
  description?: string;
  source: string;
  progress: {
    play_id: string;
    position_sec: number;
    duration_sec: number;
    progress_pct: number;
  };
};

let dbSingleton: Database.Database | null = null;

export function resetProgressDbForTests(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
}

function dbPath(): string {
  return process.env.MANGO_PROGRESS_DB_PATH || DEFAULT_PROGRESS_DB_PATH;
}

function openDb(): Database.Database {
  if (!dbSingleton) {
    dbSingleton = new Database(dbPath());
  }
  return dbSingleton;
}

export async function initProgressDb(): Promise<void> {
  await mkdir(dirname(dbPath()), { recursive: true });
  const db = openDb();
  db.pragma('journal_mode = WAL');
  db.exec(`
CREATE TABLE IF NOT EXISTS watch_progress (
  progress_key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  title TEXT,
  poster TEXT,
  position_sec REAL NOT NULL,
  duration_sec REAL NOT NULL,
  progress_pct REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watch_progress_updated ON watch_progress(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_progress_type ON watch_progress(type, updated_at DESC);

CREATE TABLE IF NOT EXISTS progress_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_watch_progress (
  profile_id TEXT NOT NULL,
  progress_key TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  title TEXT,
  poster TEXT,
  position_sec REAL NOT NULL,
  duration_sec REAL NOT NULL,
  progress_pct REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, progress_key)
);

CREATE INDEX IF NOT EXISTS idx_profile_watch_progress_updated
  ON profile_watch_progress(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_watch_progress_type
  ON profile_watch_progress(profile_id, type, updated_at DESC);
`);
  const migrated = db.prepare('SELECT 1 FROM progress_migrations WHERE version = ?')
    .get(PROFILE_PROGRESS_SCHEMA_VERSION);
  if (!migrated) {
    db.transaction(() => {
      // Pre-profile progress has one unambiguous owner: Household. Keep the
      // legacy table intact as rollback evidence; the profile table is the new
      // source of truth and supports the same title in multiple profiles.
      db.exec(`
INSERT OR IGNORE INTO profile_watch_progress (
  profile_id, progress_key, type, id, play_id, title, poster,
  position_sec, duration_sec, progress_pct, updated_at
)
SELECT
  'household', progress_key, type, id, play_id, title, poster,
  position_sec, duration_sec, progress_pct, updated_at
FROM watch_progress;
`);
      db.prepare('INSERT INTO progress_migrations(version, applied_at) VALUES (?, ?)')
        .run(PROFILE_PROGRESS_SCHEMA_VERSION, Date.now());
    })();
  }
}

function resolveProgressProfileId(profileId?: string | null): string {
  if (!profileId) return activeViewerProfileId();
  const profile = getViewerProfile(profileId);
  if (!profile) throw new Error('unknown viewer profile');
  return profile.profile_id;
}

export function upsertWatchProgress(input: {
  profile_id?: string;
  source?: string | null;
  type: string;
  id: string;
  play_id: string;
  title?: string | null;
  poster?: string | null;
  position_sec: number;
  duration_sec: number;
  tab?: CatalogTab | null;
}): WatchProgressRecord | null {
  const profileId = resolveProgressProfileId(input.profile_id);
  const position = Math.max(0, input.position_sec);
  const duration = Math.max(0, input.duration_sec);
  const pct = progressPct(position, duration);
  const key = progressTitleKey(input.type, input.play_id);
  const now = Date.now();
  const titleId = input.type === 'series'
    ? (input.id.includes(':') ? input.id.split(':')[0] : input.id)
    : input.id;

  try {
    recordLibraryWatch({
      profile_id: profileId,
      source: input.source ?? undefined,
      type: input.type,
      id: titleId,
      play_id: input.play_id,
      title: input.title,
      poster: input.poster,
      position_sec: position,
      duration_sec: duration,
      tab: input.tab ?? undefined,
      watched_at: now,
    });
  } catch (error) {
    console.warn(
      `library progress mirror failed type=${input.type} id=${input.play_id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isContinueEligible(position, duration)) {
    openDb().prepare(`
DELETE FROM profile_watch_progress WHERE profile_id = ? AND progress_key = ?
`).run(profileId, key);
    if (profileId === 'household') {
      openDb().prepare('DELETE FROM watch_progress WHERE progress_key = ?').run(key);
    }
    return null;
  }

  openDb().prepare(`
INSERT INTO profile_watch_progress (
  profile_id, progress_key, type, id, play_id, title, poster,
  position_sec, duration_sec, progress_pct, updated_at
) VALUES (
  @profile_id, @progress_key, @type, @id, @play_id, @title, @poster,
  @position_sec, @duration_sec, @progress_pct, @updated_at
)
ON CONFLICT(profile_id, progress_key) DO UPDATE SET
  play_id = excluded.play_id,
  title = COALESCE(excluded.title, profile_watch_progress.title),
  poster = COALESCE(excluded.poster, profile_watch_progress.poster),
  position_sec = excluded.position_sec,
  duration_sec = excluded.duration_sec,
  progress_pct = excluded.progress_pct,
  updated_at = excluded.updated_at
`).run({
    profile_id: profileId,
    progress_key: key,
    type: input.type,
    id: titleId,
    play_id: input.play_id,
    title: input.title ?? null,
    poster: input.poster ?? null,
    position_sec: position,
    duration_sec: duration,
    progress_pct: pct,
    updated_at: now,
  });

  // Household stays mirrored into the pre-profile table so a code rollback
  // sees the same Household position. Personal positions never enter it.
  if (profileId === 'household') {
    openDb().prepare(`
INSERT INTO watch_progress (
  progress_key, type, id, play_id, title, poster,
  position_sec, duration_sec, progress_pct, updated_at
) VALUES (
  @progress_key, @type, @id, @play_id, @title, @poster,
  @position_sec, @duration_sec, @progress_pct, @updated_at
)
ON CONFLICT(progress_key) DO UPDATE SET
  play_id = excluded.play_id,
  title = COALESCE(excluded.title, watch_progress.title),
  poster = COALESCE(excluded.poster, watch_progress.poster),
  position_sec = excluded.position_sec,
  duration_sec = excluded.duration_sec,
  progress_pct = excluded.progress_pct,
  updated_at = excluded.updated_at
`).run({
      progress_key: key,
      type: input.type,
      id: titleId,
      play_id: input.play_id,
      title: input.title ?? null,
      poster: input.poster ?? null,
      position_sec: position,
      duration_sec: duration,
      progress_pct: pct,
      updated_at: now,
    });
  }

  return getWatchProgress(key, { profile_id: profileId });
}

export function getWatchProgress(
  progressKey: string,
  options: { profile_id?: string | null } = {},
): WatchProgressRecord | null {
  const profileId = resolveProgressProfileId(options.profile_id);
  const row = openDb().prepare(`
SELECT profile_id, progress_key, type, id, play_id, title, poster,
       position_sec, duration_sec, progress_pct, updated_at
FROM profile_watch_progress
WHERE profile_id = ? AND progress_key = ?
`).get(profileId, progressKey) as WatchProgressRecord | undefined;
  return row ?? null;
}

export function getWatchProgressForTitle(
  type: string,
  id: string,
  options: { profile_id?: string | null } = {},
): WatchProgressRecord | null {
  return getWatchProgress(progressTitleKey(type, id), options);
}

export function listContinueItems(
  tab: CatalogTab,
  limit = PROGRESS_CONTINUE_LIMIT,
  options: { profile_id?: string | null } = {},
): ContinueRailItem[] {
  const contentType = tab === 'series' ? 'series' : 'movie';
  const profileId = resolveProgressProfileId(options.profile_id);
  const rows = openDb().prepare(`
SELECT profile_id, progress_key, type, id, play_id, title, poster,
       position_sec, duration_sec, progress_pct, updated_at
FROM profile_watch_progress
WHERE profile_id = ?
  AND type = ?
  AND progress_pct < ?
  AND (position_sec >= ? OR progress_pct >= ?)
ORDER BY updated_at DESC
LIMIT ?
`).all(
    profileId,
    contentType,
    PROGRESS_CONTINUE_MAX,
    PROGRESS_CONTINUE_MIN_SEC,
    PROGRESS_CONTINUE_MIN,
    limit,
  ) as WatchProgressRecord[];

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title || row.id,
    subtitle: continueSubtitle(row.play_id, row.type, row.progress_pct),
    poster: row.poster || '',
    description: undefined,
    source: CONTINUE_RAIL_ID,
    progress: {
      play_id: row.play_id,
      position_sec: row.position_sec,
      duration_sec: row.duration_sec,
      progress_pct: row.progress_pct,
    },
  }));
}

export function deleteWatchProgress(
  type: string,
  id: string,
  options: { profile_id?: string | null } = {},
): void {
  const profileId = resolveProgressProfileId(options.profile_id);
  const key = progressTitleKey(type, id);
  openDb().prepare(`
DELETE FROM profile_watch_progress WHERE profile_id = ? AND progress_key = ?
`).run(profileId, key);
  if (profileId === 'household') {
    openDb().prepare('DELETE FROM watch_progress WHERE progress_key = ?').run(key);
  }
}

export function tabMatchesProgress(tab: CatalogTab, type: string): boolean {
  return progressTabForType(type) === tab;
}
