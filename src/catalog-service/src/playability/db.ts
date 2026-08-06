import { mkdirSync } from 'node:fs';
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
import { canonicalTitleId, isSeriesRailGateId, seriesBareId } from './ids.js';
import {
  injectPinnedSessionItems,
  loadRailCurationOverrides,
  mergePinnedPoolItems,
  pinsForRail,
  type RailCurationOverrides,
} from './rail-overrides.js';
import type { RailPlayabilityConfig } from '../rails.js';
import { effectiveDisplayLimit } from './pool-growth.js';
import { playabilityPlayFailureRetryMs } from './config.js';
import { AI_CATALOG_RAIL_PREFIX } from '../ai-catalogs/types.js';
import {
  loadRailThemeProfiles,
  metaHaystack,
  parseRuntimeMinutes,
  scoreThematicFit,
  type RailThemeProfile,
} from './rail-theme.js';
import {
  aiCatalogWeight,
  categoryWeight,
  clampUnit,
  exploreWeight,
  weightedDeal,
} from '../recommendations/vod-browse-v3.js';

const DEFAULT_DB_PATH = '/etc/mango/playability.db';
const DEFAULT_VERIFY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 17;

export type StreamCapabilityClass = 'proven_smooth' | 'unknown' | 'known_risky';

export type StreamPathEvidence = {
  release_fingerprint: string;
  profile_id: string;
  capability_class: StreamCapabilityClass;
  technical_json: string | null;
  reason: string | null;
  last_proof_at: number | null;
  long_watch_count: number;
  issue_previous_class: StreamCapabilityClass | null;
  issue_reason: string | null;
  issue_expires_at: number | null;
  updated_at: number;
};

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
  vod_browse_v3?: {
    classified_memberships: number;
    trusted_memberships: number;
    ready_reservoirs: number;
    reservoir_candidate_rows: number;
    explore_session_rows: number;
    active_tab_deals: number;
    previous_tab_deals: number;
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
  first_verified_at: number | null;
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
  evidence_json?: string | null;
  evidence_hash?: string | null;
  evidence_source?: string | null;
  evidence_retrieved_at?: number | null;
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
  browseV3?: boolean;
  browseV3Tab?: 'movies' | 'series';
  seed?: string;
  excludedKeys?: ReadonlySet<string>;
  initiallyOccupiedKeys?: ReadonlySet<string>;
  affinityByKey?: ReadonlyMap<string, {
    taste_adjacency: number;
    profile_confidence: number | null;
  }>;
};

export type VodBrowseReservoirRail = {
  railId: string;
  displayLimit: number;
  minDisplay: number;
  playability?: RailPlayabilityConfig;
};

type VodBrowseReservoirItem = RailPoolRow & {
  weight: number;
  trusted: boolean;
  source_position: number | null;
  theme_confidence: number | null;
  taste_affinity: number | null;
  novelty: number | null;
  reason: string;
};

export type PlayabilityTriggerType =
  | 'pool_low'
  | 'display_low'
  | 'stale'
  | 'config_change'
  | 'play_failure'
  /** H2: fast-lane re-verify enqueued alongside invalidateTitle(reason=play_failure) — drained first (H1). */
  | 'play_failure_reverify'
  | 'scheduled'
  | 'voice_request'
  | 'search_unavailable';

export type PlayabilityTriggerRecord = {
  trigger_type: PlayabilityTriggerType;
  rail_id?: string | null;
  type?: string | null;
  id?: string | null;
  reason?: string | null;
};

export type PlayabilityTriggerRow = {
  id: number;
  created_at: number;
  trigger_type: PlayabilityTriggerType;
  rail_id: string | null;
  type: string | null;
  id_value: string | null;
  reason: string | null;
  handled_at: number | null;
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
  first_verified_at: number | null;
  evidence_json: string | null;
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

export type SourceGrowWeightRecord = {
  source_key: string;
  rail_id: string | null;
  source_label: string;
  content_type: string;
  scanned: number;
  fresh_queued: number;
  skipped_verified: number;
  skipped_recent_failed: number;
  linked_verified_seen: number;
  requested: number;
  returned: number;
  catalog_errors: number;
  rate_limited: number;
  exhausted: boolean;
  verified: number;
  failed: number;
  theme_rejected: number;
  unresolved_external_id: number;
  runs: number;
  multiplier: number;
  probation: boolean;
  probation_multiplier: number;
  elapsed_ms: number;
  last_ts: number;
  rollback_reason: string | null;
  updated_at: number;
};

export type SourceGrowRailOutcomeRecord = {
  rail_id: string;
  target_met: boolean;
  weighted: boolean;
  last_ts: number;
  updated_at: number;
};

function dbPath(): string {
  return process.env.MANGO_PLAYABILITY_DB || DEFAULT_DB_PATH;
}

function canonicalBrowseId(type: string, id: string): string {
  return canonicalTitleId(type, id);
}

function shouldMirrorSeriesGateRecord(type: string, id: string): boolean {
  return type === 'series'
    && isSeriesRailGateId(id)
    && canonicalBrowseId(type, id) !== id;
}

let dbSingleton: Database.Database | null = null;
let schemaInitialized = false;
const RAIL_POOL_CACHE_LIMIT = 64;
let railPoolCacheGeneration: number | null = null;
let railPoolCacheDataVersion: number | null = null;
const railPoolCache = new Map<string, RailPoolRow[]>();

function invalidateRailPoolCache(): void {
  railPoolCache.clear();
  railPoolCacheGeneration = null;
  railPoolCacheDataVersion = null;
}

// One tab-wide VOD shuffle updates the current sessions and recent-title rows
// for every category. SQLite's 1,000-page default can therefore checkpoint in
// the couch response path after a small burst of X presses. Mango already runs
// an explicit idle/nightly TRUNCATE checkpoint; 8,192 pages bounds the live WAL
// to roughly 32 MiB while keeping normal couch bursts below that boundary.
export const PLAYABILITY_WAL_AUTOCHECKPOINT_PAGES = 8192;

function openDb(): Database.Database {
  if (!dbSingleton) {
    const db = new Database(dbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma(`wal_autocheckpoint = ${PLAYABILITY_WAL_AUTOCHECKPOINT_PAGES}`);
    db.pragma('cache_size = -16000');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 134217728');
    dbSingleton = db;
  }
  return dbSingleton;
}

/** Accessor for other modules (e.g. batch-writer) that must share the singleton. */
export function getPlayabilityDb(): Database.Database {
  return openDb();
}

/** Test-only: close the shared handle and reset the init-once flag so a fresh
 * `MANGO_PLAYABILITY_DB` path takes effect on the next call. Never call from
 * production code — the connection must live for the process lifetime. */
export function resetPlayabilityDbForTests(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  invalidateRailPoolCache();
  vodBrowseReservoirCache.clear();
  vodBrowseReservoirPreparation.clear();
  vodBrowseReservoirPreparationTail = Promise.resolve();
  schemaInitialized = false;
}

function isStreamCapabilityClass(value: unknown): value is StreamCapabilityClass {
  return value === 'proven_smooth' || value === 'unknown' || value === 'known_risky';
}

export function getStreamPathEvidence(
  releaseFingerprint: string,
  profileId: string,
): StreamPathEvidence | null {
  if (!releaseFingerprint || !profileId) return null;
  try {
    const row = openDb().prepare(`
SELECT release_fingerprint, profile_id, capability_class, technical_json,
       reason, last_proof_at, long_watch_count, issue_previous_class,
       issue_reason, issue_expires_at, updated_at
FROM stream_path_evidence
WHERE release_fingerprint = ?
  AND profile_id = ?
LIMIT 1;
`).get(releaseFingerprint, profileId) as StreamPathEvidence | undefined;
    if (!row || !isStreamCapabilityClass(row.capability_class)) return null;
    return row;
  } catch {
    // Ranking remains functional during first-start migration or in isolated
    // unit tests that intentionally do not initialize the operator database.
    return null;
  }
}

export function upsertStreamPathEvidence(input: {
  release_fingerprint: string;
  profile_id: string;
  capability_class: StreamCapabilityClass;
  technical?: Record<string, unknown> | null;
  reason?: string | null;
  last_proof_at?: number | null;
  now?: number;
}): void {
  const now = input.now ?? nowMs();
  openDb().prepare(`
INSERT INTO stream_path_evidence(
  release_fingerprint, profile_id, capability_class, technical_json,
  reason, last_proof_at, updated_at
)
VALUES (
  @release_fingerprint, @profile_id, @capability_class, @technical_json,
  @reason, @last_proof_at, @updated_at
)
ON CONFLICT(release_fingerprint, profile_id) DO UPDATE SET
  capability_class = excluded.capability_class,
  technical_json = COALESCE(excluded.technical_json, stream_path_evidence.technical_json),
  reason = excluded.reason,
  last_proof_at = COALESCE(excluded.last_proof_at, stream_path_evidence.last_proof_at),
  issue_previous_class = CASE
    WHEN stream_path_evidence.issue_expires_at IS NOT NULL
      AND stream_path_evidence.issue_expires_at <= @updated_at
    THEN NULL
    ELSE stream_path_evidence.issue_previous_class
  END,
  issue_reason = CASE
    WHEN stream_path_evidence.issue_expires_at IS NOT NULL
      AND stream_path_evidence.issue_expires_at <= @updated_at
    THEN NULL
    ELSE stream_path_evidence.issue_reason
  END,
  issue_expires_at = CASE
    WHEN stream_path_evidence.issue_expires_at IS NOT NULL
      AND stream_path_evidence.issue_expires_at <= @updated_at
    THEN NULL
    ELSE stream_path_evidence.issue_expires_at
  END,
  updated_at = excluded.updated_at;
`).run({
    release_fingerprint: input.release_fingerprint,
    profile_id: input.profile_id,
    capability_class: input.capability_class,
    technical_json: input.technical ? JSON.stringify(input.technical) : null,
    reason: input.reason ?? null,
    last_proof_at: input.last_proof_at ?? null,
    updated_at: now,
  });
}

export function recordStreamLongWatch(input: {
  release_fingerprint: string;
  profile_id: string;
  technical?: Record<string, unknown> | null;
  now?: number;
}): void {
  const now = input.now ?? nowMs();
  openDb().prepare(`
INSERT INTO stream_path_evidence(
  release_fingerprint, profile_id, capability_class, technical_json,
  reason, last_proof_at, long_watch_count, updated_at
)
VALUES (
  @release_fingerprint, @profile_id, 'unknown', @technical_json,
  'substantial watch completed on this playback path', @now, 1, @now
)
ON CONFLICT(release_fingerprint, profile_id) DO UPDATE SET
  technical_json = COALESCE(excluded.technical_json, stream_path_evidence.technical_json),
  last_proof_at = @now,
  long_watch_count = stream_path_evidence.long_watch_count + 1,
  updated_at = @now;
`).run({
    release_fingerprint: input.release_fingerprint,
    profile_id: input.profile_id,
    technical_json: input.technical ? JSON.stringify(input.technical) : null,
    now,
  });
}

export function recordStreamPlaybackIssue(input: {
  release_fingerprint: string;
  profile_id: string;
  reason: string;
  ttl_ms?: number;
  now?: number;
}): StreamPathEvidence {
  const now = input.now ?? nowMs();
  const expiresAt = now + Math.max(60_000, input.ttl_ms ?? 7 * 24 * 60 * 60 * 1000);
  openDb().prepare(`
INSERT INTO stream_path_evidence(
  release_fingerprint, profile_id, capability_class, reason,
  issue_previous_class, issue_reason, issue_expires_at, updated_at
)
VALUES (
  @release_fingerprint, @profile_id, 'known_risky', @reason,
  'unknown', @reason, @expires_at, @now
)
ON CONFLICT(release_fingerprint, profile_id) DO UPDATE SET
  issue_previous_class = CASE
    WHEN stream_path_evidence.issue_expires_at IS NOT NULL
      AND stream_path_evidence.issue_expires_at > @now
    THEN stream_path_evidence.issue_previous_class
    ELSE stream_path_evidence.capability_class
  END,
  capability_class = 'known_risky',
  reason = @reason,
  issue_reason = @reason,
  issue_expires_at = @expires_at,
  updated_at = @now;
`).run({
    release_fingerprint: input.release_fingerprint,
    profile_id: input.profile_id,
    reason: input.reason,
    expires_at: expiresAt,
    now,
  });
  return getStreamPathEvidence(input.release_fingerprint, input.profile_id)!;
}

export function undoStreamPlaybackIssue(input: {
  release_fingerprint: string;
  profile_id: string;
  now?: number;
}): StreamPathEvidence | null {
  const now = input.now ?? nowMs();
  openDb().prepare(`
UPDATE stream_path_evidence
SET capability_class = COALESCE(issue_previous_class, 'unknown'),
    reason = 'playback issue undone',
    issue_previous_class = NULL,
    issue_reason = NULL,
    issue_expires_at = NULL,
    updated_at = @now
WHERE release_fingerprint = @release_fingerprint
  AND profile_id = @profile_id;
`).run({
    release_fingerprint: input.release_fingerprint,
    profile_id: input.profile_id,
    now,
  });
  return getStreamPathEvidence(input.release_fingerprint, input.profile_id);
}

function nowMs(): number {
  return Date.now();
}

function ensurePlayabilitySchemaInitialized(): void {
  mkdirSync(dirname(dbPath()), { recursive: true });
  const db = openDb();
  if (schemaInitialized) {
    return;
  }
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
  first_verified_at INTEGER,
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
  evidence_json TEXT,
  evidence_hash TEXT,
  evidence_source TEXT,
  evidence_retrieved_at INTEGER,
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

CREATE TABLE IF NOT EXISTS source_grow_weights (
  source_key TEXT NOT NULL,
  rail_id TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  scanned REAL NOT NULL DEFAULT 0,
  fresh_queued REAL NOT NULL DEFAULT 0,
  skipped_verified REAL NOT NULL DEFAULT 0,
  skipped_recent_failed REAL NOT NULL DEFAULT 0,
  linked_verified_seen REAL NOT NULL DEFAULT 0,
  requested REAL NOT NULL DEFAULT 0,
  returned REAL NOT NULL DEFAULT 0,
  catalog_errors REAL NOT NULL DEFAULT 0,
  rate_limited REAL NOT NULL DEFAULT 0,
  exhausted INTEGER NOT NULL DEFAULT 0,
  verified REAL NOT NULL DEFAULT 0,
  failed REAL NOT NULL DEFAULT 0,
  theme_rejected REAL NOT NULL DEFAULT 0,
  unresolved_external_id REAL NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  multiplier REAL NOT NULL DEFAULT 1,
  probation INTEGER NOT NULL DEFAULT 0,
  probation_multiplier REAL NOT NULL DEFAULT 0.08,
  elapsed_ms REAL NOT NULL DEFAULT 0,
  last_ts INTEGER NOT NULL,
  rollback_reason TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_key, rail_id)
);

CREATE TABLE IF NOT EXISTS source_grow_rail_outcomes (
  rail_id TEXT PRIMARY KEY,
  target_met INTEGER NOT NULL,
  weighted INTEGER NOT NULL,
  last_ts INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stream_path_evidence (
  release_fingerprint TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  capability_class TEXT NOT NULL
    CHECK (capability_class IN ('proven_smooth', 'unknown', 'known_risky')),
  technical_json TEXT,
  reason TEXT,
  last_proof_at INTEGER,
  long_watch_count INTEGER NOT NULL DEFAULT 0,
  issue_previous_class TEXT
    CHECK (issue_previous_class IS NULL OR issue_previous_class IN ('proven_smooth', 'unknown', 'known_risky')),
  issue_reason TEXT,
  issue_expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (release_fingerprint, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_titles_status_expires ON titles(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_rail_pool_rail_score ON rail_pool(rail_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_rail_session_session ON rail_session(session_id, rail_id, slot);
CREATE INDEX IF NOT EXISTS idx_recently_shown_rail_time ON recently_shown(rail_id, shown_at);
CREATE INDEX IF NOT EXISTS idx_verify_log_started ON verify_log(started_at);
CREATE INDEX IF NOT EXISTS idx_playability_triggers_open ON playability_triggers(handled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_rail_candidate_rejections_active ON rail_candidate_rejections(rail_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_rail_pool_type_id ON rail_pool(type, id);
CREATE INDEX IF NOT EXISTS idx_verify_log_lookup ON verify_log(type, id_value, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_grow_weights_updated ON source_grow_weights(updated_at);
CREATE INDEX IF NOT EXISTS idx_source_grow_weights_rail ON source_grow_weights(rail_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_stream_path_evidence_issue
  ON stream_path_evidence(profile_id, issue_expires_at);
`);
  applySchemaMigrations(db);
  prunePlayabilityMaintenance();
  schemaInitialized = true;
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
  return new Set(rows.map((row) => titleKey(row.type, canonicalBrowseId(row.type, row.id))));
}

function readRailPool(
  db: Database.Database,
  railId: string,
  _now: number,
): RailPoolRow[] {
  const generation = Number((db.prepare(`
SELECT generation FROM recommendation_corpus_state WHERE state_id = 1
`).get() as { generation?: number } | undefined)?.generation ?? 1);
  const dataVersion = Number(db.pragma('data_version', { simple: true }));
  if (generation !== railPoolCacheGeneration || dataVersion !== railPoolCacheDataVersion) {
    railPoolCache.clear();
    railPoolCacheGeneration = generation;
    railPoolCacheDataVersion = dataVersion;
  }
  const cached = railPoolCache.get(railId);
  if (cached) return cached;
  const rows = db.prepare(`
SELECT
  rp.rail_id,
  rp.type,
  rp.id,
  rp.score,
  rp.title,
  rp.poster_url,
  rp.year,
  rp.evidence_json,
  t.best_source,
  t.cache_status,
  t.debrid_service,
  t.verified_at,
  t.first_verified_at,
  t.expires_at
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE rp.rail_id = @rail_id
  AND t.status IN ('verified', 'stale')
ORDER BY rp.score DESC;
`).all({ rail_id: railId }) as RailPoolRow[];
  if (railPoolCache.size >= RAIL_POOL_CACHE_LIMIT) {
    railPoolCache.delete(railPoolCache.keys().next().value as string);
  }
  railPoolCache.set(railId, rows);
  return rows;
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
  return new Set(recentRows.map((row) => titleKey(row.type, canonicalBrowseId(row.type, row.id))));
}

function writeRailSessionRows(
  db: Database.Database,
  railId: string,
  sessionId: string,
  rows: RailSessionPoolItem[],
  now: number,
  recordRecent = true,
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
    const canonicalId = canonicalBrowseId(row.type, row.id);
    insertSession.run({
      rail_id: row.rail_id,
      type: row.type,
      id: canonicalId,
      slot: row.slot,
      mix_bucket: row.mix_bucket,
      session_id: row.session_id,
      created_at: now,
    });
    if (recordRecent) {
      upsertRecent.run({
        rail_id: row.rail_id,
        type: row.type,
        id: canonicalId,
        shown_at: now,
      });
    }
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
  ensurePlayabilitySchemaInitialized();
}

/** Deletes off-browse-path bloat. Called once at init, never per request. */
export function prunePlayabilityMaintenance(now: number = nowMs()): number {
  const db = openDb();
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  let deleted = 0;
  const transaction = db.transaction(() => {
    deleted += db.prepare('DELETE FROM verify_log WHERE started_at < ?').run(fourteenDaysAgo).changes;
    deleted += db.prepare(
      'DELETE FROM playability_triggers WHERE handled_at IS NOT NULL AND created_at < ?',
    ).run(sevenDaysAgo).changes;
    deleted += db.prepare('DELETE FROM rail_candidate_rejections WHERE expires_at < ?').run(now).changes;
    db.prepare(`
UPDATE stream_path_evidence
SET capability_class = CASE
      WHEN issue_previous_class IS NOT NULL THEN issue_previous_class
      ELSE 'unknown'
    END,
    reason = 'playback issue expired',
    issue_previous_class = NULL,
    issue_reason = NULL,
    issue_expires_at = NULL,
    updated_at = ?
WHERE issue_expires_at IS NOT NULL
  AND issue_expires_at <= ?;
`).run(now, now);
  });
  transaction();
  return deleted;
}

function applySchemaMigrations(db: Database.Database): void {
  const appliedVersion = Number(
    (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM playability_migrations').get() as { version?: number } | undefined)?.version ?? 0,
  );
  const hasVersion7 = Boolean(
    db.prepare('SELECT 1 FROM playability_migrations WHERE version = 7 LIMIT 1').get(),
  );
  const columns = db.prepare('PRAGMA table_info(titles)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'win_ladder_step')) {
    db.exec('ALTER TABLE titles ADD COLUMN win_ladder_step TEXT');
  }
  if (!columns.some((column) => column.name === 'first_verified_at')) {
    db.exec('ALTER TABLE titles ADD COLUMN first_verified_at INTEGER');
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
  if (!hasVersion7 || appliedVersion < 7) {
    repairSeriesBrowseCanonicalization(db);
  }
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (7, @applied_at);
`).run({ applied_at: nowMs() });
  db.exec(`
CREATE TABLE IF NOT EXISTS source_grow_weights (
  source_key TEXT NOT NULL,
  rail_id TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  scanned REAL NOT NULL DEFAULT 0,
  fresh_queued REAL NOT NULL DEFAULT 0,
  skipped_verified REAL NOT NULL DEFAULT 0,
  skipped_recent_failed REAL NOT NULL DEFAULT 0,
  linked_verified_seen REAL NOT NULL DEFAULT 0,
  requested REAL NOT NULL DEFAULT 0,
  returned REAL NOT NULL DEFAULT 0,
  catalog_errors REAL NOT NULL DEFAULT 0,
  rate_limited REAL NOT NULL DEFAULT 0,
  exhausted INTEGER NOT NULL DEFAULT 0,
  verified REAL NOT NULL DEFAULT 0,
  failed REAL NOT NULL DEFAULT 0,
  theme_rejected REAL NOT NULL DEFAULT 0,
  unresolved_external_id REAL NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  multiplier REAL NOT NULL DEFAULT 1,
  probation INTEGER NOT NULL DEFAULT 0,
  probation_multiplier REAL NOT NULL DEFAULT 0.08,
  elapsed_ms REAL NOT NULL DEFAULT 0,
  last_ts INTEGER NOT NULL,
  rollback_reason TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_key, rail_id)
);
CREATE TABLE IF NOT EXISTS source_grow_rail_outcomes (
  rail_id TEXT PRIMARY KEY,
  target_met INTEGER NOT NULL,
  weighted INTEGER NOT NULL,
  last_ts INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_grow_weights_updated ON source_grow_weights(updated_at);
CREATE INDEX IF NOT EXISTS idx_source_grow_weights_rail ON source_grow_weights(rail_id, updated_at);
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (8, @applied_at);
`).run({ applied_at: nowMs() });
  db.prepare(`
UPDATE titles AS t
SET first_verified_at = COALESCE(
  (
    SELECT MIN(v.started_at)
    FROM verify_log v
    WHERE v.type = t.type
      AND v.id_value = t.id
      AND v.outcome = 'verified'
  ),
  CASE WHEN t.status = 'verified' THEN t.updated_at ELSE NULL END
)
WHERE t.first_verified_at IS NULL
  AND (
    t.status = 'verified'
    OR EXISTS (
      SELECT 1
      FROM verify_log v
      WHERE v.type = t.type
        AND v.id_value = t.id
        AND v.outcome = 'verified'
    )
  );
`).run();
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (9, @applied_at);
`).run({ applied_at: nowMs() });
  db.exec(`
CREATE TABLE IF NOT EXISTS stream_path_evidence (
  release_fingerprint TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  capability_class TEXT NOT NULL
    CHECK (capability_class IN ('proven_smooth', 'unknown', 'known_risky')),
  technical_json TEXT,
  reason TEXT,
  last_proof_at INTEGER,
  long_watch_count INTEGER NOT NULL DEFAULT 0,
  issue_previous_class TEXT
    CHECK (issue_previous_class IS NULL OR issue_previous_class IN ('proven_smooth', 'unknown', 'known_risky')),
  issue_reason TEXT,
  issue_expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (release_fingerprint, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_stream_path_evidence_issue
  ON stream_path_evidence(profile_id, issue_expires_at);
`);
  const streamEvidenceColumns = db.prepare(
    'PRAGMA table_info(stream_path_evidence)',
  ).all() as Array<{ name: string }>;
  if (!streamEvidenceColumns.some((column) => column.name === 'issue_previous_class')) {
    db.exec(`
ALTER TABLE stream_path_evidence
ADD COLUMN issue_previous_class TEXT
  CHECK (issue_previous_class IS NULL OR issue_previous_class IN ('proven_smooth', 'unknown', 'known_risky'));
`);
  }
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (10, @applied_at);
`).run({ applied_at: nowMs() });
  db.exec(`
CREATE TABLE IF NOT EXISTS recommendation_corpus_state (
  state_id INTEGER PRIMARY KEY CHECK(state_id = 1),
  generation INTEGER NOT NULL CHECK(generation >= 1),
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO recommendation_corpus_state(state_id, generation, updated_at)
VALUES (1, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TRIGGER IF NOT EXISTS recommendation_corpus_titles_insert
AFTER INSERT ON titles
WHEN NEW.type IN ('movie', 'series')
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS recommendation_corpus_titles_update
AFTER UPDATE OF status, updated_at ON titles
WHEN NEW.type IN ('movie', 'series')
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS recommendation_corpus_titles_delete
AFTER DELETE ON titles
WHEN OLD.type IN ('movie', 'series')
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS recommendation_corpus_pool_insert
AFTER INSERT ON rail_pool
WHEN NEW.type IN ('movie', 'series')
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS recommendation_corpus_pool_update
AFTER UPDATE OF title, poster_url, year, rail_id ON rail_pool
WHEN NEW.type IN ('movie', 'series')
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;

CREATE TRIGGER IF NOT EXISTS recommendation_corpus_pool_delete
AFTER DELETE ON rail_pool
WHEN OLD.type IN ('movie', 'series')
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (11, @applied_at);
`).run({ applied_at: nowMs() });
  const evidenceColumns = db.prepare('PRAGMA table_info(rail_pool)').all() as Array<{ name: string }>;
  if (!evidenceColumns.some((column) => column.name === 'evidence_json')) {
    db.exec('ALTER TABLE rail_pool ADD COLUMN evidence_json TEXT');
  }
  if (!evidenceColumns.some((column) => column.name === 'evidence_hash')) {
    db.exec('ALTER TABLE rail_pool ADD COLUMN evidence_hash TEXT');
  }
  if (!evidenceColumns.some((column) => column.name === 'evidence_source')) {
    db.exec('ALTER TABLE rail_pool ADD COLUMN evidence_source TEXT');
  }
  if (!evidenceColumns.some((column) => column.name === 'evidence_retrieved_at')) {
    db.exec('ALTER TABLE rail_pool ADD COLUMN evidence_retrieved_at INTEGER');
  }
  db.exec(`
DROP TRIGGER IF EXISTS recommendation_corpus_pool_update;
CREATE TRIGGER recommendation_corpus_pool_update
AFTER UPDATE OF title, poster_url, year, evidence_hash, rail_id ON rail_pool
WHEN NEW.type IN ('movie', 'series')
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (12, @applied_at);
`).run({ applied_at: nowMs() });
  // Story evidence is title metadata, not presentation-rail state. Keep a
  // durable canonical copy so rail hiding/retheme/pruning cannot erase the
  // source evidence needed by a later StoryDNA generation.
  db.exec(`
CREATE TABLE IF NOT EXISTS title_story_evidence (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT,
  poster_url TEXT,
  year TEXT,
  evidence_json TEXT,
  evidence_hash TEXT,
  evidence_source TEXT,
  evidence_retrieved_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (type, id)
);

INSERT OR IGNORE INTO title_story_evidence(
  type, id, title, poster_url, year, evidence_json, evidence_hash,
  evidence_source, evidence_retrieved_at, updated_at
)
SELECT type, id, title, poster_url, year, evidence_json, evidence_hash,
       evidence_source, evidence_retrieved_at, ingested_at
FROM (
  SELECT rp.*,
    ROW_NUMBER() OVER (
      PARTITION BY rp.type, rp.id
      ORDER BY
        CASE WHEN NULLIF(TRIM(rp.poster_url), '') IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN NULLIF(TRIM(rp.title), '') IS NOT NULL THEN 0 ELSE 1 END,
        rp.ingested_at DESC,
        rp.rail_id ASC
    ) AS evidence_rank
  FROM rail_pool rp
)
WHERE evidence_rank = 1;

CREATE TRIGGER IF NOT EXISTS title_story_evidence_pool_insert
AFTER INSERT ON rail_pool
WHEN NEW.type IN ('movie', 'series')
BEGIN
  INSERT INTO title_story_evidence(
    type, id, title, poster_url, year, evidence_json, evidence_hash,
    evidence_source, evidence_retrieved_at, updated_at
  ) VALUES (
    NEW.type, NEW.id, NEW.title, NEW.poster_url, NEW.year, NEW.evidence_json,
    NEW.evidence_hash, NEW.evidence_source, NEW.evidence_retrieved_at, NEW.ingested_at
  )
  ON CONFLICT(type, id) DO UPDATE SET
    title = COALESCE(excluded.title, title_story_evidence.title),
    poster_url = COALESCE(excluded.poster_url, title_story_evidence.poster_url),
    year = COALESCE(excluded.year, title_story_evidence.year),
    evidence_json = COALESCE(excluded.evidence_json, title_story_evidence.evidence_json),
    evidence_hash = COALESCE(excluded.evidence_hash, title_story_evidence.evidence_hash),
    evidence_source = CASE
      WHEN excluded.evidence_hash IS NOT title_story_evidence.evidence_hash
        THEN COALESCE(excluded.evidence_source, title_story_evidence.evidence_source)
      ELSE title_story_evidence.evidence_source
    END,
    evidence_retrieved_at = CASE
      WHEN excluded.evidence_hash IS NOT title_story_evidence.evidence_hash
        THEN COALESCE(excluded.evidence_retrieved_at, title_story_evidence.evidence_retrieved_at)
      ELSE title_story_evidence.evidence_retrieved_at
    END,
    updated_at = MAX(title_story_evidence.updated_at, excluded.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS title_story_evidence_pool_update
AFTER UPDATE OF title, poster_url, year, evidence_json, evidence_hash,
  evidence_source, evidence_retrieved_at ON rail_pool
WHEN NEW.type IN ('movie', 'series')
BEGIN
  INSERT INTO title_story_evidence(
    type, id, title, poster_url, year, evidence_json, evidence_hash,
    evidence_source, evidence_retrieved_at, updated_at
  ) VALUES (
    NEW.type, NEW.id, NEW.title, NEW.poster_url, NEW.year, NEW.evidence_json,
    NEW.evidence_hash, NEW.evidence_source, NEW.evidence_retrieved_at, NEW.ingested_at
  )
  ON CONFLICT(type, id) DO UPDATE SET
    title = COALESCE(excluded.title, title_story_evidence.title),
    poster_url = COALESCE(excluded.poster_url, title_story_evidence.poster_url),
    year = COALESCE(excluded.year, title_story_evidence.year),
    evidence_json = COALESCE(excluded.evidence_json, title_story_evidence.evidence_json),
    evidence_hash = COALESCE(excluded.evidence_hash, title_story_evidence.evidence_hash),
    evidence_source = CASE
      WHEN excluded.evidence_hash IS NOT title_story_evidence.evidence_hash
        THEN COALESCE(excluded.evidence_source, title_story_evidence.evidence_source)
      ELSE title_story_evidence.evidence_source
    END,
    evidence_retrieved_at = CASE
      WHEN excluded.evidence_hash IS NOT title_story_evidence.evidence_hash
        THEN COALESCE(excluded.evidence_retrieved_at, title_story_evidence.evidence_retrieved_at)
      ELSE title_story_evidence.evidence_retrieved_at
    END,
    updated_at = MAX(title_story_evidence.updated_at, excluded.updated_at);
END;
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (13, @applied_at);
`).run({ applied_at: nowMs() });
  const storyEvidenceColumns = db.prepare('PRAGMA table_info(title_story_evidence)')
    .all() as Array<{ name: string }>;
  if (!storyEvidenceColumns.some((column) => column.name === 'semantic_evidence_hash')) {
    db.exec('ALTER TABLE title_story_evidence ADD COLUMN semantic_evidence_hash TEXT');
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS recommendation_semantic_state (
  state_id INTEGER PRIMARY KEY CHECK(state_id = 1),
  generation INTEGER NOT NULL CHECK(generation >= 1),
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO recommendation_semantic_state(state_id, generation, updated_at)
VALUES (1, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE IF NOT EXISTS recommendation_semantic_evidence (
  type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
  id TEXT NOT NULL,
  semantic_evidence_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(type, id)
);

DROP TRIGGER IF EXISTS recommendation_semantic_evidence_insert;
CREATE TRIGGER recommendation_semantic_evidence_insert
AFTER INSERT ON recommendation_semantic_evidence
BEGIN
  UPDATE recommendation_semantic_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;

DROP TRIGGER IF EXISTS recommendation_semantic_evidence_update;
CREATE TRIGGER recommendation_semantic_evidence_update
AFTER UPDATE OF semantic_evidence_hash ON recommendation_semantic_evidence
WHEN NEW.semantic_evidence_hash IS NOT OLD.semantic_evidence_hash
BEGIN
  UPDATE recommendation_semantic_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;
`);
  db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (14, @applied_at);
`).run({ applied_at: nowMs() });
  if (appliedVersion < 15) {
    // Generation 15 separates actual recommendation-corpus changes from
    // operational verification churn. Updating a verification timestamp with
    // the same status must not invalidate cached pools or rebuild VOD profiles.
    db.exec(`
DROP TRIGGER IF EXISTS recommendation_corpus_titles_update;
CREATE TRIGGER recommendation_corpus_titles_update
AFTER UPDATE OF status ON titles
WHEN NEW.type IN ('movie', 'series')
  AND NEW.status IS NOT OLD.status
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;

DROP TRIGGER IF EXISTS recommendation_corpus_pool_update;
CREATE TRIGGER recommendation_corpus_pool_update
AFTER UPDATE OF title, poster_url, year, evidence_hash, rail_id ON rail_pool
WHEN NEW.type IN ('movie', 'series')
  AND (
    NEW.title IS NOT OLD.title
    OR NEW.poster_url IS NOT OLD.poster_url
    OR NEW.year IS NOT OLD.year
    OR NEW.evidence_hash IS NOT OLD.evidence_hash
    OR NEW.rail_id IS NOT OLD.rail_id
  )
BEGIN
  UPDATE recommendation_corpus_state
  SET generation = generation + 1,
      updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state_id = 1;
END;
`);
    db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (15, @applied_at);
`).run({ applied_at: nowMs() });
  }
  if (appliedVersion < 16) {
    db.exec(`
CREATE TABLE IF NOT EXISTS vod_browse_membership_v3 (
  corpus_generation INTEGER NOT NULL,
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
  id TEXT NOT NULL,
  trusted INTEGER NOT NULL CHECK(trusted IN (0, 1)),
  source_position REAL,
  theme_confidence REAL,
  taste_affinity REAL,
  novelty REAL,
  selection_weight REAL NOT NULL CHECK(selection_weight > 0),
  reason TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(corpus_generation, rail_id, type, id)
);
CREATE INDEX IF NOT EXISTS idx_vod_browse_membership_v3_rail
  ON vod_browse_membership_v3(corpus_generation, rail_id, trusted, selection_weight DESC);

CREATE TABLE IF NOT EXISTS vod_explore_sessions_v3 (
  tab TEXT NOT NULL CHECK(tab IN ('movies', 'series')),
  session_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot >= 0),
  type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  poster_url TEXT NOT NULL,
  year TEXT,
  selection_weight REAL NOT NULL CHECK(selection_weight > 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(tab, session_id, slot),
  UNIQUE(tab, session_id, type, id)
);
CREATE INDEX IF NOT EXISTS idx_vod_explore_sessions_v3_recent
  ON vod_explore_sessions_v3(tab, created_at DESC);

CREATE TABLE IF NOT EXISTS vod_tab_deals_v3 (
  tab TEXT NOT NULL CHECK(tab IN ('movies', 'series')),
  deal_epoch INTEGER NOT NULL CHECK(deal_epoch >= 0),
  state TEXT NOT NULL CHECK(state IN ('active', 'previous')),
  session_id TEXT NOT NULL,
  recommendation_revision INTEGER,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(tab, state),
  UNIQUE(tab, deal_epoch)
);
`);
    db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (16, @applied_at);
`).run({ applied_at: nowMs() });
  }
  if (appliedVersion < 17) {
    db.exec(`
CREATE TABLE IF NOT EXISTS vod_browse_reservoir_generations_v3 (
  generation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab TEXT NOT NULL CHECK(tab IN ('movies', 'series')),
  corpus_generation INTEGER NOT NULL,
  source_revision TEXT NOT NULL,
  affinity_revision TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('building', 'ready', 'failed')),
  rail_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  trusted_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_vod_browse_reservoir_generations_v3_tab
  ON vod_browse_reservoir_generations_v3(tab, generation_id DESC);

CREATE TABLE IF NOT EXISTS vod_browse_reservoir_rails_v3 (
  generation_id INTEGER NOT NULL REFERENCES vod_browse_reservoir_generations_v3(generation_id)
    ON DELETE CASCADE,
  rail_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('category', 'ai_catalog', 'explore')),
  candidate_count INTEGER NOT NULL,
  minimum_weight REAL,
  maximum_weight REAL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(generation_id, rail_id)
);

CREATE TABLE IF NOT EXISTS vod_browse_active_reservoirs_v3 (
  tab TEXT PRIMARY KEY CHECK(tab IN ('movies', 'series')),
  active_generation_id INTEGER NOT NULL
    REFERENCES vod_browse_reservoir_generations_v3(generation_id),
  previous_generation_id INTEGER
    REFERENCES vod_browse_reservoir_generations_v3(generation_id),
  updated_at INTEGER NOT NULL
);
`);
    db.prepare(`
INSERT OR IGNORE INTO playability_migrations(version, applied_at)
VALUES (17, @applied_at);
`).run({ applied_at: nowMs() });
  }
}

export function listSourceGrowWeights(): SourceGrowWeightRecord[] {
  ensurePlayabilitySchemaInitialized();
  const db = openDb();
  return db.prepare(`
SELECT
  source_key,
  NULLIF(rail_id, '') AS rail_id,
  source_label,
  content_type,
  scanned,
  fresh_queued,
  skipped_verified,
  skipped_recent_failed,
  linked_verified_seen,
  requested,
  returned,
  catalog_errors,
  rate_limited,
  exhausted,
  verified,
  failed,
  theme_rejected,
  unresolved_external_id,
  runs,
  multiplier,
  probation,
  probation_multiplier,
  elapsed_ms,
  last_ts,
  rollback_reason,
  updated_at
FROM source_grow_weights
ORDER BY rail_id, source_key;
`).all() as SourceGrowWeightRecord[];
}

export function listSourceGrowRailOutcomes(): SourceGrowRailOutcomeRecord[] {
  ensurePlayabilitySchemaInitialized();
  const db = openDb();
  return db.prepare(`
SELECT rail_id, target_met, weighted, last_ts, updated_at
FROM source_grow_rail_outcomes
ORDER BY rail_id;
`).all() as SourceGrowRailOutcomeRecord[];
}

export function replaceSourceGrowWeights(
  weights: SourceGrowWeightRecord[],
  outcomes: SourceGrowRailOutcomeRecord[],
): void {
  ensurePlayabilitySchemaInitialized();
  const db = openDb();
  const deleteWeights = db.prepare('DELETE FROM source_grow_weights');
  const deleteOutcomes = db.prepare('DELETE FROM source_grow_rail_outcomes');
  const insertWeight = db.prepare(`
INSERT INTO source_grow_weights (
  source_key, rail_id, source_label, content_type, scanned, fresh_queued,
  skipped_verified, skipped_recent_failed, linked_verified_seen, requested, returned,
  catalog_errors, rate_limited, exhausted, verified, failed, theme_rejected,
  unresolved_external_id, runs, multiplier, probation, probation_multiplier,
  elapsed_ms, last_ts, rollback_reason, updated_at
) VALUES (
  @source_key, @rail_id, @source_label, @content_type, @scanned, @fresh_queued,
  @skipped_verified, @skipped_recent_failed, @linked_verified_seen, @requested, @returned,
  @catalog_errors, @rate_limited, @exhausted, @verified, @failed, @theme_rejected,
  @unresolved_external_id, @runs, @multiplier, @probation, @probation_multiplier,
  @elapsed_ms, @last_ts, @rollback_reason, @updated_at
);
`);
  const insertOutcome = db.prepare(`
INSERT INTO source_grow_rail_outcomes (
  rail_id, target_met, weighted, last_ts, updated_at
) VALUES (
  @rail_id, @target_met, @weighted, @last_ts, @updated_at
);
`);
  const transaction = db.transaction(() => {
    deleteWeights.run();
    deleteOutcomes.run();
    for (const weight of weights) {
      insertWeight.run({
        ...weight,
        rail_id: weight.rail_id ?? '',
        exhausted: weight.exhausted ? 1 : 0,
        probation: weight.probation ? 1 : 0,
      });
    }
    for (const outcome of outcomes) {
      insertOutcome.run({
        ...outcome,
        target_met: outcome.target_met ? 1 : 0,
        weighted: outcome.weighted ? 1 : 0,
      });
    }
  });
  transaction();
}

export function clearSourceGrowWeights(): void {
  ensurePlayabilitySchemaInitialized();
  const db = openDb();
  db.prepare('DELETE FROM source_grow_weights').run();
  db.prepare('DELETE FROM source_grow_rail_outcomes').run();
}

function repairSeriesBrowseCanonicalization(db: Database.Database): void {
  const seriesTitleRows = db.prepare(`
SELECT
  type,
  id,
  status,
  verified_at,
  expires_at,
  fail_reason,
  best_source,
  cache_status,
  debrid_service,
  probe_ms,
  win_url_hash,
  win_ladder_step,
  updated_at
FROM titles
WHERE type = 'series'
  AND instr(id, char(58)) > 0;
`).all() as Array<{
    type: string;
    id: string;
    status: PlayabilityVerifyRecord['status'];
    verified_at: number | null;
    expires_at: number | null;
    fail_reason: string | null;
    best_source: string | null;
    cache_status: string | null;
    debrid_service: string | null;
    probe_ms: number | null;
    win_url_hash: string | null;
    win_ladder_step: string | null;
    updated_at: number;
  }>;
  const upsertTitle = db.prepare(`
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
`);
  for (const row of seriesTitleRows) {
    if (!shouldMirrorSeriesGateRecord(row.type, row.id)) {
      continue;
    }
    upsertTitle.run({
      ...row,
      id: canonicalBrowseId(row.type, row.id),
    });
  }

  const poolRows = db.prepare(`
SELECT rail_id, type, id, score, ingested_at, title, poster_url, year
FROM rail_pool
WHERE type = 'series';
`).all() as Array<{
    rail_id: string;
    type: string;
    id: string;
    score: number;
    ingested_at: number;
    title: string | null;
    poster_url: string | null;
    year: string | null;
  }>;
  if (poolRows.length > 0) {
    const merged = new Map<string, typeof poolRows[number]>();
    for (const row of poolRows) {
      const canonicalId = canonicalBrowseId(row.type, row.id);
      const key = `${row.rail_id}:${row.type}:${canonicalId}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...row, id: canonicalId });
        continue;
      }
      merged.set(key, {
        ...existing,
        id: canonicalId,
        score: Math.max(existing.score, row.score),
        ingested_at: Math.max(existing.ingested_at, row.ingested_at),
        title: existing.title ?? row.title,
        poster_url: existing.poster_url ?? row.poster_url,
        year: existing.year ?? row.year,
      });
    }
    db.prepare(`DELETE FROM rail_pool WHERE type = 'series';`).run();
    const insertPool = db.prepare(`
INSERT INTO rail_pool (rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES (@rail_id, @type, @id, @score, @ingested_at, @title, @poster_url, @year);
`);
    for (const row of merged.values()) {
      insertPool.run(row);
    }
  }

  db.prepare(`DELETE FROM rail_session WHERE type = 'series';`).run();
  db.prepare(`DELETE FROM recently_shown WHERE type = 'series';`).run();
}

export async function getRailIngestOffsetsBulk(railIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (railIds.length === 0) {
    return result;
  }
  await initPlayabilityDb();
  const db = openDb();
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
}

export async function setRailIngestOffset(railId: string, catalogOffset: number): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
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
}

/** Reset paginated ingest cursors after AI catalog compose escalation. */
export async function resetRailIngestCursors(railId: string): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
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
  const row = db.prepare(`
SELECT COUNT(*) AS c
FROM titles
WHERE status = 'verified';
`).get({ now }) as { c: number } | undefined;
  return toNumber(row?.c);
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
}

export async function listActiveRailCandidateRejections(
  railId: string,
  now = nowMs(),
): Promise<RailCandidateRejectionRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  return db.prepare(`
SELECT rail_id, type, id, reason, source_key, run_id, created_at, expires_at, details
FROM rail_candidate_rejections
WHERE rail_id = @rail_id AND expires_at > @now
ORDER BY expires_at DESC, type, id;
`).all({ rail_id: railId, now }) as RailCandidateRejectionRow[];
}

export async function clearExpiredRailCandidateRejections(now = nowMs()): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  const result = db.prepare(`
DELETE FROM rail_candidate_rejections
WHERE expires_at <= @now;
`).run({ now });
  return result.changes;
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
}

export async function getPlayabilityStatus(railIds: string[]): Promise<PlayabilityStatus> {
  await initPlayabilityDb();
  const db = openDb();
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
  const browse = db.prepare(`
SELECT
  (SELECT COALESCE(SUM(generations.trusted_count + generations.excluded_count), 0)
   FROM vod_browse_active_reservoirs_v3 active
   JOIN vod_browse_reservoir_generations_v3 generations
     ON generations.generation_id = active.active_generation_id
   WHERE generations.state = 'ready') AS classified_memberships,
  (SELECT COALESCE(SUM(generations.trusted_count), 0)
   FROM vod_browse_active_reservoirs_v3 active
   JOIN vod_browse_reservoir_generations_v3 generations
     ON generations.generation_id = active.active_generation_id
   WHERE generations.state = 'ready') AS trusted_memberships,
  (SELECT COUNT(*) FROM vod_browse_active_reservoirs_v3) AS ready_reservoirs,
  (SELECT COALESCE(SUM(generations.candidate_count), 0)
   FROM vod_browse_active_reservoirs_v3 active
   JOIN vod_browse_reservoir_generations_v3 generations
     ON generations.generation_id = active.active_generation_id
   WHERE generations.state = 'ready') AS reservoir_candidate_rows,
  (SELECT COUNT(*) FROM vod_explore_sessions_v3) AS explore_session_rows,
  (SELECT COUNT(*) FROM vod_tab_deals_v3 WHERE state = 'active') AS active_tab_deals,
  (SELECT COUNT(*) FROM vod_tab_deals_v3 WHERE state = 'previous') AS previous_tab_deals
`).get() as PlayabilityStatus['vod_browse_v3'];

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
    vod_browse_v3: browse,
    last_indexer_run_at: lastRun[0]?.last_indexer_run_at ?? null,
  };
}

export async function recordVerifyResult(record: PlayabilityVerifyRecord): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  const timestamp = nowMs();
  const verifiedAt = record.status === 'verified' ? timestamp : null;
  const firstVerifiedAt = record.status === 'verified' ? timestamp : null;
  const expiresAt = record.status === 'verified'
    ? record.expires_at ?? timestamp + DEFAULT_VERIFY_TTL_MS
    : record.expires_at ?? null;

  const transaction = db.transaction(() => {
    db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, win_ladder_step, first_verified_at, updated_at
) VALUES (
  @type, @id, @status, @verified_at, @expires_at, @fail_reason, @best_source,
  @cache_status, @debrid_service, @probe_ms, @win_url_hash, @win_ladder_step, @first_verified_at, @updated_at
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
  first_verified_at = CASE
    WHEN titles.first_verified_at IS NULL AND excluded.status = 'verified' THEN excluded.first_verified_at
    ELSE titles.first_verified_at
  END,
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
      first_verified_at: firstVerifiedAt,
      updated_at: timestamp,
    });
    if (shouldMirrorSeriesGateRecord(record.type, record.id)) {
      db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, win_ladder_step, first_verified_at, updated_at
) VALUES (
  @type, @id, @status, @verified_at, @expires_at, @fail_reason, @best_source,
  @cache_status, @debrid_service, @probe_ms, @win_url_hash, @win_ladder_step, @first_verified_at, @updated_at
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
  first_verified_at = CASE
    WHEN titles.first_verified_at IS NULL AND excluded.status = 'verified' THEN excluded.first_verified_at
    ELSE titles.first_verified_at
  END,
  updated_at = excluded.updated_at;
`).run({
        type: record.type,
        id: canonicalBrowseId(record.type, record.id),
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
        first_verified_at: firstVerifiedAt,
        updated_at: timestamp,
      });
    }

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
  // Verification metadata is included in rail snapshots even when status is
  // unchanged and the semantic corpus revision correctly stays stable.
  invalidateRailPoolCache();
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
}

export async function getStaleTitlesForRefresh(): Promise<Array<{ type: string; id: string; rail_id: string | null }>> {
  await initPlayabilityDb();
  const db = openDb();
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
}

export async function getStaleTitlesInPools(): Promise<Array<{ type: string; id: string }>> {
  const rows = await getStaleTitlesForRefresh();
  return rows.map(({ type, id }) => ({ type, id }));
}

/**
 * Q2: play_failure-tombstoned titles whose short dedicated retry window has elapsed.
 * These must be picked up by the nightly stale-reverify phase even when they never
 * resurface in a curated source-list scan (candidate-ingest only guards re-ingestion,
 * it never actively re-queues a title that already dropped out of every rail pool).
 */
export async function getPlayFailureTitlesForReverify(
  now: number = nowMs(),
): Promise<Array<{ type: string; id: string; rail_id: string | null }>> {
  await initPlayabilityDb();
  const db = openDb();
  const cutoff = now - playabilityPlayFailureRetryMs();
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
WHERE t.status = 'failed'
  AND t.fail_reason = 'play_failure'
  AND t.updated_at <= @cutoff;
`).all({ cutoff }) as Array<{ type: string; id: string; rail_id: string | null }>;
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
    keys.add(titleKey(row.type, canonicalBrowseId(row.type, row.id)));
    result.set(row.rail_id, keys);
  }
  return result;
}

export async function getTitleVerifyProfile(
  type: string,
  id: string,
): Promise<TitleVerifyProfile | null> {
  await initPlayabilityDb();
  const db = openDb();
  const row = db.prepare(`
SELECT
  type,
  id,
  status,
  first_verified_at,
  best_source,
  cache_status,
  debrid_service,
  win_url_hash,
  win_ladder_step,
  probe_ms,
  expires_at
FROM titles
WHERE type = @type AND id = @id;
`).get({ type, id }) as {
    type: string;
    id: string;
    status: TitleVerifyProfile['status'];
    first_verified_at: number | null;
    best_source: string | null;
    cache_status: string | null;
    debrid_service: string | null;
    win_url_hash: string | null;
    win_ladder_step: string | null;
    probe_ms: number | null;
    expires_at: number | null;
  } | undefined;
  return row ?? null;
}

export async function getRailPoolTitleKeys(railId: string): Promise<Set<string>> {
  await initPlayabilityDb();
  const db = openDb();
  const rows = db.prepare(`
SELECT type, id
FROM rail_pool
WHERE rail_id = @rail_id;
`).all({ rail_id: railId }) as RailPoolKeyRow[];
  return new Set(rows.map((row) => `${row.type}:${canonicalBrowseId(row.type, row.id)}`));
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
  return db.prepare(`
SELECT t.type, t.id, (
  SELECT rp.title FROM rail_pool rp
  WHERE rp.type = t.type AND rp.id = t.id
  LIMIT 1
) AS display_title
FROM titles t
WHERE t.status = 'verified'
  AND (t.type != 'series' OR instr(t.id, char(58)) = 0)
  AND NOT EXISTS (
    SELECT 1 FROM rail_pool rp WHERE rp.type = t.type AND rp.id = t.id
  );
`).all({ now }) as OrphanVerifiedRow[];
}

export async function countOrphanVerifiedPoolTitles(
  now: number = nowMs(),
): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  const row = db.prepare(`
SELECT COUNT(*) AS c
FROM titles t
WHERE t.status = 'verified'
  AND (t.type != 'series' OR instr(t.id, char(58)) = 0)
  AND NOT EXISTS (
    SELECT 1 FROM rail_pool rp WHERE rp.type = t.type AND rp.id = t.id
  );
`).get({ now }) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

export async function getRailPoolOverlapSummary(options: {
  maxRailsPerTitle?: number;
  topPairs?: number;
  now?: number;
} = {}): Promise<RailPoolOverlapSummary> {
  const maxRailsPerTitle = Math.max(1, Math.floor(options.maxRailsPerTitle ?? 2));
  const topPairs = Math.max(0, Math.floor(options.topPairs ?? 10));
  const now = options.now ?? nowMs();
  const overrides = await loadRailCurationOverrides();
  const pinned = new Set(
    overrides.pins.map((pin) => `${pin.rail_id}:${pin.type}:${pin.id}`),
  );
  await initPlayabilityDb();
  const db = openDb();
  const activeRows = db.prepare(`
WITH active AS (
  SELECT rp.rail_id, rp.type, rp.id
  FROM rail_pool rp
  JOIN titles t ON t.type = rp.type AND t.id = rp.id
  WHERE t.status = 'verified'
)
SELECT rail_id, type, id FROM active;
`).all({ now }) as Array<{ rail_id: string; type: string; id: string }>;

  const titleCounts = new Map<string, { rails: Set<string>; unpinnedRails: Set<string> }>();
  for (const row of activeRows) {
    const key = titleKey(row.type, row.id);
    const bucket = titleCounts.get(key) ?? { rails: new Set<string>(), unpinnedRails: new Set<string>() };
    bucket.rails.add(row.rail_id);
    const normalizedId = row.type === 'series' ? (seriesBareId(row.id) ?? row.id) : row.id;
    if (!pinned.has(`${row.rail_id}:${row.type}:${normalizedId}`)) {
      bucket.unpinnedRails.add(row.rail_id);
    }
    titleCounts.set(key, bucket);
  }

  let overlappedTitles = 0;
  let overCapTitles = 0;
  let overlapExtraSlots = 0;
  let maxRailsForAnyTitle = 0;
  for (const counts of titleCounts.values()) {
    const railCount = counts.rails.size;
    const unpinnedRailCount = counts.unpinnedRails.size;
    if (railCount > 1) overlappedTitles += 1;
    if (unpinnedRailCount > maxRailsPerTitle) {
      overCapTitles += 1;
      overlapExtraSlots += unpinnedRailCount - maxRailsPerTitle;
    }
    maxRailsForAnyTitle = Math.max(maxRailsForAnyTitle, railCount);
  }

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
    overlapped_titles: overlappedTitles,
    over_cap_titles: overCapTitles,
    overlap_extra_slots: overlapExtraSlots,
    max_rails_per_title: maxRailsForAnyTitle,
    top_pairs: pairs.map((pair) => ({
      rail_a: pair.rail_a,
      rail_b: pair.rail_b,
      shared_titles: Number(pair.shared_titles),
    })),
  };
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
  db.prepare(`
DELETE FROM rail_pool
WHERE rail_id = @rail_id AND type = @type AND id = @id;
`).run({ rail_id: railId, type, id: canonicalBrowseId(type, id) });
}

export async function listRailIdsContainingTitle(
  type: string,
  id: string,
): Promise<string[]> {
  await initPlayabilityDb();
  const db = openDb();
  const rows = db.prepare(`
SELECT DISTINCT rail_id
FROM rail_pool
WHERE type = @type AND id = @id;
`).all({ type, id: canonicalBrowseId(type, id) }) as Array<{ rail_id: string }>;
  return rows.map((row) => row.rail_id);
}

export async function clearRailSessions(railIds: string[]): Promise<void> {
  if (railIds.length === 0) return;
  await initPlayabilityDb();
  const db = openDb();
  const stmt = db.prepare('DELETE FROM rail_session WHERE rail_id = ?;');
  for (const railId of railIds) {
    stmt.run(railId);
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
  return counts;
}

export async function deleteRailPoolForRailIds(railIds: string[]): Promise<number> {
  if (railIds.length === 0) {
    return 0;
  }
  await initPlayabilityDb();
  const db = openDb();
  const placeholders = railIds.map(() => '?').join(', ');
  const result = db.prepare(`
DELETE FROM rail_pool
WHERE rail_id IN (${placeholders});
`).run(...railIds);
  return result.changes;
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
    id: canonicalBrowseId(item.type, item.id),
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

type VodBrowseMembershipDecision = {
  trusted: boolean;
  sourcePosition: number;
  themeConfidence: number | null;
  tasteAffinity: number | null;
  novelty: number;
  weight: number;
  reason: string;
};

function browseNovelty(firstVerifiedAt: number | null, now: number): number {
  if (!firstVerifiedAt || firstVerifiedAt <= 0) return 0.5;
  const ageDays = Math.max(0, now - firstVerifiedAt) / (24 * 60 * 60 * 1_000);
  return clampUnit(2 ** (-ageDays / 60));
}

function browseEvidenceMeta(row: RailPoolRow): Parameters<typeof metaHaystack>[0] {
  if (!row.evidence_json) return null;
  try {
    const parsed = JSON.parse(row.evidence_json);
    return parsed && typeof parsed === 'object'
      ? parsed as Parameters<typeof metaHaystack>[0]
      : null;
  } catch {
    return null;
  }
}

function classifyBrowseMembership(input: {
  railId: string;
  row: RailPoolRow;
  index: number;
  poolSize: number;
  now: number;
  themeProfile?: RailThemeProfile;
  tasteAffinity?: number | null;
  pinned: boolean;
}): VodBrowseMembershipDecision {
  const sourcePosition = input.poolSize <= 1 ? 1 : clampUnit(1 - input.index / (input.poolSize - 1));
  const novelty = browseNovelty(input.row.first_verified_at, input.now);
  const meta = browseEvidenceMeta(input.row);
  // A title string is identity, not enough evidence to reject a trusted source
  // membership. Only structured evidence can safely disprove the rail theme.
  const hasEvidence = meta !== null;
  let themeConfidence: number | null = null;
  let trusted = true;
  let reason = input.pinned ? 'operator_pin' : 'trusted_source';
  if (input.themeProfile) {
    const haystack = metaHaystack(meta, input.row.title);
    const fit = scoreThematicFit(haystack, input.themeProfile, parseRuntimeMinutes(meta));
    themeConfidence = clampUnit((fit - input.themeProfile.min_fit + 20) / 40);
    const permissiveAnchor = input.themeProfile.min_fit <= 3 && fit >= 0;
    trusted = input.pinned || !hasEvidence || fit >= input.themeProfile.min_fit || permissiveAnchor;
    reason = input.pinned
      ? 'operator_pin'
      : trusted
        ? fit >= input.themeProfile.min_fit ? 'theme_match' : 'trusted_source_sparse'
        : 'theme_mismatch';
  }
  const isAiCatalog = input.railId.startsWith(AI_CATALOG_RAIL_PREFIX);
  const weight = isAiCatalog
    ? aiCatalogWeight({
      catalogRelevance: sourcePosition,
      tasteAffinity: input.tasteAffinity,
      pinned: input.pinned,
    })
    : categoryWeight({
      sourcePosition,
      themeConfidence,
      tasteAffinity: input.tasteAffinity,
      novelty,
      pinned: input.pinned,
    });
  return {
    trusted: isAiCatalog || trusted,
    sourcePosition,
    themeConfidence,
    tasteAffinity: input.tasteAffinity ?? null,
    novelty,
    weight,
    reason: isAiCatalog ? (input.pinned ? 'operator_pin' : 'ai_catalog_member') : reason,
  };
}

type VodBrowseReservoirSnapshot = {
  generation_id: number;
  corpus_generation: number;
  source_revision: string;
  affinity_revision: string;
  rails: Map<string, VodBrowseReservoirItem[]>;
};

const vodBrowseReservoirPreparation = new Map<'movies' | 'series', Promise<number>>();
const vodBrowseReservoirCache = new Map<'movies' | 'series', VodBrowseReservoirSnapshot>();
let vodBrowseReservoirPreparationTail: Promise<void> = Promise.resolve();

function currentRecommendationCorpusGeneration(db: Database.Database): number {
  return Number((db.prepare(`
SELECT generation FROM recommendation_corpus_state WHERE state_id = 1
`).get() as { generation?: number } | undefined)?.generation ?? 1);
}

function vodBrowseSourceRevision(
  db: Database.Database,
  tab: 'movies' | 'series',
): string {
  const type = tab === 'series' ? 'series' : 'movie';
  const row = db.prepare(`
SELECT COUNT(*) AS count, COALESCE(MAX(ingested_at), 0) AS latest
FROM rail_pool WHERE type = ?
`).get(type) as { count: number; latest: number };
  return `${row.count}:${row.latest}`;
}

function readVodBrowseReservoirSnapshot(
  db: Database.Database,
  tab: 'movies' | 'series',
): VodBrowseReservoirSnapshot | null {
  const active = db.prepare(`
SELECT generations.generation_id, generations.corpus_generation,
       generations.source_revision, generations.affinity_revision
FROM vod_browse_active_reservoirs_v3 active
JOIN vod_browse_reservoir_generations_v3 generations
  ON generations.generation_id = active.active_generation_id
WHERE active.tab = ? AND generations.state = 'ready'
`).get(tab) as Omit<VodBrowseReservoirSnapshot, 'rails'> | undefined;
  if (!active) return null;
  const cached = vodBrowseReservoirCache.get(tab);
  if (cached?.generation_id === active.generation_id) return cached;
  const rows = db.prepare(`
SELECT rail_id, payload_json
FROM vod_browse_reservoir_rails_v3
WHERE generation_id = ?
ORDER BY rail_id
`).all(active.generation_id) as Array<{ rail_id: string; payload_json: string }>;
  const rails = new Map<string, VodBrowseReservoirItem[]>();
  try {
    for (const row of rows) {
      const parsed = JSON.parse(row.payload_json) as VodBrowseReservoirItem[];
      if (!Array.isArray(parsed)) return null;
      rails.set(row.rail_id, parsed);
    }
  } catch {
    return null;
  }
  const snapshot = { ...active, rails };
  vodBrowseReservoirCache.set(tab, snapshot);
  return snapshot;
}

async function buildVodBrowseReservoirV3(input: {
  tab: 'movies' | 'series';
  rails: readonly VodBrowseReservoirRail[];
  affinityRevision: string;
  affinityByKey?: ReadonlyMap<string, {
    taste_adjacency: number;
    profile_confidence: number | null;
  }>;
}): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  const now = nowMs();
  const corpusGeneration = currentRecommendationCorpusGeneration(db);
  const sourceRevision = vodBrowseSourceRevision(db, input.tab);
  const existing = db.prepare(`
SELECT generations.generation_id
FROM vod_browse_active_reservoirs_v3 active
JOIN vod_browse_reservoir_generations_v3 generations
  ON generations.generation_id = active.active_generation_id
WHERE active.tab = ? AND generations.state = 'ready'
  AND generations.corpus_generation = ? AND generations.source_revision = ?
  AND generations.affinity_revision = ?
`).get(input.tab, corpusGeneration, sourceRevision, input.affinityRevision) as { generation_id: number } | undefined;
  if (existing) return existing.generation_id;

  const generationId = Number(db.prepare(`
INSERT INTO vod_browse_reservoir_generations_v3(
  tab, corpus_generation, source_revision, affinity_revision, state, created_at
) VALUES (?, ?, ?, ?, 'building', ?)
`).run(input.tab, corpusGeneration, sourceRevision, input.affinityRevision, now).lastInsertRowid);
  try {
    const overrides = await loadRailCurationOverrides();
    const themeProfiles = await loadRailThemeProfiles();
    const railPayloads = new Map<string, { kind: 'category' | 'ai_catalog' | 'explore'; items: VodBrowseReservoirItem[] }>();
    const trustedCatalogQuality = new Map<string, number>();
    const verifiedKeys = new Set((db.prepare(`
SELECT type, id FROM titles WHERE status = 'verified' AND type IN ('movie', 'series')
`).all() as Array<{ type: string; id: string }>).map((row) => titleKey(row.type, row.id)));
    for (const rail of input.rails) {
      const pool = curatedPool(readRailPool(db, rail.railId, now), rail.railId, overrides)
        .filter((row) => verifiedKeys.has(titleKey(row.type, row.id)));
      const pins = new Set(pinsForRail(rail.railId, overrides).map((pin) => titleKey(pin.type, pin.id)));
      const items = pool.map((row, index) => {
        const key = titleKey(row.type, row.id);
        const affinity = input.affinityByKey?.get(key);
        const decision = classifyBrowseMembership({
          railId: rail.railId,
          row,
          index,
          poolSize: pool.length,
          now,
          themeProfile: themeProfiles.get(rail.railId),
          tasteAffinity: affinity?.taste_adjacency,
          pinned: pins.has(key),
        });
        if (decision.trusted && !rail.railId.startsWith(AI_CATALOG_RAIL_PREFIX)) {
          trustedCatalogQuality.set(key, Math.max(
            trustedCatalogQuality.get(key) ?? 0,
            decision.sourcePosition,
          ));
        }
        return {
          ...row,
          evidence_json: null,
          weight: decision.weight,
          trusted: decision.trusted,
          source_position: decision.sourcePosition,
          theme_confidence: decision.themeConfidence,
          taste_affinity: decision.tasteAffinity,
          novelty: decision.novelty,
          reason: decision.reason,
        } satisfies VodBrowseReservoirItem;
      });
      railPayloads.set(rail.railId, {
        kind: rail.railId.startsWith(AI_CATALOG_RAIL_PREFIX) ? 'ai_catalog' : 'category',
        items,
      });
    }

    const type = input.tab === 'series' ? 'series' : 'movie';
    const exploreRailId = input.tab === 'series' ? 'explore-series' : 'explore-movies';
    const exploreRows = db.prepare(`
SELECT titles.type, titles.id, titles.first_verified_at, titles.best_source,
       titles.cache_status, titles.debrid_service, titles.verified_at, titles.expires_at,
       evidence.title, evidence.poster_url, evidence.year
FROM titles
JOIN title_story_evidence evidence ON evidence.type = titles.type AND evidence.id = titles.id
WHERE titles.type = ? AND titles.status = 'verified'
  AND NULLIF(TRIM(evidence.title), '') IS NOT NULL
  AND NULLIF(TRIM(evidence.poster_url), '') IS NOT NULL
ORDER BY titles.id
`).all(type) as Array<{
      type: string;
      id: string;
      first_verified_at: number | null;
      best_source: string | null;
      cache_status: string | null;
      debrid_service: string | null;
      verified_at: number | null;
      expires_at: number | null;
      title: string;
      poster_url: string;
      year: string | null;
    }>;
    const exploreItems = exploreRows.map((row) => {
      const key = titleKey(row.type, row.id);
      const affinity = input.affinityByKey?.get(key);
      const novelty = browseNovelty(row.first_verified_at, now);
      const weight = exploreWeight({
        catalogQuality: trustedCatalogQuality.get(key),
        tasteAdjacency: affinity?.taste_adjacency,
        profileConfidence: affinity?.profile_confidence,
        novelty,
      });
      return {
        rail_id: exploreRailId,
        ...row,
        score: weight,
        evidence_json: null,
        weight,
        trusted: true,
        source_position: trustedCatalogQuality.get(key) ?? null,
        theme_confidence: null,
        taste_affinity: affinity?.taste_adjacency ?? null,
        novelty,
        reason: 'verified_explore',
      } satisfies VodBrowseReservoirItem;
    });
    railPayloads.set(exploreRailId, { kind: 'explore', items: exploreItems });

    const publish = db.transaction(() => {
      if (currentRecommendationCorpusGeneration(db) !== corpusGeneration) {
        throw new Error('verified corpus changed while Browse v3 reservoir was building');
      }
      if (vodBrowseSourceRevision(db, input.tab) !== sourceRevision) {
        throw new Error('browse source membership changed while Browse v3 reservoir was building');
      }
      const insertRail = db.prepare(`
INSERT INTO vod_browse_reservoir_rails_v3(
  generation_id, rail_id, kind, candidate_count, minimum_weight, maximum_weight, payload_json
) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
      let candidateCount = 0;
      let trustedCount = 0;
      let excludedCount = 0;
      for (const [railId, payload] of railPayloads) {
        const weights = payload.items.map((item) => item.weight);
        candidateCount += payload.items.length;
        if (payload.kind !== 'explore') {
          trustedCount += payload.items.filter((item) => item.trusted).length;
          excludedCount += payload.items.filter((item) => !item.trusted).length;
        }
        insertRail.run(
          generationId,
          railId,
          payload.kind,
          payload.items.length,
          weights.length > 0 ? Math.min(...weights) : null,
          weights.length > 0 ? Math.max(...weights) : null,
          JSON.stringify(payload.items),
        );
      }
      db.prepare(`
UPDATE vod_browse_reservoir_generations_v3
SET state = 'ready', rail_count = ?, candidate_count = ?, trusted_count = ?,
    excluded_count = ?, published_at = ?, error = NULL
WHERE generation_id = ? AND state = 'building'
`).run(railPayloads.size, candidateCount, trustedCount, excludedCount, nowMs(), generationId);
      const pointer = db.prepare(`
SELECT active_generation_id FROM vod_browse_active_reservoirs_v3 WHERE tab = ?
`).get(input.tab) as { active_generation_id: number } | undefined;
      db.prepare(`
INSERT INTO vod_browse_active_reservoirs_v3(
  tab, active_generation_id, previous_generation_id, updated_at
) VALUES (?, ?, ?, ?)
ON CONFLICT(tab) DO UPDATE SET
  previous_generation_id = vod_browse_active_reservoirs_v3.active_generation_id,
  active_generation_id = excluded.active_generation_id,
  updated_at = excluded.updated_at
`).run(input.tab, generationId, pointer?.active_generation_id ?? null, nowMs());
      db.prepare(`
DELETE FROM vod_browse_reservoir_generations_v3
WHERE tab = ? AND generation_id NOT IN (
  SELECT active_generation_id FROM vod_browse_active_reservoirs_v3 WHERE tab = ?
  UNION
  SELECT previous_generation_id FROM vod_browse_active_reservoirs_v3
  WHERE tab = ? AND previous_generation_id IS NOT NULL
)
`).run(input.tab, input.tab, input.tab);
    });
    publish();
    vodBrowseReservoirCache.delete(input.tab);
    return generationId;
  } catch (error) {
    db.prepare(`
UPDATE vod_browse_reservoir_generations_v3
SET state = 'failed', error = ? WHERE generation_id = ? AND state = 'building'
`).run(error instanceof Error ? error.message : String(error), generationId);
    throw error;
  }
}

/** Build the replaceable browse reservoir away from Home/X; coalesced per tab. */
export function prepareVodBrowseReservoirV3(input: {
  tab: 'movies' | 'series';
  rails: readonly VodBrowseReservoirRail[];
  affinityRevision: string;
  affinityByKey?: ReadonlyMap<string, {
    taste_adjacency: number;
    profile_confidence: number | null;
  }>;
}): Promise<number> {
  const existing = vodBrowseReservoirPreparation.get(input.tab);
  if (existing) return existing;
  const running = vodBrowseReservoirPreparationTail
    .catch(() => undefined)
    .then(() => buildVodBrowseReservoirV3(input))
    .finally(() => {
    if (vodBrowseReservoirPreparation.get(input.tab) === running) {
      vodBrowseReservoirPreparation.delete(input.tab);
    }
  });
  vodBrowseReservoirPreparationTail = running.then(() => undefined, () => undefined);
  vodBrowseReservoirPreparation.set(input.tab, running);
  return running;
}

/** Remove pool rows only for confirmed failed titles; stale remains published until confirmed. */
export async function pruneNonPlayableFromRailPools(_now: number = nowMs()): Promise<number> {
  const quarantined = await quarantineLegacyBackgroundUncachedVerifiedTitles(_now);
  await initPlayabilityDb();
  const db = openDb();
  const result = db.prepare(`
DELETE FROM rail_pool
WHERE EXISTS (
  SELECT 1 FROM titles t
  WHERE t.type = rail_pool.type AND t.id = rail_pool.id
    AND t.status = 'failed'
);
`).run();
  return quarantined.rail_pool + result.changes;
}

export async function upsertRailPoolTitle(entry: RailPoolEntry): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  db.prepare(`
INSERT INTO rail_pool (
  rail_id, type, id, score, ingested_at, title, poster_url, year,
  evidence_json, evidence_hash, evidence_source, evidence_retrieved_at
)
VALUES (
  @rail_id, @type, @id, @score, @ingested_at, @title, @poster_url, @year,
  @evidence_json, @evidence_hash, @evidence_source, @evidence_retrieved_at
)
ON CONFLICT(rail_id, type, id) DO UPDATE SET
  score = excluded.score,
  ingested_at = excluded.ingested_at,
  title = COALESCE(excluded.title, rail_pool.title),
  poster_url = COALESCE(excluded.poster_url, rail_pool.poster_url),
  year = COALESCE(excluded.year, rail_pool.year),
  evidence_json = COALESCE(excluded.evidence_json, rail_pool.evidence_json),
  evidence_hash = COALESCE(excluded.evidence_hash, rail_pool.evidence_hash),
  evidence_source = CASE
    WHEN excluded.evidence_hash IS NOT rail_pool.evidence_hash
      THEN COALESCE(excluded.evidence_source, rail_pool.evidence_source)
    ELSE rail_pool.evidence_source
  END,
  evidence_retrieved_at = CASE
    WHEN excluded.evidence_hash IS NOT rail_pool.evidence_hash
      THEN COALESCE(excluded.evidence_retrieved_at, rail_pool.evidence_retrieved_at)
    ELSE rail_pool.evidence_retrieved_at
  END;
`).run({
    rail_id: entry.rail_id,
    type: entry.type,
    id: canonicalBrowseId(entry.type, entry.id),
    score: entry.score,
    ingested_at: nowMs(),
    title: entry.title ?? null,
    poster_url: entry.poster_url ?? null,
    year: entry.year ?? null,
    evidence_json: entry.evidence_json ?? null,
    evidence_hash: entry.evidence_hash ?? null,
    evidence_source: entry.evidence_source ?? null,
    evidence_retrieved_at: entry.evidence_retrieved_at ?? null,
  });
  // Score-only refreshes intentionally do not advance the VOD corpus, but the
  // next selection must observe their new order.
  invalidateRailPoolCache();
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
  /** Every curated rail membership, sorted and URL-free, for semantic features. */
  rail_ids: string[];
};

/**
 * One row from the complete VOD recommendation corpus. Unlike
 * `VerifiedLibraryCatalogRow`, this type deliberately includes verified titles
 * that have no current presentation-rail membership or usable artwork. The
 * recommendation index must account for those rows and persist an exclusion
 * reason instead of silently shrinking the corpus.
 */
export type VerifiedRecommendationCatalogRow = {
  type: 'movie' | 'series';
  id: string;
  title: string | null;
  poster: string | null;
  year: string | null;
  rail_ids: string[];
  evidence_json: string | null;
  evidence_hash: string | null;
  evidence_source: string | null;
  evidence_retrieved_at: number | null;
  best_source: string | null;
  verified_at: number | null;
  updated_at: number;
};

export type VerifiedRecommendationCatalogPage = {
  content_type: 'movie' | 'series';
  corpus_generation: number;
  verified_count: number;
  after_id: string | null;
  next_cursor: string | null;
  items: VerifiedRecommendationCatalogRow[];
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
  AND (t.type != 'series' OR instr(t.id, char(58)) = 0)
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
}

/** Monotonic source revision captured by every VOD v2 indexing generation. */
export async function playabilityRecommendationCorpusGeneration(): Promise<number> {
  await initPlayabilityDb();
  const row = openDb().prepare(`
SELECT generation FROM recommendation_corpus_state WHERE state_id = 1
`).get() as { generation?: number } | undefined;
  return Math.max(1, Math.floor(Number(row?.generation) || 1));
}

/** Semantic revisions exclude rail placement, poster, source, and retrieval-time churn. */
export async function playabilityRecommendationSemanticGeneration(): Promise<number> {
  await initPlayabilityDb();
  const row = openDb().prepare(`
SELECT generation FROM recommendation_semantic_state WHERE state_id = 1
`).get() as { generation?: number } | undefined;
  return Math.max(1, Math.floor(Number(row?.generation) || 1));
}

/** Persist compiler-owned semantic hashes after a deterministic corpus scan. */
export async function recordRecommendationSemanticEvidence(
  rows: readonly { type: 'movie' | 'series'; id: string; semantic_evidence_hash: string }[],
): Promise<number> {
  if (rows.length === 0) return playabilityRecommendationSemanticGeneration();
  await initPlayabilityDb();
  const db = openDb();
  const update = db.prepare(`
INSERT INTO recommendation_semantic_evidence(
  type, id, semantic_evidence_hash, updated_at
) VALUES (?, ?, ?, ?)
ON CONFLICT(type, id) DO UPDATE SET
  semantic_evidence_hash = excluded.semantic_evidence_hash,
  updated_at = excluded.updated_at
WHERE semantic_evidence_hash IS NOT excluded.semantic_evidence_hash
`);
  const now = nowMs();
  db.transaction(() => {
    for (const row of rows) {
      update.run(row.type, row.id, row.semantic_evidence_hash, now);
    }
  })();
  return playabilityRecommendationSemanticGeneration();
}

// A verified series gate is normally written twice: once for the show id and
// once for the S1E1 stream-probe id. Recommendation coverage is show-level, so
// both the COUNT and page query must operate on this identical canonical
// relation rather than counting the physical gate rows.
const VERIFIED_RECOMMENDATION_CORPUS_CTE = `
WITH verified_recommendation_sources AS (
  SELECT
    t.*,
    CASE
      WHEN t.type = 'series'
        AND LOWER(t.id) GLOB 'tt[0-9]*:[0-9]*:[0-9]*'
        AND INSTR(t.id, ':') > 0
      THEN SUBSTR(t.id, 1, INSTR(t.id, ':') - 1)
      ELSE t.id
    END AS canonical_id
  FROM titles t
  WHERE t.status = 'verified' AND t.type = @content_type
), canonical_verified_titles AS (
  SELECT sources.*,
    ROW_NUMBER() OVER (
      PARTITION BY sources.type, sources.canonical_id
      ORDER BY
        CASE WHEN sources.id = sources.canonical_id THEN 0 ELSE 1 END,
        COALESCE(sources.verified_at, 0) DESC,
        sources.updated_at DESC,
        sources.id COLLATE BINARY ASC
    ) AS source_rank
  FROM verified_recommendation_sources sources
)
`;

/**
 * Deterministically pages the entire active verified movie/show corpus. This
 * query intentionally starts at `titles`, not `rail_pool`: removing a visible
 * curated rail cannot make a verified title disappear from recommendation
 * accounting. Missing title/artwork rows are returned and excluded later with
 * an auditable reason.
 */
export async function listVerifiedRecommendationCatalogPage(input: {
  content_type: 'movie' | 'series';
  cursor?: string | null;
  limit?: number;
}): Promise<VerifiedRecommendationCatalogPage> {
  await initPlayabilityDb();
  const db = openDb();
  const limit = Math.max(1, Math.min(1_000, Math.floor(input.limit ?? 250)));
  const afterId = input.cursor?.trim() || '';
  const readPage = db.transaction(() => {
    const state = db.prepare(`
SELECT generation FROM recommendation_corpus_state WHERE state_id = 1
`).get() as { generation: number };
    const count = db.prepare(`${VERIFIED_RECOMMENDATION_CORPUS_CTE}
SELECT COUNT(*) AS verified_count
FROM canonical_verified_titles
WHERE source_rank = 1
`).get({ content_type: input.content_type }) as { verified_count: number };
    const rows = db.prepare(`
${VERIFIED_RECOMMENDATION_CORPUS_CTE}, membership_sources AS (
  SELECT
    type,
    CASE
      WHEN type = 'series'
        AND LOWER(id) GLOB 'tt[0-9]*:[0-9]*:[0-9]*'
        AND INSTR(id, ':') > 0
      THEN SUBSTR(id, 1, INSTR(id, ':') - 1)
      ELSE id
    END AS canonical_id,
    rail_id
  FROM rail_pool
  WHERE type = @content_type
), memberships AS (
  SELECT type, canonical_id, GROUP_CONCAT(DISTINCT rail_id) AS rail_ids
  FROM membership_sources
  GROUP BY type, canonical_id
), evidence_sources AS (
  SELECT
    se.*,
    CASE
      WHEN se.type = 'series'
        AND LOWER(se.id) GLOB 'tt[0-9]*:[0-9]*:[0-9]*'
        AND INSTR(se.id, ':') > 0
      THEN SUBSTR(se.id, 1, INSTR(se.id, ':') - 1)
      ELSE se.id
    END AS canonical_id
  FROM title_story_evidence se
  WHERE se.type = @content_type
), canonical_evidence AS (
  SELECT evidence_sources.*,
    ROW_NUMBER() OVER (
      PARTITION BY type, canonical_id
      ORDER BY
        CASE WHEN id = canonical_id THEN 0 ELSE 1 END,
        CASE WHEN NULLIF(TRIM(evidence_json), '') IS NOT NULL THEN 0 ELSE 1 END,
        COALESCE(evidence_retrieved_at, 0) DESC,
        updated_at DESC,
        id COLLATE BINARY ASC
    ) AS evidence_rank
  FROM evidence_sources
)
SELECT
  t.type,
  t.canonical_id AS id,
  NULLIF(TRIM(se.title), '') AS title,
  NULLIF(TRIM(se.poster_url), '') AS poster,
  NULLIF(TRIM(se.year), '') AS year,
  COALESCE(m.rail_ids, '') AS rail_ids,
  se.evidence_json,
  se.evidence_hash,
  se.evidence_source,
  se.evidence_retrieved_at,
  t.best_source,
  t.verified_at,
  t.updated_at
FROM canonical_verified_titles t
LEFT JOIN memberships m ON m.type = t.type AND m.canonical_id = t.canonical_id
LEFT JOIN canonical_evidence se
  ON se.type = t.type AND se.canonical_id = t.canonical_id AND se.evidence_rank = 1
WHERE t.source_rank = 1
  AND t.canonical_id > @after_id COLLATE BINARY
ORDER BY t.canonical_id COLLATE BINARY ASC
LIMIT @limit
`).all({
      content_type: input.content_type,
      after_id: afterId,
      limit,
    }) as Array<Omit<VerifiedRecommendationCatalogRow, 'rail_ids'> & { rail_ids: string }>;
    return {
      generation: Math.max(1, Math.floor(Number(state.generation) || 1)),
      count: Math.max(0, Math.floor(Number(count.verified_count) || 0)),
      rows,
    };
  });
  const page = readPage();
  const items = page.rows.map((row) => ({
    ...row,
    type: row.type as 'movie' | 'series',
    rail_ids: [...new Set(row.rail_ids.split(',').map((value) => value.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right)),
  }));
  return {
    content_type: input.content_type,
    corpus_generation: page.generation,
    verified_count: page.count,
    after_id: afterId || null,
    next_cursor: items.length === limit ? items.at(-1)?.id ?? null : null,
    items,
  };
}

export async function listVerifiedLibraryCatalogRows(
  limit = 500,
  contentType?: 'movie' | 'series',
): Promise<VerifiedLibraryCatalogRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  const rows = db.prepare(`
WITH memberships AS (
  SELECT rp.type, rp.id, GROUP_CONCAT(DISTINCT rp.rail_id) AS rail_ids
  FROM rail_pool rp
  JOIN titles t ON t.type = rp.type AND t.id = rp.id
  WHERE t.status = 'verified'
    AND (@content_type IS NULL OR rp.type = @content_type)
  GROUP BY rp.type, rp.id
), ranked AS (
  SELECT
    rp.rail_id,
    rp.type,
    rp.id,
    rp.title,
    rp.poster_url AS poster,
    rp.year,
    t.verified_at,
    ROW_NUMBER() OVER (
      PARTITION BY rp.type, rp.id
      ORDER BY
        CASE WHEN rp.poster_url IS NOT NULL AND trim(rp.poster_url) != '' THEN 0 ELSE 1 END,
        rp.ingested_at DESC,
        rp.rail_id ASC
    ) AS row_rank
  FROM rail_pool rp
  JOIN titles t ON t.type = rp.type AND t.id = rp.id
  WHERE t.status = 'verified'
    AND (@content_type IS NULL OR rp.type = @content_type)
    AND rp.title IS NOT NULL
    AND trim(rp.title) != ''
), canonical AS (
  SELECT r.rail_id, r.type, r.id, r.title, r.poster, r.year, r.verified_at, m.rail_ids
  FROM ranked r
  JOIN memberships m ON m.type = r.type AND m.id = r.id
  WHERE r.row_rank = 1
), fair AS (
  SELECT canonical.*,
    ROW_NUMBER() OVER (
      PARTITION BY rail_id
      ORDER BY verified_at DESC, type ASC, id ASC
    ) AS rail_rank
  FROM canonical
)
SELECT rail_id, type, id, title, poster, year, rail_ids
FROM fair
ORDER BY rail_rank ASC, verified_at DESC, rail_id ASC, type ASC, id ASC
LIMIT @limit;
  `).all({
    content_type: contentType ?? null,
    limit: Math.max(1, limit),
  }) as Array<Omit<VerifiedLibraryCatalogRow, 'rail_ids'> & { rail_ids: string }>;
  return rows.map((row) => ({
    ...row,
    rail_ids: [...new Set(row.rail_ids.split(',').map((item) => item.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right)),
  }));
}

/** Cheap generation token used by the launcher search index invalidator. */
export async function playabilitySearchGeneration(): Promise<string> {
  await initPlayabilityDb();
  const row = openDb().prepare(`
SELECT
  COALESCE(MAX(t.updated_at), 0) AS titles_updated_at,
  COALESCE(MAX(rp.ingested_at), 0) AS pool_updated_at,
  COUNT(*) AS row_count
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE t.status = 'verified'
  AND rp.title IS NOT NULL
  AND trim(rp.title) != '';
`).get() as {
    titles_updated_at: number;
    pool_updated_at: number;
    row_count: number;
  };
  return `${row.titles_updated_at}:${row.pool_updated_at}:${row.row_count}`;
}

export async function queueTitleForPlayabilityIngest(input: {
  type: string;
  id: string;
  title: string;
  rail_id: string;
  poster_url?: string | null;
  year?: string | null;
  trigger_type?: PlayabilityTriggerType;
  reason?: string;
}): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
  const now = nowMs();
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
    id: canonicalBrowseId(input.type, input.id),
    updated_at: now,
  });

  await upsertRailPoolTitle({
    rail_id: input.rail_id,
    type: input.type,
    id: canonicalBrowseId(input.type, input.id),
    score: 0,
    title: input.title,
    poster_url: input.poster_url ?? undefined,
    year: input.year ?? undefined,
  });

  await enqueuePlayabilityTrigger({
    trigger_type: input.trigger_type ?? 'voice_request',
    rail_id: input.rail_id,
    type: input.type,
    id: input.id,
    reason: input.reason?.trim() || `${input.trigger_type ?? 'voice_request'}:${input.title}`,
  });
}

export async function queueTitleForVoiceIngest(input: {
  type: string;
  id: string;
  title: string;
  rail_id: string;
  poster_url?: string | null;
  year?: string | null;
}): Promise<void> {
  await queueTitleForPlayabilityIngest(input);
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
}

export async function listRailPoolMissingDisplay(limit: number): Promise<RailPoolDisplayRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  return db.prepare(`
SELECT DISTINCT rail_id, type, id
FROM rail_pool
WHERE COALESCE(TRIM(title), '') = ''
   OR COALESCE(TRIM(poster_url), '') = ''
LIMIT @limit;
`).all({ limit: Math.max(1, limit) }) as RailPoolDisplayRow[];
}

export async function patchRailPoolDisplay(
  railId: string,
  type: string,
  id: string,
  patch: Pick<RailPoolEntry, 'title' | 'poster_url' | 'year'>,
): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
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
  if (options.browseV3 && !options.browseV3Tab) {
    throw new Error('Browse v3 tab identity is required for reservoir allocation');
  }
  const browseReservoir = options.browseV3
    ? readVodBrowseReservoirSnapshot(db, options.browseV3Tab!)
    : null;
  if (options.browseV3 && !browseReservoir) {
    throw new Error('Browse v3 reservoir is not ready; retain the previous complete tab deal');
  }

  const existingByRail = new Map<string, RailSessionPoolItem[]>();
  const curatedPools = new Map<string, ReturnType<typeof readRailPool>>();
  const decisionsByRail = new Map<string, Map<string, VodBrowseMembershipDecision>>();
  const poolSizes = new Map<string, number>();
  let canReuseExisting = options.rails.length > 0 && !options.forceReshuffle;

  for (const rail of options.rails) {
    const prepared = browseReservoir?.rails.get(rail.railId) ?? [];
    const rawPool = options.browseV3
      ? prepared.filter((item) => (
        item.trusted && !options.excludedKeys?.has(titleKey(item.type, item.id))
      ))
      : curatedPool(readRailPool(db, rail.railId, now), rail.railId, overrides)
        .filter((item) => !options.excludedKeys?.has(titleKey(item.type, item.id)));
    const decisions = new Map<string, VodBrowseMembershipDecision>();
    if (options.browseV3) {
      (rawPool as VodBrowseReservoirItem[]).forEach((row) => decisions.set(titleKey(row.type, row.id), {
        trusted: row.trusted,
        sourcePosition: row.source_position ?? 0.5,
        themeConfidence: row.theme_confidence,
        tasteAffinity: row.taste_affinity,
        novelty: row.novelty ?? 0.5,
        weight: row.weight,
        reason: row.reason,
      }));
    }
    decisionsByRail.set(rail.railId, decisions);
    const pool = rawPool;
    curatedPools.set(rail.railId, pool);
    poolSizes.set(rail.railId, pool.length);
    const displayLimit = resolveRailDisplayLimit(rail, pool.length);
    const existing = readExistingRailSession(db, rail.railId, options.sessionId, now);
    existingByRail.set(rail.railId, existing);
    const targetSessionSize = Math.min(displayLimit, pool.length);
    const poolKeys = new Set(pool.map((item) => titleKey(item.type, item.id)));
    if (existing.length < targetSessionSize
      || existing.some((item) => !poolKeys.has(titleKey(item.type, item.id)))) {
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
      recentKeysByRail.set(
        rail.railId,
        options.browseV3 ? new Set() : readRecentRailKeys(db, rail.railId, cooldownCutoff),
      );
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
        stableRatio: options.browseV3 ? 0 : options.stableRatio,
        seed: options.seed ?? options.sessionId,
        initiallyOccupiedKeys: options.initiallyOccupiedKeys,
        weightForItem: options.browseV3
          ? (railId, item) => decisionsByRail.get(railId)?.get(titleKey(item.type, item.id))?.weight ?? 0.35
          : undefined,
      },
    );

    for (const rail of options.rails) {
      const pool = pools.get(rail.railId) ?? [];
      const displayLimit = resolveRailDisplayLimit(rail, pool.length);
      const selected = options.browseV3
        ? (tabSelections.get(rail.railId) ?? []).slice(0, displayLimit)
        : injectPinnedSessionItems(
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
      writeRailSessionRows(db, rail.railId, options.sessionId, rows, now, !options.browseV3);
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
    // Daily session rotation creates a fresh session_id each day; drop stale
    // session rows so rail_session does not grow unbounded.
    db.prepare(`
DELETE FROM rail_session
WHERE created_at < @prune_before;
`).run({ prune_before: now - 2 * 24 * 60 * 60 * 1000 });
  });
  transaction();
  return snapshots;
}

export async function allocateVodExploreSession(options: {
  tab: 'movies' | 'series';
  sessionId: string;
  displayLimit?: number;
  seed?: string;
  excludedKeys?: ReadonlySet<string>;
  occupiedKeys?: ReadonlySet<string>;
  affinityByKey?: ReadonlyMap<string, {
    taste_adjacency: number;
    profile_confidence: number | null;
  }>;
}): Promise<RailSessionSnapshot> {
  await initPlayabilityDb();
  const db = openDb();
  const now = nowMs();
  const railId = options.tab === 'series' ? 'explore-series' : 'explore-movies';
  const displayLimit = Math.max(1, Math.min(12, Math.floor(options.displayLimit ?? 6)));
  const occupied = new Set(options.occupiedKeys ?? []);
  const excluded = new Set(options.excludedKeys ?? []);
  const existing = db.prepare(`
SELECT sessions.type, sessions.id, sessions.title, sessions.poster_url, sessions.year,
       sessions.selection_weight, titles.best_source, titles.cache_status,
       titles.debrid_service, titles.verified_at, titles.expires_at
FROM vod_explore_sessions_v3 sessions
JOIN titles ON titles.type = sessions.type AND titles.id = sessions.id
WHERE sessions.tab = ? AND sessions.session_id = ? AND titles.status = 'verified'
ORDER BY sessions.slot
`).all(options.tab, options.sessionId) as Array<{
    type: string;
    id: string;
    title: string;
    poster_url: string;
    year: string | null;
    selection_weight: number;
    best_source: string | null;
    cache_status: string | null;
    debrid_service: string | null;
    verified_at: number | null;
    expires_at: number | null;
  }>;
  const existingValid = existing.length >= displayLimit && existing.every((item) => {
    const key = titleKey(item.type, item.id);
    return !occupied.has(key) && !excluded.has(key);
  });
  if (existingValid) {
    return {
      rail_id: railId,
      session_id: options.sessionId,
      verified_pool: existing.length,
      items: existing.slice(0, displayLimit).map((item, slot) => ({
        rail_id: railId,
        type: item.type,
        id: item.id,
        score: item.selection_weight,
        mix_bucket: 'fresh',
        slot,
        session_id: options.sessionId,
        best_source: item.best_source,
        cache_status: item.cache_status,
        debrid_service: item.debrid_service,
        verified_at: item.verified_at,
        expires_at: item.expires_at,
        title: item.title,
        poster_url: item.poster_url,
        year: item.year,
      })),
    };
  }

  const reservoir = readVodBrowseReservoirSnapshot(db, options.tab);
  const rows = reservoir?.rails.get(railId) ?? [];
  if (!reservoir || rows.length === 0) {
    throw new Error(`Browse v3 ${options.tab} Explore reservoir is not ready`);
  }
  const candidates = rows.flatMap((row) => {
    const key = titleKey(row.type, row.id);
    if (occupied.has(key) || excluded.has(key)) return [];
    return [{
      ...row,
      weight: row.weight,
    }];
  });
  const selected = weightedDeal(candidates, displayLimit, options.seed ?? options.sessionId);
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM vod_explore_sessions_v3 WHERE tab = ? AND session_id = ?')
      .run(options.tab, options.sessionId);
    const insert = db.prepare(`
INSERT INTO vod_explore_sessions_v3(
  tab, session_id, slot, type, id, title, poster_url, year, selection_weight, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    selected.forEach((item, slot) => insert.run(
      options.tab,
      options.sessionId,
      slot,
      item.type,
      item.id,
      item.title,
      item.poster_url,
      item.year,
      item.weight,
      now,
    ));
    db.prepare('DELETE FROM vod_explore_sessions_v3 WHERE created_at < ?')
      .run(now - 2 * 24 * 60 * 60 * 1_000);
  });
  transaction();
  return {
    rail_id: railId,
    session_id: options.sessionId,
    verified_pool: candidates.length,
    items: selected.map((item, slot) => ({
      rail_id: railId,
      type: item.type,
      id: item.id,
      score: item.weight,
      mix_bucket: 'fresh',
      slot,
      session_id: options.sessionId,
      best_source: item.best_source,
      cache_status: item.cache_status,
      debrid_service: item.debrid_service,
      verified_at: item.verified_at,
      expires_at: item.expires_at,
      title: item.title,
      poster_url: item.poster_url,
      year: item.year,
    })),
  };
}

export async function persistVodTabDealV3(input: {
  tab: 'movies' | 'series';
  session_id: string;
  recommendation_revision: number | null;
  payload_json: string;
  expected_previous_epoch: number | null;
}): Promise<number> {
  await initPlayabilityDb();
  const db = openDb();
  const now = nowMs();
  return db.transaction(() => {
    const current = db.prepare(`
SELECT deal_epoch, session_id, recommendation_revision, payload_json, created_at
FROM vod_tab_deals_v3 WHERE tab = ? AND state = 'active'
`).get(input.tab) as {
      deal_epoch: number;
      session_id: string;
      recommendation_revision: number | null;
      payload_json: string;
      created_at: number;
    } | undefined;
    if ((current?.deal_epoch ?? null) !== input.expected_previous_epoch) {
      throw new Error(
        `vod tab deal changed while ${input.tab} was being dealt: expected=${input.expected_previous_epoch ?? 'none'} actual=${current?.deal_epoch ?? 'none'}`,
      );
    }
    const nextEpoch = (current?.deal_epoch ?? -1) + 1;
    db.prepare("DELETE FROM vod_tab_deals_v3 WHERE tab = ? AND state = 'previous'").run(input.tab);
    if (current) {
      db.prepare("UPDATE vod_tab_deals_v3 SET state = 'previous' WHERE tab = ? AND state = 'active'")
        .run(input.tab);
    }
    db.prepare(`
INSERT INTO vod_tab_deals_v3(
  tab, deal_epoch, state, session_id, recommendation_revision, payload_json, created_at
) VALUES (?, ?, 'active', ?, ?, ?, ?)
`).run(
      input.tab,
      nextEpoch,
      input.session_id,
      input.recommendation_revision,
      input.payload_json,
      now,
    );
    return nextEpoch;
  })();
}

export async function readVodTabDealV3(
  tab: 'movies' | 'series',
  state: 'active' | 'previous' = 'active',
): Promise<{ payload_json: string; deal_epoch: number } | null> {
  await initPlayabilityDb();
  return openDb().prepare(`
SELECT payload_json, deal_epoch FROM vod_tab_deals_v3 WHERE tab = ? AND state = ?
`).get(tab, state) as { payload_json: string; deal_epoch: number } | undefined ?? null;
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
    // Daily session rotation creates a fresh session_id each day; drop stale
    // session rows so rail_session does not grow unbounded.
    db.prepare(`
DELETE FROM rail_session
WHERE created_at < @prune_before;
`).run({ prune_before: now - 2 * 24 * 60 * 60 * 1000 });
  });
  transaction();

  return {
    rail_id: options.railId,
    session_id: options.sessionId,
    items: rows,
    verified_pool: pool.length,
  };
}

function shufflePoolRows<T>(items: T[]): T[] {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

/** Random verified pool picks for detail related shelf — excludes home-visible titles. */
export async function pickRailRelatedFromPool(
  railId: string,
  excludeKeys: ReadonlySet<string>,
  limit: number,
): Promise<RailPoolRow[]> {
  await initPlayabilityDb();
  const overrides = await loadRailCurationOverrides();
  const db = openDb();
  const now = nowMs();
  const pool = curatedPool(readRailPool(db, railId, now), railId, overrides);
  const candidates = pool.filter((item) => !excludeKeys.has(titleKey(item.type, item.id)));
  if (candidates.length === 0) {
    return [];
  }
  return shufflePoolRows(candidates).slice(0, Math.max(1, limit));
}

export async function enqueuePlayabilityTrigger(record: PlayabilityTriggerRecord): Promise<void> {
  await initPlayabilityDb();
  const db = openDb();
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
}

/**
 * H1/H2: unhandled playability_triggers, prioritized so play_failure_reverify (couch fast-lane)
 * drains before everything else — including voice_request — per row created_at within each tier.
 */
export async function listUnhandledPlayabilityTriggers(
  limit: number,
): Promise<PlayabilityTriggerRow[]> {
  await initPlayabilityDb();
  const db = openDb();
  return db.prepare(`
SELECT id, created_at, trigger_type, rail_id, type, id_value, reason, handled_at
FROM playability_triggers
WHERE handled_at IS NULL
ORDER BY
  CASE WHEN trigger_type = 'play_failure_reverify' THEN 0 ELSE 1 END,
  created_at ASC,
  id ASC
LIMIT @limit;
`).all({ limit: Math.max(1, limit) }) as PlayabilityTriggerRow[];
}

/** Marks drained trigger rows handled (success OR failure) so the queue never grows unbounded. */
export async function markPlayabilityTriggersHandled(
  ids: number[],
  now: number = nowMs(),
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  await initPlayabilityDb();
  const db = openDb();
  const stmt = db.prepare(`
UPDATE playability_triggers SET handled_at = @now WHERE id = @id AND handled_at IS NULL;
`);
  const transaction = db.transaction(() => {
    let changed = 0;
    for (const id of ids) {
      changed += stmt.run({ id, now }).changes;
    }
    return changed;
  });
  return transaction();
}

export type SweepExpiredVerifiedResult = {
  swept: number;
};

/**
 * H3: enforces expires_at as a real visibility/freshness cutoff — verified rows whose TTL has
 * lapsed are demoted to stale so the nightly stale-reverify phase re-probes them. Idempotent
 * (a row already swept no longer matches status='verified') and bounded to the expired set.
 */
export async function sweepExpiredVerified(
  now: number = nowMs(),
): Promise<SweepExpiredVerifiedResult> {
  await initPlayabilityDb();
  const db = openDb();
  const transaction = db.transaction(() => {
    const rows = db.prepare(`
SELECT type, id
FROM titles
WHERE status = 'verified' AND expires_at IS NOT NULL AND expires_at <= @now;
`).all({ now }) as Array<{ type: string; id: string }>;
    if (rows.length === 0) {
      return 0;
    }
    const updateStmt = db.prepare(`
UPDATE titles
SET status = 'stale', updated_at = @now
WHERE type = @type AND id = @id AND status = 'verified' AND expires_at IS NOT NULL AND expires_at <= @now;
`);
    const logStmt = db.prepare(`
INSERT INTO verify_log (started_at, rail_id, type, id_value, stage, ms, outcome)
VALUES (@started_at, NULL, @type, @id, 'sweep', 0, 'expired_stale');
`);
    let swept = 0;
    for (const row of rows) {
      const changes = updateStmt.run({ ...row, now }).changes;
      if (changes > 0) {
        swept += changes;
        logStmt.run({ ...row, started_at: now });
      }
    }
    return swept;
  });
  const swept = transaction();
  return { swept };
}

/**
 * First couch miss after obligation-floor exhaustion — demote to stale/play_miss.
 * Keeps rail_pool membership and session posters (preserve_session).
 */
export async function demoteTitle(record: {
  rail_id?: string | null;
  type: string;
  id: string;
  reason?: string | null;
}): Promise<void> {
  await invalidateTitle({
    ...record,
    reason: record.reason ?? 'play_miss',
    preserve_session: true,
  });
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
  const reason = record.reason ?? 'invalidated';
  // play_miss is a soft demotion (stale, keep pool). Only play_failure purges.
  const status = reason === 'play_failure' ? 'failed' : 'stale';
  const confirmedFailure = status === 'failed';
  const preserveSession = record.preserve_session === true || reason === 'play_miss';
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
      reason,
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

    if (!preserveSession) {
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
      outcome: reason,
    });
  });
  transaction();
  invalidateRailPoolCache();
  await enqueuePlayabilityTrigger({
    trigger_type: reason === 'play_failure' ? 'play_failure' : 'stale',
    rail_id: record.rail_id ?? null,
    type: record.type,
    id: record.id,
    reason,
  });
}
