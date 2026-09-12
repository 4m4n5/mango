import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLibraryDb, libraryDatabase, resetLibraryDbForTests } from '../library/db.js';
import { acknowledgeDesiredRevision, readDesiredRevision, updateDesiredRevision } from './desired-revision.js';
import {
  claimQueuedVodRecommendationRefreshJobsForDesired,
  completeSatisfiedQueuedVodRecommendationRefreshJobs,
  createRecommendationRefreshJob,
  createVodRecommendationRefreshJob,
  captureVodRecommendationRevisions,
  listRecommendationRefreshJobs,
  recommendationRefreshJobById,
  reconcileInterruptedRecommendationRefreshJobs,
  updateRecommendationRefreshJobRuntimeBestEffort,
  updateRecommendationRefreshJobs,
} from './jobs.js';

function withLibrary(fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mango-recommendation-jobs-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    fn();
  } finally {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedCompleteVodRank(input: {
  content_type: 'movie' | 'series';
  rank_generation_id: number;
  corpus_generation: number;
  story_generation_id: number;
  taste_generation_id: number;
  taste_revision: string;
  at: number;
}): void {
  const db = libraryDatabase();
  db.prepare(`
INSERT OR IGNORE INTO vod_story_dna_generations(
  generation_id, content_type, schema_version, ontology_version, prompt_version,
  model_version, corpus_generation, evidence_revision, status, verified_count,
  complete_count, failure_count, started_at, published_at, completed_at
) VALUES (?, ?, 'test-schema', 'test-ontology', 'test-prompt', 'test-model',
  ?, 'test-evidence', 'complete', 1, 1, 0, ?, ?, ?)
`).run(
    input.story_generation_id,
    input.content_type,
    input.corpus_generation,
    input.at,
    input.at,
    input.at,
  );
  db.prepare(`
INSERT OR IGNORE INTO vod_taste_generations(
  taste_generation_id, content_type, story_generation_id, taste_revision,
  watch_decay_bucket, status, selected_k, anchor_count, explicit_mass,
  implicit_mass, created_at, published_at
) VALUES (?, ?, ?, ?, 0, 'complete', 0, 0, 0, 0, ?, ?)
`).run(
    input.taste_generation_id,
    input.content_type,
    input.story_generation_id,
    input.taste_revision,
    input.at,
    input.at,
  );
  db.prepare(`
INSERT INTO vod_rank_generations(
  rank_generation_id, content_type, model_version, feature_version,
  ontology_version, story_generation_id, taste_generation_id, taste_revision,
  corpus_generation, trigger_reasons_json, status, verified_count, scored_count,
  eligible_count, excluded_count, started_at, published_at, completed_at
) VALUES (?, ?, 'test-model', 'test-features', 'test-ontology', ?, ?, ?, ?, '[]',
  'complete', 1, 1, 1, 0, ?, ?, ?)
`).run(
    input.rank_generation_id,
    input.content_type,
    input.story_generation_id,
    input.taste_generation_id,
    input.taste_revision,
    input.corpus_generation,
    input.at,
    input.at,
    input.at,
  );
  db.prepare(`
INSERT OR REPLACE INTO vod_active_generations(
  content_type, active_rank_generation_id, previous_complete_rank_generation_id,
  active_story_generation_id, active_taste_generation_id, shuffle_epoch, updated_at
) VALUES (?, ?, NULL, ?, ?, 0, ?)
`).run(
    input.content_type,
    input.rank_generation_id,
    input.story_generation_id,
    input.taste_generation_id,
    input.at,
  );
}

test('recommendation refresh jobs preserve captured revisions and lifecycle', () => withLibrary(() => {
  const job = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['Manual Refresh', 'manual_refresh'],
    captured_revisions: { taste: 'abc', corpus: 42 },
    queued_at: 100,
  });
  assert.deepEqual(job.trigger_reasons, ['manual_refresh']);
  updateRecommendationRefreshJobs([job.job_id], 'running', undefined, 110);
  updateRecommendationRefreshJobs([job.job_id], 'complete', undefined, 120);

  const stored = listRecommendationRefreshJobs(1)[0];
  assert.equal(stored?.status, 'complete');
  assert.equal(stored?.started_at, 110);
  assert.equal(stored?.completed_at, 120);
  assert.deepEqual(stored?.captured_revisions, { taste: 'abc', corpus: 42 });
}));

test('restart reconciliation requeues interrupted work and terminal jobs stay terminal', () => withLibrary(() => {
  const queued = createRecommendationRefreshJob({
    domain: 'vod', content_type: 'movie', trigger_reasons: ['startup'], captured_revisions: {}, queued_at: 1,
  });
  const running = createRecommendationRefreshJob({
    domain: 'vod', content_type: 'series', trigger_reasons: ['manual'], captured_revisions: {}, queued_at: 2,
  });
  const complete = createRecommendationRefreshJob({
    domain: 'youtube', trigger_reasons: ['nightly'], captured_revisions: {}, queued_at: 3,
  });
  updateRecommendationRefreshJobs([running.job_id], 'running', undefined, 4);
  updateRecommendationRefreshJobs([complete.job_id], 'complete', undefined, 5);
  assert.equal(reconcileInterruptedRecommendationRefreshJobs(6), 1);
  assert.equal(updateRecommendationRefreshJobs([complete.job_id], 'failed', 'late', 7), 0);
  const byId = new Map(listRecommendationRefreshJobs(10).map((job) => [job.job_id, job]));
  assert.equal(byId.get(queued.job_id)?.status, 'queued');
  assert.equal(byId.get(running.job_id)?.status, 'queued');
  assert.equal(byId.get(running.job_id)?.resume_count, 1);
  assert.equal(byId.get(running.job_id)?.error_code, 'restart_resume');
  assert.equal(byId.get(complete.job_id)?.status, 'complete');
}));

test('exact job lookup survives newer diagnostics-window traffic', () => withLibrary(() => {
  const target = createRecommendationRefreshJob({
    domain: 'youtube', trigger_reasons: ['manual'], captured_revisions: { generation: 7 }, queued_at: 1,
  });
  for (let index = 0; index < 25; index += 1) {
    createRecommendationRefreshJob({
      domain: 'vod', content_type: 'movie', trigger_reasons: ['signal'], captured_revisions: {}, queued_at: index + 2,
    });
  }
  assert.equal(listRecommendationRefreshJobs(20).some((job) => job.job_id === target.job_id), false);
  assert.deepEqual(recommendationRefreshJobById(target.job_id), target);
  assert.equal(recommendationRefreshJobById('missing'), null);
}));

test('a newer queued job supersedes the older durable wait target', () => withLibrary(() => {
  const first = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['service_startup'],
    captured_revisions: { corpus_generation: 1 },
    queued_at: 100,
  });
  const second = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['playability_corpus_publication'],
    captured_revisions: { corpus_generation: 2 },
    queued_at: 200,
  });
  const superseded = recommendationRefreshJobById(first.job_id);
  assert.equal(superseded?.status, 'coalesced');
  assert.equal(superseded?.successor_job_id, second.job_id);
  assert.equal(recommendationRefreshJobById(second.job_id)?.status, 'queued');
  updateRecommendationRefreshJobs([second.job_id], 'running', undefined, 210);
  updateRecommendationRefreshJobs([second.job_id], 'complete', undefined, 220);
  assert.equal(recommendationRefreshJobById(second.job_id)?.status, 'complete');
}));

test('VOD enqueue capture records the durable corpus and personalization revisions', () => withLibrary(() => {
  seedCompleteVodRank({
    content_type: 'movie',
    rank_generation_id: 325,
    corpus_generation: 42,
    story_generation_id: 281,
    taste_generation_id: 330,
    taste_revision: 'taste-a',
    at: 90,
  });
  const captured = captureVodRecommendationRevisions('movies', {
    corpus_generation: 42,
    semantic_generation: 280,
    captured_at: 99,
  });
  assert.equal(captured.captured_at, 99);
  assert.equal(captured.corpus_generation, 42);
  assert.equal(captured.story_generation, 280);
  assert.equal(captured.latest_rank_generation, 325);
  assert.equal(captured.rank_corpus_generation, 42);
  assert.equal(typeof captured.personalization_revision, 'number');
  assert.equal(captured.active_rank_generation, 325);
}));

test('manual VOD refresh atomically advances unchanged desired revision and enqueues receipt', () => withLibrary(() => {
  updateDesiredRevision({
    content_type: 'movie',
    reason: 'service_startup',
    corpus_generation: 42,
    semantic_generation: 7,
    taste_signature: 'taste-a',
    now: 100,
  });
  acknowledgeDesiredRevision({
    content_type: 'movie',
    revision: 1,
    rank_generation_id: 10,
    outcome: 'activated',
    now: 110,
  });
  const job = createVodRecommendationRefreshJob({
    content_type: 'movie',
    trigger_reasons: ['manual_refresh'],
    captured_revisions: {
      corpus_generation: 42,
      story_generation: 7,
      taste_revision: 'taste-a',
    },
    desired_revision: {
      corpus_generation: 42,
      semantic_generation: 7,
      taste_signature: 'taste-a',
      force_revision: true,
      now: 120,
    },
    queued_at: 120,
  });
  const desired = readDesiredRevision('movie', 120);
  assert.equal(desired?.revision, 2);
  assert.equal(desired?.acknowledged_revision, 1);
  assert.equal(desired?.pending, true);
  assert.equal(desired?.retry_due, true);
  const stored = recommendationRefreshJobById(job.job_id);
  assert.equal(stored?.status, 'queued');
  assert.deepEqual(stored?.captured_revisions, {
    corpus_generation: 42,
    story_generation: 7,
    taste_revision: 'taste-a',
    desired_revision: 2,
  });
}));

test('VOD claim refuses stale desired snapshot and preserves newer queued receipt', () => withLibrary(() => {
  const oldDesired = updateDesiredRevision({
    content_type: 'movie',
    reason: 'startup',
    corpus_generation: 1,
    semantic_generation: 2,
    taste_signature: 'taste-old',
    now: 10,
  });
  const newer = createVodRecommendationRefreshJob({
    content_type: 'movie',
    trigger_reasons: ['signal_change'],
    captured_revisions: {
      corpus_generation: 2,
      story_generation: 3,
      taste_revision: 'taste-new',
    },
    desired_revision: {
      corpus_generation: 2,
      semantic_generation: 3,
      taste_signature: 'taste-new',
      now: 20,
    },
    queued_at: 20,
  });
  libraryDatabase().prepare(`
INSERT INTO recommendation_refresh_jobs(
  job_id, domain, content_type, trigger_reasons_json, captured_revisions_json,
  status, queued_at, started_at, completed_at, error
) VALUES (
  'stale-old-claim-job', 'vod', 'movie', ?, ?, 'queued', 30, NULL, NULL, NULL
)
`).run(JSON.stringify(['startup']), JSON.stringify({
      desired_revision: 1,
      corpus_generation: 1,
      story_generation: 2,
      taste_revision: 'taste-old',
    }));
  assert.deepEqual(claimQueuedVodRecommendationRefreshJobsForDesired('movie', oldDesired, 40), []);
  assert.equal(
    recommendationRefreshJobById(newer.job_id)?.status,
    'queued',
    'newer exact job must not be coalesced into a stale worker claim',
  );
  assert.equal(
    recommendationRefreshJobById('stale-old-claim-job')?.status,
    'queued',
    'stale snapshot claim must leave older queued rows untouched when desired advanced',
  );
  assert.equal(readDesiredRevision('movie', 40)?.revision, 2);
}));

test('runtime checkpoint contention is best-effort and cannot abort recommendation work', () => withLibrary(() => {
  const job = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['service_startup'],
    captured_revisions: {},
  });
  const path = process.env.MANGO_LIBRARY_DB_PATH!;
  libraryDatabase().pragma('busy_timeout = 1');
  const blocker = new Database(path);
  blocker.pragma('busy_timeout = 1');
  blocker.exec('BEGIN IMMEDIATE');
  try {
    assert.equal(updateRecommendationRefreshJobRuntimeBestEffort([job.job_id], {
      phase: 'heartbeat',
      heartbeat_at: 123,
    }), 0);
  } finally {
    blocker.exec('ROLLBACK');
    blocker.close();
  }
  assert.equal(recommendationRefreshJobById(job.job_id)?.heartbeat_at, null);
}));

test('already satisfied VOD desired revision completes matching queued facade only', () => withLibrary(() => {
  updateDesiredRevision({
    content_type: 'movie',
    reason: 'playability_corpus_publication',
    corpus_generation: 34302,
    semantic_generation: 280,
    taste_signature: 'taste-a',
    now: 100,
  });
  seedCompleteVodRank({
    content_type: 'movie',
    rank_generation_id: 325,
    corpus_generation: 34302,
    story_generation_id: 281,
    taste_generation_id: 330,
    taste_revision: 'taste-a',
    at: 110,
  });
  const desired = acknowledgeDesiredRevision({
    content_type: 'movie',
    revision: 1,
    rank_generation_id: 325,
    outcome: 'activated',
    now: 120,
  });
  assert.ok(desired);
  const fulfilled = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['playability_corpus_publication'],
    captured_revisions: {
      desired_revision: 1,
      corpus_generation: 34302,
      story_generation: 280,
      taste_revision: 'taste-a',
    },
    queued_at: 130,
  });
  assert.equal(
    completeSatisfiedQueuedVodRecommendationRefreshJobs([desired], 140),
    1,
  );
  const stored = recommendationRefreshJobById(fulfilled.job_id);
  assert.equal(stored?.status, 'complete');
  assert.equal(stored?.rank_generation_id, 325);
  assert.equal(stored?.phase, 'already_satisfied');
  assert.equal(stored?.completed_at, 140);

  const legacyWithoutDesiredRevision = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['playability_corpus_publication'],
    captured_revisions: {
      corpus_generation: 34302,
      story_generation: 280,
      taste_revision: 'taste-a',
    },
    queued_at: 145,
  });
  assert.equal(completeSatisfiedQueuedVodRecommendationRefreshJobs([desired], 146), 0);
  assert.equal(
    recommendationRefreshJobById(legacyWithoutDesiredRevision.job_id)?.status,
    'queued',
    'legacy receipts without desired_revision are not strong enough for synthetic completion',
  );

  const mismatch = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['playability_corpus_publication'],
    captured_revisions: {
      corpus_generation: 34303,
      story_generation: 280,
      taste_revision: 'taste-a',
    },
    queued_at: 150,
  });
  assert.equal(completeSatisfiedQueuedVodRecommendationRefreshJobs([desired], 160), 0);
  assert.equal(recommendationRefreshJobById(mismatch.job_id)?.status, 'queued');
}));

test('already satisfied reconciliation leaves manual force refresh queued', () => withLibrary(() => {
  updateDesiredRevision({
    content_type: 'series',
    reason: 'service_startup',
    corpus_generation: 5,
    semantic_generation: 7,
    taste_signature: 'taste-series',
    now: 10,
  });
  seedCompleteVodRank({
    content_type: 'series',
    rank_generation_id: 42,
    corpus_generation: 5,
    story_generation_id: 8,
    taste_generation_id: 9,
    taste_revision: 'taste-series',
    at: 20,
  });
  const desired = acknowledgeDesiredRevision({
    content_type: 'series',
    revision: 1,
    rank_generation_id: 42,
    outcome: 'activated',
    now: 30,
  });
  assert.ok(desired);
  const manual = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'series',
    trigger_reasons: ['manual_refresh'],
    captured_revisions: {
      corpus_generation: 5,
      story_generation: 7,
      taste_revision: 'taste-series',
    },
    queued_at: 40,
  });
  assert.equal(completeSatisfiedQueuedVodRecommendationRefreshJobs([desired], 50), 0);
  assert.equal(recommendationRefreshJobById(manual.job_id)?.status, 'queued');
}));

test('already satisfied reconciliation rereads desired row and refuses stale snapshots', () => withLibrary(() => {
  updateDesiredRevision({
    content_type: 'movie',
    reason: 'service_startup',
    corpus_generation: 10,
    semantic_generation: 20,
    taste_signature: 'taste-old',
    now: 10,
  });
  seedCompleteVodRank({
    content_type: 'movie',
    rank_generation_id: 50,
    corpus_generation: 10,
    story_generation_id: 21,
    taste_generation_id: 22,
    taste_revision: 'taste-old',
    at: 20,
  });
  const staleDesired = acknowledgeDesiredRevision({
    content_type: 'movie',
    revision: 1,
    rank_generation_id: 50,
    outcome: 'activated',
    now: 30,
  });
  assert.ok(staleDesired);
  const job = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['playability_corpus_publication'],
    captured_revisions: {
      corpus_generation: 10,
      story_generation: 20,
      taste_revision: 'taste-old',
    },
    queued_at: 40,
  });
  updateDesiredRevision({
    content_type: 'movie',
    reason: 'signal_change',
    corpus_generation: 11,
    semantic_generation: 20,
    taste_signature: 'taste-old',
    now: 45,
  });
  assert.equal(completeSatisfiedQueuedVodRecommendationRefreshJobs([staleDesired], 50), 0);
  assert.equal(recommendationRefreshJobById(job.job_id)?.status, 'queued');
}));

test('already satisfied reconciliation refuses conflicting queued rank ids', () => withLibrary(() => {
  updateDesiredRevision({
    content_type: 'movie',
    reason: 'service_startup',
    corpus_generation: 20,
    semantic_generation: 30,
    taste_signature: 'taste-current',
    now: 10,
  });
  seedCompleteVodRank({
    content_type: 'movie',
    rank_generation_id: 60,
    corpus_generation: 20,
    story_generation_id: 31,
    taste_generation_id: 32,
    taste_revision: 'taste-current',
    at: 20,
  });
  const desired = acknowledgeDesiredRevision({
    content_type: 'movie',
    revision: 1,
    rank_generation_id: 60,
    outcome: 'activated',
    now: 30,
  });
  assert.ok(desired);
  const job = createRecommendationRefreshJob({
    domain: 'vod',
    content_type: 'movie',
    trigger_reasons: ['playability_corpus_publication'],
    captured_revisions: {
      desired_revision: 1,
      corpus_generation: 20,
      story_generation: 30,
      taste_revision: 'taste-current',
    },
    queued_at: 40,
  });
  libraryDatabase().prepare(`
UPDATE recommendation_refresh_jobs SET rank_generation_id = ? WHERE job_id = ?
`).run(59, job.job_id);
  assert.equal(completeSatisfiedQueuedVodRecommendationRefreshJobs([desired], 50), 0);
  const stored = recommendationRefreshJobById(job.job_id);
  assert.equal(stored?.status, 'queued');
  assert.equal(stored?.rank_generation_id, 59);
}));
