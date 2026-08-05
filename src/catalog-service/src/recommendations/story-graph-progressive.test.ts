import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { libraryDatabase, resetLibraryDbForTests } from '../library/db.js';
import { putRating } from '../library/ratings.js';
import {
  getPlayabilityDb,
  initPlayabilityDb,
  resetPlayabilityDbForTests,
} from '../playability/db.js';
import {
  refreshStoryGraphForYou,
  storyGraphDiagnostics,
  type StoryGraphRefreshDependencies,
} from './story-graph-service.js';

async function withProgressiveDatabases(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mango-progressive-story-'));
  const prior = {
    library: process.env.MANGO_LIBRARY_DB_PATH,
    pins: process.env.MANGO_USER_PINS_PATH,
    playability: process.env.MANGO_PLAYABILITY_DB,
    profile: process.env.MANGO_VOD_CONTENT_PROFILE,
    worker: process.env.MANGO_STORY_DNA_WORKER_MODE,
  };
  process.env.MANGO_LIBRARY_DB_PATH = join(directory, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(directory, 'pins.json');
  process.env.MANGO_PLAYABILITY_DB = join(directory, 'playability.db');
  process.env.MANGO_VOD_CONTENT_PROFILE = 'progressive-v2';
  process.env.MANGO_STORY_DNA_WORKER_MODE = 'off';
  resetLibraryDbForTests();
  resetPlayabilityDbForTests();
  try {
    libraryDatabase();
    await initPlayabilityDb();
    await fn();
  } finally {
    resetLibraryDbForTests();
    resetPlayabilityDbForTests();
    for (const [name, value] of Object.entries(prior)) {
      const key = name === 'library' ? 'MANGO_LIBRARY_DB_PATH'
        : name === 'pins' ? 'MANGO_USER_PINS_PATH'
          : name === 'playability' ? 'MANGO_PLAYABILITY_DB'
            : name === 'profile' ? 'MANGO_VOD_CONTENT_PROFILE'
              : 'MANGO_STORY_DNA_WORKER_MODE';
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function seedMovies(count: number): void {
  const db = getPlayabilityDb();
  const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, best_source, verified_at, updated_at)
VALUES ('movie', ?, 'verified', 'test', ?, ?)
`);
  const insertPool = db.prepare(`
INSERT INTO rail_pool(
  rail_id, type, id, score, ingested_at, title, poster_url, year,
  evidence_json, evidence_hash, evidence_source, evidence_retrieved_at
) VALUES (?, 'movie', ?, 1, ?, ?, ?, '2022', ?, ?, 'test:addon', ?)
`);
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const id = `m${String(index).padStart(3, '0')}`;
      const sparse = index === count - 1;
      const evidence = JSON.stringify({
        synopsis: sparse ? null : `A detective investigation about family bonds and justice ${index}.`,
        genres: sparse ? [] : [index % 2 ? 'Drama' : 'Crime'],
        keywords: sparse ? [] : ['murder investigation'],
        languages: sparse ? [] : ['English'],
        countries: sparse ? [] : ['India'],
        runtime_minutes: sparse ? null : 108,
        format: sparse ? null : 'feature-film',
        cast: sparse ? [] : [`Actor ${index % 10}`],
        directors: sparse ? [] : [`Director ${index % 8}`],
        writers: [], characters: [], awards: null, certification: 'PG-13',
        external_ids: { catalog: id },
      });
      insertTitle.run(id, index + 1, index + 1);
      insertPool.run(
        `movies-theme-${index % 4}`, id, index + 1, `Movie ${index}`,
        `https://example.test/${id}.jpg`, evidence, `source-hash-${index}`, index + 1,
      );
    }
  })();
}

function passingEvaluation(input: Parameters<NonNullable<StoryGraphRefreshDependencies['evaluate']>>[0]) {
  return {
    version: 'vod-story-graph-evaluation-v1' as const,
    rank_generation_id: input.rankGenerationId,
    status: 'passed' as const,
    samples: input.ratings.length,
    folds: 5,
    holistic_ndcg_at_6: { v2: 1, v4: 0.8, relative_improvement: 0.25 },
    paired_bootstrap_90: { low: 0.01, high: 0.2, iterations: 2_000 },
    fire_pairwise_concordance_ge_4: { v2: 1, v4: 1, regression: 0 },
    water_pairwise_concordance_ge_4: { v2: 1, v4: 1, regression: 0 },
    low_low_top_6_intrusion_rate: { v2: 0, v4: 0, regression: 0 },
    verified_accounting_complete: true,
    coverage: 1,
    deterministic: true,
    worker_latency_ms: input.workerLatencyMs,
    cached_service_p95_ms: input.cachedServiceP95Ms ?? null,
    promotion_eligible: true,
    reasons: [],
    evaluated_at: input.now,
  };
}

test('progressive full-corpus refresh makes zero teacher calls and accounts for sparse titles', async () => {
  await withProgressiveDatabases(async () => {
    seedMovies(205);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 4.5, expected_revision: 0, origin: 'couch', taste_tags: [],
    });
    let teacherCalls = 0;
    const result = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 200,
      cached_service_p95_ms: 1,
      dependencies: {
        refreshTeacher: async () => {
          teacherCalls += 1;
          throw new Error('progressive refresh must not call teacher');
        },
        loadTeacherCache: () => new Map(),
        evaluate: passingEvaluation,
      },
    });
    assert.equal(teacherCalls, 0);
    assert.equal(result.verified_count, 205);
    assert.equal(result.profiled_count, 0);
    assert.equal(result.retryable_failure_count, 1);
    assert.equal(result.scored_count, 203);
    assert.equal(result.excluded_count, 2);
    assert.equal(result.coverage, 1);
    assert.equal(result.published, true);

    const generation = libraryDatabase().prepare(`
SELECT model_version, feature_version, scored_count, excluded_count
FROM vod_rank_generations WHERE rank_generation_id = ?
`).get(result.rank_generation_id) as {
      model_version: string;
      feature_version: string;
      scored_count: number;
      excluded_count: number;
    };
    assert.deepEqual(generation, {
      model_version: 'vod-story-frontier-v1',
      feature_version: 'vod-content-profile-v2',
      scored_count: 203,
      excluded_count: 2,
    });
    const sparse = libraryDatabase().prepare(`
SELECT profile_status, exclusion_reason
FROM vod_rank_items
WHERE rank_generation_id = ? AND content_id = 'm204'
`).get(result.rank_generation_id) as { profile_status: string; exclusion_reason: string };
    assert.deepEqual(sparse, {
      profile_status: 'sparse_unresolved',
      exclusion_reason: 'sparse_unresolved',
    });
    const diagnostics = storyGraphDiagnostics();
    assert.equal(diagnostics.profile_mode, 'progressive-v2');
    assert.equal(diagnostics.frontier.worker_mode, 'off');
    assert.equal(diagnostics.domains[0]?.base_profile_count, 204);
    assert.equal(diagnostics.domains[0]?.sparse_profile_count, 1);
    assert.equal(diagnostics.domains[0]?.calibration.status, 'insufficient');
    assert.ok((diagnostics.domains[0]?.family_coverage['genre-subgenre'] ?? 0) >= 204);
    assert.ok((diagnostics.domains[0]?.edge_sources.metadata_fact ?? 0) > 0);
  });
});
