import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initLibraryDb,
  resetLibraryDbForTests,
} from '../library/db.js';
import {
  readAllDesiredRevisions,
  readDesiredRevision,
  updateDesiredRevision,
} from './desired-revision.js';
import { acquireExclusiveLease, pickPendingRevisions, runWorkerLoop } from './worker-cli.js';

test('persistent worker idle polling keeps a referenced timer', () => {
  const source = readFileSync(join(process.cwd(), 'src/recommendations/worker-cli.ts'), 'utf8');
  const sleepBody = source.match(/function defaultSleep[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(sleepBody.includes('setTimeout'));
  assert.equal(sleepBody.includes('.unref'), false,
    'an unref idle timer lets the systemd worker exit cleanly while idle');
});

function withLibrary(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-vod-recs-worker-'));
  const prior = {
    library: process.env.MANGO_LIBRARY_DB_PATH,
    pins: process.env.MANGO_USER_PINS_PATH,
    oneshot: process.env.MANGO_VOD_RECS_WORKER_ONESHOT,
  };
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  return (async () => {
    try {
      initLibraryDb();
      await fn(dir);
    } finally {
      resetLibraryDbForTests();
      for (const [name, value] of Object.entries(prior)) {
        const key = name === 'library' ? 'MANGO_LIBRARY_DB_PATH'
          : name === 'pins' ? 'MANGO_USER_PINS_PATH'
            : 'MANGO_VOD_RECS_WORKER_ONESHOT';
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

test('pickPendingRevisions returns movie then series in deterministic order', async () => {
  await withLibrary(async () => {
    updateDesiredRevision({ content_type: 'series', reason: 'a', now: 1 });
    updateDesiredRevision({ content_type: 'movie', reason: 'b', now: 2 });
    const pending = pickPendingRevisions();
    assert.deepEqual(pending.map((p) => p.tab), ['movies', 'series']);
  });
});

test('worker loop activates on success and stops when nothing is pending', async () => {
  await withLibrary(async (dir) => {
    updateDesiredRevision({
      content_type: 'movie', reason: 'seed', corpus_generation: 1, now: 10,
    });
    const heartbeat = join(dir, 'hb.json');
    const logs: string[] = [];
    const result = await runWorkerLoop({
      refresh: async (tab) => {
        assert.equal(tab, 'movies');
        return { rank_generation_id: 42, activated: true, published: true };
      },
      now: () => 100,
      log: (msg) => logs.push(msg),
    }, { heartbeatPath: heartbeat, oneshot: true });
    assert.equal(result.processed, 1);
    const row = readDesiredRevision('movie');
    assert.equal(row?.acknowledged_revision, 1);
    assert.equal(row?.acknowledged_rank_generation_id, 42);
    assert.equal(row?.pending, false);
    const hb = JSON.parse(readFileSync(heartbeat, 'utf8')) as { phase: string };
    assert.ok(hb.phase.startsWith('rank:') || hb.phase === 'poll');
    assert.ok(logs.some((line) => line.includes('activated')));
  });
});

test('worker discards stale builds when desired revision advances mid-flight', async () => {
  await withLibrary(async () => {
    updateDesiredRevision({
      content_type: 'movie', reason: 'seed', corpus_generation: 1, now: 10,
    });
    let inFlight = false;
    const result = await runWorkerLoop({
      refresh: async () => {
        inFlight = true;
        updateDesiredRevision({
          content_type: 'movie',
          reason: 'signal_change_during_build',
          corpus_generation: 1,
          taste_signature: 'new',
          now: 20,
        });
        return { rank_generation_id: 7, activated: true };
      },
    }, { oneshot: true });
    assert.equal(inFlight, true);
    assert.equal(result.processed, 1);
    const row = readDesiredRevision('movie');
    assert.equal(row?.revision, 2);
    assert.equal(row?.acknowledged_revision, 0,
      'stale build must not advance acknowledged_revision');
    assert.equal(row?.last_worker_error, 'desired_revision_advanced_during_build');
    assert.equal(row?.pending, true);
  });
});

test('worker last-good on refresh throw does NOT acknowledge the revision', async () => {
  await withLibrary(async () => {
    updateDesiredRevision({ content_type: 'series', reason: 'seed', now: 5 });
    let calls = 0;
    const result = await runWorkerLoop({
      refresh: async () => {
        calls += 1;
        throw new Error('rank_worker_timeout');
      },
      now: () => 5,
    }, { oneshot: true });
    assert.equal(calls, 1);
    assert.equal(result.processed, 1);
    const row = readDesiredRevision('series', 5);
    // Non-activation must NEVER consume the desired revision — the worker
    // will retry once retry_after has elapsed (or immediately on a new signal).
    assert.equal(row?.acknowledged_revision, 0,
      'transient failure must not advance acknowledged_revision');
    assert.equal(row?.last_worker_error, 'rank_worker_timeout');
    assert.equal(row?.attempt_count, 1);
    assert.ok(row?.retry_after !== null && row?.retry_after !== undefined,
      'transient failure must schedule a retry_after clock');
    assert.equal(row?.pending, true, 'revision remains pending across retries');
    assert.equal(row?.retry_due, false,
      'retry_after in the future keeps retry_due false at now=5');
    assert.ok(readAllDesiredRevisions().length >= 1);
  });
});

test('non-activation (last_good_retained) does NOT consume the revision', async () => {
  await withLibrary(async () => {
    updateDesiredRevision({ content_type: 'movie', reason: 'seed', now: 100 });
    const result = await runWorkerLoop({
      refresh: async () => (
        { rank_generation_id: null, activated: false, published: false, reason: 'not_eligible' }
      ),
      now: () => 100,
    }, { oneshot: true });
    assert.equal(result.processed, 1);
    const row = readDesiredRevision('movie', 100);
    assert.equal(row?.acknowledged_revision, 0);
    assert.equal(row?.pending, true);
    assert.equal(row?.attempt_count, 1);
    assert.equal(row?.last_worker_error, 'not_eligible');
    assert.ok((row?.retry_after ?? 0) > 100);
  });
});

test('exponential backoff caps at 1 hour after repeated failures', async () => {
  await withLibrary(async () => {
    updateDesiredRevision({ content_type: 'movie', reason: 'seed', now: 0 });
    const seen: number[] = [];
    // Drive the worker across seven failing iterations; on iteration K the
    // clock is advanced past `retry_after` so `retry_due` is true again.
    let now = 0;
    for (let iter = 1; iter <= 7; iter += 1) {
      await runWorkerLoop({
        refresh: async () => (
          { rank_generation_id: null, activated: false, published: false, reason: 'boom' }
        ),
        now: () => now,
      }, { oneshot: true });
      const row = readDesiredRevision('movie', now)!;
      assert.equal(row.attempt_count, iter);
      seen.push((row.retry_after ?? 0) - now);
      now = (row.retry_after ?? 0);
    }
    // Attempts 1..6 double from 60_000 up to 1_920_000, attempt >=7 saturates.
    assert.deepEqual(seen, [60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000]);
  });
});

test('worker skips rows whose retry_after is still in the future', async () => {
  await withLibrary(async () => {
    updateDesiredRevision({ content_type: 'movie', reason: 'seed', now: 0 });
    // First failure schedules retry_after = 60_000.
    await runWorkerLoop({
      refresh: async () => ({ activated: false, reason: 'transient' }),
      now: () => 0,
    }, { oneshot: true });
    const afterFail = readDesiredRevision('movie', 0)!;
    assert.equal(afterFail.retry_after, 60_000);
    // Second run before retry_after elapses: worker must NOT refresh.
    let refreshCalls = 0;
    const result = await runWorkerLoop({
      refresh: async () => { refreshCalls += 1; return { activated: true }; },
      now: () => 30_000,
    }, { oneshot: true });
    assert.equal(refreshCalls, 0, 'worker must skip rows whose retry_after is in the future');
    assert.equal(result.processed, 0);
    // After retry_after elapses, worker picks it up and success clears state.
    const later = await runWorkerLoop({
      refresh: async () => ({ rank_generation_id: 77, activated: true }),
      now: () => 60_001,
    }, { oneshot: true });
    assert.equal(later.processed, 1);
    const done = readDesiredRevision('movie', 60_001)!;
    assert.equal(done.acknowledged_revision, 1);
    assert.equal(done.attempt_count, 0, 'success resets attempt_count');
    assert.equal(done.retry_after, null, 'success clears retry_after');
    assert.equal(done.pending, false);
  });
});

test('new desired input resets retry state so the worker retries immediately', async () => {
  await withLibrary(async () => {
    updateDesiredRevision({
      content_type: 'movie',
      reason: 'seed',
      corpus_generation: 1,
      now: 0,
    });
    await runWorkerLoop({
      refresh: async () => ({ activated: false, reason: 'flake' }),
      now: () => 0,
    }, { oneshot: true });
    const failed = readDesiredRevision('movie', 0)!;
    assert.equal(failed.attempt_count, 1);
    assert.equal(failed.retry_after, 60_000);
    // Fresh signal with new inputs — retry state MUST reset so the worker
    // does not sit on the previous failure's backoff.
    updateDesiredRevision({
      content_type: 'movie',
      reason: 'signal_change',
      corpus_generation: 2,
      now: 10,
    });
    const bumped = readDesiredRevision('movie', 10)!;
    assert.equal(bumped.revision, 2);
    assert.equal(bumped.attempt_count, 0, 'new input must reset attempt_count');
    assert.equal(bumped.retry_after, null, 'new input must clear retry_after');
    assert.equal(bumped.retry_due, true);
    let refreshCalls = 0;
    await runWorkerLoop({
      refresh: async () => { refreshCalls += 1; return { rank_generation_id: 3, activated: true }; },
      now: () => 20,
    }, { oneshot: true });
    assert.equal(refreshCalls, 1);
    const done = readDesiredRevision('movie', 20)!;
    assert.equal(done.acknowledged_revision, 2);
  });
});

test('worker returns immediately when nothing is pending in oneshot mode', async () => {
  await withLibrary(async () => {
    const sleeps: number[] = [];
    const result = await runWorkerLoop({
      refresh: async () => { throw new Error('should not be called'); },
      sleep: async (ms) => { sleeps.push(ms); },
    }, { oneshot: true, pollMs: 42 });
    assert.equal(result.processed, 0);
    // Oneshot with no pending desired revisions returns without sleeping;
    // systemd RestartSec provides the poll interval between activations.
    assert.deepEqual(sleeps, []);
    assert.equal(result.iterations, 1);
  });
});

test('acquireExclusiveLease reclaims a lease whose recorded PID is dead', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-vod-recs-lease-'));
  try {
    const path = join(dir, 'worker.lease');
    // Simulate a crashed worker: pid file exists but its recorded pid is dead.
    const staleFd = openSync(path, 'wx');
    writeFileSync(staleFd, JSON.stringify({ pid: 999_999, started_at: 1 }));
    closeSync(staleFd);
    assert.ok(existsSync(path));
    const logs: string[] = [];
    const acquired = acquireExclusiveLease(
      path,
      (msg) => logs.push(msg),
      { isPidLive: () => false, now: () => 2 },
    );
    assert.ok(acquired, 'must reclaim lease when the recorded pid is dead');
    assert.ok(logs.some((line) => line.includes('reclaimed stale lease')),
      'reclaim event must be logged for operator visibility');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { pid: number };
    assert.equal(raw.pid, process.pid,
      'reclaimed lease must record the new owning pid');
    closeSync(acquired!.fd);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireExclusiveLease refuses when the recorded PID is still live', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-vod-recs-lease-live-'));
  try {
    const path = join(dir, 'worker.lease');
    const fd = openSync(path, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: 12_345, started_at: 1 }));
    closeSync(fd);
    const logs: string[] = [];
    const acquired = acquireExclusiveLease(
      path,
      (msg) => logs.push(msg),
      { isPidLive: (pid) => pid === 12_345, now: () => 2 },
    );
    assert.equal(acquired, null,
      'must not steal a lease owned by a live worker pid');
    assert.ok(logs.some((line) => line.includes('owned by pid 12345')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('worker polls and processes when items appear on the second iteration', async () => {
  await withLibrary(async () => {
    const sleeps: number[] = [];
    let refreshCalls = 0;
    let addedOnce = false;
    const result = await runWorkerLoop({
      refresh: async () => {
        refreshCalls += 1;
        return { rank_generation_id: 99, activated: true };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        if (!addedOnce) {
          addedOnce = true;
          updateDesiredRevision({ content_type: 'movie', reason: 'late', now: ms });
        }
      },
    }, { oneshot: false, pollMs: 5, maxIterations: 3 });
    assert.equal(refreshCalls, 1);
    assert.equal(result.processed, 1);
    // First idle iter sleeps, second iter processes the newly-appearing item.
    // A third idle iter may or may not sleep depending on scheduling; we only
    // require at least one sleep, all with the configured pollMs.
    assert.ok(sleeps.length >= 1);
    for (const value of sleeps) assert.equal(value, 5);
  });
});
