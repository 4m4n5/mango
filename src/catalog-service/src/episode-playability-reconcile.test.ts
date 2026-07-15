import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyEpisodePlayability, type SeriesSeasonBlock } from './episodes.js';
import { reconcileSuccessfulEpisodePlayability } from './episode-playability-reconcile.js';
import {
  getTitlePlayability,
  getTitlesPlayabilityBulk,
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
