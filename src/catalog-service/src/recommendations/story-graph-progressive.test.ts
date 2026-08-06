import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { libraryDatabase, resetLibraryDbForTests, saveLibraryItem } from '../library/db.js';
import { putRating } from '../library/ratings.js';
import {
  getPlayabilityDb,
  initPlayabilityDb,
  resetPlayabilityDbForTests,
} from '../playability/db.js';
import {
  refreshStoryGraphForYou,
  isStoryGraphTrueNegativeRating,
  resetStoryGraphServingWorkCounters,
  storyGraphHighPreferenceConcordance,
  storyGraphServingWorkSnapshot,
  storyGraphTitleSupportsOfflineEvaluation,
  storyGraphDiagnostics,
  storyGraphServingDecision,
  type StoryGraphRefreshDependencies,
} from './story-graph-service.js';
import { loadForYouRail } from './service.js';

async function withProgressiveDatabases(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mango-progressive-story-'));
  const prior = {
    library: process.env.MANGO_LIBRARY_DB_PATH,
    pins: process.env.MANGO_USER_PINS_PATH,
    playability: process.env.MANGO_PLAYABILITY_DB,
    worker: process.env.MANGO_STORY_DNA_WORKER_MODE,
    vodMode: process.env.MANGO_VOD_RECS_V2,
    predealtSlates: process.env.MANGO_VOD_STORY_GRAPH_PREDEALT_SLATES,
  };
  process.env.MANGO_LIBRARY_DB_PATH = join(directory, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(directory, 'pins.json');
  process.env.MANGO_PLAYABILITY_DB = join(directory, 'playability.db');
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
            : name === 'worker' ? 'MANGO_STORY_DNA_WORKER_MODE'
              : name === 'vodMode' ? 'MANGO_VOD_RECS_V2'
                : 'MANGO_VOD_STORY_GRAPH_PREDEALT_SLATES';
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function seedTitles(type: 'movie' | 'series', count: number): void {
  const db = getPlayabilityDb();
  const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, best_source, verified_at, updated_at)
VALUES (?, ?, 'verified', 'test', ?, ?)
`);
  const insertPool = db.prepare(`
INSERT INTO rail_pool(
  rail_id, type, id, score, ingested_at, title, poster_url, year,
  evidence_json, evidence_hash, evidence_source, evidence_retrieved_at
) VALUES (?, ?, ?, 1, ?, ?, ?, '2022', ?, ?, 'test:addon', ?)
`);
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const id = `${type === 'movie' ? 'm' : 's'}${String(index).padStart(3, '0')}`;
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
      insertTitle.run(type, id, index + 1, index + 1);
      insertPool.run(
        `${type === 'movie' ? 'movies' : 'series'}-theme-${index % 4}`,
        type, id, index + 1, `${type === 'movie' ? 'Movie' : 'Series'} ${index}`,
        `https://example.test/${id}.jpg`, evidence, `source-hash-${index}`, index + 1,
      );
    }
  })();
}

function passingEvaluation(input: Parameters<NonNullable<StoryGraphRefreshDependencies['evaluate']>>[0]) {
  return {
    version: 'vod-story-frontier-evaluation-v2' as const,
    rank_generation_id: input.rankGenerationId,
    status: 'passed' as const,
    samples: input.ratings.length,
    folds: 5,
    holistic_ndcg_at_6: 1,
    fire_pairwise_concordance_ge_4: 1,
    water_pairwise_concordance_ge_4: 1,
    low_low_top_6_intrusion_rate: 0,
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

function labelSparseEvaluation(
  input: Parameters<NonNullable<StoryGraphRefreshDependencies['evaluate']>>[0],
) {
  return {
    version: 'vod-story-frontier-evaluation-v2' as const,
    rank_generation_id: input.rankGenerationId,
    status: 'insufficient' as const,
    samples: input.ratings.length,
    folds: 0,
    holistic_ndcg_at_6: null,
    fire_pairwise_concordance_ge_4: null,
    water_pairwise_concordance_ge_4: null,
    low_low_top_6_intrusion_rate: null,
    verified_accounting_complete: true,
    coverage: 1,
    deterministic: true,
    worker_latency_ms: input.workerLatencyMs,
    cached_service_p95_ms: input.cachedServiceP95Ms ?? null,
    promotion_eligible: false,
    reasons: ['insufficient_stratified_ratings', 'ndcg_unavailable'],
    evaluated_at: input.now,
  };
}

test('axis concordance compares strong with lower preferences inside each fold', () => {
  const result = storyGraphHighPreferenceConcordance([
    // Ordering the two strong preferences incorrectly must not turn this
    // guard into an ordinal 4-vs-5 regression.
    { actual: 4, predicted: 0.9, fold: 0 },
    { actual: 5, predicted: 0.8, fold: 0 },
    { actual: 2.5, predicted: 0.2, fold: 0 },
    { actual: 1, predicted: 0.1, fold: 0 },
    // Cross-fold scores are intentionally incomparable and are not paired.
    { actual: 5, predicted: 0.3, fold: 1 },
    { actual: 2, predicted: 0.4, fold: 1 },
    { actual: 3.5, predicted: 1, fold: 1 },
  ]);
  assert.deepEqual(result, {
    value: 2 / 3,
    comparisons: 6,
    strong_preferences: 3,
    lower_preferences: 4,
  });
  assert.deepEqual(storyGraphHighPreferenceConcordance([
    { actual: 4.5, predicted: 0.7, fold: 0 },
    { actual: 3, predicted: 0.2, fold: 0 },
  ]), {
    value: 1,
    comparisons: 1,
    strong_preferences: 1,
    lower_preferences: 1,
  });
});

test('only ratings below one on both axes are true-negative intrusion labels', () => {
  assert.equal(isStoryGraphTrueNegativeRating({ fire: 0, water: 0.5 }), true);
  assert.equal(isStoryGraphTrueNegativeRating({ fire: 0.5, water: 0.5 }), true);
  assert.equal(isStoryGraphTrueNegativeRating({ fire: 1, water: 0 }), false);
  assert.equal(isStoryGraphTrueNegativeRating({ fire: 2, water: 2 }), false);
  assert.equal(isStoryGraphTrueNegativeRating({ fire: 2.5, water: 0.5 }), false);
});

test('offline quality labels require a thematically rankable profile', () => {
  const title = {
    type: 'movie' as const,
    id: 'profile',
    title: 'Profile',
    edges: [],
  };
  assert.equal(storyGraphTitleSupportsOfflineEvaluation({
    ...title,
    profile_state: 'base',
  }), true);
  assert.equal(storyGraphTitleSupportsOfflineEvaluation({
    ...title,
    profile_state: 'enriched',
  }), true);
  assert.equal(storyGraphTitleSupportsOfflineEvaluation({
    ...title,
    profile_state: 'sparse_unresolved',
  }), false);
  assert.equal(storyGraphTitleSupportsOfflineEvaluation({
    ...title,
    profile_state: 'unrankable',
  }), false);
});

test('progressive full-corpus refresh accounts for sparse titles without a teacher dependency', async () => {
  await withProgressiveDatabases(async () => {
    process.env.MANGO_VOD_RECS_V2 = 'serve';
    process.env.MANGO_VOD_STORY_GRAPH_PREDEALT_SLATES = '8';
    seedTitles('movie', 205);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 4.5, expected_revision: 0, origin: 'couch', taste_tags: [],
    });
    const result = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 200,
      cached_service_p95_ms: 1,
      dependencies: {
        evaluate: passingEvaluation,
      },
    });
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
      model_version: 'vod-story-frontier-v2',
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
    assert.deepEqual(diagnostics.domains[0]?.serving_pointer, {
      active_ready: true,
      active_rank_generation_id: result.rank_generation_id,
      previous_complete_rank_generation_id: null,
      active_story_generation_id: diagnostics.domains[0]?.story_generation_id ?? null,
      active_taste_generation_id: diagnostics.domains[0]?.taste_generation_id ?? null,
      active_model_version: 'vod-story-frontier-v2',
      active_status: 'complete',
      active_published_at: diagnostics.domains[0]?.last_good_publication ?? null,
      shuffle_epoch: 0,
      updated_at: diagnostics.domains[0]?.last_good_publication ?? null,
      promotion_rank_generation_id: result.rank_generation_id,
      promotion_eligible: true,
      serve_eligible: true,
      serve_basis: 'evaluated',
      serve_blockers: [],
      public_rank_generation_id: result.rank_generation_id,
      public_shuffle_epoch: 0,
    });
    const repeated = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 200,
      cached_service_p95_ms: 1,
      dependencies: { evaluate: passingEvaluation },
    });
    assert.equal(repeated.story_generation_id, result.story_generation_id);
    assert.equal((libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_story_graph_backgrounds WHERE content_type = 'movie'
`).get() as { count: number }).count, 1);

    const activeEpoch = () => (libraryDatabase().prepare(`
SELECT shuffle_epoch FROM vod_active_generations WHERE content_type = 'movie'
`).get() as { shuffle_epoch: number }).shuffle_epoch;
    process.env.MANGO_VOD_RECS_V2 = 'shadow';
    assert.equal(await loadForYouRail('movies', { reshuffle: true, profileId: 'household' }), null);
    assert.equal(activeEpoch(), 0, 'shadow X must not advance a hidden slate');
    process.env.MANGO_VOD_RECS_V2 = 'off';
    assert.equal(await loadForYouRail('movies', { reshuffle: true, profileId: 'household' }), null);
    assert.equal(activeEpoch(), 0, 'off X must not advance a disabled slate');
    process.env.MANGO_VOD_RECS_V2 = 'serve';
    resetStoryGraphServingWorkCounters();
    const initial = await loadForYouRail('movies', { profileId: 'household' });
    assert.ok(initial);
    const rendered = [new Set(initial.items.map((item) => item.id))];
    const visitedEpochs = new Set([activeEpoch()]);
    for (let press = 0; press < 24; press += 1) {
      const shuffled = await loadForYouRail('movies', {
        reshuffle: true,
        profileId: 'household',
      });
      assert.ok(shuffled);
      const ids = new Set(shuffled.items.map((item) => item.id));
      for (const prior of rendered.slice(-4)) {
        assert.equal(
          [...ids].some((id) => prior.has(id)),
          false,
          `X press ${press + 1} must avoid every card from the preceding four slates`,
        );
      }
      rendered.push(ids);
      visitedEpochs.add(activeEpoch());
    }
    assert.ok(activeEpoch() < 8, 'serve X wraps within the finite predealt cache');
    assert.ok(visitedEpochs.size > 1, 'serve X advances a published cached slate');
    const servingWork = storyGraphServingWorkSnapshot();
    assert.equal(servingWork.dealer_calls, 0, 'X consumes only predealt slates');
    assert.equal(servingWork.full_reserve_queries, 0, 'X never scans or ranks the reserve');
    assert.equal(servingWork.full_reserve_rows_loaded, 0, 'X never loads the reserve');
    assert.equal(servingWork.queue_slates_scanned, 24, 'each X validates only its selected slate');

    const failed = libraryDatabase().prepare(`
INSERT INTO vod_rank_generations(
  content_type, model_version, feature_version, ontology_version,
  story_generation_id, taste_generation_id, taste_revision, corpus_generation,
  trigger_reasons_json, cursor, status, verified_count, scored_count,
  eligible_count, excluded_count, started_at, published_at, completed_at, last_error
)
SELECT content_type, model_version, feature_version, ontology_version,
       story_generation_id, taste_generation_id, taste_revision, corpus_generation,
       '["diagnostic_probe"]', cursor, 'failed', verified_count, scored_count,
       eligible_count, excluded_count, started_at + 1, NULL, completed_at + 1, 'probe failure'
FROM vod_rank_generations WHERE rank_generation_id = ?
`).run(repeated.rank_generation_id);
    const afterFailed = storyGraphDiagnostics();
    assert.equal(afterFailed.domains[0]?.rank_generation_id, Number(failed.lastInsertRowid));
    assert.equal(
      afterFailed.domains[0]?.serving_pointer.active_rank_generation_id,
      repeated.rank_generation_id,
      'a newer failed row must not masquerade as the active public generation',
    );
    assert.equal(afterFailed.domains[0]?.serving_pointer.active_status, 'complete');
    assert.equal(afterFailed.domains[0]?.serving_pointer.public_rank_generation_id, repeated.rank_generation_id);
  });
});

test('label-sparse household evidence can activate a safe cached generation without faking promotion', async () => {
  await withProgressiveDatabases(async () => {
    process.env.MANGO_VOD_RECS_V2 = 'shadow';
    seedTitles('series', 205);
    saveLibraryItem({
      source: 'mango', type: 'series', id: 's000', title: 'Series 0',
      poster: 'https://example.test/s000.jpg', tab: 'series', profile_id: 'household',
    });
    const result = await refreshStoryGraphForYou('series', {
      bootstrap_minimum: 200,
      cached_service_p95_ms: 1,
      dependencies: { evaluate: labelSparseEvaluation },
    });
    assert.equal(result.selected_k, 1, 'Saved is qualifying cold-start household evidence');
    assert.equal(result.activated, true);
    assert.equal(result.evaluation.promotion_eligible, false);
    assert.deepEqual(storyGraphServingDecision(result.evaluation), {
      serve_eligible: true,
      basis: 'evidence_cold_start',
      blockers: [],
    });

    const shadow = storyGraphDiagnostics().domains.find((domain) => domain.content_type === 'series');
    assert.equal(shadow?.serving_pointer.active_ready, true);
    assert.equal(shadow?.serving_pointer.promotion_eligible, false);
    assert.equal(shadow?.serving_pointer.serve_eligible, true);
    assert.equal(shadow?.serving_pointer.serve_basis, 'evidence_cold_start');
    assert.equal(shadow?.serving_pointer.public_rank_generation_id, null);
    assert.equal(await loadForYouRail('series', { profileId: 'household' }), null);

    process.env.MANGO_VOD_RECS_V2 = 'serve';
    const served = await loadForYouRail('series', { profileId: 'household' });
    assert.equal(served?.items.length, 6);
    const live = storyGraphDiagnostics().domains.find((domain) => domain.content_type === 'series');
    assert.equal(live?.serving_pointer.public_rank_generation_id, result.rank_generation_id);
    assert.equal(live?.serving_pointer.promotion_eligible, false);
    assert.equal(live?.serving_pointer.serve_basis, 'evidence_cold_start');
  });
});

test('synthetic gate Saved rows never teach or exclude VOD recommendations', async () => {
  await withProgressiveDatabases(async () => {
    seedTitles('movie', 205);
    saveLibraryItem({
      source: 'mango', type: 'movie', id: 'm001', title: 'Movie 1',
      poster: 'https://example.test/m001.jpg', tab: 'movies', profile_id: 'household',
    });
    saveLibraryItem({
      source: 'gate', type: 'movie', id: 'm000', title: 'Synthetic Gate Movie',
      poster: 'https://example.test/m000.jpg', tab: 'movies', profile_id: 'household',
      saved_by: 'gate',
    });
    const result = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 200,
      cached_service_p95_ms: 1,
      dependencies: { evaluate: passingEvaluation },
    });
    const taste = libraryDatabase().prepare(`
SELECT anchor_count, explicit_mass, implicit_mass
FROM vod_taste_generations WHERE taste_generation_id = ?
`).get(result.taste_generation_id) as {
      anchor_count: number;
      explicit_mass: number;
      implicit_mass: number;
    };
    assert.deepEqual(taste, { anchor_count: 1, explicit_mass: 0, implicit_mass: 0.8 });
    const candidates = libraryDatabase().prepare(`
SELECT content_id, serving_eligible, exclusion_reason
FROM vod_rank_items
WHERE rank_generation_id = ? AND content_id IN ('m000', 'm001')
ORDER BY content_id
`).all(result.rank_generation_id) as Array<{
      content_id: string;
      serving_eligible: number;
      exclusion_reason: string | null;
    }>;
    assert.deepEqual(candidates, [
      { content_id: 'm000', serving_eligible: 1, exclusion_reason: null },
      { content_id: 'm001', serving_eligible: 0, exclusion_reason: 'saved_exact' },
    ]);
  });
});

test('cold-start authorization never excuses a measured operational failure', async () => {
  await withProgressiveDatabases(async () => {
    process.env.MANGO_VOD_RECS_V2 = 'shadow';
    seedTitles('series', 205);
    saveLibraryItem({
      source: 'mango', type: 'series', id: 's000', title: 'Series 0',
      poster: 'https://example.test/s000.jpg', tab: 'series', profile_id: 'household',
    });
    const result = await refreshStoryGraphForYou('series', {
      bootstrap_minimum: 200,
      cached_service_p95_ms: 251,
      dependencies: {
        evaluate: (input) => ({
          ...labelSparseEvaluation(input),
          cached_service_p95_ms: 251,
          reasons: [
            'insufficient_stratified_ratings',
            'ndcg_unavailable',
            'cached_service_p95_above_250ms',
          ],
        }),
      },
    });
    assert.equal(result.published, true, 'the shadow artifact remains auditable');
    assert.equal(result.activated, false, 'a hard safety failure cannot replace last-good');
    assert.deepEqual(storyGraphServingDecision(result.evaluation), {
      serve_eligible: false,
      basis: 'blocked',
      blockers: ['cached_service_p95_above_250ms'],
    });
    const diagnostics = storyGraphDiagnostics().domains.find((domain) => domain.content_type === 'series');
    assert.equal(diagnostics?.serving_pointer.active_ready, false);
    assert.equal(diagnostics?.serving_pointer.serve_eligible, false);
    assert.equal(diagnostics?.serving_pointer.public_rank_generation_id, null);
  });
});

test('progressive indexing accounts for the complete large Movies and TV corpora', async () => {
  await withProgressiveDatabases(async () => {
    seedTitles('movie', 5_452);
    seedTitles('series', 3_794);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch', taste_tags: [],
    });
    putRating({
      profile_id: 'household', type: 'series', id: 's000', title: 'Series 0',
      fire: 5, water: 4.5, expected_revision: 0, origin: 'couch', taste_tags: [],
    });
    const options = {
      bootstrap_minimum: 200,
      cached_service_p95_ms: 1,
      dependencies: { evaluate: passingEvaluation },
    } as const;
    const movies = await refreshStoryGraphForYou('movies', options);
    const series = await refreshStoryGraphForYou('series', options);
    assert.deepEqual([movies.verified_count, series.verified_count], [5_452, 3_794]);
    for (const result of [movies, series]) {
      assert.equal(result.scored_count + result.excluded_count, result.verified_count);
      assert.equal(result.coverage, 1);
      assert.ok(result.reserve_depth > 2_000);
      assert.equal(result.published, true);
    }
  });
});
