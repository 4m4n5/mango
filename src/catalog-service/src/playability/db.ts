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
import { seriesBareId, seriesFollowUpEpisodeIds } from './ids.js';
import {
  injectPinnedSessionItems,
  loadRailCurationOverrides,
  mergePinnedPoolItems,
  type RailCurationOverrides,
} from './rail-overrides.js';
import type { RailPlayabilityConfig } from '../rails.js';
import { effectiveDisplayLimit } from './pool-growth.js';

const DEFAULT_DB_PATH = '/etc/mango/playability.db';
const SCHEMA_VERSION = 2;

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
};

export type PlayabilityTriggerRecord = {
  trigger_type: 'pool_low' | 'display_low' | 'stale' | 'config_change' | 'play_failure' | 'scheduled';
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
};

type RecentRow = {
  type: string;
  id: string;
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
  t.best_source,
  t.cache_status,
  t.debrid_service,
  t.verified_at,
  t.expires_at
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE rp.rail_id = @rail_id
  AND t.status = 'verified'
  AND COALESCE(t.expires_at, 0) > @now
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
  AND t.status = 'verified'
  AND COALESCE(t.expires_at, 0) > @now
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

CREATE TABLE IF NOT EXISTS series_episode_queue (
  series_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'skipped')),
  queued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (series_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_series_episode_queue_status ON series_episode_queue(status, queued_at);

CREATE INDEX IF NOT EXISTS idx_titles_status_expires ON titles(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_rail_pool_rail_score ON rail_pool(rail_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_rail_session_session ON rail_session(session_id, rail_id, slot);
CREATE INDEX IF NOT EXISTS idx_recently_shown_rail_time ON recently_shown(rail_id, shown_at);
CREATE INDEX IF NOT EXISTS idx_verify_log_started ON verify_log(started_at);
CREATE INDEX IF NOT EXISTS idx_playability_triggers_open ON playability_triggers(handled_at, created_at);

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
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (2, @applied_at);
`).run({ applied_at: nowMs() });
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
  SUM(CASE WHEN t.status = 'verified' AND COALESCE(t.expires_at, 0) > ${now} THEN 1 ELSE 0 END) AS verified_pool,
  SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) AS pending,
  SUM(CASE WHEN t.status = 'stale' OR (t.status = 'verified' AND COALESCE(t.expires_at, 0) <= ${now}) THEN 1 ELSE 0 END) AS stale,
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
    ? record.expires_at ?? timestamp + 48 * 60 * 60 * 1000
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

export async function getSeriesEpisodePlayableMap(
  episodeIds: string[],
): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  for (const episodeId of episodeIds) {
    result.set(episodeId, null);
  }
  if (episodeIds.length === 0) {
    return result;
  }

  await initPlayabilityDb();
  const db = openDb();
  const now = Date.now();
  try {
    const placeholders = episodeIds.map(() => '?').join(', ');
    const rows = db.prepare(`
SELECT id, status, expires_at
FROM titles
WHERE type = 'series' AND id IN (${placeholders});
`).all(...episodeIds) as Array<{
      id: string;
      status: TitleVerifyProfile['status'];
      expires_at: number | null;
    }>;

    for (const row of rows) {
      if (row.status === 'verified' && (row.expires_at === null || row.expires_at > now)) {
        result.set(row.id, true);
      } else if (row.status === 'failed') {
        result.set(row.id, false);
      } else {
        result.set(row.id, null);
      }
    }
    return result;
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

/** Remove pool rows only for titles definitively marked stale (additive library — never drop verified). */
export async function pruneNonPlayableFromRailPools(_now: number = nowMs()): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    const result = db.prepare(`
DELETE FROM rail_pool
WHERE EXISTS (
  SELECT 1 FROM titles t
  WHERE t.type = rail_pool.type AND t.id = rail_pool.id
    AND t.status = 'stale'
);
`).run();
    return result.changes;
  } finally {
    db.close();
  }
}

export async function upsertRailPoolTitle(entry: RailPoolEntry): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    db.prepare(`
INSERT INTO rail_pool (rail_id, type, id, score, ingested_at)
VALUES (@rail_id, @type, @id, @score, @ingested_at)
ON CONFLICT(rail_id, type, id) DO UPDATE SET
  score = excluded.score,
  ingested_at = excluded.ingested_at;
`).run({
      rail_id: entry.rail_id,
      type: entry.type,
      id: entry.id,
      score: entry.score,
      ingested_at: nowMs(),
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
    let canReuseExisting = options.rails.length > 0;

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
  try {
    const transaction = db.transaction(() => {
      db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, updated_at
) VALUES (
  @type, @id, 'stale', NULL, NULL, @reason, NULL, NULL, NULL, NULL, NULL, @updated_at
)
ON CONFLICT(type, id) DO UPDATE SET
  status = 'stale',
  expires_at = NULL,
  fail_reason = @reason,
  updated_at = @updated_at;
`).run({
        type: record.type,
        id: record.id,
        reason: record.reason ?? 'invalidated',
        updated_at: timestamp,
      });

      if (!record.preserve_session) {
        const sessionWhere = record.rail_id
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

export type EpisodeQueueEntry = {
  series_id: string;
  episode_id: string;
  season: number;
  episode: number;
  status: 'pending' | 'verified' | 'failed' | 'skipped';
  queued_at: number;
  updated_at: number;
};

function parseEpisodeNumbers(episodeId: string): { season: number; episode: number } | null {
  const match = episodeId.trim().match(/^tt\d+:(\d+):(\d+)$/i);
  if (!match) {
    return null;
  }
  return {
    season: Number(match[1]),
    episode: Number(match[2]),
  };
}

/** Queue S1E2–S1E4 after a series rail title verifies via S1E1. */
export async function enqueueSeriesFollowUpEpisodes(seriesId: string): Promise<number> {
  const bare = seriesBareId(seriesId);
  if (!bare) {
    return 0;
  }

  await initPlayabilityDb();
  const db = openDb();
  const now = nowMs();
  let queued = 0;

  try {
    const insert = db.prepare(`
INSERT INTO series_episode_queue (
  series_id, episode_id, season, episode, status, queued_at, updated_at
) VALUES (
  @series_id, @episode_id, @season, @episode, 'pending', @queued_at, @updated_at
)
ON CONFLICT(series_id, episode_id) DO NOTHING;
`);
    for (const episodeId of seriesFollowUpEpisodeIds(bare)) {
      const numbers = parseEpisodeNumbers(episodeId);
      if (!numbers) {
        continue;
      }
      const result = insert.run({
        series_id: bare,
        episode_id: episodeId,
        season: numbers.season,
        episode: numbers.episode,
        queued_at: now,
        updated_at: now,
      });
      if (result.changes > 0) {
        queued += 1;
      }
    }
    return queued;
  } finally {
    db.close();
  }
}

export async function listPendingEpisodeQueue(limit = 50): Promise<EpisodeQueueEntry[]> {
  await initPlayabilityDb();
  const db = openDb();
  try {
    return db.prepare(`
SELECT series_id, episode_id, season, episode, status, queued_at, updated_at
FROM series_episode_queue
WHERE status = 'pending'
ORDER BY queued_at ASC
LIMIT @limit;
`).all({ limit }) as EpisodeQueueEntry[];
  } finally {
    db.close();
  }
}
