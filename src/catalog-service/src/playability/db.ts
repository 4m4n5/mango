import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const DEFAULT_DB_PATH = '/etc/mango/playability.db';
const SCHEMA_VERSION = 1;

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
  expires_at?: number | null;
  stage?: string;
  outcome?: string;
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

CREATE INDEX IF NOT EXISTS idx_titles_status_expires ON titles(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_rail_pool_rail_score ON rail_pool(rail_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_rail_session_session ON rail_session(session_id, rail_id, slot);
CREATE INDEX IF NOT EXISTS idx_recently_shown_rail_time ON recently_shown(rail_id, shown_at);
CREATE INDEX IF NOT EXISTS idx_verify_log_started ON verify_log(started_at);
CREATE INDEX IF NOT EXISTS idx_playability_triggers_open ON playability_triggers(handled_at, created_at);

INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (${SCHEMA_VERSION}, ${nowMs()});
`);
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
  cache_status, debrid_service, probe_ms, win_url_hash, updated_at
) VALUES (
  @type, @id, @status, @verified_at, @expires_at, @fail_reason, @best_source,
  @cache_status, @debrid_service, @probe_ms, @win_url_hash, @updated_at
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
