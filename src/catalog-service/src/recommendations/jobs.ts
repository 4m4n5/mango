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
  libraryDatabase().prepare(`
INSERT INTO recommendation_refresh_jobs(
  job_id, domain, content_type, trigger_reasons_json, captured_revisions_json,
  status, queued_at, started_at, completed_at, error
) VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)
`).run(
    jobId,
    input.domain,
    input.content_type?.trim() || null,
    JSON.stringify(reasons),
    JSON.stringify(input.captured_revisions),
    queuedAt,
  );
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
  };
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
 * In-memory queue ownership cannot survive a process restart. Close orphaned
 * rows honestly; the normal service-startup jobs then perform fresh work with
 * newly captured revisions instead of pretending an old request resumed.
 */
export function reconcileInterruptedRecommendationRefreshJobs(
  at = Date.now(),
  reason = 'service restarted before recommendation refresh completed',
): number {
  return libraryDatabase().prepare(`
UPDATE recommendation_refresh_jobs
SET status = 'failed', completed_at = ?, error = ?
WHERE status IN ('queued', 'running')
`).run(at, reason.slice(0, 1_000)).changes;
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
       status, queued_at, started_at, completed_at, error
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
  }>;
  return rows.map(({ trigger_reasons_json: reasons, captured_revisions_json: revisions, ...row }) => ({
    ...row,
    trigger_reasons: parseJsonList(reasons),
    captured_revisions: parseJsonObject(revisions),
  }));
}

/** Exact durable lookup for a caller polling the job ID returned by HTTP 202. */
export function recommendationRefreshJobById(jobId: string): RecommendationRefreshJob | null {
  const normalized = jobId.trim();
  if (!normalized) return null;
  const row = libraryDatabase().prepare(`
SELECT job_id, domain, content_type, trigger_reasons_json, captured_revisions_json,
       status, queued_at, started_at, completed_at, error
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
  } | undefined;
  if (!row) return null;
  const {
    trigger_reasons_json: reasons,
    captured_revisions_json: revisions,
    ...job
  } = row;
  return {
    ...job,
    trigger_reasons: parseJsonList(reasons),
    captured_revisions: parseJsonObject(revisions),
  };
}
