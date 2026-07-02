import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
  initPlayabilityDb,
  type PlayabilityVerifyRecord,
  type RailPoolEntry,
} from './db.js';
import { canonicalTitleId, isSeriesRailGateId } from './ids.js';

function dbPath(): string {
  return process.env.MANGO_PLAYABILITY_DB || '/etc/mango/playability.db';
}

function openDb(): Database.Database {
  return new Database(dbPath());
}

function nowMs(): number {
  return Date.now();
}

function canonicalBrowseId(type: string, id: string): string {
  return canonicalTitleId(type, id);
}

function shouldMirrorSeriesGateRecord(type: string, id: string): boolean {
  return type === 'series'
    && isSeriesRailGateId(id)
    && canonicalBrowseId(type, id) !== id;
}

export class PlayabilityBatchWriter {
  private verifyRecords: PlayabilityVerifyRecord[] = [];
  private poolEntries: RailPoolEntry[] = [];

  queueVerify(record: PlayabilityVerifyRecord): void {
    this.verifyRecords.push(record);
  }

  queuePool(entry: RailPoolEntry): void {
    this.poolEntries.push(entry);
  }

  hasPending(): boolean {
    return this.verifyRecords.length > 0 || this.poolEntries.length > 0;
  }

  async flush(): Promise<{ verify_count: number; pool_count: number }> {
    const verifyCount = this.verifyRecords.length;
    const poolCount = this.poolEntries.length;
    if (verifyCount === 0 && poolCount === 0) {
      return { verify_count: 0, pool_count: 0 };
    }

    await initPlayabilityDb();
    const db = openDb();
    const timestamp = nowMs();
    try {
      const transaction = db.transaction(() => {
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
        const insertLog = db.prepare(`
INSERT INTO verify_log (started_at, rail_id, type, id_value, stage, ms, outcome)
VALUES (@started_at, @rail_id, @type, @id_value, @stage, @ms, @outcome);
`);
        const upsertPool = db.prepare(`
INSERT INTO rail_pool (rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES (@rail_id, @type, @id, @score, @ingested_at, @title, @poster_url, @year)
ON CONFLICT(rail_id, type, id) DO UPDATE SET
  score = excluded.score,
  ingested_at = excluded.ingested_at,
  title = COALESCE(excluded.title, rail_pool.title),
  poster_url = COALESCE(excluded.poster_url, rail_pool.poster_url),
  year = COALESCE(excluded.year, rail_pool.year);
`);

        for (const record of this.verifyRecords) {
          const verifiedAt = record.status === 'verified' ? timestamp : null;
          const expiresAt = record.status === 'verified'
            ? record.expires_at ?? timestamp + 48 * 60 * 60 * 1000
            : record.expires_at ?? null;
          upsertTitle.run({
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
          if (shouldMirrorSeriesGateRecord(record.type, record.id)) {
            upsertTitle.run({
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
              updated_at: timestamp,
            });
          }
          insertLog.run({
            started_at: timestamp,
            rail_id: record.rail_id ?? null,
            type: record.type,
            id_value: record.id,
            stage: record.stage ?? 'verify',
            ms: record.probe_ms ?? 0,
            outcome: record.outcome ?? record.status,
          });
        }

        for (const entry of this.poolEntries) {
          upsertPool.run({
            rail_id: entry.rail_id,
            type: entry.type,
            id: canonicalBrowseId(entry.type, entry.id),
            score: entry.score,
            ingested_at: timestamp,
            title: entry.title ?? null,
            poster_url: entry.poster_url ?? null,
            year: entry.year ?? null,
          });
        }
      });
      transaction();
    } finally {
      db.close();
    }

    this.verifyRecords = [];
    this.poolEntries = [];

    return {
      verify_count: verifyCount,
      pool_count: poolCount,
    };
  }
}
