import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyEpisodePlayability, type SeriesSeasonBlock } from './episodes.js';
import {
  reconcileFailedEpisodePlayability,
  reconcileSuccessfulEpisodePlayability,
} from './episode-playability-reconcile.js';
import {
  getTitlePlayability,
  getTitlesPlayabilityBulk,
  listUnhandledPlayabilityTriggers,
  recordVerifyResult,
  resetPlayabilityDbForTests,
} from './playability/db.js';

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-episode-playability-'));
  const oldDb = process.env.MANGO_PLAYABILITY_DB;
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    if (oldDb === undefined) delete process.env.MANGO_PLAYABILITY_DB;
    else process.env.MANGO_PLAYABILITY_DB = oldDb;
    await rm(dir, { recursive: true, force: true });
  }
}

function episodeSeason(id = 'tt12004706:2:4'): SeriesSeasonBlock[] {
  return [{
    season: 2,
    label: 'Season 2',
    episodes: [{
      id,
      season: 2,
      episode: 4,
      title: 'Episode 4',
      progress_pct: null,
      position_sec: null,
      playable: null,
    }],
  }];
}

test('successful auto play clears a stale failed non-gate episode row', async () => {
  await withTempDb(async () => {
    const id = 'tt12004706:2:4';
    await recordVerifyResult({
      type: 'series',
      id,
      status: 'failed',
      fail_reason: 'no_stream',
      stage: 'verify',
      outcome: 'failed',
    });

    const wrote = await reconcileSuccessfulEpisodePlayability({
      contentType: 'series',
      playId: id,
      playMode: 'auto',
      usePlayabilityIndex: false,
      playEpoch: 42,
      playback: {
        ok: true,
        win_on_main: true,
        stream: {
          source: 'AIOStreams',
          cache_status: 'cached',
          debrid_service: 'torbox',
        },
        probe_ms: 125,
        win_url_hash: 'fresh-win',
        win_ladder_step: 'ideal',
      },
    }, {
      assertCurrent: async () => undefined,
      now: () => 10_000,
      verifyTtlMs: () => 60_000,
    });

    assert.equal(wrote, true);
    assert.equal((await getTitlePlayability('series', id))?.status, 'verified');
    const seasons = episodeSeason(id);
    applyEpisodePlayability(
      seasons,
      await getTitlesPlayabilityBulk([{ type: 'series', id }]),
      10_001,
    );
    assert.equal(seasons[0]?.episodes[0]?.playable, true);
  });
});

test('failed or picker episode plays never write verified state', async () => {
  const writes: unknown[] = [];
  const base = {
    contentType: 'series',
    playId: 'tt12004706:2:4',
    usePlayabilityIndex: false,
    playEpoch: 42,
  } as const;
  const dependencies = {
    assertCurrent: async () => undefined,
    writeResult: async (record: unknown) => { writes.push(record); },
  };

  assert.equal(await reconcileSuccessfulEpisodePlayability({
    ...base,
    playMode: 'auto',
    playback: { ok: false, stream: {} },
  }, dependencies), false);
  assert.equal(await reconcileSuccessfulEpisodePlayability({
    ...base,
    playMode: 'picker',
    playback: { ok: true, stream: {} },
  }, dependencies), false);
  assert.equal(await reconcileSuccessfulEpisodePlayability({
    ...base,
    playMode: 'auto',
    playback: { ok: true, win_on_main: false, stream: {} },
  }, dependencies), false);
  assert.equal(await reconcileSuccessfulEpisodePlayability({
    ...base,
    identityCertifiable: false,
    playMode: 'auto',
    playback: { ok: true, win_on_main: true, stream: {} },
  }, dependencies), false);
  assert.deepEqual(writes, []);
});

test('bare and :1:1 rail-gate series behavior stays on the existing path', async () => {
  const writes: unknown[] = [];
  const dependencies = {
    assertCurrent: async () => undefined,
    writeResult: async (record: unknown) => { writes.push(record); },
  };
  for (const playId of ['tt12004706', 'tt12004706:1:1']) {
    assert.equal(await reconcileSuccessfulEpisodePlayability({
      contentType: 'series',
      playId,
      playMode: 'auto',
      usePlayabilityIndex: true,
      playEpoch: 42,
      playback: { ok: true, stream: {} },
    }, dependencies), false);
  }
  assert.deepEqual(writes, []);
});

test('a transient overall exact-episode miss hides that episode and queues an exact recheck', async () => {
  const mutations: string[] = [];
  const action = await reconcileFailedEpisodePlayability({
    contentType: 'series',
    playId: 'tt12004706:2:4',
    playMode: 'auto',
    usePlayabilityIndex: false,
    playEpoch: 42,
    isNoPlayableStream: true,
    attempts: [{ error: 'timeout' }],
    candidates: 1,
    obligationFloorRan: true,
  }, {
    assertCurrent: async () => undefined,
    readState: async () => null,
    demote: async () => { mutations.push('demote'); },
    invalidate: async () => { mutations.push('invalidate'); },
    enqueue: async (record) => { mutations.push(`enqueue:${record.id}:${record.reason}`); },
  });

  assert.equal(action, 'stale');
  assert.deepEqual(mutations, ['demote', 'enqueue:tt12004706:2:4:play_miss']);
});

test('an exact-episode infrastructure failure hides and queues an exact recheck', async () => {
  const mutations: string[] = [];
  const action = await reconcileFailedEpisodePlayability({
    contentType: 'series',
    playId: 'tt12004706:2:4',
    playMode: 'auto',
    usePlayabilityIndex: false,
    playEpoch: 42,
    isNoPlayableStream: false,
  }, {
    assertCurrent: async () => undefined,
    readState: async () => null,
    demote: async () => { mutations.push('demote'); },
    invalidate: async () => { mutations.push('invalidate'); },
    enqueue: async (record) => { mutations.push(`enqueue:${record.id}:${record.reason}`); },
  });

  assert.equal(action, 'stale');
  assert.deepEqual(mutations, ['demote', 'enqueue:tt12004706:2:4:play_miss']);
});

test('a picker exact-episode terminal failure hides and queues an exact recheck', async () => {
  const mutations: string[] = [];
  const action = await reconcileFailedEpisodePlayability({
    contentType: 'series',
    playId: 'tt12004706:2:4',
    playMode: 'picker',
    usePlayabilityIndex: false,
    playEpoch: 42,
    isNoPlayableStream: false,
    attempts: [{ error: 'mpv-play failed: HTTP error 403' }],
    candidates: 1,
  }, {
    assertCurrent: async () => undefined,
    readState: async () => null,
    demote: async () => { mutations.push('demote'); },
    invalidate: async () => { mutations.push('invalidate'); },
    enqueue: async (record) => { mutations.push(`enqueue:${record.id}:${record.reason}`); },
  });

  assert.equal(action, 'stale');
  assert.deepEqual(mutations, ['demote', 'enqueue:tt12004706:2:4:play_miss']);
});

test('a cancelled exact-episode play does not mutate or requeue playability', async () => {
  const mutations: string[] = [];
  const action = await reconcileFailedEpisodePlayability({
    contentType: 'series',
    playId: 'tt12004706:2:4',
    playMode: 'auto',
    usePlayabilityIndex: false,
    playEpoch: 42,
    isNoPlayableStream: true,
    attempts: [{ error: 'play cancelled' }],
    candidates: 1,
  }, {
    assertCurrent: async () => undefined,
    readState: async () => null,
    demote: async () => { mutations.push('demote'); },
    invalidate: async () => { mutations.push('invalidate'); },
    enqueue: async (record) => { mutations.push(`enqueue:${record.id}:${record.reason}`); },
  });

  assert.equal(action, null);
  assert.deepEqual(mutations, []);
});

test('confirmed exact-episode misses become stale then failed without demoting the show', async () => {
  await withTempDb(async () => {
    const showId = 'tt12004706';
    const episodeId = `${showId}:2:4`;
    await recordVerifyResult({
      type: 'series',
      id: showId,
      status: 'verified',
      stage: 'verify',
      outcome: 'verified',
    });
    const miss = {
      contentType: 'series',
      playId: episodeId,
      playMode: 'auto' as const,
      usePlayabilityIndex: false,
      playEpoch: 42,
      isNoPlayableStream: true,
      attempts: [{ error: 'debrid_copyright_block' }],
      candidates: 1,
      obligationFloorRan: true,
    };
    const dependencies = { assertCurrent: async () => undefined };

    assert.equal(await reconcileFailedEpisodePlayability(miss, dependencies), 'stale');
    const episodeState = await getTitlePlayability('series', episodeId);
    assert.deepEqual(episodeState, {
      type: 'series',
      id: episodeId,
      status: 'stale',
      fail_reason: 'play_miss',
      verified_at: null,
      expires_at: null,
      updated_at: episodeState?.updated_at,
    });
    assert.equal((await getTitlePlayability('series', showId))?.status, 'verified');

    assert.equal(await reconcileFailedEpisodePlayability(miss, dependencies), 'failed');
    assert.equal((await getTitlePlayability('series', episodeId))?.status, 'failed');
    assert.equal((await getTitlePlayability('series', episodeId))?.fail_reason, 'play_failure');
    assert.equal((await getTitlePlayability('series', showId))?.status, 'verified');
    const triggers = await listUnhandledPlayabilityTriggers(20);
    const fastLane = triggers.filter((row) => row.trigger_type === 'play_failure_reverify');
    assert.equal(fastLane.length, 2);
    assert.ok(fastLane.every((row) => row.id_value === episodeId && row.rail_id === null));
  });
});
