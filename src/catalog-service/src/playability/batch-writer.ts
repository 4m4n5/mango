import {
  getPlayabilityDb,
  initPlayabilityDb,
  updateRetryQueueForVerifyRecord,
  validatePlayabilityProof,
  type PlayabilityVerifyRecord,
  type RailPoolEntry,
} from './db.js';
import { canonicalTitleId, isSeriesRailGateId } from './ids.js';

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
    this.verifyRecords.push({ ...record, observed_at: record.observed_at ?? nowMs() });
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
    const db = getPlayabilityDb();
    const timestamp = nowMs();
    const transaction = db.transaction(() => {
      const upsertTitle = db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, win_ladder_step,
  proof_version, proof_run_id, proof_exact_main, first_verified_at, updated_at
) VALUES (
  @type, @id, @status, @verified_at, @expires_at, @fail_reason, @best_source,
  @cache_status, @debrid_service, @probe_ms, @win_url_hash, @win_ladder_step,
  @proof_version, @proof_run_id, @proof_exact_main, @first_verified_at, @updated_at
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
  proof_version = CASE WHEN excluded.status = 'verified' THEN excluded.proof_version ELSE titles.proof_version END,
  proof_run_id = CASE WHEN excluded.status = 'verified' THEN excluded.proof_run_id ELSE titles.proof_run_id END,
  proof_exact_main = CASE WHEN excluded.status = 'verified' THEN excluded.proof_exact_main ELSE titles.proof_exact_main END,
  first_verified_at = CASE
    WHEN titles.first_verified_at IS NULL AND excluded.status = 'verified' THEN excluded.first_verified_at
    ELSE titles.first_verified_at
  END,
  updated_at = excluded.updated_at;
`);
      const insertLog = db.prepare(`
INSERT INTO verify_log (
  started_at, rail_id, type, id_value, stage, ms, outcome, run_id,
  request_id, request_title_id, request_title, request_year, source_key,
  attempt_kind, exact_main_win, proof_version
)
VALUES (
  @started_at, @rail_id, @type, @id_value, @stage, @ms, @outcome, @proof_run_id,
  @request_id, @request_title_id, @request_title, @request_year, @source_key,
  @attempt_kind, @proof_exact_main, @proof_version
);
`);
      const upsertPool = db.prepare(`
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
`);

      for (const record of this.verifyRecords) {
        const observedAt = record.observed_at ?? timestamp;
        const proof = validatePlayabilityProof(record);
        const verifiedAt = record.status === 'verified' ? observedAt : null;
        const expiresAt = record.status === 'verified'
          ? record.expires_at ?? observedAt + 48 * 60 * 60 * 1000
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
          ...proof,
          first_verified_at: verifiedAt,
          updated_at: observedAt,
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
            ...proof,
            first_verified_at: verifiedAt,
            updated_at: observedAt,
          });
        }
        insertLog.run({
          started_at: observedAt,
          rail_id: record.rail_id ?? null,
          type: record.type,
          id_value: record.id,
          stage: record.stage ?? 'verify',
          ms: record.probe_ms ?? 0,
          outcome: record.outcome ?? record.status,
          ...proof,
        });
        updateRetryQueueForVerifyRecord(db, record, observedAt);
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
          evidence_json: entry.evidence_json ?? null,
          evidence_hash: entry.evidence_hash ?? null,
          evidence_source: entry.evidence_source ?? null,
          evidence_retrieved_at: entry.evidence_retrieved_at ?? null,
        });
      }
    });
    transaction();

    this.verifyRecords = [];
    this.poolEntries = [];

    return {
      verify_count: verifyCount,
      pool_count: poolCount,
    };
  }
}
