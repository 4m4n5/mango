import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initLibraryDb, libraryDatabase, resetLibraryDbForTests } from '../library/db.js';
import {
  createRecommendationRefreshJob,
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
  const captured = captureVodRecommendationRevisions('movies', {
    corpus_generation: 42,
    captured_at: 99,
  });
  assert.equal(captured.captured_at, 99);
  assert.equal(captured.corpus_generation, 42);
  assert.equal(typeof captured.personalization_revision, 'number');
  assert.equal(captured.active_rank_generation, null);
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
