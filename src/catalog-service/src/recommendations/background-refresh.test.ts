import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CoalescingRecommendationRefreshQueue,
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
