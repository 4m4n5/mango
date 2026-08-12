import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getPlayabilityDb,
  getStaleTitlesForRefresh,
  invalidateTitle,
  recordVerifyResult,
  resetPlayabilityDbForTests,
} from './db.js';

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playability-retry-'));
  const priorDb = process.env.MANGO_PLAYABILITY_DB;
  const priorBootstrap = process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    if (priorDb === undefined) delete process.env.MANGO_PLAYABILITY_DB;
    else process.env.MANGO_PLAYABILITY_DB = priorDb;
    if (priorBootstrap === undefined) delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
    else process.env.MANGO_PLAYABILITY_BOOTSTRAP = priorBootstrap;
    await rm(dir, { recursive: true, force: true });
  }
}

test('retry queue applies cause-specific exponential backoff', async () => {
  await withTempDb(async () => {
    delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
    await recordVerifyResult({
      type: 'movie', id: 'tt-no-stream', status: 'failed', fail_reason: 'no_stream',
    });
    await recordVerifyResult({
      type: 'movie', id: 'tt-no-stream', status: 'failed', fail_reason: 'no_stream',
    });
    const row = getPlayabilityDb().prepare(`
SELECT attempt_count, last_attempt_at, next_eligible_at
FROM playability_retry_queue WHERE type='movie' AND id='tt-no-stream'
`).get() as { attempt_count: number; last_attempt_at: number; next_eligible_at: number };
    assert.equal(row.attempt_count, 2);
    assert.ok(row.next_eligible_at - row.last_attempt_at >= 14 * 24 * 60 * 60 * 1000);
    assert.deepEqual(await getStaleTitlesForRefresh(), []);
  });
});

test('due queue is priority ordered and bounded across stale and play-failure rows', async () => {
  await withTempDb(async () => {
    process.env.MANGO_PLAYABILITY_BOOTSTRAP = '1';
    await recordVerifyResult({
      type: 'movie', id: 'tt-long-tail', status: 'stale', fail_reason: 'expired_stale',
    });
    await invalidateTitle({
      rail_id: 'movies-active', type: 'movie', id: 'tt-play-failure', reason: 'play_failure',
    });
    const due = await getStaleTitlesForRefresh(1, Date.now() + 10);
    assert.equal(due.length, 1);
    assert.equal(due[0]?.id, 'tt-play-failure');
    assert.equal(due[0]?.reason, 'play_failure');
  });
});

test('a verified result removes its retry obligation without mass legacy work', async () => {
  await withTempDb(async () => {
    await recordVerifyResult({
      type: 'movie', id: 'tt-natural-touch', status: 'stale', fail_reason: 'play_miss',
    });
    assert.equal((await getStaleTitlesForRefresh()).length, 1);
    await recordVerifyResult({ type: 'movie', id: 'tt-natural-touch', status: 'verified' });
    const count = getPlayabilityDb().prepare(`
SELECT COUNT(*) AS count FROM playability_retry_queue WHERE id='tt-natural-touch'
`).get() as { count: number };
    assert.equal(count.count, 0);
  });
});

test('legacy episode-shaped series rows are excluded from discovery retries', async () => {
  await withTempDb(async () => {
    process.env.MANGO_PLAYABILITY_BOOTSTRAP = '1';
    await recordVerifyResult({
      type: 'series', id: 'tt1234567:1:2', status: 'stale', fail_reason: 'expired_stale',
    });
    assert.deepEqual(await getStaleTitlesForRefresh(), []);
  });
});
