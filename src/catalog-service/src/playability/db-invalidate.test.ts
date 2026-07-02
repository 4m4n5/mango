import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  getOrCreateRailSession,
  getRailPoolTitleKeys,
  getRailPlayabilityStatus,
  getTitlePlayability,
  invalidateTitle,
  initPlayabilityDb,
  listLinkableVerifiedForRail,
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

test('series browse ids are canonicalized and representative verify status mirrors to bare ids', async () => {
  await withTempDb(async () => {
    await recordVerifyResult({
      type: 'series',
      id: 'tt33094114:1:1',
      status: 'verified',
      expires_at: Date.now() + 60_000,
    });
    await upsertRailPoolTitle({
      rail_id: 'series-global-popular',
      type: 'series',
      id: 'tt33094114:1:1',
      score: 100,
      title: "India's Got Latent",
    });

    const mirrored = await getTitlePlayability('series', 'tt33094114');
    assert.equal(mirrored?.status, 'verified');

    const keys = await getRailPoolTitleKeys('series-global-popular');
    assert.deepEqual([...keys], ['series:tt33094114']);

    const session = await getOrCreateRailSession({
      railId: 'series-global-popular',
      sessionId: 'session-1',
      displayLimit: 9,
    });
    assert.deepEqual(session.items.map((item) => item.id), ['tt33094114']);

    const linked = await listLinkableVerifiedForRail('series-classics', 'series', 10);
    assert.equal(linked.some((item) => item.id === 'tt33094114:1:1'), false);
    assert.equal(linked.some((item) => item.id === 'tt33094114'), true);
  });
});

test('initPlayabilityDb repairs legacy series episode ids in pool and sessions', async () => {
  await withTempDb(async () => {
    await initPlayabilityDb();
    const db = new Database(process.env.MANGO_PLAYABILITY_DB as string);
    const now = Date.now();
    try {
      db.prepare('DELETE FROM playability_migrations WHERE version = 7').run();
      db.prepare(`
INSERT INTO titles (
  type, id, status, verified_at, expires_at, fail_reason, best_source,
  cache_status, debrid_service, probe_ms, win_url_hash, win_ladder_step, updated_at
) VALUES (
  'series', 'tt35077054:1:1', 'verified', @verified_at, @expires_at, NULL, 'AIOStreams',
  'cached', 'torbox', 1000, 'hash-1', 'ideal', @updated_at
)
`).run({
        verified_at: now,
        expires_at: now + 60_000,
        updated_at: now,
      });
      db.prepare(`
INSERT INTO rail_pool (rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES ('series-global-popular', 'series', 'tt35077054:1:1', 100, @ingested_at, NULL, NULL, NULL)
`).run({ ingested_at: now });
      db.prepare(`
INSERT INTO rail_session (rail_id, type, id, slot, mix_bucket, session_id, created_at)
VALUES ('series-global-popular', 'series', 'tt35077054:1:1', 0, 'fresh', 'legacy-session', @created_at)
`).run({ created_at: now });
      db.prepare(`
INSERT INTO recently_shown (rail_id, type, id, shown_at)
VALUES ('series-global-popular', 'series', 'tt35077054:1:1', @shown_at)
`).run({ shown_at: now });
    } finally {
      db.close();
    }

    await initPlayabilityDb();

    const keys = await getRailPoolTitleKeys('series-global-popular');
    assert.deepEqual([...keys], ['series:tt35077054']);

    const mirrored = await getTitlePlayability('series', 'tt35077054');
    assert.equal(mirrored?.status, 'verified');

    const repairedDb = new Database(process.env.MANGO_PLAYABILITY_DB as string, { readonly: true });
    try {
      const poolIds = repairedDb.prepare(`
SELECT id FROM rail_pool WHERE rail_id = 'series-global-popular' AND type = 'series' ORDER BY id
`).all() as Array<{ id: string }>;
      assert.deepEqual(poolIds.map((row) => row.id), ['tt35077054']);

      const sessionIds = repairedDb.prepare(`
SELECT id FROM rail_session WHERE rail_id = 'series-global-popular' AND type = 'series'
`).all() as Array<{ id: string }>;
      assert.equal(sessionIds.length, 0);
    } finally {
      repairedDb.close();
    }
  });
});
