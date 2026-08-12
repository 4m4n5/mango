import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  allocateTabRailSessions,
  allocateVodExploreSession,
  getPlayabilityDb,
  getPlayabilityStatus,
  initPlayabilityDb,
  prepareVodBrowseReservoirV3,
  persistVodTabDealV3,
  readVodTabDealV3,
  resetPlayabilityDbForTests,
} from './db.js';

const CAPPED_GROWTH_POLICY = {
  display_limit: 9,
  display_max: 9,
  min_display: 6,
  ingest_multiplier: 5,
  pool_target: 60,
  pool_growth_per_refresh: 10,
  pool_max: 120,
  grow_per_pass: 20,
};

const ENV = { ...process.env };

async function withBrowseDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-vod-browse-v3-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_REPO_DIR = join(process.cwd(), '../..');
  resetPlayabilityDbForTests();
  try {
    await initPlayabilityDb();
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    process.env = { ...ENV };
    await rm(dir, { recursive: true, force: true });
  }
}

test('Explore deals from the complete verified artwork corpus with deterministic positive weights', async () => {
  await withBrowseDb(async () => {
    const db = getPlayabilityDb();
    const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, verified_at, first_verified_at, best_source, updated_at)
VALUES ('movie', ?, 'verified', ?, ?, 'fixture', ?)
`);
    const insertEvidence = db.prepare(`
INSERT INTO title_story_evidence(type, id, title, poster_url, year, updated_at)
VALUES ('movie', ?, ?, ?, '2026', ?)
`);
    const now = Date.now();
    db.transaction(() => {
      for (let index = 0; index < 40; index += 1) {
        const id = `tt${String(index).padStart(7, '0')}`;
        insertTitle.run(id, now, now - index * 86_400_000, now);
        insertEvidence.run(id, `Title ${index}`, `https://img/${id}.jpg`, now);
      }
    })();
    await prepareVodBrowseReservoirV3({
      tab: 'movies',
      rails: [],
      affinityRevision: 'fixture-rank-1',
    });
    const excluded = new Set(['movie:tt0000000']);
    const occupied = new Set(['movie:tt0000001']);
    const first = await allocateVodExploreSession({
      tab: 'movies', sessionId: 'session-a', displayLimit: 9,
      seed: 'movies:deal:0', excludedKeys: excluded, occupiedKeys: occupied,
    });
    const replay = await allocateVodExploreSession({
      tab: 'movies', sessionId: 'session-a', displayLimit: 9,
      seed: 'movies:deal:0', excludedKeys: excluded, occupiedKeys: occupied,
    });
    assert.equal(first.verified_pool, 38);
    assert.equal(first.items.length, 9);
    assert.deepEqual(first.items.map((item) => item.id), replay.items.map((item) => item.id));
    assert.equal(new Set(first.items.map((item) => item.id)).size, 9);
    assert.ok(first.items.every((item) => item.score > 0));
    assert.ok(first.items.every((item) => !excluded.has(`${item.type}:${item.id}`)));
    assert.ok(first.items.every((item) => !occupied.has(`${item.type}:${item.id}`)));
  });
});

test('atomic tab deals retain one previous generation and reject stale concurrent commits', async () => {
  await withBrowseDb(async () => {
    const firstEpoch = await persistVodTabDealV3({
      tab: 'movies', session_id: 's0', recommendation_revision: 1,
      payload_json: '{"tab":"movies","rails":[],"resolve_ms":0}',
      expected_previous_epoch: null,
    });
    assert.equal(firstEpoch, 0);
    const secondEpoch = await persistVodTabDealV3({
      tab: 'movies', session_id: 's1', recommendation_revision: 1,
      payload_json: '{"tab":"movies","rails":[{"rail_id":"explore"}],"resolve_ms":0}',
      expected_previous_epoch: 0,
    });
    assert.equal(secondEpoch, 1);
    assert.equal((await readVodTabDealV3('movies', 'active'))?.deal_epoch, 1);
    assert.equal((await readVodTabDealV3('movies', 'previous'))?.deal_epoch, 0);
    await assert.rejects(() => persistVodTabDealV3({
      tab: 'movies', session_id: 'stale', recommendation_revision: 1,
      payload_json: '{}', expected_previous_epoch: 0,
    }), /changed while movies was being dealt/);
    assert.equal((await readVodTabDealV3('movies', 'active'))?.deal_epoch, 1);
  });
});

test('serve-time category deals read the published reservoir without rescanning source membership', async () => {
  await withBrowseDb(async () => {
    const db = getPlayabilityDb();
    const now = Date.now();
    const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, verified_at, first_verified_at, best_source, updated_at)
VALUES ('movie', ?, 'verified', ?, ?, 'fixture', ?)
`);
    const insertEvidence = db.prepare(`
INSERT INTO title_story_evidence(type, id, title, poster_url, year, updated_at)
VALUES ('movie', ?, ?, ?, '2026', ?)
`);
    const insertMembership = db.prepare(`
INSERT INTO rail_pool(rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES ('movies-global-popular', 'movie', ?, ?, ?, ?, ?, '2026')
`);
    db.transaction(() => {
      for (let index = 0; index < 20; index += 1) {
        const id = `tt${String(index + 100).padStart(7, '0')}`;
        insertTitle.run(id, now, now, now);
        insertEvidence.run(id, `Reservoir ${index}`, `https://img/${id}.jpg`, now);
        insertMembership.run(id, 20 - index, now, `Reservoir ${index}`, `https://img/${id}.jpg`);
      }
    })();
    await prepareVodBrowseReservoirV3({
      tab: 'movies',
      rails: [{ railId: 'movies-global-popular', displayLimit: 9, minDisplay: 6 }],
      affinityRevision: 'fixture-rank-2',
    });
    db.prepare("DELETE FROM rail_pool WHERE rail_id = 'movies-global-popular'").run();
    const sessions = await allocateTabRailSessions({
      sessionId: 'reservoir-session',
      rails: [{ railId: 'movies-global-popular', displayLimit: 9, minDisplay: 6 }],
      forceReshuffle: true,
      browseV3: true,
      browseV3Tab: 'movies',
      seed: 'reservoir-seed',
    });
    const session = sessions.get('movies-global-popular');
    assert.equal(session?.items.length, 9);
    assert.equal(session?.verified_pool, 20);
  });
});

test('deep eligibility keeps source members beyond pool_max, derives exact themes, and excludes structured conflicts', async () => {
  await withBrowseDb(async () => {
    const db = getPlayabilityDb();
    const now = Date.now();
    const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, verified_at, first_verified_at, best_source, updated_at)
VALUES ('movie', ?, 'verified', ?, ?, 'fixture', ?)
`);
    const insertEvidence = db.prepare(`
INSERT INTO title_story_evidence(type, id, title, poster_url, year, evidence_json, updated_at)
VALUES ('movie', ?, ?, ?, '2026', ?, ?)
`);
    const insertMembership = db.prepare(`
INSERT INTO rail_pool(
  rail_id, type, id, score, ingested_at, title, poster_url, year, evidence_json
) VALUES ('movies-comedy', 'movie', ?, ?, ?, ?, ?, '2026', ?)
`);
    db.transaction(() => {
      for (let index = 0; index < 140; index += 1) {
        const id = `tt${String(index + 500).padStart(7, '0')}`;
        const evidence = index === 139 ? JSON.stringify({ genres: ['Drama'] }) : null;
        insertTitle.run(id, now, now, now);
        insertEvidence.run(id, `Comedy source ${index}`, `https://img/${id}.jpg`, evidence, now);
        insertMembership.run(id, 140 - index, now, `Comedy source ${index}`, `https://img/${id}.jpg`, evidence);
      }
      insertTitle.run('tt9999991', now, now, now);
      insertEvidence.run(
        'tt9999991', 'Derived exact comedy', 'https://img/tt9999991.jpg',
        JSON.stringify({ genres: ['Comedy'] }), now,
      );
    })();
    await prepareVodBrowseReservoirV3({
      tab: 'movies',
      rails: [{
        railId: 'movies-comedy', displayLimit: 9, minDisplay: 6,
        playability: CAPPED_GROWTH_POLICY,
      }],
      affinityRevision: 'deep-eligibility-fixture',
    });

    const seen = new Set<string>();
    let previous = new Set<string>();
    for (let epoch = 0; epoch < 500; epoch += 1) {
      const sessions = await allocateTabRailSessions({
        sessionId: `deep-${epoch}`,
        rails: [{
          railId: 'movies-comedy', displayLimit: 9, minDisplay: 6,
          playability: CAPPED_GROWTH_POLICY,
        }],
        forceReshuffle: true,
        browseV3: true,
        browseV3Tab: 'movies',
        seed: `deep:${epoch}`,
        previousSlateKeysByRail: new Map([['movies-comedy', previous]]),
      });
      const items = sessions.get('movies-comedy')?.items ?? [];
      assert.equal(items.length, 9);
      assert.equal(items.some((item) => previous.has(`${item.type}:${item.id}`)), false);
      items.forEach((item) => seen.add(item.id));
      previous = new Set(items.map((item) => `${item.type}:${item.id}`));
    }
    assert.ok(seen.has('tt0000630'), 'a source member beyond position 120 remains reachable');
    assert.ok(seen.has('tt9999991'), 'an exact typed source-less title is reachable');
    assert.equal(seen.has('tt0000639'), false, 'a structured source conflict is excluded');
    const status = await getPlayabilityStatus(['movies-comedy']);
    const rail = status.vod_browse_v3?.rails.find((item) => item.rail_id === 'movies-comedy');
    assert.deepEqual(rail && {
      total_eligible: rail.total_eligible,
      source_backed: rail.source_backed,
      derived: rail.derived,
      conflict_excluded: rail.conflict_excluded,
    }, { total_eligible: 140, source_backed: 139, derived: 1, conflict_excluded: 1 });
  });
});

test('serve-time category and Explore deals fence titles that expired after reservoir publication', async () => {
  await withBrowseDb(async () => {
    const db = getPlayabilityDb();
    const now = Date.now();
    const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, verified_at, first_verified_at, best_source, updated_at)
VALUES ('series', ?, 'verified', ?, ?, 'fixture', ?)
`);
    const insertEvidence = db.prepare(`
INSERT INTO title_story_evidence(type, id, title, poster_url, year, updated_at)
VALUES ('series', ?, ?, ?, '2026', ?)
`);
    const insertMembership = db.prepare(`
INSERT INTO rail_pool(rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES ('series-reality-casual', 'series', ?, ?, ?, ?, ?, '2026')
`);
    const staleIds = new Set<string>();
    db.transaction(() => {
      for (let index = 0; index < 20; index += 1) {
        const id = `tt${String(index + 200).padStart(7, '0')}`;
        insertTitle.run(id, now, now, now);
        insertEvidence.run(id, `Series ${index}`, `https://img/${id}.jpg`, now);
        insertMembership.run(id, 20 - index, now, `Series ${index}`, `https://img/${id}.jpg`);
        if (index < 10) staleIds.add(id);
      }
    })();
    await prepareVodBrowseReservoirV3({
      tab: 'series',
      rails: [{ railId: 'series-reality-casual', displayLimit: 9, minDisplay: 6 }],
      affinityRevision: 'fixture-rank-expiry',
    });

    const expire = db.prepare(`UPDATE titles SET status = 'stale', updated_at = ? WHERE id = ?`);
    db.transaction(() => {
      for (const id of staleIds) expire.run(now + 1, id);
      db.prepare("UPDATE titles SET expires_at = ?, updated_at = ? WHERE id = 'tt0000210'")
        .run(now - 1, now + 1);
    })();

    const sessions = await allocateTabRailSessions({
      sessionId: 'post-expiry-category',
      rails: [{ railId: 'series-reality-casual', displayLimit: 9, minDisplay: 6 }],
      forceReshuffle: true,
      browseV3: true,
      browseV3Tab: 'series',
      seed: 'post-expiry-category',
    });
    const category = sessions.get('series-reality-casual');
    assert.equal(category?.verified_pool, 9);
    assert.equal(category?.items.length, 9);
    assert.ok(category?.items.every((item) => !staleIds.has(item.id)));

    const explore = await allocateVodExploreSession({
      tab: 'series',
      sessionId: 'post-expiry-explore',
      displayLimit: 9,
      seed: 'post-expiry-explore',
    });
    assert.equal(explore.verified_pool, 9);
    assert.equal(explore.items.length, 9);
    assert.ok(explore.items.every((item) => !staleIds.has(item.id)));
  });
});
