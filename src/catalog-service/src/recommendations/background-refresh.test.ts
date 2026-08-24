import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CoalescingRecommendationRefreshQueue,
  KeyedSerialExecutor,
  type RecommendationRefreshWork,
} from './background-refresh.js';

test('background recommendation refresh coalesces duplicate tabs and serializes work', async () => {
  const calls: RecommendationRefreshWork[] = [];
  let active = 0;
  let maxActive = 0;
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = new CoalescingRecommendationRefreshQueue({
    refresh: async (work) => {
      calls.push(work);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (calls.length === 1) await first;
      active -= 1;
    },
    onPublished: () => undefined,
    wait: async () => undefined,
  });
  queue.enqueue('alice', ['movies', 'movies']);
  await Promise.resolve();
  queue.enqueue('alice', ['series', 'series']);
  releaseFirst?.();
  await queue.idle();
  assert.deepEqual(calls, [
    { profile_id: 'alice', tab: 'movies' },
    { profile_id: 'alice', tab: 'series' },
  ]);
  assert.equal(maxActive, 1);
});

test('background recommendation refresh retries with bounded exponential delays', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const notices: boolean[] = [];
  let publications = 0;
  const queue = new CoalescingRecommendationRefreshQueue({
    refresh: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
    },
    onPublished: () => { publications += 1; },
    onRetainedLastGood: (_tab, _error, willRetry) => notices.push(willRetry),
    wait: async (delay) => { delays.push(delay); },
    maxRetries: 2,
    retryBaseMs: 100,
  });
  queue.enqueue('alice', ['movies']);
  await queue.idle();
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.deepEqual(notices, [true, true]);
  assert.equal(publications, 1);
});

test('background recommendation refresh stops after its retry budget and retains last good', async () => {
  let attempts = 0;
  const notices: boolean[] = [];
  const queue = new CoalescingRecommendationRefreshQueue({
    refresh: async () => {
      attempts += 1;
      throw new Error('persistent');
    },
    onPublished: () => assert.fail('failed work must not invalidate the last-good cache'),
    onRetainedLastGood: (_tab, _error, willRetry) => notices.push(willRetry),
    wait: async () => undefined,
    maxRetries: 1,
  });
  queue.enqueue('alice', ['series']);
  await queue.idle();
  assert.equal(attempts, 2);
  assert.deepEqual(notices, [true, false]);
});

test('a throwing failure notifier cannot abandon the queue or reject the flight', async () => {
  // Durable job bookkeeping runs in these notifiers and can throw on SQLITE_BUSY
  // while a VACUUM holds library.db. That must not reject `flight`, which nothing
  // catches outside idle(), and must not skip the rest of the batch.
  const refreshed: string[] = [];
  const faults: unknown[] = [];
  const queue = new CoalescingRecommendationRefreshQueue({
    refresh: async (work) => {
      refreshed.push(work.tab);
      if (work.tab === 'movies') throw new Error('rank deadline exceeded');
    },
    onPublished: () => { throw new Error('SQLITE_BUSY: database is locked'); },
    onRetainedLastGood: () => { throw new Error('SQLITE_BUSY: database is locked'); },
    onBookkeepingFault: (_work, error) => faults.push(error),
    wait: async () => undefined,
    maxRetries: 0,
  });
  queue.enqueue('household', ['movies', 'series']);
  await queue.idle();
  assert.deepEqual(refreshed, ['movies', 'series'], 'a notifier fault must not skip later work');
  assert.equal(faults.length, 2, 'both the failure and publish notices report their fault');
  assert.equal(
    faults.every((error) => error instanceof Error && /SQLITE_BUSY/.test(error.message)),
    true,
  );
});

test('a throwing publish notifier does not re-run an already published refresh', async () => {
  let calls = 0;
  const queue = new CoalescingRecommendationRefreshQueue({
    refresh: async () => { calls += 1; },
    onPublished: () => { throw new Error('SQLITE_BUSY: database is locked'); },
    onBookkeepingFault: () => undefined,
    wait: async () => undefined,
    maxRetries: 2,
  });
  queue.enqueue('household', ['movies']);
  await queue.idle();
  assert.equal(calls, 1, 'cache invalidation is not part of the refresh contract');
});

test('same tab work remains isolated across viewer profiles', async () => {
  const calls: RecommendationRefreshWork[] = [];
  const queue = new CoalescingRecommendationRefreshQueue({
    refresh: async (work) => { calls.push(work); },
    onPublished: () => undefined,
  });
  queue.enqueue('alice', ['movies', 'movies']);
  queue.enqueue('bob', ['movies', 'movies']);
  await queue.idle();
  assert.deepEqual(calls, [
    { profile_id: 'alice', tab: 'movies' },
    { profile_id: 'bob', tab: 'movies' },
  ]);
});

test('a same-key trigger arriving during retry is processed as distinct work', async () => {
  let calls = 0;
  let releaseRetryWait!: () => void;
  const retryWait = new Promise<void>((resolve) => { releaseRetryWait = resolve; });
  const queue = new CoalescingRecommendationRefreshQueue({
    refresh: async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
    },
    onPublished: () => undefined,
    wait: async () => retryWait,
    maxRetries: 1,
  });
  queue.enqueue('household', ['movies']);
  await Promise.resolve();
  await Promise.resolve();
  queue.enqueue('household', ['movies']);
  releaseRetryWait();
  await queue.idle();
  assert.equal(calls, 3, 'failed attempt, its retry, and the newer trigger all run');
});

test('keyed executor serializes one media type while allowing the other to run', async () => {
  const executor = new KeyedSerialExecutor<'movies' | 'series'>();
  let releaseMovie!: () => void;
  const movieGate = new Promise<void>((resolve) => { releaseMovie = resolve; });
  let noteMovieStarted!: () => void;
  const movieStarted = new Promise<void>((resolve) => { noteMovieStarted = resolve; });
  let noteSeriesStarted!: () => void;
  const seriesStarted = new Promise<void>((resolve) => { noteSeriesStarted = resolve; });
  const events: string[] = [];
  const movieOne = executor.run('movies', async () => {
    events.push('movie-one-start');
    noteMovieStarted();
    await movieGate;
    events.push('movie-one-end');
  });
  const movieTwo = executor.run('movies', async () => { events.push('movie-two'); });
  const series = executor.run('series', async () => {
    events.push('series');
    noteSeriesStarted();
  });
  await Promise.all([movieStarted, seriesStarted]);
  assert.deepEqual(events, ['movie-one-start', 'series']);
  releaseMovie();
  await Promise.all([movieOne, movieTwo, series]);
  assert.deepEqual(events, ['movie-one-start', 'series', 'movie-one-end', 'movie-two']);
});
