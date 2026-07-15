import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CatalogCore } from '../core.js';
import type { VerifyTitleOptions, VerifyTitleResult } from './verify.js';
import type { AssignVerifiedTitleResult, RethemeCore } from './rail-pool-retheme.js';
import {
  enqueuePlayabilityTrigger,
  listUnhandledPlayabilityTriggers,
  resetPlayabilityDbForTests,
} from './db.js';
import {
  drainTriggers,
  isCouchIdleForTriggerConsumer,
  isPlaybackActiveForTriggerConsumer,
} from './trigger-consumer.js';

async function withPlaybackStateEnv(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playback-state-'));
  const keys = [
    'MANGO_COUCH_ACTIVITY_STATE',
    'MANGO_PLAYBACK_ACTIVE_FILE',
    'MANGO_MPV_PID_FILE',
    'MANGO_MPV_SOCKET',
  ] as const;
  const old = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.MANGO_COUCH_ACTIVITY_STATE = join(dir, 'couch.json');
  process.env.MANGO_PLAYBACK_ACTIVE_FILE = join(dir, 'playback-active');
  process.env.MANGO_MPV_PID_FILE = join(dir, 'mpv.pid');
  process.env.MANGO_MPV_SOCKET = join(dir, 'mpv.sock');
  try {
    await fn(dir);
  } finally {
    for (const key of keys) {
      const value = old.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-trigger-consumer-'));
  const oldDb = process.env.MANGO_PLAYABILITY_DB;
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    if (oldDb === undefined) {
      delete process.env.MANGO_PLAYABILITY_DB;
    } else {
      process.env.MANGO_PLAYABILITY_DB = oldDb;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

const fakeCore = {} as CatalogCore;

test('S2: a live tracked playback process is hard non-idle despite a stale activity timestamp', async () => {
  await withPlaybackStateEnv(async (dir) => {
    const server = createServer();
    await writeFile(join(dir, 'mpv.pid'), `${process.pid}\n`);
    await writeFile(join(dir, 'playback-active'), '');
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(join(dir, 'mpv.sock'), () => resolvePromise());
    });
    await writeFile(join(dir, 'couch.json'), JSON.stringify({ ts: Date.now() - 31 * 60_000 }));
    try {
      assert.equal(isPlaybackActiveForTriggerConsumer(), true);
      assert.equal(isCouchIdleForTriggerConsumer(), false);
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });
});

test('S2: a live unrelated PID without the Mango socket is not playback-active', async () => {
  await withPlaybackStateEnv(async (dir) => {
    await writeFile(join(dir, 'mpv.pid'), `${process.pid}\n`);
    await writeFile(join(dir, 'couch.json'), JSON.stringify({ ts: Date.now() - 31 * 60_000 }));
    assert.equal(isPlaybackActiveForTriggerConsumer(), false);
    assert.equal(isCouchIdleForTriggerConsumer(), true);
  });
});

test('S2: stale playback PID does not permanently block idle maintenance', async () => {
  await withPlaybackStateEnv(async (dir) => {
    const server = createServer();
    await writeFile(join(dir, 'mpv.pid'), '99999999\n');
    await writeFile(join(dir, 'playback-active'), '');
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(join(dir, 'mpv.sock'), () => resolvePromise());
    });
    await writeFile(join(dir, 'couch.json'), JSON.stringify({ ts: Date.now() - 31 * 60_000 }));
    try {
      assert.equal(isPlaybackActiveForTriggerConsumer(), false);
      assert.equal(isCouchIdleForTriggerConsumer(), true);
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });
});

function verifyResult(type: string, id: string, status: 'verified' | 'failed'): VerifyTitleResult {
  return {
    type,
    id,
    ok: status === 'verified',
    status,
    attempts: [],
  };
}

test('H1: drainTriggers probes each distinct title once, sets handled_at, and promotes on success', async () => {
  await withTempDb(async () => {
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-ok',
      reason: 'voice_request:Ok Movie',
    });
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-fail',
      reason: 'voice_request:Fail Movie',
    });

    const verifyCalls: string[] = [];
    const promoteCalls: string[] = [];
    const fakeVerify = async (
      _core: CatalogCore,
      type: string,
      id: string,
      _options: VerifyTitleOptions,
    ): Promise<VerifyTitleResult> => {
      verifyCalls.push(`${type}:${id}`);
      return verifyResult(type, id, id === 'tt-ok' ? 'verified' : 'failed');
    };
    const fakePromote = async (
      _core: RethemeCore,
      input: { type: string; id: string; preferredRailId?: string | null },
    ): Promise<AssignVerifiedTitleResult> => {
      promoteCalls.push(`${input.type}:${input.id}`);
      return {
        ok: true,
        rail_id: input.preferredRailId ?? 'movies-india-trending',
        type: input.type,
        id: input.id,
        score: 10,
        reason: 'preferred_fit',
      };
    };

    const result = await drainTriggers(fakeCore, {
      verify: fakeVerify as unknown as typeof import('./verify.js').verifyTitle,
      promote: fakePromote as unknown as typeof import('./rail-pool-retheme.js').assignVerifiedTitleToBestRail,
    });

    assert.equal(result.drained, 2);
    assert.equal(result.verified, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.promoted, 1);
    assert.deepEqual(verifyCalls.sort(), ['movie:tt-fail', 'movie:tt-ok']);
    assert.deepEqual(promoteCalls, ['movie:tt-ok']);

    const remaining = await listUnhandledPlayabilityTriggers(10);
    assert.equal(remaining.length, 0);
  });
});

test('H1: drainTriggers dedupes multiple triggers for the same title into one verify call', async () => {
  await withTempDb(async () => {
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-dup',
      reason: 'voice_request:First',
    });
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-dup',
      reason: 'voice_request:Second',
    });

    let verifyCallCount = 0;
    const fakeVerify = async (
      _core: CatalogCore,
      type: string,
      id: string,
    ): Promise<VerifyTitleResult> => {
      verifyCallCount += 1;
      return verifyResult(type, id, 'verified');
    };

    const result = await drainTriggers(fakeCore, {
      verify: fakeVerify as unknown as typeof import('./verify.js').verifyTitle,
      promote: (async () => ({
        ok: true,
        rail_id: 'movies-india-trending',
        type: 'movie',
        id: 'tt-dup',
        score: 10,
        reason: 'preferred_fit',
      })) as unknown as typeof import('./rail-pool-retheme.js').assignVerifiedTitleToBestRail,
    });

    assert.equal(verifyCallCount, 1);
    assert.equal(result.drained, 1);
    assert.equal(result.verified, 1);

    const remaining = await listUnhandledPlayabilityTriggers(10);
    assert.equal(remaining.length, 0);
  });
});

test('H1: drainTriggers marks rail-only trigger rows handled without probing', async () => {
  await withTempDb(async () => {
    await enqueuePlayabilityTrigger({
      trigger_type: 'pool_low',
      rail_id: 'movies-india-trending',
      reason: 'pool=1 target=20',
    });

    let verifyCalled = false;
    const result = await drainTriggers(fakeCore, {
      verify: (async (_core: CatalogCore, type: string, id: string) => {
        verifyCalled = true;
        return verifyResult(type, id, 'verified');
      }) as unknown as typeof import('./verify.js').verifyTitle,
    });

    assert.equal(verifyCalled, false);
    assert.equal(result.drained, 0);
    assert.deepEqual(result.by_trigger_type, { pool_low: 1 });

    const remaining = await listUnhandledPlayabilityTriggers(10);
    assert.equal(remaining.length, 0);
  });
});

test('H2: drainTriggers processes play_failure_reverify ahead of voice_request when batch-limited', async () => {
  await withTempDb(async () => {
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-voice',
      reason: 'voice_request:Some Movie',
    });
    await enqueuePlayabilityTrigger({
      trigger_type: 'play_failure_reverify',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-couch-fail',
      reason: 'play_failure',
    });

    const verifyCalls: string[] = [];
    const result = await drainTriggers(fakeCore, {
      limit: 1,
      verify: (async (_core: CatalogCore, type: string, id: string) => {
        verifyCalls.push(`${type}:${id}`);
        return verifyResult(type, id, 'verified');
      }) as unknown as typeof import('./verify.js').verifyTitle,
      promote: (async (_core: RethemeCore, input: { type: string; id: string }) => ({
        ok: true,
        rail_id: 'movies-india-trending',
        type: input.type,
        id: input.id,
        score: 10,
        reason: 'preferred_fit',
      })) as unknown as typeof import('./rail-pool-retheme.js').assignVerifiedTitleToBestRail,
    });

    assert.deepEqual(verifyCalls, ['movie:tt-couch-fail']);
    assert.equal(result.drained, 1);

    const remaining = await listUnhandledPlayabilityTriggers(10);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].trigger_type, 'voice_request');
  });
});

test('H1: drainTriggers marks a row handled even when the verify pipeline throws', async () => {
  await withTempDb(async () => {
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-throws',
      reason: 'voice_request:Throws',
    });

    const result = await drainTriggers(fakeCore, {
      verify: (async () => {
        throw new Error('boom');
      }) as unknown as typeof import('./verify.js').verifyTitle,
    });

    assert.equal(result.failed, 1);
    const remaining = await listUnhandledPlayabilityTriggers(10);
    assert.equal(remaining.length, 0);
  });
});
