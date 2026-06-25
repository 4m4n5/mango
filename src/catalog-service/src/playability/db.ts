import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
  selectRailSessionItems,
  sessionItemsConflictWithOccupied,
  tabSessionsHaveDuplicateTitles,
  titleKey,
  buildTabSessionSelections,
} from './session-select.js';
import { seriesBareId } from './ids.js';
import {
  injectPinnedSessionItems,
  loadRailCurationOverrides,
  mergePinnedPoolItems,
  type RailCurationOverrides,
} from './rail-overrides.js';
import type { RailPlayabilityConfig } from '../rails.js';
import { effectiveDisplayLimit } from './pool-growth.js';

const DEFAULT_DB_PATH = '/etc/mango/playability.db';
const DEFAULT_VERIFY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 6;

export type PlayabilityRailStatus = {
  rail_id: string;
  pool_depth: number;
  verified_pool: number;
  pending: number;
  stale: number;
  failed: number;
  last_verified_at: number | null;
};

export type PlayabilityStatus = {
  ok: true;
  db_path: string;
  schema_version: number;
  rails: PlayabilityRailStatus[];
  totals: {
    pool_depth: number;
    verified_pool: number;
    pending: number;
    stale: number;
    failed: number;
  };
  last_indexer_run_at: number | null;
};

export type PlayabilityVerifyRecord = {
  type: string;
  id: string;
  status: 'verified' | 'failed' | 'pending' | 'stale';
  rail_id?: string | null;
  fail_reason?: string | null;
  best_source?: string | null;
  cache_status?: string | null;
  debrid_service?: string | null;
  probe_ms?: number | null;
  win_url_hash?: string | null;
  win_ladder_step?: string | null;
  expires_at?: number | null;
  stage?: string;
  outcome?: string;
};

export type TitlePlayabilityRecord = {
  type: string;
  id: string;
  status: 'verified' | 'failed' | 'pending' | 'stale';
  fail_reason: string | null;
  expires_at: number | null;
  updated_at: number;
};

export type TitleVerifyProfile = {
  type: string;
  id: string;
  status: 'verified' | 'failed' | 'pending' | 'stale';
  best_source: string | null;
  cache_status: string | null;
  debrid_service: string | null;
  win_url_hash: string | null;
  win_ladder_step: string | null;
  probe_ms: number | null;
  expires_at: number | null;
};

export type RailPoolEntry = {
  rail_id: string;
  type: string;
  id: string;
  score: number;
  title?: string | null;
  poster_url?: string | null;
  year?: string | null;
};

export type RailCandidateRejectionRecord = {
  rail_id: string;
  type: string;
  id: string;
  reason: string;
  source_key?: string | null;
  run_id?: string | null;
  expires_at: number;
  details?: string | null;
};

export type RailSessionPoolItem = {
  rail_id: string;
  type: string;
  id: string;
  score: number;
  mix_bucket: 'stable' | 'fresh';
  slot: number;
  session_id: string;
  best_source: string | null;
  cache_status: string | null;
  debrid_service: string | null;
  verified_at: number | null;
  expires_at: number | null;
  title?: string | null;
  poster_url?: string | null;
  year?: string | null;
};

export type RailSessionSnapshot = {
  rail_id: string;
  session_id: string;
  items: RailSessionPoolItem[];
  verified_pool: number;
};

export type RailSessionOptions = {
  railId: string;
  sessionId: string;
  displayLimit: number;
  playability?: RailPlayabilityConfig;
  /** Other rails on the same tab — titles shown there are excluded from this session. */
  siblingRailIds?: string[];
};

export type TabRailSessionRequest = {
  railId: string;
  displayLimit: number;
  minDisplay: number;
  playability?: RailPlayabilityConfig;
};

export type TabRailSessionAllocateOptions = {
  sessionId: string;
  rails: TabRailSessionRequest[];
  forceReshuffle?: boolean;
  stableRatio?: number;
};

export type PlayabilityTriggerRecord = {
  trigger_type: 'pool_low' | 'display_low' | 'stale' | 'config_change' | 'play_failure' | 'scheduled' | 'voice_request';
  rail_id?: string | null;
  type?: string | null;
  id?: string | null;
  reason?: string | null;
};

type StatusRow = {
  rail_id: string;
  pool_depth: number | null;
  verified_pool: number | null;
  pending: number | null;
  stale: number | null;
  failed: number | null;
  last_verified_at: number | null;
};

type IndexerRow = {
  last_indexer_run_at: number | null;
};

type TitleRow = {
  type: string;
  id: string;
  status: 'verified' | 'failed' | 'pending' | 'stale';
  fail_reason: string | null;
  expires_at: number | null;
  updated_at: number;
};

type RailPoolKeyRow = {
  type: string;
  id: string;
};

type RailPoolRow = {
  rail_id: string;
  type: string;
  id: string;
  score: number;
  best_source: string | null;
  cache_status: string | null;
  debrid_service: string | null;
  verified_at: number | null;
  expires_at: number | null;
  title: string | null;
  poster_url: string | null;
  year: string | null;
};

type RecentRow = {
  type: string;
  id: string;
};

type RailCandidateRejectionRow = {
  rail_id: string;
  type: string;
  id: string;
  reason: string;
  source_key: string | null;
  run_id: string | null;
  created_at: number;
  expires_at: number;
  details: string | null;
};

function dbPath(): string {
  return process.env.MANGO_PLAYABILITY_DB || DEFAULT_DB_PATH;
}

function openDb(): Database.Database {
  return new Database(dbPath());
}

function nowMs(): number {
  return Date.now();
}

function toNumber(value: number | null | undefined): number {
  return Number(value || 0);
}

function readSiblingSessionOccupiedKeys(
  db: Database.Database,
  sessionId: string,
  siblingRailIds: string[],
): Set<string> {
  if (siblingRailIds.length === 0) {
    return new Set();
  }
  const placeholders = siblingRailIds.map(() => '?').join(', ');
  const rows = db.prepare(`
SELECT DISTINCT rs.type, rs.id
FROM rail_session rs
WHERE rs.session_id = ?
  AND rs.rail_id IN (${placeholders});
`).all(sessionId, ...siblingRailIds) as RecentRow[];
  return new Set(rows.map((row) => titleKey(row.type, row.id)));
}

function readRailPool(
  db: Database.Database,
  railId: string,
  now: number,
): RailPoolRow[] {
  return db.prepare(`
SELECT
  rp.rail_id,
  rp.type,
  rp.id,
  rp.score,
  rp.title,
  rp.poster_url,
  rp.year,
  t.best_source,
  t.cache_status,
  t.debrid_service,
  t.verified_at,
  t.expires_at
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE rp.rail_id = @rail_id
  AND t.status IN ('verified', 'stale')
ORDER BY rp.score DESC;
`).all({ rail_id: railId, now }) as RailPoolRow[];
}

function readExistingRailSession(
  db: Database.Database,
  railId: string,
  sessionId: string,
  now: number,
): RailSessionPoolItem[] {
  return db.prepare(`
SELECT
  rs.rail_id,
  rs.type,
  rs.id,
  rp.score,
  rs.mix_bucket,
  rs.slot,
  rs.session_id,
  rp.title,
  rp.poster_url,
  rp.year,
  t.best_source,
  t.cache_status,
  t.debrid_service,
  t.verified_at,
  t.expires_at
FROM rail_session rs
JOIN rail_pool rp ON rp.rail_id = rs.rail_id AND rp.type = rs.type AND rp.id = rs.id
JOIN titles t ON t.type = rs.type AND t.id = rs.id
WHERE rs.rail_id = @rail_id
  AND rs.session_id = @session_id
  AND t.status IN ('verified', 'stale')
ORDER BY rs.slot ASC;
`).all({
    rail_id: railId,
    session_id: sessionId,
    now,
  }) as RailSessionPoolItem[];
}

function readRecentRailKeys(
  db: Database.Database,
  railId: string,
  cooldownCutoff: number,
): Set<string> {
  const recentRows = db.prepare(`
SELECT type, id
FROM recently_shown
WHERE rail_id = @rail_id AND shown_at >= @cooldown_cutoff;
`).all({
    rail_id: railId,
    cooldown_cutoff: cooldownCutoff,
  }) as RecentRow[];
  return new Set(recentRows.map((row) => titleKey(row.type, row.id)));
}

function writeRailSessionRows(
  db: Database.Database,
  railId: string,
  sessionId: string,
  rows: RailSessionPoolItem[],
  now: number,
): void {
  db.prepare(`
DELETE FROM rail_session
WHERE rail_id = @rail_id AND session_id = @session_id;
`).run({
    rail_id: railId,
    session_id: sessionId,
  });

  const insertSession = db.prepare(`
INSERT INTO rail_session (rail_id, type, id, slot, mix_bucket, session_id, created_at)
VALUES (@rail_id, @type, @id, @slot, @mix_bucket, @session_id, @created_at);
`);
  const upsertRecent = db.prepare(`
INSERT INTO recently_shown (rail_id, type, id, shown_at)
VALUES (@rail_id, @type, @id, @shown_at)
ON CONFLICT(rail_id, type, id) DO UPDATE SET shown_at = excluded.shown_at;
`);
  for (const row of rows) {
    insertSession.run({
      rail_id: row.rail_id,
      type: row.type,
      id: row.id,
      slot: row.slot,
      mix_bucket: row.mix_bucket,
      session_id: row.session_id,
      created_at: now,
    });
    upsertRecent.run({
      rail_id: row.rail_id,
      type: row.type,
      id: row.id,
      shown_at: now,
    });
  }
}

function emptyRailStatus(railId: string): PlayabilityRailStatus {
  return {
    rail_id: railId,
    pool_depth: 0,
    verified_pool: 0,
    pending: 0,
    stale: 0,
    failed: 0,
    last_verified_at: null,
  };
}

export async function initPlayabilityDb(): Promise<void> {
  await mkdir(dirname(dbPath()), { recursive: true });
  const db = openDb();
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS playability_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS titles (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'failed', 'pending', 'stale')),
  verified_at INTEGER,
  expires_at INTEGER,
  fail_reason TEXT,
  best_source TEXT,
  cache_status TEXT,
  debrid_service TEXT,
  probe_ms INTEGER,
  win_url_hash TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (type, id)
);

CREATE TABLE IF NOT EXISTS rail_pool (
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  ingested_at INTEGER NOT NULL,
  PRIMARY KEY (rail_id, type, id)
);

CREATE TABLE IF NOT EXISTS rail_session (
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  mix_bucket TEXT NOT NULL CHECK (mix_bucket IN ('stable', 'fresh')),
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rail_id, session_id, slot)
);

CREATE TABLE IF NOT EXISTS recently_shown (
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  shown_at INTEGER NOT NULL,
  PRIMARY KEY (rail_id, type, id)
);

CREATE TABLE IF NOT EXISTS verify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  rail_id TEXT,
  type TEXT NOT NULL,
  id_value TEXT NOT NULL,
  stage TEXT NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playability_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  rail_id TEXT,
  type TEXT,
  id_value TEXT,
  reason TEXT,
  handled_at INTEGER
);

CREATE TABLE IF NOT EXISTS rail_candidate_rejections (
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_key TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  details TEXT,
  PRIMARY KEY (rail_id, type, id)
);

CREATE INDEX IF NOT EXISTS idx_titles_status_expires ON titles(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_rail_pool_rail_score ON rail_pool(rail_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_rail_session_session ON rail_session(session_id, rail_id, slot);
CREATE INDEX IF NOT EXISTS idx_recently_shown_rail_time ON recently_shown(rail_id, shown_at);
CREATE INDEX IF NOT EXISTS idx_verify_log_started ON verify_log(started_at);
CREATE INDEX IF NOT EXISTS idx_playability_triggers_open ON playability_triggers(handled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_rail_candidate_rejections_active ON rail_candidate_rejections(rail_id, expires_at);

INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (${SCHEMA_VERSION}, ${nowMs()});
`);
    applySchemaMigrations(db);
  } finally {
    db.close();
  }
}

function applySchemaMigrations(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(titles)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'win_ladder_step')) {
    db.exec('ALTER TABLE titles ADD COLUMN win_ladder_step TEXT');
  }
  const poolColumns = db.prepare('PRAGMA table_info(rail_pool)').all() as Array<{ name: string }>;
  if (!poolColumns.some((column) => column.name === 'title')) {
    db.exec('ALTER TABLE rail_pool ADD COLUMN title TEXT');
  }
  if (!poolColumns.some((column) => column.name === 'poster_url')) {
    db.exec('ALTER TABLE rail_pool ADD COLUMN poster_url TEXT');
  }
  if (!poolColumns.some((column) => column.name === 'year')) {
    db.exec('ALTER TABLE rail_pool ADD COLUMN year TEXT');
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS rail_ingest_state (
  rail_id TEXT PRIMARY KEY,
  catalog_offset INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (2, @applied_at);
`).run({ applied_at: nowMs() });
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (3, @applied_at);
`).run({ applied_at: nowMs() });
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (4, @applied_at);
`).run({ applied_at: nowMs() });
  db.exec(`
CREATE TABLE IF NOT EXISTS rail_source_ingest_state (
  rail_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  catalog_offset INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (rail_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_rail_source_ingest_rail ON rail_source_ingest_state(rail_id);
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (5, @applied_at);
`).run({ applied_at: nowMs() });
  db.exec(`
CREATE TABLE IF NOT EXISTS rail_candidate_rejections (
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_key TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  details TEXT,
  PRIMARY KEY (rail_id, type, id)
);
CREATE INDEX IF NOT EXISTS idx_rail_candidate_rejections_active
  ON rail_candidate_rejections(rail_id, expires_at);
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (6, @applied_at);
`).run({ applied_at: nowMs() });
}

export async function getRailIngestOffsetsBulk(railIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (railIds.length === 0) {
    return result;
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const placeholders = railIds.map((_, index) => `@rail_${index}`).join(', ');
    const params: Record<string, string> = {};
    railIds.forEach((railId, index) => {
      params[`rail_${index}`] = railId;
    });
    const rows = db.prepare(`
SELECT rail_id, catalog_offset
FROM rail_ingest_state
WHERE rail_id IN (${placeholders});
`).all(params) as Array<{ rail_id: string; catalog_offset: number }>;
    for (const row of rows) {
      result.set(row.rail_id, row.catalog_offset);
    }
    return result;
  } finally {
    db.close();
  }
}

export async function setRailIngestOffset(railId: string, catalogOffset: number): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    db.prepare(`
INSERT INTO rail_ingest_state (rail_id, catalog_offset, updated_at)
VALUES (@rail_id, @catalog_offset, @updated_at)
ON CONFLICT(rail_id) DO UPDATE SET
  catalog_offset = excluded.catalog_offset,
  updated_at = excluded.updated_at;
`).run({
      rail_id: railId,
      catalog_offset: Math.max(0, catalogOffset),
      updated_at: nowMs(),
    });
  } finally {
    db.close();
  }
}

export async function getRailSourceIngestOffsetsBulk(
  railId: string,
  sourceKeys: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (sourceKeys.length === 0) {
    return result;
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const placeholders = sourceKeys.map((_, index) => `@source_${index}`).join(', ');
    const params: Record<string, string> = { rail_id: railId };
    sourceKeys.forEach((sourceKey, index) => {
      params[`source_${index}`] = sourceKey;
    });
    const rows = db.prepare(`
SELECT source_key, catalog_offset
FROM rail_source_ingest_state
WHERE rail_id = @rail_id AND source_key IN (${placeholders});
`).all(params) as Array<{ source_key: string; catalog_offset: number }>;
    for (const row of rows) {
      result.set(row.source_key, row.catalog_offset);
    }
    return result;
  } finally {
    db.close();
  }
}

export async function setRailSourceIngestOffsetsBulk(
  railId: string,
  offsets: Map<string, number>,
): Promise<void> {
  if (offsets.size === 0) {
    return;
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const stmt = db.prepare(`
INSERT INTO rail_source_ingest_state (rail_id, source_key, catalog_offset, updated_at)
VALUES (@rail_id, @source_key, @catalog_offset, @updated_at)
ON CONFLICT(rail_id, source_key) DO UPDATE SET
  catalog_offset = excluded.catalog_offset,
  updated_at = excluded.updated_at;
`);
    const updatedAt = nowMs();
    for (const [sourceKey, catalogOffset] of offsets.entries()) {
      stmt.run({
        rail_id: railId,
        source_key: sourceKey,
        catalog_offset: Math.max(0, catalogOffset),
        updated_at: updatedAt,
      });
    }
  } finally {
    db.close();
  }
}

/** Reset paginated ingest cursors after AI catalog compose escalation. */
export async function resetRailIngestCursors(railId: string): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    db.prepare('DELETE FROM rail_source_ingest_state WHERE rail_id = @rail_id').run({ rail_id: railId });
    db.prepare(`
INSERT INTO rail_ingest_state (rail_id, catalog_offset, updated_at)
VALUES (@rail_id, 0, @updated_at)
ON CONFLICT(rail_id) DO UPDATE SET
  catalog_offset = 0,
  updated_at = excluded.updated_at;
`).run({
      rail_id: railId,
      updated_at: nowMs(),
    });
  } finally {
    db.close();
  }
}

/** Seed per-source cursors from legacy rail_ingest_state when missing. */
export async function ensureRailSourceIngestOffsets(
  railId: string,
  sourceKeys: string[],
): Promise<Map<string, number>> {
  const existing = await getRailSourceIngestOffsetsBulk(railId, sourceKeys);
  const result = new Map<string, number>();
  for (const key of sourceKeys) {
    result.set(key, existing.get(key) ?? 0);
  }
  if (existing.size === 0 && sourceKeys.length > 0) {
    const legacy = await getRailIngestOffsetsBulk([railId]);
    const globalOffset = legacy.get(railId) ?? 0;
    if (globalOffset > 0) {
      result.set(sourceKeys[0], globalOffset);
      await setRailSourceIngestOffsetsBulk(railId, result);
    }
  }
  return result;
}

/** Distinct published verified titles in the global library (not per-rail pool slots). */
export async function getUniqueVerifiedLibraryCount(now = nowMs()): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const row = db.prepare(`
SELECT COUNT(*) AS c
FROM titles
WHERE status = 'verified';
`).get({ now }) as { c: number } | undefined;
    return toNumber(row?.c);
  } finally {
    db.close();
  }
}

export async function recordRailCandidateRejections(
  records: RailCandidateRejectionRecord[],
  now = nowMs(),
): Promise<number> {
  const activeRecords = records.filter((record) => record.expires_at > now);
  if (activeRecords.length === 0) {
    return 0;
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const unique = new Map<string, RailCandidateRejectionRecord>();
    for (const record of activeRecords) {
      unique.set(`${record.rail_id}:${titleKey(record.type, record.id)}`, record);
    }
    const stmt = db.prepare(`
INSERT INTO rail_candidate_rejections (
  rail_id, type, id, reason, source_key, run_id, created_at, expires_at, details
) VALUES (
  @rail_id, @type, @id, @reason, @source_key, @run_id, @created_at, @expires_at, @details
)
ON CONFLICT(rail_id, type, id) DO UPDATE SET
  reason = excluded.reason,
  source_key = COALESCE(excluded.source_key, rail_candidate_rejections.source_key),
  run_id = COALESCE(excluded.run_id, rail_candidate_rejections.run_id),
  created_at = excluded.created_at,
  expires_at = MAX(rail_candidate_rejections.expires_at, excluded.expires_at),
  details = COALESCE(excluded.details, rail_candidate_rejections.details);
`);
    const transaction = db.transaction(() => {
      for (const record of unique.values()) {
        stmt.run({
          rail_id: record.rail_id,
          type: record.type,
          id: record.id,
          reason: record.reason,
          source_key: record.source_key ?? null,
          run_id: record.run_id ?? null,
          created_at: now,
          expires_at: record.expires_at,
          details: record.details ?? null,
        });
      }
    });
    transaction();
    return unique.size;
  } finally {
    db.close();
  }
}

export async function getActiveRailCandidateRejectionKeys(
  railId: string,
  keys: Array<{ type: string; id: string }>,
  now = nowMs(),
): Promise<Set<string>> {
  const result = new Set<string>();
  if (keys.length === 0) {
    return result;
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const unique = new Map<string, { type: string; id: string }>();
    for (const key of keys) {
      unique.set(titleKey(key.type, key.id), key);
    }
    const values = [...unique.values()];
    const chunkSize = 200;
    for (let offset = 0; offset < values.length; offset += chunkSize) {
      const chunk = values.slice(offset, offset + chunkSize);
      const placeholders = chunk.map((_, index) => `( @type_${index}, @id_${index} )`).join(', ');
      const params: Record<string, string | number> = { rail_id: railId, now };
      chunk.forEach((entry, index) => {
        params[`type_${index}`] = entry.type;
        params[`id_${index}`] = entry.id;
      });
      const rows = db.prepare(`
SELECT type, id
FROM rail_candidate_rejections
WHERE rail_id = @rail_id
  AND expires_at > @now
  AND (type, id) IN ( VALUES ${placeholders} );
`).all(params) as RailPoolKeyRow[];
      for (const row of rows) {
        result.add(titleKey(row.type, row.id));
      }
    }
    return result;
  } finally {
    db.close();
  }
}

export async function listActiveRailCandidateRejections(
  railId: string,
  now = nowMs(),
): Promise<RailCandidateRejectionRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT rail_id, type, id, reason, source_key, run_id, created_at, expires_at, details
FROM rail_candidate_rejections
WHERE rail_id = @rail_id AND expires_at > @now
ORDER BY expires_at DESC, type, id;
`).all({ rail_id: railId, now }) as RailCandidateRejectionRow[];
  } finally {
    db.close();
  }
}

export async function clearExpiredRailCandidateRejections(now = nowMs()): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const result = db.prepare(`
DELETE FROM rail_candidate_rejections
WHERE expires_at <= @now;
`).run({ now });
    return result.changes;
  } finally {
    db.close();
  }
}

type LegacyUncachedVerifiedRow = {
  type: string;
  id: string;
};

function listLegacyBackgroundUncachedVerifiedRows(db: Database.Database): LegacyUncachedVerifiedRow[] {
  return db.prepare(`
SELECT t.type, t.id
FROM titles t
LEFT JOIN verify_log latest
  ON latest.id = (
    SELECT v.id
    FROM verify_log v
    WHERE v.type = t.type AND v.id_value = t.id
    ORDER BY v.started_at DESC, v.id DESC
    LIMIT 1
  )
WHERE t.status = 'verified'
  AND t.cache_status = 'uncached'
  AND COALESCE(latest.stage, 'verify') != 'play';
`).all() as LegacyUncachedVerifiedRow[];
}

export type LegacyUncachedQuarantineResult = {
  titles: number;
  rail_pool: number;
  rail_session: number;
};

export async function quarantineLegacyBackgroundUncachedVerifiedTitles(
  now: number = nowMs(),
): Promise<LegacyUncachedQuarantineResult> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const transaction = db.transaction(() => {
      const rows = listLegacyBackgroundUncachedVerifiedRows(db);
      if (rows.length === 0) {
        return { titles: 0, rail_pool: 0, rail_session: 0 };
      }

      const updateTitle = db.prepare(`
UPDATE titles
SET status = 'failed',
    verified_at = NULL,
    expires_at = NULL,
    fail_reason = 'uncached_verify_legacy',
    updated_at = @updated_at
WHERE type = @type AND id = @id AND status = 'verified' AND cache_status = 'uncached';
`);
      const deletePool = db.prepare(`
DELETE FROM rail_pool
WHERE type = @type AND id = @id;
`);
      const deleteSession = db.prepare(`
DELETE FROM rail_session
WHERE type = @type AND id = @id;
`);
      const logRow = db.prepare(`
INSERT INTO verify_log (started_at, rail_id, type, id_value, stage, ms, outcome)
VALUES (@started_at, NULL, @type, @id, 'quarantine', 0, 'uncached_verify_legacy');
`);

      let titles = 0;
      let railPool = 0;
      let railSession = 0;
      for (const row of rows) {
        titles += updateTitle.run({ ...row, updated_at: now }).changes;
        railPool += deletePool.run(row).changes;
        railSession += deleteSession.run(row).changes;
        logRow.run({ ...row, started_at: now });
      }

      return { titles, rail_pool: railPool, rail_session: railSession };
    });
    return transaction();
  } finally {
    db.close();
  }
}

export async function getPlayabilityStatus(railIds: string[]): Promise<PlayabilityStatus> {
  await initPlayabilityDb();
  const now = nowMs();
  const db = openDb();
  try {
    const rows = db.prepare(`
SELECT
  rp.rail_id AS rail_id,
  COUNT(*) AS pool_depth,
  SUM(CASE WHEN t.status = 'verified' THEN 1 ELSE 0 END) AS verified_pool,
  SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) AS pending,
  SUM(CASE WHEN t.status = 'stale' THEN 1 ELSE 0 END) AS stale,
  SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed,
  MAX(t.verified_at) AS last_verified_at
FROM rail_pool rp
LEFT JOIN titles t ON t.type = rp.type AND t.id = rp.id
GROUP BY rp.rail_id
ORDER BY rp.rail_id;
`).all() as StatusRow[];
    const lastRun = db.prepare(`
SELECT MAX(started_at) AS last_indexer_run_at
FROM verify_log;
`).all() as IndexerRow[];

    const byRail = new Map(rows.map((row) => [row.rail_id, row]));
    const allRailIds = [...new Set([...railIds, ...rows.map((row) => row.rail_id)])].sort();
    const rails = allRailIds.map((railId) => {
      const row = byRail.get(railId);
      if (!row) return emptyRailStatus(railId);
      return {
        rail_id: railId,
        pool_depth: toNumber(row.pool_depth),
        verified_pool: toNumber(row.verified_pool),
        pending: toNumber(row.pending),
        stale: toNumber(row.stale),
        failed: toNumber(row.failed),
        last_verified_at: row.last_verified_at ?? null,
      };
    });

    return {
      ok: true,
      db_path: dbPath(),
      schema_version: SCHEMA_VERSION,
      rails,
      totals: rails.reduce(
        (totals, rail) => ({
          pool_depth: totals.pool_depth + rail.pool_depth,
          verified_pool: totals.verified_pool + rail.verified_pool,
          pending: totals.pending + rail.pending,
          stale: totals.stale + rail.stale,
          failed: totals.failed + rail.failed,
        }),
        { pool_depth: 0, verified_pool: 0, pending: 0, stale: 0, failed: 0 },
      ),
      last_indexer_run_at: lastRun[0]?.last_indexer_run_at ?? null,
    };
  } finally {
    db.close();
  }
}

export async function recordVerifyResult(record: PlayabilityVerifyRecord): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  const timestamp = nowMs();
  const verifiedAt = record.status === 'verified' ? timestamp : null;
  const expiresAt = record.status === 'verified'
    ? record.expires_at ?? timestamp + DEFAULT_VERIFY_TTL_MS
    : record.expires_at ?? null;

  try {
    const transaction = db.transaction(() => {
      db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, win_ladder_step, updated_at
) VALUES (
  @type, @id, @status, @verified_at, @expires_at, @fail_reason, @best_source,
  @cache_status, @debrid_service, @probe_ms, @win_url_hash, @win_ladder_step, @updated_at
)
ON CONFLICT(type, id) DO UPDATE SET
  status = excluded.status,
  verified_at = excluded.verified_at,
  expires_at = excluded.expires_at,
  fail_reason = excluded.fail_reason,
  best_source = excluded.best_source,
  cache_status = excluded.cache_status,
  debrid_service = excluded.debrid_service,
  probe_ms = excluded.probe_ms,
  win_url_hash = excluded.win_url_hash,
  win_ladder_step = excluded.win_ladder_step,
  updated_at = excluded.updated_at;
`).run({
        type: record.type,
        id: record.id,
        status: record.status,
        verified_at: verifiedAt,
        expires_at: expiresAt,
        fail_reason: record.fail_reason ?? null,
        best_source: record.best_source ?? null,
        cache_status: record.cache_status ?? null,
        debrid_service: record.debrid_service ?? null,
        probe_ms: record.probe_ms ?? null,
        win_url_hash: record.win_url_hash ?? null,
        win_ladder_step: record.win_ladder_step ?? null,
        updated_at: timestamp,
      });

      db.prepare(`
INSERT INTO verify_log (started_at, rail_id, type, id_value, stage, ms, outcome)
VALUES (@started_at, @rail_id, @type, @id_value, @stage, @ms, @outcome);
`).run({
        started_at: timestamp,
        rail_id: record.rail_id ?? null,
        type: record.type,
        id_value: record.id,
        stage: record.stage ?? 'verify',
        ms: record.probe_ms ?? 0,
        outcome: record.outcome ?? record.status,
      });
    });
    transaction();
  } finally {
    db.close();
  }
}

export async function getRailPlayabilityStatus(railId: string): Promise<PlayabilityRailStatus> {
  const status = await getPlayabilityStatus([railId]);
  return status.rails.find((rail) => rail.rail_id === railId) ?? emptyRailStatus(railId);
}

export async function getTitlePlayability(
  type: string,
  id: string,
): Promise<TitlePlayabilityRecord | null> {
  const map = await getTitlesPlayabilityBulk([{ type, id }]);
  return map.get(titleKey(type, id)) ?? null;
}

export async function getTitlesPlayabilityBulk(
  keys: Array<{ type: string; id: string }>,
): Promise<Map<string, TitlePlayabilityRecord>> {
  const result = new Map<string, TitlePlayabilityRecord>();
  if (keys.length === 0) {
    return result;
  }

  await initPlayabilityDb();
  const db = openDb();
  try {
    const unique = new Map<string, { type: string; id: string }>();
    for (const key of keys) {
      unique.set(titleKey(key.type, key.id), key);
    }
    const values = [...unique.values()];
    const chunkSize = 200;
    for (let offset = 0; offset < values.length; offset += chunkSize) {
      const chunk = values.slice(offset, offset + chunkSize);
      const placeholders = chunk.map((_, index) => `( @type_${index}, @id_${index} )`).join(', ');
      const params: Record<string, string> = {};
      chunk.forEach((entry, index) => {
        params[`type_${index}`] = entry.type;
        params[`id_${index}`] = entry.id;
      });
      const rows = db.prepare(`
SELECT type, id, status, fail_reason, expires_at, updated_at
FROM titles
WHERE (type, id) IN ( VALUES ${placeholders} );
`).all(params) as TitleRow[];
      for (const row of rows) {
        result.set(titleKey(row.type, row.id), row);
      }
    }
    return result;
  } finally {
    db.close();
  }
}

export async function getStaleTitlesForRefresh(): Promise<Array<{ type: string; id: string; rail_id: string | null }>> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT DISTINCT
  t.type,
  t.id,
  COALESCE(
    (
      SELECT rp.rail_id
      FROM rail_pool rp
      WHERE rp.type = t.type AND rp.id = t.id
      LIMIT 1
    ),
    (
      SELECT vl.rail_id
      FROM verify_log vl
      WHERE vl.type = t.type
        AND vl.id_value = t.id
        AND vl.rail_id IS NOT NULL
      ORDER BY vl.started_at DESC
      LIMIT 1
    )
  ) AS rail_id
FROM titles t
WHERE t.status = 'stale';
`).all() as Array<{ type: string; id: string; rail_id: string | null }>;
  } finally {
    db.close();
  }
}

export async function getStaleTitlesInPools(): Promise<Array<{ type: string; id: string }>> {
  const rows = await getStaleTitlesForRefresh();
  return rows.map(({ type, id }) => ({ type, id }));
}

export async function getRailPoolTitleKeysBulk(
  railIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const railId of railIds) {
    result.set(railId, new Set());
  }
  if (railIds.length === 0) {
    return result;
  }

  await initPlayabilityDb();
  const db = openDb();
  try {
    const placeholders = railIds.map((_, index) => `@rail_${index}`).join(', ');
    const params: Record<string, string> = {};
    railIds.forEach((railId, index) => {
      params[`rail_${index}`] = railId;
    });
    const rows = db.prepare(`
SELECT rail_id, type, id
FROM rail_pool
WHERE rail_id IN (${placeholders});
`).all(params) as Array<{ rail_id: string; type: string; id: string }>;
    for (const row of rows) {
      const keys = result.get(row.rail_id) ?? new Set<string>();
      keys.add(titleKey(row.type, row.id));
      result.set(row.rail_id, keys);
    }
    return result;
  } finally {
    db.close();
  }
}

export async function getTitleVerifyProfile(
  type: string,
  id: string,
): Promise<TitleVerifyProfile | null> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const row = db.prepare(`
SELECT type, id, status, best_source, cache_status, debrid_service, win_url_hash, win_ladder_step, probe_ms, expires_at
FROM titles
WHERE type = @type AND id = @id;
`).get({ type, id }) as {
      type: string;
      id: string;
      status: TitleVerifyProfile['status'];
      best_source: string | null;
      cache_status: string | null;
      debrid_service: string | null;
      win_url_hash: string | null;
      win_ladder_step: string | null;
      probe_ms: number | null;
      expires_at: number | null;
    } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function getRailPoolTitleKeys(railId: string): Promise<Set<string>> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const rows = db.prepare(`
SELECT type, id
FROM rail_pool
WHERE rail_id = @rail_id;
`).all({ rail_id: railId }) as RailPoolKeyRow[];
    return new Set(rows.map((row) => `${row.type}:${row.id}`));
  } finally {
    db.close();
  }
}

export type RailPoolMembership = {
  rail_id: string;
  type: string;
  id: string;
  title: string | null;
  year: string | null;
  score: number;
};

export type RailPoolOverlapPair = {
  rail_a: string;
  rail_b: string;
  shared_titles: number;
};

export type RailPoolOverlapSummary = {
  overlapped_titles: number;
  over_cap_titles: number;
  overlap_extra_slots: number;
  max_rails_per_title: number;
  top_pairs: RailPoolOverlapPair[];
};

export async function listVerifiedPoolMemberships(
  now: number = nowMs(),
): Promise<RailPoolMembership[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT
  rp.rail_id,
  rp.type,
  rp.id,
  rp.title,
  rp.year,
  rp.score
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE t.status = 'verified'
ORDER BY rp.rail_id, rp.score DESC;
`).all({ now }) as RailPoolMembership[];
  } finally {
    db.close();
  }
}

type OrphanVerifiedRow = {
  type: string;
  id: string;
  display_title: string | null;
};

/** Verified titles with no rail_pool row — e.g. after a bad retheme pass. */
export async function listOrphanVerifiedPoolTitles(
  now: number = nowMs(),
): Promise<OrphanVerifiedRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT t.type, t.id, (
  SELECT rp.title FROM rail_pool rp
  WHERE rp.type = t.type AND rp.id = t.id
  LIMIT 1
) AS display_title
FROM titles t
WHERE t.status = 'verified'
  AND NOT EXISTS (
    SELECT 1 FROM rail_pool rp WHERE rp.type = t.type AND rp.id = t.id
  );
`).all({ now }) as OrphanVerifiedRow[];
  } finally {
    db.close();
  }
}

export async function countOrphanVerifiedPoolTitles(
  now: number = nowMs(),
): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const row = db.prepare(`
SELECT COUNT(*) AS c
FROM titles t
WHERE t.status = 'verified'
  AND NOT EXISTS (
    SELECT 1 FROM rail_pool rp WHERE rp.type = t.type AND rp.id = t.id
  );
`).get({ now }) as { c: number } | undefined;
    return Number(row?.c ?? 0);
  } finally {
    db.close();
  }
}

export async function getRailPoolOverlapSummary(options: {
  maxRailsPerTitle?: number;
  topPairs?: number;
  now?: number;
} = {}): Promise<RailPoolOverlapSummary> {
  const maxRailsPerTitle = Math.max(1, Math.floor(options.maxRailsPerTitle ?? 2));
  const topPairs = Math.max(0, Math.floor(options.topPairs ?? 10));
  const now = options.now ?? nowMs();
  await initPlayabilityDb();
  const db = openDb();
  try {
    const summary = db.prepare(`
WITH active AS (
  SELECT rp.rail_id, rp.type, rp.id
  FROM rail_pool rp
  JOIN titles t ON t.type = rp.type AND t.id = rp.id
  WHERE t.status = 'verified'
), title_counts AS (
  SELECT type, id, COUNT(DISTINCT rail_id) AS rails
  FROM active
  GROUP BY type, id
)
SELECT
  SUM(CASE WHEN rails > 1 THEN 1 ELSE 0 END) AS overlapped_titles,
  SUM(CASE WHEN rails > @max_rails THEN 1 ELSE 0 END) AS over_cap_titles,
  SUM(CASE WHEN rails > @max_rails THEN rails - @max_rails ELSE 0 END) AS overlap_extra_slots,
  MAX(rails) AS max_rails_per_title
FROM title_counts;
`).get({ now, max_rails: maxRailsPerTitle }) as {
      overlapped_titles: number | null;
      over_cap_titles: number | null;
      overlap_extra_slots: number | null;
      max_rails_per_title: number | null;
    } | undefined;

    const pairs = topPairs > 0
      ? db.prepare(`
WITH active AS (
  SELECT rp.rail_id, rp.type, rp.id
  FROM rail_pool rp
  JOIN titles t ON t.type = rp.type AND t.id = rp.id
  WHERE t.status = 'verified'
)
SELECT a.rail_id AS rail_a, b.rail_id AS rail_b, COUNT(*) AS shared_titles
FROM active a
JOIN active b ON b.type = a.type AND b.id = a.id AND b.rail_id > a.rail_id
GROUP BY a.rail_id, b.rail_id
ORDER BY shared_titles DESC, rail_a, rail_b
LIMIT @limit;
`).all({ now, limit: topPairs }) as RailPoolOverlapPair[]
      : [];

    return {
      overlapped_titles: Number(summary?.overlapped_titles ?? 0),
      over_cap_titles: Number(summary?.over_cap_titles ?? 0),
      overlap_extra_slots: Number(summary?.overlap_extra_slots ?? 0),
      max_rails_per_title: Number(summary?.max_rails_per_title ?? 0),
      top_pairs: pairs.map((pair) => ({
        rail_a: pair.rail_a,
        rail_b: pair.rail_b,
        shared_titles: Number(pair.shared_titles),
      })),
    };
  } finally {
    db.close();
  }
}

export async function recoverOrphanVerifiedPoolTitles(
  now: number = nowMs(),
): Promise<number> {
  const orphans = await listOrphanVerifiedPoolTitles(now);
  if (orphans.length === 0) {
    return 0;
  }
  for (const row of orphans) {
    const railId = row.type === 'movie' ? 'movies-global-popular' : 'series-global-popular';
    await upsertRailPoolTitle({
      rail_id: railId,
      type: row.type,
      id: row.id,
      score: 75,
      title: row.display_title ?? undefined,
    });
  }
  return orphans.length;
}

export async function deleteRailPoolTitle(
  railId: string,
  type: string,
  id: string,
): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    db.prepare(`
DELETE FROM rail_pool
WHERE rail_id = @rail_id AND type = @type AND id = @id;
`).run({ rail_id: railId, type, id });
  } finally {
    db.close();
  }
}

export async function listRailIdsContainingTitle(
  type: string,
  id: string,
): Promise<string[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const rows = db.prepare(`
SELECT DISTINCT rail_id
FROM rail_pool
WHERE type = @type AND id = @id;
`).all({ type, id }) as Array<{ rail_id: string }>;
    return rows.map((row) => row.rail_id);
  } finally {
    db.close();
  }
}

export async function clearRailSessions(railIds: string[]): Promise<void> {
  if (railIds.length === 0) return;
  await initPlayabilityDb();
  const db = openDb();
  try {
    const stmt = db.prepare('DELETE FROM rail_session WHERE rail_id = ?;');
    for (const railId of railIds) {
      stmt.run(railId);
    }
  } finally {
    db.close();
  }
}

/** Verified pool depth for published rows. TTL is a recheck signal, not a visibility cutoff. */
export async function countVerifiedRailPoolByRailIds(
  railIds: string[],
  _nowMs = Date.now(),
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (railIds.length === 0) {
    return counts;
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const placeholders = railIds.map(() => '?').join(', ');
    const rows = db.prepare(`
SELECT rp.rail_id, COUNT(*) AS c
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE rp.rail_id IN (${placeholders})
  AND t.status = 'verified'
GROUP BY rp.rail_id;
`).all(...railIds) as Array<{ rail_id: string; c: number }>;
    for (const row of rows) {
      counts.set(row.rail_id, row.c);
    }
  } finally {
    db.close();
  }
  return counts;
}

export async function deleteRailPoolForRailIds(railIds: string[]): Promise<number> {
  if (railIds.length === 0) {
    return 0;
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const placeholders = railIds.map(() => '?').join(', ');
    const result = db.prepare(`
DELETE FROM rail_pool
WHERE rail_id IN (${placeholders});
`).run(...railIds);
    return result.changes;
  } finally {
    db.close();
  }
}

function curatedPool(
  pool: RailPoolRow[],
  railId: string,
  overrides: RailCurationOverrides,
): RailPoolRow[] {
  return mergePinnedPoolItems(pool, railId, overrides) as RailPoolRow[];
}

function toRailSessionPoolItem(
  railId: string,
  sessionId: string,
  item: { type: string; id: string; score?: number; mix_bucket?: 'stable' | 'fresh' },
  full: RailPoolRow | undefined,
  slot: number,
): RailSessionPoolItem {
  return {
    rail_id: railId,
    type: item.type,
    id: item.id,
    score: full?.score ?? item.score ?? 0,
    mix_bucket: item.mix_bucket ?? 'stable',
    slot,
    session_id: sessionId,
    best_source: full?.best_source ?? null,
    cache_status: full?.cache_status ?? null,
    debrid_service: full?.debrid_service ?? null,
    verified_at: full?.verified_at ?? null,
    expires_at: full?.expires_at ?? null,
    title: full?.title ?? null,
    poster_url: full?.poster_url ?? null,
    year: full?.year ?? null,
  };
}

function resolveRailDisplayLimit(
  rail: { displayLimit: number; playability?: RailPlayabilityConfig },
  verifiedPool: number,
): number {
  if (!rail.playability) {
    return Math.max(1, rail.displayLimit);
  }
  return Math.max(1, effectiveDisplayLimit(rail.playability, verifiedPool));
}

/** Remove pool rows only for confirmed failed titles; stale remains published until confirmed. */
export async function pruneNonPlayableFromRailPools(_now: number = nowMs()): Promise<number> {
  const quarantined = await quarantineLegacyBackgroundUncachedVerifiedTitles(_now);
  await initPlayabilityDb();
  const db = openDb();
  try {
    const result = db.prepare(`
DELETE FROM rail_pool
WHERE EXISTS (
  SELECT 1 FROM titles t
  WHERE t.type = rail_pool.type AND t.id = rail_pool.id
    AND t.status = 'failed'
);
`).run();
    return quarantined.rail_pool + result.changes;
  } finally {
    db.close();
  }
}

export async function upsertRailPoolTitle(entry: RailPoolEntry): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    db.prepare(`
INSERT INTO rail_pool (rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES (@rail_id, @type, @id, @score, @ingested_at, @title, @poster_url, @year)
ON CONFLICT(rail_id, type, id) DO UPDATE SET
  score = excluded.score,
  ingested_at = excluded.ingested_at,
  title = COALESCE(excluded.title, rail_pool.title),
  poster_url = COALESCE(excluded.poster_url, rail_pool.poster_url),
  year = COALESCE(excluded.year, rail_pool.year);
`).run({
      rail_id: entry.rail_id,
      type: entry.type,
      id: entry.id,
      score: entry.score,
      ingested_at: nowMs(),
      title: entry.title ?? null,
      poster_url: entry.poster_url ?? null,
      year: entry.year ?? null,
    });
  } finally {
    db.close();
  }
}

export type RailPoolDisplayRow = {
  rail_id: string;
  type: string;
  id: string;
};

export type VerifiedRailPoolSearchRow = {
  type: string;
  id: string;
  title: string;
  poster: string | null;
  year: string | null;
};

export type VerifiedLibraryCatalogRow = VerifiedRailPoolSearchRow & {
  rail_id: string;
};

export type LinkableVerifiedCandidateRow = {
  type: string;
  id: string;
  title: string | null;
  poster: string | null;
  year: string | null;
};

/** Active verified titles matching content type that are not yet in the target rail pool. */
export async function listLinkableVerifiedForRail(
  railId: string,
  contentType: string,
  limit: number,
  now = Date.now(),
): Promise<LinkableVerifiedCandidateRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT
  t.type,
  t.id,
  (
    SELECT rp.title
    FROM rail_pool rp
    WHERE rp.type = t.type
      AND rp.id = t.id
      AND rp.title IS NOT NULL
      AND trim(rp.title) != ''
    LIMIT 1
  ) AS title,
  (
    SELECT rp.poster_url
    FROM rail_pool rp
    WHERE rp.type = t.type AND rp.id = t.id
    LIMIT 1
  ) AS poster,
  (
    SELECT rp.year
    FROM rail_pool rp
    WHERE rp.type = t.type AND rp.id = t.id
    LIMIT 1
  ) AS year
FROM titles t
WHERE t.status = 'verified'
  AND t.type = @content_type
  AND NOT EXISTS (
    SELECT 1
    FROM rail_pool rp2
    JOIN titles tv ON tv.type = rp2.type AND tv.id = rp2.id
    WHERE rp2.rail_id = @rail_id
      AND rp2.type = t.type
      AND rp2.id = t.id
      AND tv.status = 'verified'
  )
ORDER BY t.verified_at DESC
LIMIT @limit;
`).all({
      rail_id: railId,
      content_type: contentType,
      now,
      limit: Math.max(1, limit),
    }) as LinkableVerifiedCandidateRow[];
  } finally {
    db.close();
  }
}

export async function listVerifiedLibraryCatalogRows(
  limit = 500,
): Promise<VerifiedLibraryCatalogRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT
  rp.rail_id,
  rp.type,
  rp.id,
  rp.title,
  rp.poster_url AS poster,
  rp.year
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE t.status = 'verified'
  AND rp.title IS NOT NULL
  AND trim(rp.title) != ''
ORDER BY rp.title ASC
LIMIT @limit;
`).all({ limit: Math.max(1, limit) }) as VerifiedLibraryCatalogRow[];
  } finally {
    db.close();
  }
}

export async function queueTitleForVoiceIngest(input: {
  type: string;
  id: string;
  title: string;
  rail_id: string;
  poster_url?: string | null;
  year?: string | null;
}): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  const now = nowMs();
  try {
    db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, updated_at
) VALUES (
  @type, @id, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @updated_at
)
ON CONFLICT(type, id) DO UPDATE SET
  status = CASE WHEN titles.status = 'verified' THEN titles.status ELSE 'pending' END,
  updated_at = @updated_at;
`).run({
      type: input.type,
      id: input.id,
      updated_at: now,
    });
  } finally {
    db.close();
  }

  await upsertRailPoolTitle({
    rail_id: input.rail_id,
    type: input.type,
    id: input.id,
    score: 0,
    title: input.title,
    poster_url: input.poster_url ?? undefined,
    year: input.year ?? undefined,
  });

  await enqueuePlayabilityTrigger({
    trigger_type: 'voice_request',
    rail_id: input.rail_id,
    type: input.type,
    id: input.id,
    reason: `voice_request:${input.title}`,
  });
}

export async function searchVerifiedRailPoolTitles(
  query: string,
  limit = 40,
): Promise<VerifiedRailPoolSearchRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }
  await initPlayabilityDb();
  const db = openDb();
  try {
    const like = `%${trimmed.toLowerCase()}%`;
    return db.prepare(`
SELECT DISTINCT
  rp.type,
  rp.id,
  rp.title,
  rp.poster_url AS poster,
  rp.year
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE t.status = 'verified'
  AND rp.title IS NOT NULL
  AND trim(rp.title) != ''
  AND lower(rp.title) LIKE @like
LIMIT @limit;
`).all({ like, limit: Math.max(1, limit) }) as VerifiedRailPoolSearchRow[];
  } finally {
    db.close();
  }
}

export async function listRailPoolMissingDisplay(limit: number): Promise<RailPoolDisplayRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT DISTINCT rail_id, type, id
FROM rail_pool
WHERE COALESCE(TRIM(title), '') = ''
   OR COALESCE(TRIM(poster_url), '') = ''
LIMIT @limit;
`).all({ limit: Math.max(1, limit) }) as RailPoolDisplayRow[];
  } finally {
    db.close();
  }
}

export async function patchRailPoolDisplay(
  railId: string,
  type: string,
  id: string,
  patch: Pick<RailPoolEntry, 'title' | 'poster_url' | 'year'>,
): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    db.prepare(`
UPDATE rail_pool
SET
  title = COALESCE(@title, title),
  poster_url = COALESCE(@poster_url, poster_url),
  year = COALESCE(@year, year)
WHERE rail_id = @rail_id AND type = @type AND id = @id;
`).run({
      rail_id: railId,
      type,
      id,
      title: patch.title ?? null,
      poster_url: patch.poster_url ?? null,
      year: patch.year ?? null,
    });
  } finally {
    db.close();
  }
}

export async function allocateTabRailSessions(
  options: TabRailSessionAllocateOptions,
): Promise<Map<string, RailSessionSnapshot>> {
  await initPlayabilityDb();
  const overrides = await loadRailCurationOverrides();
  const db = openDb();
  const now = nowMs();
  const cooldownCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const snapshots = new Map<string, RailSessionSnapshot>();

  try {
    const existingByRail = new Map<string, RailSessionPoolItem[]>();
    const curatedPools = new Map<string, ReturnType<typeof readRailPool>>();
    const poolSizes = new Map<string, number>();
    let canReuseExisting = options.rails.length > 0 && !options.forceReshuffle;

    for (const rail of options.rails) {
      const pool = curatedPool(readRailPool(db, rail.railId, now), rail.railId, overrides);
      curatedPools.set(rail.railId, pool);
      poolSizes.set(rail.railId, pool.length);
      const displayLimit = resolveRailDisplayLimit(rail, pool.length);
      const existing = readExistingRailSession(db, rail.railId, options.sessionId, now);
      existingByRail.set(rail.railId, existing);
      const targetSessionSize = Math.min(displayLimit, pool.length);
      if (existing.length < targetSessionSize) {
        canReuseExisting = false;
      }
    }

    if (canReuseExisting && !tabSessionsHaveDuplicateTitles(existingByRail)) {
      for (const rail of options.rails) {
        const existing = existingByRail.get(rail.railId) ?? [];
        snapshots.set(rail.railId, {
          rail_id: rail.railId,
          session_id: options.sessionId,
          items: existing,
          verified_pool: poolSizes.get(rail.railId) ?? 0,
        });
      }
      return snapshots;
    }

    const transaction = db.transaction(() => {
      for (const rail of options.rails) {
        db.prepare(`
DELETE FROM rail_session
WHERE rail_id = @rail_id AND session_id = @session_id;
`).run({
          rail_id: rail.railId,
          session_id: options.sessionId,
        });
      }

      const pools = curatedPools;
      const recentKeysByRail = new Map<string, Set<string>>();
      for (const rail of options.rails) {
        recentKeysByRail.set(rail.railId, readRecentRailKeys(db, rail.railId, cooldownCutoff));
      }

      const tabSelections = buildTabSessionSelections(
        options.rails.map((rail) => {
          const pool = pools.get(rail.railId) ?? [];
          const displayLimit = resolveRailDisplayLimit(rail, pool.length);
          return {
            railId: rail.railId,
            displayLimit,
            minDisplay: Math.max(1, rail.minDisplay),
          };
        }),
        pools,
        recentKeysByRail,
        {
          stableRatio: options.stableRatio,
        },
      );

      for (const rail of options.rails) {
        const pool = pools.get(rail.railId) ?? [];
        const displayLimit = resolveRailDisplayLimit(rail, pool.length);
        const selected = injectPinnedSessionItems(
          tabSelections.get(rail.railId) ?? [],
          pool,
          rail.railId,
          overrides,
          displayLimit,
        );
        const poolByKey = new Map(pool.map((item) => [titleKey(item.type, item.id), item]));
        const rows = selected.map((item, slot) => toRailSessionPoolItem(
          rail.railId,
          options.sessionId,
          item,
          poolByKey.get(titleKey(item.type, item.id)),
          slot,
        ));
        writeRailSessionRows(db, rail.railId, options.sessionId, rows, now);
        snapshots.set(rail.railId, {
          rail_id: rail.railId,
          session_id: options.sessionId,
          items: rows,
          verified_pool: pool.length,
        });
      }

      db.prepare(`
DELETE FROM recently_shown
WHERE shown_at < @prune_before;
`).run({ prune_before: now - 14 * 24 * 60 * 60 * 1000 });
    });
    transaction();
    return snapshots;
  } finally {
    db.close();
  }
}

export async function getOrCreateRailSession(
  options: RailSessionOptions,
): Promise<RailSessionSnapshot> {
  await initPlayabilityDb();
  const overrides = await loadRailCurationOverrides();
  const db = openDb();
  const now = nowMs();
  const cooldownCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const siblingRailIds = options.siblingRailIds ?? [];

  try {
    const pool = curatedPool(readRailPool(db, options.railId, now), options.railId, overrides);
    const displayLimit = resolveRailDisplayLimit(options, pool.length);
    const existing = readExistingRailSession(db, options.railId, options.sessionId, now);
    const siblingOccupied = readSiblingSessionOccupiedKeys(db, options.sessionId, siblingRailIds);
    const targetSessionSize = Math.min(displayLimit, pool.length);

    if (
      existing.length > 0
      && existing.length >= targetSessionSize
      && !sessionItemsConflictWithOccupied(existing, siblingOccupied)
    ) {
      return {
        rail_id: options.railId,
        session_id: options.sessionId,
        items: existing,
        verified_pool: pool.length,
      };
    }

    const recent = readRecentRailKeys(db, options.railId, cooldownCutoff);
    const selectWithOccupied = (occupiedKeys: Set<string>): RailPoolRow[] => injectPinnedSessionItems(
      selectRailSessionItems(pool, {
        displayLimit,
        recentKeys: recent,
        occupiedKeys,
      }),
      pool,
      options.railId,
      overrides,
      displayLimit,
    );
    let selected = selectWithOccupied(siblingOccupied);
    if (selected.length === 0 && pool.length > 0 && siblingOccupied.size > 0) {
      selected = selectWithOccupied(new Set());
    }
    const poolByKey = new Map(pool.map((item) => [titleKey(item.type, item.id), item]));
    const rows = selected.map((item, slot) => toRailSessionPoolItem(
      options.railId,
      options.sessionId,
      item,
      poolByKey.get(titleKey(item.type, item.id)),
      slot,
    ));

    const transaction = db.transaction(() => {
      writeRailSessionRows(db, options.railId, options.sessionId, rows, now);
      db.prepare(`
DELETE FROM recently_shown
WHERE shown_at < @prune_before;
`).run({ prune_before: now - 14 * 24 * 60 * 60 * 1000 });
    });
    transaction();

    return {
      rail_id: options.railId,
      session_id: options.sessionId,
      items: rows,
      verified_pool: pool.length,
    };
  } finally {
    db.close();
  }
}

export async function enqueuePlayabilityTrigger(record: PlayabilityTriggerRecord): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    db.prepare(`
INSERT INTO playability_triggers (
  created_at, trigger_type, rail_id, type, id_value, reason, handled_at
) VALUES (
  @created_at, @trigger_type, @rail_id, @type, @id_value, @reason, NULL
);
`).run({
      created_at: nowMs(),
      trigger_type: record.trigger_type,
      rail_id: record.rail_id ?? null,
      type: record.type ?? null,
      id_value: record.id ?? null,
      reason: record.reason ?? null,
    });
  } finally {
    db.close();
  }
}

export async function invalidateTitle(record: {
  rail_id?: string | null;
  type: string;
  id: string;
  reason?: string | null;
  /** Keep current session posters until session rotates (Track B couch UX). */
  preserve_session?: boolean;
}): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  const timestamp = nowMs();
  const status = record.reason === 'play_failure' ? 'failed' : 'stale';
  const confirmedFailure = status === 'failed';
  try {
    const transaction = db.transaction(() => {
      db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, updated_at
) VALUES (
  @type, @id, @status, NULL, NULL, @reason, NULL, NULL, NULL, NULL, NULL, @updated_at
)
ON CONFLICT(type, id) DO UPDATE SET
  status = @status,
  expires_at = NULL,
  fail_reason = @reason,
  updated_at = @updated_at;
`).run({
        type: record.type,
        id: record.id,
        status,
        reason: record.reason ?? 'invalidated',
        updated_at: timestamp,
      });

      if (confirmedFailure) {
        db.prepare(`
DELETE FROM rail_pool
WHERE type = @type AND id = @id;
`).run({
          type: record.type,
          id: record.id,
        });
      }

      if (!record.preserve_session) {
        const sessionWhere = record.rail_id && !confirmedFailure
          ? 'rail_id = @rail_id AND type = @type AND id = @id'
          : 'type = @type AND id = @id';
        db.prepare(`
DELETE FROM rail_session
WHERE ${sessionWhere};
`).run({
          rail_id: record.rail_id ?? null,
          type: record.type,
          id: record.id,
        });
      }

      db.prepare(`
INSERT INTO verify_log (started_at, rail_id, type, id_value, stage, ms, outcome)
VALUES (@started_at, @rail_id, @type, @id_value, 'invalidate', 0, @outcome);
`).run({
        started_at: timestamp,
        rail_id: record.rail_id ?? null,
        type: record.type,
        id_value: record.id,
        outcome: record.reason ?? 'invalidated',
      });
    });
    transaction();
  } finally {
    db.close();
  }
  await enqueuePlayabilityTrigger({
    trigger_type: record.reason === 'play_failure' ? 'play_failure' : 'stale',
    rail_id: record.rail_id ?? null,
    type: record.type,
    id: record.id,
    reason: record.reason ?? 'invalidated',
  });
}
