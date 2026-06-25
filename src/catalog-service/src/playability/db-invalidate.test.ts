import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getOrCreateRailSession,
  getRailPlayabilityStatus,
  getTitlePlayability,
  invalidateTitle,
  quarantineLegacyBackgroundUncachedVerifiedTitles,
  recordVerifyResult,
  upsertRailPoolTitle,
} from './db.js';

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playability-db-'));
  const oldDb = process.env.MANGO_PLAYABILITY_DB;
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  try {
    await fn();
  } finally {
    if (oldDb === undefined) {
      delete process.env.MANGO_PLAYABILITY_DB;
    } else {
      process.env.MANGO_PLAYABILITY_DB = oldDb;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function addVerifiedPoolTitle(railId: string, id: string): Promise<void> {
  await upsertRailPoolTitle({
    rail_id: railId,
    type: 'movie',
    id,
    score: 100,
    title: `Title ${id}`,
  });
}

test('stale invalidation remains published until confirmed failure', async () => {
  await withTempDb(async () => {
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-stale-visible',
      status: 'verified',
      expires_at: Date.now() + 60_000,
    });
    await addVerifiedPoolTitle('movies-india-trending', 'tt-stale-visible');

    await invalidateTitle({
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-stale-visible',
      reason: 'verify_drift',
    });

    const title = await getTitlePlayability('movie', 'tt-stale-visible');
    assert.equal(title?.status, 'stale');
    const status = await getRailPlayabilityStatus('movies-india-trending');
    assert.equal(status.pool_depth, 1);
    assert.equal(status.stale, 1);

    const session = await getOrCreateRailSession({
      railId: 'movies-india-trending',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    assert.deepEqual(session.items.map((item) => item.id), ['tt-stale-visible']);
  });
});

test('play failure invalidation removes title from all rail pools and sessions', async () => {
  await withTempDb(async () => {
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-confirmed-fail',
      status: 'verified',
      expires_at: Date.now() + 60_000,
    });
    await addVerifiedPoolTitle('movies-india-trending', 'tt-confirmed-fail');
    await addVerifiedPoolTitle('ai-horror', 'tt-confirmed-fail');

    const beforeIndia = await getOrCreateRailSession({
      railId: 'movies-india-trending',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    const beforeHorror = await getOrCreateRailSession({
      railId: 'ai-horror',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    assert.equal(beforeIndia.items.length, 1);
    assert.equal(beforeHorror.items.length, 1);

    await invalidateTitle({
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-confirmed-fail',
      reason: 'play_failure',
    });

    const title = await getTitlePlayability('movie', 'tt-confirmed-fail');
    assert.equal(title?.status, 'failed');
    assert.equal(title?.fail_reason, 'play_failure');

    const indiaStatus = await getRailPlayabilityStatus('movies-india-trending');
    const horrorStatus = await getRailPlayabilityStatus('ai-horror');
    assert.equal(indiaStatus.pool_depth, 0);
    assert.equal(horrorStatus.pool_depth, 0);

    const afterIndia = await getOrCreateRailSession({
      railId: 'movies-india-trending',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    const afterHorror = await getOrCreateRailSession({
      railId: 'ai-horror',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    assert.equal(afterIndia.items.length, 0);
    assert.equal(afterHorror.items.length, 0);
  });
});

test('legacy background uncached quarantine preserves play-backed verified titles', async () => {
  await withTempDb(async () => {
    const now = Date.now();
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-bg-uncached',
      status: 'verified',
      cache_status: 'uncached',
      win_ladder_step: '1080p_uncached',
      expires_at: now + 60_000,
      stage: 'verify',
      outcome: 'verified',
    });
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-play-uncached',
      status: 'verified',
      cache_status: 'uncached',
      win_ladder_step: '1080p_uncached',
      expires_at: now + 60_000,
      stage: 'play',
      outcome: 'verified',
    });
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-bg-cached',
      status: 'verified',
      cache_status: 'cached',
      win_ladder_step: 'ideal',
      expires_at: now + 60_000,
      stage: 'verify',
      outcome: 'verified',
    });
    await addVerifiedPoolTitle('movies-quick-watches', 'tt-bg-uncached');
    await addVerifiedPoolTitle('movies-quick-watches', 'tt-play-uncached');
    await addVerifiedPoolTitle('movies-quick-watches', 'tt-bg-cached');

    const before = await getOrCreateRailSession({
      railId: 'movies-quick-watches',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    assert.equal(before.items.length, 3);

    const result = await quarantineLegacyBackgroundUncachedVerifiedTitles(now + 1);
    assert.deepEqual(result, { titles: 1, rail_pool: 1, rail_session: 1 });

    const quarantined = await getTitlePlayability('movie', 'tt-bg-uncached');
    const playBacked = await getTitlePlayability('movie', 'tt-play-uncached');
    const cached = await getTitlePlayability('movie', 'tt-bg-cached');
    assert.equal(quarantined?.status, 'failed');
    assert.equal(quarantined?.fail_reason, 'uncached_verify_legacy');
    assert.equal(playBacked?.status, 'verified');
    assert.equal(cached?.status, 'verified');

    const status = await getRailPlayabilityStatus('movies-quick-watches');
    assert.equal(status.pool_depth, 2);
    assert.equal(status.verified_pool, 2);

    const after = await getOrCreateRailSession({
      railId: 'movies-quick-watches',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    assert.deepEqual(after.items.map((item) => item.id).sort(), ['tt-bg-cached', 'tt-play-uncached']);
  });
});
