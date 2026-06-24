import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { growRunStatePath, recordGrowRunState } from './grow-run-state.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

test('recordGrowRunState writes operator-only grow progress and preserves run id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-grow-state-'));
  process.env.XDG_CACHE_HOME = dir;
  process.env.MANGO_OPS_RUN_ID = 'run-123';
  try {
    recordGrowRunState({
      phase: 'grow',
      rail_id: 'movies-comedy',
      grow_target: 20,
      fresh_verified: 3,
      message: 'grow movies-comedy: 3/20 verified',
    });
    recordGrowRunState({
      phase: 'grow',
      rail_id: 'movies-comedy',
      fresh_verified: 4,
    });

    const state = JSON.parse(await readFile(growRunStatePath(), 'utf8')) as {
      run_id: string;
      phase: string;
      rail_id: string;
      grow_target: number;
      fresh_verified: number;
    };
    assert.equal(state.run_id, 'run-123');
    assert.equal(state.phase, 'grow');
    assert.equal(state.rail_id, 'movies-comedy');
    assert.equal(state.grow_target, 20);
    assert.equal(state.fresh_verified, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
