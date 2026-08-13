import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initLibraryDb,
  libraryDatabase,
  pruneLibraryMaintenance,
  pruneStoryGraphGenerationHistory,
  resetLibraryDbForTests,
  RECOMMENDATION_JOB_TERMINAL_RETENTION,
  RECOMMENDATION_SERVED_SLATE_TTL_MS,
} from './db.js';
import { createRecommendationRefreshJob, updateRecommendationRefreshJobs } from '../recommendations/jobs.js';

function withLibrary(fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mango-library-prune-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    fn();
  } finally {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertStoryGraphStack(contentType: 'movie' | 'series', count: number): number[] {
  const db = libraryDatabase();
  const storyIds: number[] = [];
  const rankIds: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const story = Number(db.prepare(`
INSERT INTO vod_story_dna_generations(
  content_type, schema_version, ontology_version, prompt_version, model_version,
  corpus_generation, evidence_revision, status, started_at
) VALUES (?, 'story-dna-v1', 'story-dna-core-v1', 'story-dna-prompt-v1', 'test',
          ?, 'evidence', 'complete', 1)
`).run(contentType, index + 1).lastInsertRowid);
    storyIds.push(story);
    db.prepare(`
INSERT INTO vod_story_dna_documents(
  generation_id, content_type, content_id, evidence_json, evidence_hash,
  status, created_at, updated_at, profile_json
) VALUES (?, ?, ?, '{}', 'hash', 'valid', 1, 1, '{"profile":true}')
`).run(story, contentType, `tt-${contentType}-${index}`);
    db.prepare(`
INSERT INTO vod_story_dna_edges(
  generation_id, content_type, content_id, node_key, family, intensity, confidence, edge_source
) VALUES (?, ?, ?, 'genre:drama', 'genre-subgenre', 2, 0.9, 'metadata')
`).run(story, contentType, `tt-${contentType}-${index}`);
    db.prepare(`
INSERT INTO vod_content_profile_edges(
  generation_id, content_type, content_id, node_key, family, intensity, confidence,
  edge_source, producer_version, dependency_hash
) VALUES (?, ?, ?, 'genre:drama', 'genre-subgenre', 2, 0.9, 'metadata_fact', 'v1', 'dep')
`).run(story, contentType, `tt-${contentType}-${index}`);
    db.prepare(`
INSERT INTO vod_story_dna_overlays(
  content_type, content_id, semantic_evidence_hash, document_hash, document_json,
  schema_version, ontology_version, prompt_version, model_version, created_at
) VALUES (?, ?, 'sem', 'doc', '{}', 'story-dna-v1', 'story-dna-core-v1', 'story-dna-prompt-v1', 'test', 1)
`).run(contentType, `tt-overlay-${index}`);
    const taste = Number(db.prepare(`
INSERT INTO vod_taste_generations(
  content_type, story_generation_id, taste_revision, watch_decay_bucket, status,
  selected_k, created_at
) VALUES (?, ?, 'taste', 0, 'complete', 1, 1)
`).run(contentType, story).lastInsertRowid);
    const rank = Number(db.prepare(`
INSERT INTO vod_rank_generations(
  content_type, model_version, feature_version, ontology_version,
  story_generation_id, taste_generation_id, taste_revision, corpus_generation,
  status, started_at
) VALUES (?, 'vod-story-frontier-v2', 'v1', 'story-dna-core-v1', ?, ?, 'taste', ?, 'complete', 1)
`).run(contentType, story, taste, index + 1).lastInsertRowid);
    rankIds.push(rank);
    db.prepare(`
INSERT INTO vod_rank_items(
  rank_generation_id, content_type, content_id, serving_eligible, created_at, updated_at
) VALUES (?, ?, ?, 1, 1, 1)
`).run(rank, contentType, `tt-${contentType}-${index}`);
  }
  const previous = rankIds[count - 2] ?? null;
  const active = rankIds[count - 1]!;
  const activeStory = storyIds[count - 1]!;
  const previousStory = storyIds[count - 2];
  const activeTaste = Number((db.prepare(`
SELECT taste_generation_id AS id FROM vod_rank_generations WHERE rank_generation_id = ?
`).get(active) as { id: number }).id);
  db.prepare(`
INSERT INTO vod_active_generations(
  content_type, active_rank_generation_id, previous_complete_rank_generation_id,
  active_story_generation_id, active_taste_generation_id, shuffle_epoch, updated_at
) VALUES (?, ?, ?, ?, ?, 0, 1)
`).run(contentType, active, previous, activeStory, activeTaste);
  return [previousStory ?? activeStory, activeStory];
}

test('Story Graph prune keeps active + previous and teacher overlays', () => withLibrary(() => {
  insertStoryGraphStack('movie', 4);
  insertStoryGraphStack('series', 3);
  const before = libraryDatabase().prepare('SELECT COUNT(*) AS count FROM vod_story_dna_generations')
    .get() as { count: number };
  assert.equal(before.count, 7);
  const stats = pruneStoryGraphGenerationHistory();
  assert.equal(stats.skipped_story_graph, false);
  assert.equal(stats.story_generations, 3);
  const remaining = libraryDatabase().prepare(`
SELECT content_type, COUNT(*) AS count FROM vod_story_dna_generations GROUP BY content_type ORDER BY 1
`).all() as Array<{ content_type: string; count: number }>;
  assert.deepEqual(remaining, [
    { content_type: 'movie', count: 2 },
    { content_type: 'series', count: 2 },
  ]);
  assert.equal(
    (libraryDatabase().prepare('SELECT COUNT(*) AS count FROM vod_rank_generations').get() as { count: number }).count,
    4,
  );
  assert.equal(
    (libraryDatabase().prepare('SELECT COUNT(*) AS count FROM vod_story_dna_overlays').get() as { count: number }).count,
    7,
  );
  const docs = libraryDatabase().prepare('SELECT COUNT(*) AS count FROM vod_story_dna_documents')
    .get() as { count: number };
  assert.equal(docs.count, 4);
}));

test('library maintenance empties dead DNA edges and trims jobs, lookup state, and old slates', () => withLibrary(() => {
  insertStoryGraphStack('movie', 3);
  const db = libraryDatabase();
  db.prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES ('vod_story_dna_lookup:movie:abc', '{}', 1)
`).run();
  db.prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES ('vod_story_graph_evaluation:movie:1', '{}', 1)
`).run();
  const now = Date.now();
  db.prepare(`
INSERT INTO profile_recommendation_served_slates(
  attribution_token, profile_id, domain, rail_id, slate_revision,
  source_revision, context_id, created_at, expires_at
) VALUES ('old-token', 'household', 'vod', 'for-you-movies', 1, 1, '', ?, ?)
`).run(now - RECOMMENDATION_SERVED_SLATE_TTL_MS - 1, now - 1);
  for (let index = 0; index < RECOMMENDATION_JOB_TERMINAL_RETENTION + 5; index += 1) {
    const job = createRecommendationRefreshJob({
      domain: 'vod',
      content_type: 'movie',
      trigger_reasons: ['nightly'],
      captured_revisions: {},
      queued_at: index + 1,
    });
    updateRecommendationRefreshJobs([job.job_id], 'complete', undefined, index + 100);
  }
  const stats = pruneLibraryMaintenance(now);
  assert.ok(stats.dna_edges >= 1);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM vod_story_dna_edges').get() as { count: number }).count,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM recommendation_runtime_state WHERE state_key LIKE 'vod_story_dna_lookup%'")
      .get() as { count: number }).count,
    0,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM recommendation_refresh_jobs').get() as { count: number }).count,
    RECOMMENDATION_JOB_TERMINAL_RETENTION,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM profile_recommendation_served_slates').get() as { count: number }).count,
    0,
  );
}));

test('catalog startup bookkeeping does not delete Story Graph generations', () => withLibrary(() => {
  insertStoryGraphStack('movie', 4);
  resetLibraryDbForTests();
  initLibraryDb();
  assert.equal(
    (libraryDatabase().prepare('SELECT COUNT(*) AS count FROM vod_story_dna_generations').get() as { count: number }).count,
    4,
  );
}));

test('publish-path Story Graph prune deletes at most the inline cap', () => withLibrary(() => {
  insertStoryGraphStack('movie', 6);
  const stats = pruneStoryGraphGenerationHistory({ maxDeletes: 1 });
  assert.equal(stats.skipped_story_graph, false);
  assert.equal(stats.rank_generations, 1);
  assert.equal(
    (libraryDatabase().prepare('SELECT COUNT(*) AS count FROM vod_rank_generations').get() as { count: number }).count,
    5,
  );
}));

test('Story Graph prune refuses to wipe generations when no active pointer exists', () => withLibrary(() => {
  const db = libraryDatabase();
  db.prepare(`
INSERT INTO vod_story_dna_generations(
  content_type, schema_version, ontology_version, prompt_version, model_version,
  corpus_generation, evidence_revision, status, started_at
) VALUES ('movie', 'story-dna-v1', 'story-dna-core-v1', 'story-dna-prompt-v1', 'test',
          1, 'evidence', 'complete', 1)
`).run();
  const stats = pruneStoryGraphGenerationHistory();
  assert.equal(stats.skipped_story_graph, true);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM vod_story_dna_generations').get() as { count: number }).count,
    1,
  );
}));
