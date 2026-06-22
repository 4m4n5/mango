import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PlayabilityBatchWriter } from './batch-writer.js';

const ENV = { ...process.env };

test.afterEach(() => {
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
  });
  assert.equal(writer.hasPending(), true);

  const first = await writer.flush();
  assert.equal(first.verify_count, 1);
  assert.equal(writer.hasPending(), false);

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
