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
  if (normalizeLibraryType(type) === 'series') {
    return (seriesBareId(trimmed) ?? trimmed).toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function libraryItemKey(source: string | undefined, type: string, id: string): string {
  return `${normalizeSource(source)}:${normalizeLibraryType(type)}:${normalizeLibraryId(type, id)}`;
}

export function libraryTabForType(type: string, fallback?: CatalogTab | null): CatalogTab {
  if (fallback === 'movies' || fallback === 'series' || fallback === 'live') {
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
  const result = db.prepare('DELETE FROM saved_items WHERE item_key = ?').run(key);
  return result.changes > 0;
}

export function listSavedLibraryItems(tab?: CatalogTab, limit = 100): SavedLibraryItem[] {
  const db = ensureDb();
  const rows = db.prepare(`
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
FROM saved_items si
JOIN library_items li ON li.item_key = si.item_key
WHERE (@tab IS NULL OR li.tab = @tab)
ORDER BY si.saved_at DESC
LIMIT @limit;
`).all({
    tab: tab ?? null,
    limit: Math.max(1, Math.min(500, limit)),
  }) as SavedRow[];
  return rows;
}

export function getSavedLibraryItemByKey(itemKey: string): SavedLibraryItem | null {
  const db = ensureDb();
  const row = db.prepare(`
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
FROM saved_items si
JOIN library_items li ON li.item_key = si.item_key
WHERE si.item_key = ?;
`).get(itemKey) as SavedRow | undefined;
  return row ?? null;
}

export function getLibraryState(input: { source?: string; type: string; id: string }): LibraryState {
  const db = ensureDb();
  const source = normalizeSource(input.source);
  const type = normalizeLibraryType(input.type);
  const id = normalizeLibraryId(type, input.id);
  const key = libraryItemKey(source, type, id);
  const row = db.prepare(`
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
LEFT JOIN saved_items si ON si.item_key = li.item_key
LEFT JOIN watch_state ws ON ws.item_key = li.item_key
WHERE li.item_key = ?;
`).get(key) as StateRow | undefined;
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
  play_id?: string | null;
  position_sec?: number | null;
  duration_sec?: number | null;
  event?: string;
  watched_at?: number;
}): WatchHistoryRow {
  const db = ensureDb();
  const watchedAt = input.watched_at ?? nowMs();
  const position = Math.max(0, Number(input.position_sec ?? 0));
  const duration = Math.max(0, Number(input.duration_sec ?? 0));
  const pct = progressPct(position, duration);
  const event = input.event || (pct >= LIBRARY_FINISHED_PCT ? 'finished' : 'progress');
  const finishedAt = pct >= LIBRARY_FINISHED_PCT ? watchedAt : null;
  let historyId = 0;
  const transaction = db.transaction(() => {
    const itemKey = upsertLibraryItem(db, input, watchedAt);
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
`).run({
      item_key: itemKey,
      latest_play_id: input.play_id ?? null,
      position_sec: position,
      duration_sec: duration,
      progress_pct: pct,
      last_watched_at: watchedAt,
      finished_at: finishedAt,
    });
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

export function listWatchHistory(limit = 50): WatchHistoryRow[] {
  const db = ensureDb();
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
ORDER BY wh.watched_at DESC, wh.history_id DESC
LIMIT @limit;
`).all({ limit: Math.max(1, Math.min(500, limit)) }) as WatchHistoryRow[];
}

export function setLibraryContext(input: LibraryItemInput): LibraryContext {
  const db = ensureDb();
  const updatedAt = nowMs();
  const transaction = db.transaction(() => {
    const itemKey = upsertLibraryItem(db, input, updatedAt);
    db.prepare(`
INSERT INTO library_context (context_id, item_key, updated_at)
VALUES (@context_id, @item_key, @updated_at)
ON CONFLICT(context_id) DO UPDATE SET
  item_key = excluded.item_key,
  updated_at = excluded.updated_at;
`).run({
      context_id: LIBRARY_CONTEXT_ID,
      item_key: itemKey,
      updated_at: updatedAt,
    });
    return itemKey;
  });
  const itemKey = transaction();
  const context = getLibraryContext();
  if (!context || context.item_key !== itemKey) {
    throw new Error('library context write failed');
  }
  return context;
}

export function getLibraryContext(): LibraryContext | null {
  const db = ensureDb();
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
`).get(LIBRARY_CONTEXT_ID) as LibraryContext | undefined;
  return row ?? null;
}

export function clearLibraryContext(): number {
  const db = ensureDb();
  const result = db.prepare('DELETE FROM library_context WHERE context_id = ?').run(LIBRARY_CONTEXT_ID);
  return result.changes;
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
    saved_at: Number.isFinite(pin.pinned_at) ? Number(pin.pinned_at) : importedAt,
  });
}
