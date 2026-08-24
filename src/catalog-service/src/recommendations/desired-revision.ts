import { libraryDatabase } from '../library/db.js';
import type { RatingContentType } from '../library/ratings.js';

/**
 * Durable "latest desired revision" state per movie/series that replaces the
 * legacy in-catalog startup/in-memory queue flights for VOD reranks. Callers
 * (signal handlers, corpus publication notifiers, operator diagnostics) only
 * write here; an isolated worker CLI reads, sequences, and acknowledges. The
 * catalog boot serves and reconciles this state — it does not run rank work.
 *
 * Lifecycle invariants:
 *   - Additive to prior schema; existing rows and generations are preserved.
 *   - `revision` is monotonically non-decreasing per content_type; the writer
 *     coalesces duplicate triggers by keeping the newest requested inputs.
 *   - `acknowledged_revision` advances ONLY on `activated`. A
 *     `last_good_retained` outcome (transient failure, non-activation) MUST
 *     NOT ack: it keeps `pending` true, stores `last_worker_error`, bumps
 *     `attempt_count`, and schedules a bounded exponential `retry_after`.
 *     A `discarded_stale` outcome never acks and leaves retry state alone.
 *   - Any new desired input (writer) resets `attempt_count` and clears
 *     `retry_after`, so a fresh signal is picked up immediately.
 *   - `retry_due(now)` returns `retry_after == NULL || retry_after <= now`.
 *   - Read/write must not throw on cache/lock contention; callers rely on
 *     best-effort updates from mutation hot paths.
 */

export type DesiredRevisionKind = RatingContentType;

export type DesiredRevisionSignal = {
  content_type: DesiredRevisionKind;
  reason: string;
  corpus_generation?: number | null;
  semantic_generation?: number | null;
  taste_signature?: string | null;
  now?: number;
};

export type DesiredRevisionRow = {
  content_type: DesiredRevisionKind;
  revision: number;
  corpus_generation: number | null;
  semantic_generation: number | null;
  taste_signature: string | null;
  requested_at: number;
  requested_reasons: string[];
  acknowledged_revision: number;
  acknowledged_rank_generation_id: number | null;
  acknowledged_at: number | null;
  last_worker_error: string | null;
  attempt_count: number;
  retry_after: number | null;
  updated_at: number;
  pending: boolean;
  retry_due: boolean;
};

export type DesiredRevisionAcknowledgement = {
  content_type: DesiredRevisionKind;
  revision: number;
  rank_generation_id: number | null;
  outcome: 'activated' | 'last_good_retained' | 'discarded_stale';
  error?: string | null;
  now?: number;
};

type PersistedRow = {
  content_type: DesiredRevisionKind;
  revision: number;
  corpus_generation: number | null;
  semantic_generation: number | null;
  taste_signature: string | null;
  requested_at: number;
  requested_reasons_json: string;
  acknowledged_revision: number;
  acknowledged_rank_generation_id: number | null;
  acknowledged_at: number | null;
  last_worker_error: string | null;
  attempt_count: number;
  retry_after: number | null;
  updated_at: number;
};

const MAX_REASONS = 8;
const SELECT_COLUMNS = `content_type, revision, corpus_generation, semantic_generation, taste_signature,
       requested_at, requested_reasons_json, acknowledged_revision,
       acknowledged_rank_generation_id, acknowledged_at, last_worker_error,
       attempt_count, retry_after, updated_at`;

/**
 * Bounded exponential backoff. Attempts 1..∞ produce delays capped between
 * `MIN_BACKOFF_MS` (1 minute) and `MAX_BACKOFF_MS` (1 hour):
 *   attempt=1 → 60_000ms
 *   attempt=2 → 120_000ms
 *   attempt=3 → 240_000ms
 *   attempt=4 → 480_000ms
 *   attempt=5 → 960_000ms (16 min)
 *   attempt=6 → 1_920_000ms (32 min)
 *   attempt≥7 → 3_600_000ms (1 hour, saturated)
 * Deterministic and side-effect-free so tests can freeze `now` and reason
 * about the exact `retry_after` timestamp.
 */
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
export function backoffForAttempt(attempt: number): number {
  const clamped = Math.max(1, Math.floor(attempt));
  const raw = MIN_BACKOFF_MS * 2 ** (clamped - 1);
  return Math.min(MAX_BACKOFF_MS, raw);
}

function parseReasons(reasonsJson: string): string[] {
  try {
    const parsed = JSON.parse(reasonsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, MAX_REASONS);
  } catch {
    return [];
  }
}

function toRow(row: PersistedRow, now = Date.now()): DesiredRevisionRow {
  const pending = row.revision > row.acknowledged_revision;
  const retryDue = pending && (row.retry_after === null || row.retry_after <= now);
  return {
    content_type: row.content_type,
    revision: row.revision,
    corpus_generation: row.corpus_generation,
    semantic_generation: row.semantic_generation,
    taste_signature: row.taste_signature,
    requested_at: row.requested_at,
    requested_reasons: parseReasons(row.requested_reasons_json),
    acknowledged_revision: row.acknowledged_revision,
    acknowledged_rank_generation_id: row.acknowledged_rank_generation_id,
    acknowledged_at: row.acknowledged_at,
    last_worker_error: row.last_worker_error,
    attempt_count: row.attempt_count,
    retry_after: row.retry_after,
    updated_at: row.updated_at,
    pending,
    retry_due: retryDue,
  };
}

/**
 * Record a new desired revision. Idempotent when nothing changed: repeated
 * signals with identical (corpus, semantic, taste) inputs never advance
 * `revision`, but the request timestamp/reason list are refreshed so
 * diagnostics reflect the latest observation. A signal that DOES change
 * inputs (i.e. `revision` advances) also resets retry state — a new input
 * is picked up immediately, without waiting on the previous failure's
 * exponential backoff.
 */
export function updateDesiredRevision(signal: DesiredRevisionSignal): DesiredRevisionRow {
  const reason = signal.reason.trim();
  if (!reason) throw new Error('desired revision signal requires a reason');
  const now = signal.now ?? Date.now();
  const db = libraryDatabase();
  return db.transaction((): DesiredRevisionRow => {
    const existing = db.prepare(`
SELECT ${SELECT_COLUMNS} FROM vod_desired_revisions WHERE content_type = ?
`).get(signal.content_type) as PersistedRow | undefined;
    const priorReasons = existing ? parseReasons(existing.requested_reasons_json) : [];
    const mergedReasons = [...new Set([reason, ...priorReasons])].slice(0, MAX_REASONS);
    const inputsChanged = !existing
      || existing.corpus_generation !== (signal.corpus_generation ?? null)
      || existing.semantic_generation !== (signal.semantic_generation ?? null)
      || existing.taste_signature !== (signal.taste_signature ?? null);
    const nextRevision = existing
      ? (inputsChanged ? existing.revision + 1 : existing.revision)
      : 1;
    if (!existing) {
      db.prepare(`
INSERT INTO vod_desired_revisions(
  content_type, revision, corpus_generation, semantic_generation, taste_signature,
  requested_at, requested_reasons_json, acknowledged_revision,
  acknowledged_rank_generation_id, acknowledged_at, last_worker_error,
  attempt_count, retry_after, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 0, NULL, ?)
`).run(
        signal.content_type,
        nextRevision,
        signal.corpus_generation ?? null,
        signal.semantic_generation ?? null,
        signal.taste_signature ?? null,
        now,
        JSON.stringify(mergedReasons),
        now,
      );
    } else if (inputsChanged) {
      // New desired input → reset retry state so the worker retries now.
      db.prepare(`
UPDATE vod_desired_revisions SET
  revision = ?,
  corpus_generation = ?,
  semantic_generation = ?,
  taste_signature = ?,
  requested_at = ?,
  requested_reasons_json = ?,
  attempt_count = 0,
  retry_after = NULL,
  last_worker_error = NULL,
  updated_at = ?
WHERE content_type = ?
`).run(
        nextRevision,
        signal.corpus_generation ?? null,
        signal.semantic_generation ?? null,
        signal.taste_signature ?? null,
        now,
        JSON.stringify(mergedReasons),
        now,
        signal.content_type,
      );
    } else {
      // Identical inputs: freshen diagnostics only, leave retry state alone.
      db.prepare(`
UPDATE vod_desired_revisions SET
  requested_at = ?,
  requested_reasons_json = ?,
  updated_at = ?
WHERE content_type = ?
`).run(now, JSON.stringify(mergedReasons), now, signal.content_type);
    }
    return toRow(db.prepare(`
SELECT ${SELECT_COLUMNS} FROM vod_desired_revisions WHERE content_type = ?
`).get(signal.content_type) as PersistedRow, now);
  })();
}

export function readDesiredRevision(
  type: DesiredRevisionKind,
  now = Date.now(),
): DesiredRevisionRow | null {
  const row = libraryDatabase().prepare(`
SELECT ${SELECT_COLUMNS} FROM vod_desired_revisions WHERE content_type = ?
`).get(type) as PersistedRow | undefined;
  return row ? toRow(row, now) : null;
}

export function readAllDesiredRevisions(now = Date.now()): DesiredRevisionRow[] {
  return (libraryDatabase().prepare(`
SELECT ${SELECT_COLUMNS} FROM vod_desired_revisions ORDER BY content_type
`).all() as PersistedRow[]).map((row) => toRow(row, now));
}

/**
 * Worker acknowledgement. Semantics per outcome:
 *   - `activated`: advance `acknowledged_revision`; clear retry state;
 *     store `rank_generation_id`; store `error=null`.
 *   - `last_good_retained`: DO NOT advance `acknowledged_revision`. Bump
 *     `attempt_count`, store `last_worker_error`, and schedule
 *     `retry_after = now + backoffForAttempt(attempt_count)`. The next
 *     desired input will reset this state; otherwise the worker will
 *     retry when `retry_due` is true.
 *   - `discarded_stale`: NEVER ack. Also never advance retry state — the
 *     newer revision that superseded this build owns lifecycle.
 * Stale-revision guards: acks older than the current
 * `acknowledged_revision` are dropped; acks past the current `revision`
 * are also dropped (would imply a revision advance during the build,
 * which the caller MUST detect via `discarded_stale`).
 */
export function acknowledgeDesiredRevision(
  ack: DesiredRevisionAcknowledgement,
): DesiredRevisionRow | null {
  const now = ack.now ?? Date.now();
  const db = libraryDatabase();
  return db.transaction((): DesiredRevisionRow | null => {
    const existing = db.prepare(`
SELECT ${SELECT_COLUMNS} FROM vod_desired_revisions WHERE content_type = ?
`).get(ack.content_type) as PersistedRow | undefined;
    if (!existing) return null;
    if (ack.revision < existing.acknowledged_revision) return toRow(existing, now);
    if (ack.revision > existing.revision) return toRow(existing, now);
    if (ack.outcome === 'activated') {
      db.prepare(`
UPDATE vod_desired_revisions SET
  acknowledged_revision = ?,
  acknowledged_rank_generation_id = ?,
  acknowledged_at = ?,
  last_worker_error = NULL,
  attempt_count = 0,
  retry_after = NULL,
  updated_at = ?
WHERE content_type = ?
`).run(ack.revision, ack.rank_generation_id ?? null, now, now, ack.content_type);
    } else if (ack.outcome === 'last_good_retained') {
      // Non-activation MUST NOT consume the desired revision. We only
      // record the failure and schedule a bounded retry.
      const nextAttempt = existing.attempt_count + 1;
      const retryAfter = now + backoffForAttempt(nextAttempt);
      db.prepare(`
UPDATE vod_desired_revisions SET
  last_worker_error = ?,
  attempt_count = ?,
  retry_after = ?,
  updated_at = ?
WHERE content_type = ?
`).run(ack.error ?? 'not_activated', nextAttempt, retryAfter, now, ack.content_type);
    } else {
      // `discarded_stale`: leave `acknowledged_revision`, `attempt_count`,
      // and `retry_after` alone — the newer revision that superseded this
      // build owns lifecycle. We record the discard reason in
      // `last_worker_error` so operators can see why a build was thrown
      // away without conflating it with a real failure.
      db.prepare(`
UPDATE vod_desired_revisions SET last_worker_error = ?, updated_at = ?
WHERE content_type = ?
`).run(ack.error ?? null, now, ack.content_type);
    }
    return toRow(db.prepare(`
SELECT ${SELECT_COLUMNS} FROM vod_desired_revisions WHERE content_type = ?
`).get(ack.content_type) as PersistedRow, now);
  })();
}

export type DesiredRevisionDiagnostic = {
  content_type: DesiredRevisionKind;
  revision: number;
  pending: boolean;
  retry_due: boolean;
  attempt_count: number;
  retry_after: number | null;
  requested_reasons: string[];
  requested_at: number;
  acknowledged_revision: number;
  acknowledged_rank_generation_id: number | null;
  acknowledged_at: number | null;
  last_worker_error: string | null;
};

export function desiredRevisionDiagnostics(now = Date.now()): DesiredRevisionDiagnostic[] {
  return readAllDesiredRevisions(now).map((row) => ({
    content_type: row.content_type,
    revision: row.revision,
    pending: row.pending,
    retry_due: row.retry_due,
    attempt_count: row.attempt_count,
    retry_after: row.retry_after,
    requested_reasons: row.requested_reasons,
    requested_at: row.requested_at,
    acknowledged_revision: row.acknowledged_revision,
    acknowledged_rank_generation_id: row.acknowledged_rank_generation_id,
    acknowledged_at: row.acknowledged_at,
    last_worker_error: row.last_worker_error,
  }));
}
