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

export type TitlePlayabilityRecord = {
  type: string;
  id: string;
  status: 'verified' | 'failed' | 'pending' | 'stale';
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

function itemKey(item: { type: string; id: string }): string {
  return `${item.type}:${item.id}`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
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

export async function getRailPlayabilityStatus(railId: string): Promise<PlayabilityRailStatus> {
  const status = await getPlayabilityStatus([railId]);
  return status.rails.find((rail) => rail.rail_id === railId) ?? emptyRailStatus(railId);
}

export async function getTitlePlayability(
  type: string,
  id: string,
): Promise<TitlePlayabilityRecord | null> {
  const map = await getTitlesPlayabilityBulk([{ type, id }]);
  return map.get(itemKey({ type, id })) ?? null;
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
      unique.set(itemKey(key), key);
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
SELECT type, id, status, expires_at, updated_at
FROM titles
WHERE (type, id) IN ( VALUES ${placeholders} );
`).all(params) as TitleRow[];
      for (const row of rows) {
        result.set(itemKey(row), row);
      }
    }
    return result;
  } finally {
    db.close();
  }
}

export async function getStaleTitlesInPools(): Promise<Array<{ type: string; id: string }>> {
  await initPlayabilityDb();
  const now = nowMs();
  const db = openDb();
  try {
    const rows = db.prepare(`
SELECT DISTINCT rp.type, rp.id
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE t.status = 'stale'
   OR (t.status = 'verified' AND COALESCE(t.expires_at, 0) <= @now);
`).all({ now }) as Array<{ type: string; id: string }>;
    return rows;
  } finally {
    db.close();
  }
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
      keys.add(itemKey(row));
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
SELECT type, id, status, best_source, cache_status, debrid_service, win_url_hash, expires_at
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

export async function getOrCreateRailSession(
  options: RailSessionOptions,
): Promise<RailSessionSnapshot> {
  await initPlayabilityDb();
  const db = openDb();
  const now = nowMs();
  const cooldownCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const displayLimit = Math.max(1, options.displayLimit);

  try {
    const selectSessionItems = db.prepare(`
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
`);
    const existing = selectSessionItems.all({
      rail_id: options.railId,
      session_id: options.sessionId,
      now,
    }) as RailSessionPoolItem[];

    const pool = db.prepare(`
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
`).all({ rail_id: options.railId, now }) as RailPoolRow[];

    const targetSessionSize = Math.min(displayLimit, pool.length);
    if (existing.length > 0 && existing.length >= targetSessionSize) {
      return {
        rail_id: options.railId,
        session_id: options.sessionId,
        items: existing,
        verified_pool: pool.length,
      };
    }

    if (existing.length > 0) {
      db.prepare(`
DELETE FROM rail_session
WHERE rail_id = @rail_id AND session_id = @session_id;
`).run({
        rail_id: options.railId,
        session_id: options.sessionId,
      });
    }

    const recentRows = db.prepare(`
SELECT type, id
FROM recently_shown
WHERE rail_id = @rail_id AND shown_at >= @cooldown_cutoff;
`).all({
      rail_id: options.railId,
      cooldown_cutoff: cooldownCutoff,
    }) as RecentRow[];
    const recent = new Set(recentRows.map(itemKey));
    const stableTarget = Math.ceil(displayLimit * 0.7);
    const stable = pool
      .filter((item) => !recent.has(itemKey(item)))
      .slice(0, stableTarget);
    const chosen = new Map(stable.map((item) => [itemKey(item), item]));
    const fresh = shuffle(pool.filter((item) => !chosen.has(itemKey(item))))
      .slice(0, Math.max(0, displayLimit - stable.length));
    const selected = [
      ...stable.map((item) => ({ ...item, mix_bucket: 'stable' as const })),
      ...fresh.map((item) => ({ ...item, mix_bucket: 'fresh' as const })),
    ].slice(0, displayLimit);

    const rows = selected.map((item, slot): RailSessionPoolItem => ({
      ...item,
      slot,
      session_id: options.sessionId,
    }));

    const transaction = db.transaction(() => {
      db.prepare(`
DELETE FROM rail_session
WHERE rail_id = @rail_id AND session_id = @session_id;
`).run({
        rail_id: options.railId,
        session_id: options.sessionId,
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
