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
      grow_target: 20,
      fresh_verified: 4,
      message: 'grow movies-comedy: 4/20 verified',
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

test('recordGrowRunState does not leak stale rail outcome fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-grow-state-'));
  process.env.XDG_CACHE_HOME = dir;
  process.env.MANGO_OPS_RUN_ID = 'run-456';
  try {
    recordGrowRunState({
      phase: 'grow',
      rail_id: 'series-classics',
      message: 'grow series-classics: 1/20 short',
      grow_target: 20,
      fresh_verified: 1,
      ok: false,
      failure_category: 'theme_rejected',
    });
    recordGrowRunState({
      phase: 'grow',
      rail_id: 'series-miniseries',
      message: 'grow series-miniseries: starting 0/20',
      grow_target: 20,
      fresh_verified: 0,
    });

    const state = JSON.parse(await readFile(growRunStatePath(), 'utf8')) as Record<string, unknown>;
    assert.equal(state.run_id, 'run-456');
    assert.equal(state.rail_id, 'series-miniseries');
    assert.equal(state.fresh_verified, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'ok'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'failure_category'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recordGrowRunState preserves benchmark grow_per_pass', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-grow-state-'));
  process.env.XDG_CACHE_HOME = dir;
  process.env.MANGO_OPS_RUN_ID = 'run-789';
  process.env.MANGO_GROW_PER_PASS = '5';
  try {
    recordGrowRunState({
      phase: 'preflight',
      message: 'probing sources',
    });
    delete process.env.MANGO_GROW_PER_PASS;
    recordGrowRunState({
      phase: 'grow',
      rail_id: 'movies-comedy',
      message: 'grow movies-comedy',
    });

    const state = JSON.parse(await readFile(growRunStatePath(), 'utf8')) as Record<string, unknown>;
    assert.equal(state.run_id, 'run-789');
    assert.equal(state.grow_per_pass, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recordGrowRunState does not preserve benchmark grow_per_pass across run ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-grow-state-'));
  process.env.XDG_CACHE_HOME = dir;
  process.env.MANGO_OPS_RUN_ID = 'benchmark-run';
  process.env.MANGO_GROW_PER_PASS = '5';
  try {
    recordGrowRunState({
      phase: 'grow',
      message: 'benchmark grow',
    });

    process.env.MANGO_OPS_RUN_ID = 'production-run';
    delete process.env.MANGO_GROW_PER_PASS;
    recordGrowRunState({
      phase: 'grow',
      rail_id: 'series-miniseries',
      grow_target: 20,
      fresh_verified: 0,
      message: 'production grow',
    });

    const state = JSON.parse(await readFile(growRunStatePath(), 'utf8')) as Record<string, unknown>;
    assert.equal(state.run_id, 'production-run');
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'grow_per_pass'), false);
    assert.equal(state.grow_target, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
