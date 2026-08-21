import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initLibraryDb,
  libraryDatabase,
  resetLibraryDbForTests,
  type RecommendationServedSlate,
} from '../library/db.js';
import { isCurrentVodRecommendationSource } from './source-revision.js';

test('VOD served-slate source revision is fenced only against the latest active generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-source-revision-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  process.env.MANGO_VOD_RECS_V2 = 'serve';
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    libraryDatabase().prepare(`
INSERT INTO profile_recommendation_snapshots(
  profile_id, tab, revision, model_version, model_kind, status, candidate_count, generated_at, daily_seed
)
VALUES ('household', 'movies', 7, 'v4', 'test', 'ready', 0, 1, 'seed')
`).run();
    const served: RecommendationServedSlate = {
      attribution_token: 'opaque', profile_id: 'household', domain: 'vod', rail_id: 'for-you-movies',
      slate_revision: 1, source_revision: 7, context_id: 'ctx', items: [{ type: 'movie', id: 'tt1', rank: 0 }],
      created_at: 1, expires_at: 2,
    };
    assert.equal(isCurrentVodRecommendationSource(served), false, 'historical snapshots cannot authorize actions');
    libraryDatabase().pragma('foreign_keys = OFF');
    libraryDatabase().prepare(`
INSERT INTO vod_active_generations(
  content_type, active_rank_generation_id, previous_complete_rank_generation_id,
  active_story_generation_id, active_taste_generation_id, shuffle_epoch, updated_at
) VALUES ('movie', 8, NULL, NULL, NULL, 0, 1)
`).run();
    libraryDatabase().pragma('foreign_keys = ON');
    assert.equal(isCurrentVodRecommendationSource({ ...served, source_revision: 8 }), true);
    assert.equal(isCurrentVodRecommendationSource(served), false);
    assert.equal(isCurrentVodRecommendationSource({ ...served, rail_id: 'curated' }), true);
  } finally {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    delete process.env.MANGO_VOD_RECS_V2;
    rmSync(dir, { recursive: true, force: true });
  }
});
