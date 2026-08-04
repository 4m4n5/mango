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

test('VOD served-slate source revision is fenced against the current snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-source-revision-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  process.env.MANGO_VOD_RECS_V2 = 'off';
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
    assert.equal(isCurrentVodRecommendationSource(served), true);
    assert.equal(isCurrentVodRecommendationSource({ ...served, source_revision: 6 }), false);
    assert.equal(isCurrentVodRecommendationSource({ ...served, rail_id: 'curated' }), true);
  } finally {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    delete process.env.MANGO_VOD_RECS_V2;
    rmSync(dir, { recursive: true, force: true });
  }
});
