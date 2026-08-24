import { randomUUID } from 'node:crypto';
import { libraryDatabase } from '../library/db.js';

export type RecommendationRefreshJobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'coalesced';

export type RecommendationRefreshJob = {
  job_id: string;
  domain: 'vod' | 'youtube';
  content_type: string | null;
  trigger_reasons: string[];
  captured_revisions: Record<string, string | number | null>;
  status: RecommendationRefreshJobStatus;
  queued_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
  phase: string | null;
  phase_cursor: string | null;
  checkpoint: Record<string, unknown>;
  heartbeat_at: number | null;
  deadline_at: number | null;
  story_generation_id: number | null;
  taste_generation_id: number | null;
  rank_generation_id: number | null;
  resume_count: number;
  successor_job_id: string | null;
  error_code: string | null;
  resource_metrics: Record<string, unknown>;
};

export type VodRecommendationRefreshTab = 'movies' | 'series';

function normalizeReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons
    .map((reason) => reason.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 48))
    .filter(Boolean))].sort();
}

function parseJsonObject(value: string): Record<string, string | number | null> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string | number | null>;
  } catch {
    return {};
  }
}

function parseUnknownJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function createRecommendationRefreshJob(input: {
  domain: 'vod' | 'youtube';
  content_type?: string | null;
  trigger_reasons: readonly string[];
  captured_revisions: Record<string, string | number | null>;
  queued_at?: number;
}): RecommendationRefreshJob {
  const queuedAt = input.queued_at ?? Date.now();
  const jobId = randomUUID();
  const reasons = normalizeReasons(input.trigger_reasons);
  const db = libraryDatabase();
  const coalesce = db.prepare(`
UPDATE recommendation_refresh_jobs
SET status = 'coalesced', completed_at = ?, successor_job_id = ?, error_code = 'superseded',
    error = 'superseded by a newly captured refresh job'
WHERE domain = ? AND COALESCE(content_type, '') = COALESCE(?, '') AND status = 'queued'
`);
  const insert = db.prepare(`
INSERT INTO recommendation_refresh_jobs(
  job_id, domain, content_type, trigger_reasons_json, captured_revisions_json,
  status, queued_at, started_at, completed_at, error
) VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)
`);
  db.transaction(() => {
    coalesce.run(queuedAt, jobId, input.domain, input.content_type?.trim() || null);
    insert.run(
      jobId,
      input.domain,
      input.content_type?.trim() || null,
      JSON.stringify(reasons),
      JSON.stringify(input.captured_revisions),
      queuedAt,
    );
  })();
  return {
    job_id: jobId,
    domain: input.domain,
    content_type: input.content_type?.trim() || null,
    trigger_reasons: reasons,
    captured_revisions: input.captured_revisions,
    status: 'queued',
    queued_at: queuedAt,
    started_at: null,
    completed_at: null,
    error: null,
    phase: null,
    phase_cursor: null,
    checkpoint: {},
    heartbeat_at: null,
    deadline_at: null,
    story_generation_id: null,
    taste_generation_id: null,
    rank_generation_id: null,
    resume_count: 0,
    successor_job_id: null,
    error_code: null,
    resource_metrics: {},
  };
}

export type RecommendationRefreshJobRuntimeUpdate = {
  phase?: string | null;
  phase_cursor?: string | null;
  checkpoint?: Record<string, unknown>;
  heartbeat_at?: number | null;
  deadline_at?: number | null;
  story_generation_id?: number | null;
  taste_generation_id?: number | null;
  rank_generation_id?: number | null;
  successor_job_id?: string | null;
  error_code?: string | null;
  resource_metrics?: Record<string, unknown>;
};

/** Additive operational checkpointing; recommendation semantics never depend on it. */
export function updateRecommendationRefreshJobRuntime(
  jobIds: readonly string[],
  update: RecommendationRefreshJobRuntimeUpdate,
): number {
  const ids = [...new Set(jobIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const db = libraryDatabase();
  const current = db.prepare(`
SELECT checkpoint_json, resource_metrics_json FROM recommendation_refresh_jobs WHERE job_id = ?
`);
  const write = db.prepare(`
UPDATE recommendation_refresh_jobs
SET phase = COALESCE(@phase, phase),
    phase_cursor = COALESCE(@phase_cursor, phase_cursor),
    checkpoint_json = @checkpoint_json,
    heartbeat_at = COALESCE(@heartbeat_at, heartbeat_at),
    deadline_at = COALESCE(@deadline_at, deadline_at),
    story_generation_id = COALESCE(@story_generation_id, story_generation_id),
    taste_generation_id = COALESCE(@taste_generation_id, taste_generation_id),
    rank_generation_id = COALESCE(@rank_generation_id, rank_generation_id),
    successor_job_id = COALESCE(@successor_job_id, successor_job_id),
    error_code = COALESCE(@error_code, error_code),
    resource_metrics_json = @resource_metrics_json
WHERE job_id = @job_id
`);
  return db.transaction(() => ids.reduce((changes, jobId) => {
    const row = current.get(jobId) as {
      checkpoint_json: string;
      resource_metrics_json: string;
    } | undefined;
    if (!row) return changes;
    const checkpoint = update.checkpoint === undefined
      ? parseUnknownJsonObject(row.checkpoint_json)
      : update.checkpoint;
    const resourceMetrics = update.resource_metrics === undefined
      ? parseUnknownJsonObject(row.resource_metrics_json)
      : update.resource_metrics;
    return changes + write.run({
      job_id: jobId,
      phase: update.phase ?? null,
      phase_cursor: update.phase_cursor ?? null,
      checkpoint_json: JSON.stringify(checkpoint),
      heartbeat_at: update.heartbeat_at ?? null,
      deadline_at: update.deadline_at ?? null,
      story_generation_id: update.story_generation_id ?? null,
      taste_generation_id: update.taste_generation_id ?? null,
      rank_generation_id: update.rank_generation_id ?? null,
      successor_job_id: update.successor_job_id ?? null,
      error_code: update.error_code ?? null,
      resource_metrics_json: JSON.stringify(resourceMetrics),
    }).changes;
  }, 0))();
}

function isRecommendationRuntimeWriteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}

/**
 * Runtime checkpoints are diagnostics, never publication authority. A live
 * SQLite maintenance lock may delay them, but must not crash or invalidate the
 * recommendation refresh that still owns last-good publication semantics.
 */
export function updateRecommendationRefreshJobRuntimeBestEffort(
  jobIds: readonly string[],
  update: RecommendationRefreshJobRuntimeUpdate,
): number {
  try {
    return updateRecommendationRefreshJobRuntime(jobIds, update);
  } catch (error) {
    if (isRecommendationRuntimeWriteContention(error)) return 0;
    throw error;
  }
}

export function updateRecommendationRefreshJobs(
  jobIds: readonly string[],
  status: Exclude<RecommendationRefreshJobStatus, 'queued'>,
  error?: unknown,
  at = Date.now(),
): number {
  const ids = [...new Set(jobIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const update = libraryDatabase().prepare(`
UPDATE recommendation_refresh_jobs
SET status = @status,
    started_at = CASE
      WHEN @status = 'running' THEN COALESCE(started_at, @at)
      ELSE started_at
    END,
    completed_at = CASE
      WHEN @status IN ('complete', 'failed', 'coalesced') THEN @at
      ELSE NULL
    END,
    error = @error
    , error_code = CASE WHEN @status IN ('running', 'complete') THEN NULL ELSE error_code END
WHERE job_id = @job_id AND status IN ('queued', 'running')
`);
  const message = error == null
    ? null
    : (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
  return libraryDatabase().transaction(() => ids.reduce(
    (changes, jobId) => changes + update.run({ job_id: jobId, status, at, error: message }).changes,
    0,
  ))();
}

/**
 * A committed page is recoverable. Preserve queued work and return interrupted
 * running rows to queued state; the newly captured startup request coalesces
 * them explicitly rather than relabeling durable work as a failure.
 */
/**
 * Worker-side claim: transitions any queued facade rows for
 * `(domain, content_type)` to `running` atomically and returns their ids so
 * the worker can finalize them by id. If nothing is queued we still return
 * an empty array — a stale desired revision may exist without a facade
 * row after a crash-and-restart cycle.
 *
 * This is the sole authorized `queued → running` transition for facade
 * rows: the catalog only *enqueues*; the isolated worker *runs* and
 * *finalizes*. That contract keeps `/recommendations/state` polling truthful
 * without waking the catalog to update job status.
 */
export function claimQueuedRecommendationRefreshJobsForContent(
  domain: 'vod' | 'youtube',
  contentType: string,
  at = Date.now(),
): string[] {
  const db = libraryDatabase();
  const trimmed = contentType.trim();
  if (!trimmed) return [];
  return db.transaction((): string[] => {
    const rows = db.prepare(`
SELECT job_id FROM recommendation_refresh_jobs
WHERE domain = ? AND COALESCE(content_type, '') = ? AND status = 'queued'
ORDER BY queued_at ASC, job_id ASC
`).all(domain, trimmed) as Array<{ job_id: string }>;
    const ids = rows.map((row) => row.job_id);
    if (ids.length === 0) return ids;
    const update = db.prepare(`
UPDATE recommendation_refresh_jobs
SET status = 'running',
    started_at = COALESCE(started_at, ?),
    heartbeat_at = ?
WHERE job_id = ? AND status = 'queued'
`);
    for (const id of ids) update.run(at, at, id);
    return ids;
  })();
}

export function reconcileInterruptedRecommendationRefreshJobs(
  at = Date.now(),
  reason = 'service restarted; committed checkpoint retained for resume',
): number {
  return libraryDatabase().prepare(`
UPDATE recommendation_refresh_jobs
SET status = 'queued', started_at = NULL, completed_at = NULL, error = ?,
    error_code = 'restart_resume', resume_count = resume_count + 1,
    heartbeat_at = ?, deadline_at = NULL
WHERE status = 'running'
`).run(reason.slice(0, 1_000), at).changes;
}

/** Capture the exact durable VOD revisions visible when a job is enqueued. */
export function captureVodRecommendationRevisions(
  tab: VodRecommendationRefreshTab,
  options: {
    corpus_generation?: number | null;
    captured_at?: number;
  },
): Record<string, string | number | null> {
  const db = libraryDatabase();
  const contentType = tab === 'movies' ? 'movie' : 'series';
  const personalization = db.prepare(`
SELECT updated_at FROM personalization_state WHERE state_id = 1
`).get() as { updated_at: number };
  const latest = db.prepare(`
SELECT rank_generation_id, story_generation_id, taste_generation_id,
       taste_revision, corpus_generation, model_version, feature_version,
       ontology_version, status
FROM vod_rank_generations
WHERE content_type = ?
ORDER BY rank_generation_id DESC
LIMIT 1
`).get(contentType) as {
    rank_generation_id: number;
    story_generation_id: number;
    taste_generation_id: number;
    taste_revision: string;
    corpus_generation: number;
    model_version: string;
    feature_version: string;
    ontology_version: string;
    status: string;
  } | undefined;
  const active = db.prepare(`
SELECT active_rank_generation_id, previous_complete_rank_generation_id
FROM vod_active_generations
WHERE content_type = ?
`).get(contentType) as {
    active_rank_generation_id: number | null;
    previous_complete_rank_generation_id: number | null;
  } | undefined;
  return {
    captured_at: options.captured_at ?? Date.now(),
    personalization_revision: personalization.updated_at,
    corpus_generation: options.corpus_generation ?? null,
    latest_rank_generation: latest?.rank_generation_id ?? null,
    active_rank_generation: active?.active_rank_generation_id ?? null,
    previous_complete_rank_generation: active?.previous_complete_rank_generation_id ?? null,
    story_generation: latest?.story_generation_id ?? null,
    taste_generation: latest?.taste_generation_id ?? null,
    taste_revision: latest?.taste_revision ?? null,
    rank_corpus_generation: latest?.corpus_generation ?? null,
    model_version: latest?.model_version ?? null,
    feature_version: latest?.feature_version ?? null,
    ontology_version: latest?.ontology_version ?? null,
    latest_status: latest?.status ?? null,
  };
}

export function listRecommendationRefreshJobs(limit = 20): RecommendationRefreshJob[] {
  const rows = libraryDatabase().prepare(`
SELECT job_id, domain, content_type, trigger_reasons_json, captured_revisions_json,
       status, queued_at, started_at, completed_at, error, phase, phase_cursor,
       checkpoint_json, heartbeat_at, deadline_at, story_generation_id,
       taste_generation_id, rank_generation_id, resume_count, successor_job_id,
       error_code, resource_metrics_json
FROM recommendation_refresh_jobs
ORDER BY queued_at DESC, job_id DESC
LIMIT ?
`).all(Math.max(1, Math.min(100, Math.floor(limit)))) as Array<{
    job_id: string;
    domain: 'vod' | 'youtube';
    content_type: string | null;
    trigger_reasons_json: string;
    captured_revisions_json: string;
    status: RecommendationRefreshJobStatus;
    queued_at: number;
    started_at: number | null;
    completed_at: number | null;
    error: string | null;
    phase: string | null;
    phase_cursor: string | null;
    checkpoint_json: string;
    heartbeat_at: number | null;
    deadline_at: number | null;
    story_generation_id: number | null;
    taste_generation_id: number | null;
    rank_generation_id: number | null;
    resume_count: number;
    successor_job_id: string | null;
    error_code: string | null;
    resource_metrics_json: string;
  }>;
  return rows.map(({ trigger_reasons_json: reasons, captured_revisions_json: revisions,
    checkpoint_json: checkpoint, resource_metrics_json: resourceMetrics, ...row }) => ({
    ...row,
    trigger_reasons: parseJsonList(reasons),
    captured_revisions: parseJsonObject(revisions),
    checkpoint: parseUnknownJsonObject(checkpoint),
    resource_metrics: parseUnknownJsonObject(resourceMetrics),
  }));
}

/** Exact durable lookup for a caller polling the job ID returned by HTTP 202. */
export function recommendationRefreshJobById(jobId: string): RecommendationRefreshJob | null {
  const normalized = jobId.trim();
  if (!normalized) return null;
  const row = libraryDatabase().prepare(`
SELECT job_id, domain, content_type, trigger_reasons_json, captured_revisions_json,
       status, queued_at, started_at, completed_at, error, phase, phase_cursor,
       checkpoint_json, heartbeat_at, deadline_at, story_generation_id,
       taste_generation_id, rank_generation_id, resume_count, successor_job_id,
       error_code, resource_metrics_json
FROM recommendation_refresh_jobs
WHERE job_id = ?
`).get(normalized) as {
    job_id: string;
    domain: 'vod' | 'youtube';
    content_type: string | null;
    trigger_reasons_json: string;
    captured_revisions_json: string;
    status: RecommendationRefreshJobStatus;
    queued_at: number;
    started_at: number | null;
    completed_at: number | null;
    error: string | null;
    phase: string | null;
    phase_cursor: string | null;
    checkpoint_json: string;
    heartbeat_at: number | null;
    deadline_at: number | null;
    story_generation_id: number | null;
    taste_generation_id: number | null;
    rank_generation_id: number | null;
    resume_count: number;
    successor_job_id: string | null;
    error_code: string | null;
    resource_metrics_json: string;
  } | undefined;
  if (!row) return null;
  const {
    trigger_reasons_json: reasons,
    captured_revisions_json: revisions,
    checkpoint_json: checkpoint,
    resource_metrics_json: resourceMetrics,
    ...job
  } = row;
  return {
    ...job,
    trigger_reasons: parseJsonList(reasons),
    captured_revisions: parseJsonObject(revisions),
    checkpoint: parseUnknownJsonObject(checkpoint),
    resource_metrics: parseUnknownJsonObject(resourceMetrics),
  };
}
