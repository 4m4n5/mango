import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  allocateVodExploreSession,
  getPlayabilityDb,
  initPlayabilityDb,
  persistVodTabDealV3,
  readVodTabDealV3,
  resetPlayabilityDbForTests,
} from './db.js';

const ENV = { ...process.env };

async function withBrowseDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-vod-browse-v3-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
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
