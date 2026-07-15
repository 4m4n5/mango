import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  bumpPlayEpoch,
  PlayCancelledError,
  guardPlayMutation,
  readPlayEpoch,
  resetPlayEpochForTest,
} from './play-cancel.js';
import { cancelPlayRequest, registerPlayRequest, resetPlayRequestRegistryForTest } from './play-request-registry.js';
import { defaultPlayLadder, splitLegacyPlayLadder } from './play-ladder.js';
import { playWithLadder } from './play-orchestrator.js';
import { defaultFilterConfig, mergeFilterConfig } from './stream-filters.js';

test('a superseded delayed PASS performs zero post-play mutations', async () => {
  const writes: string[] = [];
  await assert.rejects(
    guardPlayMutation(
      7,
      () => writes.push('verify'),
      async () => { throw new PlayCancelledError(); },
    ),
    PlayCancelledError,
  );
  assert.deepEqual(writes, []);
});

test('a current PASS may perform its post-play mutation', async () => {
  const writes: string[] = [];
  await guardPlayMutation(8, () => writes.push('watch'), async () => undefined);
  assert.deepEqual(writes, ['watch']);
});

test('concurrent epoch bumps persist monotonically without an older write winning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-play-epoch-'));
  const path = join(dir, 'play-cancel.epoch');
  const priorPath = process.env.MANGO_PLAY_CANCEL_PATH;
  process.env.MANGO_PLAY_CANCEL_PATH = path;
  try {
    await resetPlayEpochForTest();
    const epochs = await Promise.all(Array.from({ length: 20 }, () => bumpPlayEpoch()));
    assert.equal(new Set(epochs).size, epochs.length);
    const maximum = Math.max(...epochs);
    assert.equal(await readPlayEpoch(), maximum);
    assert.equal(Number((await readFile(path, 'utf8')).trim()), maximum);
  } finally {
    await resetPlayEpochForTest();
    if (priorPath === undefined) delete process.env.MANGO_PLAY_CANCEL_PATH;
    else process.env.MANGO_PLAY_CANCEL_PATH = priorPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('request-scoped cancellation prevents a delayed resolve from invoking play', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-play-cancel-integration-'));
  const priorPath = process.env.MANGO_PLAY_CANCEL_PATH;
  process.env.MANGO_PLAY_CANCEL_PATH = join(dir, 'play-cancel.epoch');
  resetPlayRequestRegistryForTest();
  try {
    await resetPlayEpochForTest();
    const epoch = await bumpPlayEpoch();
    const requestId = 'play-cancel-integration';
    registerPlayRequest(requestId, epoch);
    let releasePreflight: (() => void) | undefined;
    const preflightBlocked = new Promise<void>((resolvePromise) => {
      releasePreflight = resolvePromise;
    });
    let markPreflightEntered: (() => void) | undefined;
    const preflightEntered = new Promise<void>((resolvePromise) => {
      markPreflightEntered = resolvePromise;
    });
    let playCalls = 0;
    const ladder = defaultPlayLadder();
    const split = splitLegacyPlayLadder(ladder);
    const config = mergeFilterConfig({
      ...defaultFilterConfig(),
      play_ladder: ladder,
      main_ladder: split.main_ladder,
      last_resort_ladder: split.last_resort_ladder,
      strict_unknown_cache: false,
    });
    const pending = playWithLadder([{
      url: 'https://example.test/movie.mkv',
      source: 'AIOStreams',
      title: '[TB⚡] Torrentio 1080p',
      description: 'WEB-DL 1080p',
      behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
    }], config, {
      playEpoch: epoch,
      preflight: async () => {
        markPreflightEntered?.();
        await preflightBlocked;
        return 'video';
      },
      probe: async () => ({ ok: true, ttff_ms: 100, duration_sec: 5400 }),
      play: async () => {
        playCalls += 1;
        return { ok: true, ttff_ms: 100 };
      },
    });

    await preflightEntered;
    const cancelled = await cancelPlayRequest(requestId);
    assert.equal(cancelled.cancelled, true);
    assert.ok(cancelled.epoch > epoch);
    releasePreflight?.();
    await assert.rejects(pending, PlayCancelledError);
    assert.equal(playCalls, 0);
  } finally {
    resetPlayRequestRegistryForTest();
    await resetPlayEpochForTest();
    if (priorPath === undefined) delete process.env.MANGO_PLAY_CANCEL_PATH;
    else process.env.MANGO_PLAY_CANCEL_PATH = priorPath;
    await rm(dir, { recursive: true, force: true });
  }
});
