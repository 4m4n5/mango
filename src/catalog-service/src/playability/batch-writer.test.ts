import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PlayabilityBatchWriter } from './batch-writer.js';
import { getPlayabilityDb, resetPlayabilityDbForTests } from './db.js';

const ENV = { ...process.env };

test.beforeEach(() => {
  resetPlayabilityDbForTests();
});

test.afterEach(() => {
  resetPlayabilityDbForTests();
  process.env = { ...ENV };
});

test('PlayabilityBatchWriter supports incremental flushes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-batch-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');

  const writer = new PlayabilityBatchWriter();
  assert.equal(writer.hasPending(), false);

  writer.queueVerify({
    type: 'movie',
    id: 'a',
    status: 'verified',
    rail_id: 'movies-global-popular',
    outcome: 'verified',
    probe_ms: 100,
    observed_at: 1_234,
  });
  assert.equal(writer.hasPending(), true);

  const first = await writer.flush();
  assert.equal(first.verify_count, 1);
  assert.equal(writer.hasPending(), false);
  const title = getPlayabilityDb().prepare(`
SELECT verified_at, first_verified_at, updated_at FROM titles WHERE type='movie' AND id='a'
`).get() as { verified_at: number; first_verified_at: number; updated_at: number };
  assert.deepEqual(title, { verified_at: 1_234, first_verified_at: 1_234, updated_at: 1_234 });

  writer.queuePool({
    rail_id: 'movies-global-popular',
    type: 'movie',
    id: 'a',
    score: 100,
  });
  const second = await writer.flush();
  assert.equal(second.pool_count, 1);
  assert.equal(second.verify_count, 0);
});
