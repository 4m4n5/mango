import { randomUUID } from 'node:crypto';
import { libraryDatabase } from '../library/db.js';
import {
  refreshStoryDnaTeacherCache,
  storyDnaTeacherConfiguration,
  type StoryDnaTeacherRefreshResult,
} from './story-dna-teacher.js';
import {
  stableStoryDnaJson,
  type StoryDnaInput,
} from './story-dna.js';
import { contentSemanticEvidenceHash } from './content-profile-v2.js';

export type StoryDnaWorkerMode = 'off' | 'frontier';
export type StoryDnaFrontierReason =
  | 'positive_anchor'
  | 'implicit_anchor'
  | 'thread_shortage'
  | 'reserve_boundary'
  | 'fit_floor_uncertainty'
  | 'stable_audit';

export type StoryDnaFrontierCandidate = {
  input: StoryDnaInput;
  reason: StoryDnaFrontierReason;
  priority: number;
};

export type StoryDnaFrontierRunResult = {
  status: 'disabled' | 'idle' | 'complete' | 'budget_exhausted' | 'provider_degraded';
  leased: number;
  requested: number;
  persisted: number;
  failed: number;
  completed_types: Array<'movie' | 'series'>;
};

export type StoryDnaFrontierDiagnostics = {
  worker_mode: StoryDnaWorkerMode;
  queued: number;
  leased: number;
  failed: number;
  complete: number;
  used_last_24h: { movie: number; series: number };
  used_last_30d: number;
  nightly_limit_per_type: number;
  rolling_month_limit: number;
  next_retry_at: number | null;
};

type QueueRow = {
  queue_id: number;
  content_type: 'movie' | 'series';
  content_id: string;
  semantic_evidence_hash: string;
  input_json: string;
  reason: StoryDnaFrontierReason;
  priority: number;
  attempt_count: number;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const MONTH_MS = 30 * DAY_MS;
const DEFAULT_PER_TYPE_DAILY_LIMIT = 12;
const DEFAULT_ROLLING_MONTH_LIMIT = 96;
const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_RUN_LIMIT_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 3;
let workerTail: Promise<StoryDnaFrontierRunResult> = Promise.resolve({
  status: 'idle', leased: 0, requested: 0, persisted: 0, failed: 0, completed_types: [],
});

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

export function storyDnaWorkerMode(): StoryDnaWorkerMode {
  if (process.env.MANGO_STORY_DNA === '0') return 'off';
  return process.env.MANGO_STORY_DNA_WORKER_MODE === 'frontier' ? 'frontier' : 'off';
}

function limits(): { perType: number; monthly: number; batch: number; runMs: number } {
  return {
    perType: boundedInteger(
      process.env.MANGO_STORY_DNA_FRONTIER_NIGHTLY_PER_TYPE,
      DEFAULT_PER_TYPE_DAILY_LIMIT,
      0,
      100,
    ),
    monthly: boundedInteger(
      process.env.MANGO_STORY_DNA_FRONTIER_ROLLING_30D,
      DEFAULT_ROLLING_MONTH_LIMIT,
      0,
      2_000,
    ),
    batch: boundedInteger(process.env.MANGO_STORY_DNA_FRONTIER_BATCH, DEFAULT_BATCH_SIZE, 1, 4),
    runMs: boundedInteger(
      process.env.MANGO_STORY_DNA_FRONTIER_RUN_MS,
      DEFAULT_RUN_LIMIT_MS,
      1_000,
      DEFAULT_RUN_LIMIT_MS,
    ),
  };
}

function usageCount(type: 'movie' | 'series' | null, since: number): number {
  const row = type
    ? libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_usage
WHERE content_type = ? AND started_at >= ? AND status != 'cached'
`).get(type, since) as { count: number }
    : libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_usage
WHERE started_at >= ? AND status != 'cached'
`).get(since) as { count: number };
  return row.count;
}

export function enqueueStoryDnaFrontierCandidates(
  candidates: readonly StoryDnaFrontierCandidate[],
  now = Date.now(),
): number {
  if (candidates.length === 0) return 0;
  const db = libraryDatabase();
  const supersede = db.prepare(`
UPDATE vod_semantic_frontier_queue
SET status = 'superseded', updated_at = ?
WHERE content_type = ? AND content_id = ? AND semantic_evidence_hash != ?
  AND status IN ('queued', 'failed')
`);
  const insert = db.prepare(`
INSERT INTO vod_semantic_frontier_queue(
  content_type, content_id, semantic_evidence_hash, input_json, reason, priority,
  status, attempt_count, next_attempt_at, lease_owner, lease_until,
  queued_at, updated_at, completed_at, last_error
) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, NULL, NULL)
ON CONFLICT(content_type, content_id, semantic_evidence_hash) DO UPDATE SET
  input_json = excluded.input_json,
  reason = CASE WHEN excluded.priority > priority THEN excluded.reason ELSE reason END,
  priority = MAX(priority, excluded.priority),
  status = CASE WHEN status IN ('complete', 'leased') THEN status ELSE 'queued' END,
  next_attempt_at = CASE WHEN status = 'failed' THEN excluded.next_attempt_at ELSE next_attempt_at END,
  updated_at = excluded.updated_at
`);
  let changes = 0;
  db.transaction(() => {
    for (const candidate of candidates) {
      const hash = contentSemanticEvidenceHash(candidate.input);
      supersede.run(now, candidate.input.type, candidate.input.id, hash);
      changes += insert.run(
        candidate.input.type,
        candidate.input.id,
        hash,
        stableStoryDnaJson(candidate.input),
        candidate.reason,
        Math.max(0, Math.min(1_000, Math.floor(candidate.priority))),
        now,
        now,
        now,
      ).changes;
    }
  })();
  return changes;
}

function releaseExpiredLeases(now: number): void {
  libraryDatabase().prepare(`
UPDATE vod_semantic_frontier_queue
SET status = 'queued', lease_owner = NULL, lease_until = NULL,
    updated_at = ?, last_error = COALESCE(last_error, 'worker lease expired')
WHERE status = 'leased' AND lease_until < ?
`).run(now, now);
}

function leaseRows(now: number, owner: string): QueueRow[] {
  const db = libraryDatabase();
  const config = limits();
  const monthRemaining = Math.max(0, config.monthly - usageCount(null, now - MONTH_MS));
  if (monthRemaining <= 0) return [];
  const selected: QueueRow[] = [];
  db.transaction(() => {
    for (const type of ['movie', 'series'] as const) {
      const remaining = Math.max(0, config.perType - usageCount(type, now - DAY_MS));
      if (remaining <= 0 || selected.length >= monthRemaining) continue;
      const rows = db.prepare(`
SELECT queue_id, content_type, content_id, semantic_evidence_hash, input_json,
       reason, priority, attempt_count
FROM vod_semantic_frontier_queue
WHERE content_type = ? AND status = 'queued'
  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
ORDER BY priority DESC, queued_at ASC, content_id ASC
LIMIT ?
`).all(type, now, Math.min(remaining, monthRemaining - selected.length)) as QueueRow[];
      for (const row of rows) {
        const changed = db.prepare(`
UPDATE vod_semantic_frontier_queue
SET status = 'leased', lease_owner = ?, lease_until = ?, updated_at = ?
WHERE queue_id = ? AND status = 'queued'
`).run(owner, now + config.runMs + 60_000, now, row.queue_id).changes;
        if (changed === 1) selected.push(row);
      }
    }
  })();
  return selected;
}

function parseInput(row: QueueRow): StoryDnaInput | null {
  try {
    const input = JSON.parse(row.input_json) as StoryDnaInput;
    return input.type === row.content_type && input.id === row.content_id ? input : null;
  } catch {
    return null;
  }
}

function persistMetadataOverlay(base: StoryDnaInput, enriched: StoryDnaInput, now: number): void {
  if (base.type !== enriched.type || base.id !== enriched.id) return;
  libraryDatabase().prepare(`
INSERT INTO vod_semantic_metadata_cache(
  content_type, content_id, source_semantic_hash, enriched_input_json,
  enriched_semantic_hash, provider, retrieved_at
) VALUES (?, ?, ?, ?, ?, 'structured-metadata', ?)
ON CONFLICT(content_type, content_id) DO UPDATE SET
  source_semantic_hash = excluded.source_semantic_hash,
  enriched_input_json = excluded.enriched_input_json,
  enriched_semantic_hash = excluded.enriched_semantic_hash,
  provider = excluded.provider,
  retrieved_at = excluded.retrieved_at
`).run(
    base.type,
    base.id,
    contentSemanticEvidenceHash(base),
    stableStoryDnaJson(enriched),
    contentSemanticEvidenceHash(enriched),
    now,
  );
}

function updateQueueResult(row: QueueRow, success: boolean, error: string | null, now: number): void {
  const attempts = row.attempt_count + 1;
  const terminal = !success && attempts >= MAX_ATTEMPTS;
  const delay = Math.min(DAY_MS, 15 * 60 * 1_000 * 2 ** Math.max(0, attempts - 1));
  libraryDatabase().prepare(`
UPDATE vod_semantic_frontier_queue
SET status = ?, attempt_count = ?, next_attempt_at = ?, lease_owner = NULL,
    lease_until = NULL, updated_at = ?, completed_at = ?, last_error = ?
WHERE queue_id = ?
`).run(
    success ? 'complete' : terminal ? 'failed' : 'queued',
    attempts,
    success || terminal ? null : now + delay,
    now,
    success ? now : null,
    error,
    row.queue_id,
  );
}

function releaseUnprocessedLeases(owner: string, now: number, reason: string): void {
  libraryDatabase().prepare(`
UPDATE vod_semantic_frontier_queue
SET status = 'queued', lease_owner = NULL, lease_until = NULL,
    updated_at = ?, last_error = ?
WHERE status = 'leased' AND lease_owner = ?
`).run(now, reason, owner);
}

async function runWorker(options: {
  now?: number;
  lookup?: ((inputs: readonly StoryDnaInput[]) => Promise<StoryDnaInput[]>) | null;
  refreshTeacher?: typeof refreshStoryDnaTeacherCache;
  onProfilesChanged?: (types: ReadonlySet<'movie' | 'series'>) => void | Promise<void>;
}): Promise<StoryDnaFrontierRunResult> {
  if (storyDnaWorkerMode() === 'off') {
    return { status: 'disabled', leased: 0, requested: 0, persisted: 0, failed: 0, completed_types: [] };
  }
  const startedAt = options.now ?? Date.now();
  const wallStartedAt = Date.now();
  const config = limits();
  releaseExpiredLeases(startedAt);
  const owner = randomUUID();
  const rows = leaseRows(startedAt, owner);
  if (rows.length === 0) {
    const budgetExhausted = usageCount(null, startedAt - MONTH_MS) >= config.monthly
      || (['movie', 'series'] as const).every(
        (type) => usageCount(type, startedAt - DAY_MS) >= config.perType,
      );
    return {
      status: budgetExhausted ? 'budget_exhausted' : 'idle',
      leased: 0, requested: 0, persisted: 0, failed: 0, completed_types: [],
    };
  }
  const refreshTeacher = options.refreshTeacher ?? refreshStoryDnaTeacherCache;
  const completedTypes = new Set<'movie' | 'series'>();
  let requested = 0;
  let persisted = 0;
  let failed = 0;
  let transportFailures = 0;
  let stoppedForRateLimit = false;
  for (let offset = 0; offset < rows.length; offset += config.batch) {
    if (Date.now() - wallStartedAt >= config.runMs || transportFailures >= 2) break;
    const batchRows = rows.slice(offset, offset + config.batch);
    const parsed = batchRows.map((row) => ({ row, input: parseInput(row) }));
    for (const item of parsed.filter((value) => !value.input)) {
      updateQueueResult(item.row, false, 'invalid queued content-only input', Date.now());
      failed += 1;
    }
    const valid = parsed.filter((item): item is { row: QueueRow; input: StoryDnaInput } => Boolean(item.input));
    if (valid.length === 0) continue;
    let inputs = valid.map((item) => item.input);
    if (options.lookup) {
      try {
        const enriched = await options.lookup(inputs);
        const enrichedByKey = new Map(enriched.map((item) => [`${item.type}:${item.id}`, item]));
        inputs = inputs.map((base) => {
          const replacement = enrichedByKey.get(`${base.type}:${base.id}`) ?? base;
          persistMetadataOverlay(base, replacement, Date.now());
          return replacement;
        });
      } catch {
        // Structured metadata is optional. Content-only base evidence remains valid teacher input.
      }
    }
    const requestId = randomUUID();
    const usageIds = new Map<string, number>();
    const usageInsert = libraryDatabase().prepare(`
INSERT INTO vod_story_dna_usage(
  request_id, content_type, content_id, provider, model_version,
  semantic_evidence_hash, status, started_at
) VALUES (?, ?, ?, 'mango-companion', ?, ?, 'requested', ?)
RETURNING usage_id
`);
    for (const input of inputs) {
      const inserted = usageInsert.get(
        requestId,
        input.type,
        input.id,
        storyDnaTeacherConfiguration().expected_model_version,
        contentSemanticEvidenceHash(input),
        Date.now(),
      ) as { usage_id: number };
      usageIds.set(`${input.type}:${input.id}`, inserted.usage_id);
    }
    requested += inputs.length;
    let result: StoryDnaTeacherRefreshResult;
    const batchStartedAt = Date.now();
    try {
      result = await refreshTeacher(inputs, { now: Date.now(), batchSize: config.batch });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        requested: inputs.length, persisted: 0, cached: 0, documents: [],
        failures: inputs.map((input) => ({ type: input.type, id: input.id, reason: 'transport' })),
      };
      transportFailures += 1;
      console.warn(`StoryDNA frontier retained local profiles: ${message}`);
    }
    persisted += result.persisted;
    const documentKeys = new Set(result.documents.map((item) => `${item.type}:${item.id}`));
    const failures = new Map(result.failures.map((item) => [`${item.type}:${item.id}`, item.reason]));
    stoppedForRateLimit = [...failures.values()].some((reason) => (
      reason.toLowerCase().includes('rate') && reason.toLowerCase().includes('limit')
    ));
    for (const item of valid) {
      const key = `${item.row.content_type}:${item.row.content_id}`;
      const success = documentKeys.has(key);
      const reason = success ? null : failures.get(key) ?? 'missing-document';
      updateQueueResult(item.row, success, reason, Date.now());
      if (success) completedTypes.add(item.row.content_type);
      else failed += 1;
      const usageId = usageIds.get(key);
      if (usageId) {
        libraryDatabase().prepare(`
UPDATE vod_story_dna_usage
SET status = ?, completed_at = ?, duration_ms = ?, error = ?
WHERE usage_id = ?
`).run(
          success ? 'success' : 'failed',
          Date.now(),
          Date.now() - batchStartedAt,
          reason,
          usageId,
        );
      }
    }
    if (stoppedForRateLimit) break;
  }
  if (transportFailures >= 2 || stoppedForRateLimit || Date.now() - wallStartedAt >= config.runMs) {
    releaseUnprocessedLeases(
      owner,
      Date.now(),
      stoppedForRateLimit ? 'provider rate limited' : transportFailures >= 2
        ? 'provider transport degraded' : 'frontier run time limit reached',
    );
  }
  if (completedTypes.size > 0) await options.onProfilesChanged?.(completedTypes);
  return {
    status: transportFailures >= 2 || stoppedForRateLimit ? 'provider_degraded' : 'complete',
    leased: rows.length,
    requested,
    persisted,
    failed,
    completed_types: [...completedTypes].sort(),
  };
}

/** Global serialization: the companion sees at most one teacher request at a time. */
export function runStoryDnaFrontierWorker(options: Parameters<typeof runWorker>[0] = {}): Promise<StoryDnaFrontierRunResult> {
  const run = workerTail.catch(() => ({
    status: 'provider_degraded' as const,
    leased: 0, requested: 0, persisted: 0, failed: 0, completed_types: [],
  })).then(() => runWorker(options));
  workerTail = run;
  return run;
}

export function storyDnaFrontierDiagnostics(now = Date.now()): StoryDnaFrontierDiagnostics {
  const db = libraryDatabase();
  const counts = Object.fromEntries((db.prepare(`
SELECT status, COUNT(*) AS count FROM vod_semantic_frontier_queue GROUP BY status
`).all() as Array<{ status: string; count: number }>).map((row) => [row.status, row.count]));
  const retry = db.prepare(`
SELECT MIN(next_attempt_at) AS next_retry_at
FROM vod_semantic_frontier_queue WHERE status = 'queued' AND next_attempt_at > ?
`).get(now) as { next_retry_at: number | null };
  const config = limits();
  return {
    worker_mode: storyDnaWorkerMode(),
    queued: counts.queued ?? 0,
    leased: counts.leased ?? 0,
    failed: counts.failed ?? 0,
    complete: counts.complete ?? 0,
    used_last_24h: {
      movie: usageCount('movie', now - DAY_MS),
      series: usageCount('series', now - DAY_MS),
    },
    used_last_30d: usageCount(null, now - MONTH_MS),
    nightly_limit_per_type: config.perType,
    rolling_month_limit: config.monthly,
    next_retry_at: retry.next_retry_at,
  };
}
