import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getPlayabilityDb,
  initPlayabilityDb,
  listVerifiedRecommendationCatalogPage,
  playabilityRecommendationCorpusGeneration,
  playabilityRecommendationSemanticGeneration,
  recordRecommendationSemanticEvidence,
  upsertRailPoolTitle,
  resetPlayabilityDbForTests,
} from './db.js';

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-recommendation-corpus-'));
  const previous = process.env.MANGO_PLAYABILITY_DB;
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await initPlayabilityDb();
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    if (previous === undefined) delete process.env.MANGO_PLAYABILITY_DB;
    else process.env.MANGO_PLAYABILITY_DB = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test('recommendation corpus pages every verified movie and series without legacy caps', async () => {
  await withTempDb(async () => {
    const db = getPlayabilityDb();
    const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, verified_at, updated_at)
VALUES (?, ?, 'verified', ?, ?)
`);
    const insert = db.transaction(() => {
      for (let index = 0; index < 5_452; index += 1) {
        const id = `movie-${String(index).padStart(5, '0')}`;
        insertTitle.run('movie', id, index + 1, index + 1);
      }
      for (let index = 0; index < 3_794; index += 1) {
        const id = `series-${String(index).padStart(5, '0')}`;
        insertTitle.run('series', id, index + 1, index + 1);
      }
    });
    insert();

    const collect = async (contentType: 'movie' | 'series'): Promise<string[]> => {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await listVerifiedRecommendationCatalogPage({
          content_type: contentType,
          cursor,
          limit: 317,
        });
        ids.push(...page.items.map((row) => row.id));
        cursor = page.next_cursor;
      } while (cursor);
      return ids;
    };

    const movies = await collect('movie');
    const series = await collect('series');
    assert.equal(movies.length, 5_452);
    assert.equal(series.length, 3_794);
    assert.equal(new Set(movies).size, movies.length);
    assert.equal(new Set(series).size, series.length);
  });
});

test('series recommendation corpus counts a bare show and episode gate mirrors once', async () => {
  await withTempDb(async () => {
    const db = getPlayabilityDb();
    const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, verified_at, updated_at)
VALUES ('series', ?, 'verified', ?, ?)
`);
    db.transaction(() => {
      insertTitle.run('tt0944947', 1, 1);
      insertTitle.run('tt0944947:1:1', 2, 2);
      insertTitle.run('tt0944947:2:5', 3, 3);
      insertTitle.run('series-external', 4, 4);
      insertTitle.run('tt9999999:1:1', 5, 5);
    })();
    db.prepare(`
INSERT INTO rail_pool(rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES ('series-drama', 'series', 'tt0944947:1:1', 1, 1, 'Game of Thrones', 'poster.jpg', '2011')
`).run();

    const first = await listVerifiedRecommendationCatalogPage({
      content_type: 'series',
      limit: 2,
    });
    const second = await listVerifiedRecommendationCatalogPage({
      content_type: 'series',
      cursor: first.next_cursor,
      limit: 2,
    });
    const ids = [...first.items, ...second.items].map((row) => row.id);

    assert.equal(first.verified_count, 3);
    assert.equal(ids.length, first.verified_count, 'COUNT and paged relation must be identical');
    assert.deepEqual(ids, ['series-external', 'tt0944947', 'tt9999999']);
    const canonical = [...first.items, ...second.items].find((row) => row.id === 'tt0944947');
    assert.equal(canonical?.title, 'Game of Thrones');
    assert.deepEqual(canonical?.rail_ids, ['series-drama']);
  });
});

test('corpus accounting and canonical story evidence survive rail removal', async () => {
  await withTempDb(async () => {
    const db = getPlayabilityDb();
    db.prepare(`
INSERT INTO titles(type, id, status, verified_at, updated_at)
VALUES ('movie', 'orphan', 'verified', 1, 1)
`).run();
    db.prepare(`
INSERT INTO rail_pool(rail_id, type, id, score, ingested_at, title, poster_url, year)
VALUES ('curated-temporary', 'movie', 'orphan', 1, 1, 'Orphan', 'poster.jpg', '2020')
`).run();
    const before = await playabilityRecommendationCorpusGeneration();
    db.prepare("DELETE FROM rail_pool WHERE rail_id = 'curated-temporary'").run();
    const after = await playabilityRecommendationCorpusGeneration();

    const page = await listVerifiedRecommendationCatalogPage({ content_type: 'movie' });
    assert.equal(page.verified_count, 1);
    assert.deepEqual(page.items.map((row) => row.id), ['orphan']);
    assert.equal(page.items[0]?.title, 'Orphan');
    assert.equal(page.items[0]?.poster, 'poster.jpg');
    assert.deepEqual(page.items[0]?.rail_ids, []);
    assert.ok(after > before);
  });
});

test('recommendation corpus retains canonical source evidence and provenance', async () => {
  await withTempDb(async () => {
    const db = getPlayabilityDb();
    db.prepare(`
INSERT INTO titles(type, id, status, verified_at, updated_at)
VALUES ('movie', 'evidenced', 'verified', 1, 1)
`).run();
    await upsertRailPoolTitle({
      rail_id: 'movies-family',
      type: 'movie',
      id: 'evidenced',
      score: 1,
      title: 'Evidenced',
      poster_url: 'poster.jpg',
      year: '2024',
      evidence_json: '{"genres":["drama"]}',
      evidence_hash: 'evidence-hash',
      evidence_source: 'addon:catalog',
      evidence_retrieved_at: 123,
    });

    const page = await listVerifiedRecommendationCatalogPage({ content_type: 'movie' });
    assert.equal(page.items[0]?.evidence_json, '{"genres":["drama"]}');
    assert.equal(page.items[0]?.evidence_hash, 'evidence-hash');
    assert.equal(page.items[0]?.evidence_source, 'addon:catalog');
    assert.equal(page.items[0]?.evidence_retrieved_at, 123);

    await upsertRailPoolTitle({
      rail_id: 'movies-family',
      type: 'movie',
      id: 'evidenced',
      score: 2,
      title: 'Evidenced',
      poster_url: 'poster.jpg',
      year: '2024',
      evidence_json: '{"genres":["drama"]}',
      evidence_hash: 'evidence-hash',
      evidence_source: 'addon:catalog-refresh',
      evidence_retrieved_at: 999,
    });
    const unchanged = await listVerifiedRecommendationCatalogPage({ content_type: 'movie' });
    assert.equal(unchanged.items[0]?.evidence_retrieved_at, 123);
    assert.equal(unchanged.items[0]?.evidence_source, 'addon:catalog');

    await upsertRailPoolTitle({
      rail_id: 'movies-family',
      type: 'movie',
      id: 'evidenced',
      score: 3,
      title: 'Evidenced',
      poster_url: 'poster.jpg',
      year: '2024',
      evidence_json: '{"genres":["drama","family"]}',
      evidence_hash: 'changed-evidence-hash',
      evidence_source: 'addon:catalog-refresh',
      evidence_retrieved_at: 1_001,
    });
    const changed = await listVerifiedRecommendationCatalogPage({ content_type: 'movie' });
    assert.equal(changed.items[0]?.evidence_retrieved_at, 1_001);
    assert.equal(changed.items[0]?.evidence_source, 'addon:catalog-refresh');
  });
});

test('semantic revision changes only when compiler-owned evidence changes', async () => {
  await withTempDb(async () => {
    const before = await playabilityRecommendationSemanticGeneration();
    await recordRecommendationSemanticEvidence([
      { type: 'movie', id: 'canonical-orphan', semantic_evidence_hash: 'semantic-a' },
    ]);
    const inserted = await playabilityRecommendationSemanticGeneration();
    assert.ok(inserted > before);

    await recordRecommendationSemanticEvidence([
      { type: 'movie', id: 'canonical-orphan', semantic_evidence_hash: 'semantic-a' },
    ]);
    assert.equal(await playabilityRecommendationSemanticGeneration(), inserted);

    await recordRecommendationSemanticEvidence([
      { type: 'movie', id: 'canonical-orphan', semantic_evidence_hash: 'semantic-b' },
    ]);
    assert.ok(await playabilityRecommendationSemanticGeneration() > inserted);
  });
});
