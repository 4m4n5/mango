import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  libraryDatabase,
  resetLibraryDbForTests,
  saveLibraryItem,
} from '../library/db.js';
import { putRating } from '../library/ratings.js';
import type { FireWaterRating } from '../library/ratings.js';
import {
  getPlayabilityDb,
  initPlayabilityDb,
  resetPlayabilityDbForTests,
  type VerifiedRecommendationCatalogRow,
} from '../playability/db.js';
import {
  STORY_DNA_ONTOLOGY_VERSION,
  STORY_DNA_PROMPT_VERSION,
  STORY_DNA_SCHEMA_VERSION,
  storyDnaEvidenceFields,
  storyDnaEvidenceHash,
  storyDnaInputHash,
  storyDnaRequestItem,
  type StoryDnaDocument,
  type StoryDnaInput,
} from './story-dna.js';
import {
  rankStoryGraphRecommendations,
} from './story-graph-v1.js';
import {
  StaleStoryGraphGenerationError,
  evaluateStoryGraphOffline,
  loadStoryGraphForYouRail,
  reconcileInterruptedStoryDnaGenerations,
  resetStoryGraphServingWorkCounters,
  refreshStoryGraphForYou,
  replayPendingStoryGraphLowWater,
  setStoryGraphLowWaterEnqueueHook,
  stableStoryGraphEvaluationFolds,
  storyDnaInputForVerifiedRow,
  storyDnaLookupStatus,
  storyGraphDiagnostics,
  storyGraphOfflineEvaluation,
  storyGraphServingNdcgAt6,
  storyGraphServingWorkSnapshot,
  themeStratifiedStoryDnaInputs,
  type StoryGraphRefreshDependencies,
} from './story-graph-service.js';

async function withTempDatabases(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mango-story-graph-service-'));
  const previousLibrary = process.env.MANGO_LIBRARY_DB_PATH;
  const previousPins = process.env.MANGO_USER_PINS_PATH;
  const previousPlayability = process.env.MANGO_PLAYABILITY_DB;
  const previousProfileMode = process.env.MANGO_VOD_CONTENT_PROFILE;
  process.env.MANGO_LIBRARY_DB_PATH = join(directory, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(directory, 'pins.json');
  process.env.MANGO_PLAYABILITY_DB = join(directory, 'playability.db');
  process.env.MANGO_VOD_CONTENT_PROFILE = 'strict-v1';
  resetLibraryDbForTests();
  resetPlayabilityDbForTests();
  try {
    libraryDatabase();
    await initPlayabilityDb();
    await fn();
  } finally {
    resetLibraryDbForTests();
    resetPlayabilityDbForTests();
    if (previousLibrary === undefined) delete process.env.MANGO_LIBRARY_DB_PATH;
    else process.env.MANGO_LIBRARY_DB_PATH = previousLibrary;
    if (previousPins === undefined) delete process.env.MANGO_USER_PINS_PATH;
    else process.env.MANGO_USER_PINS_PATH = previousPins;
    if (previousPlayability === undefined) delete process.env.MANGO_PLAYABILITY_DB;
    else process.env.MANGO_PLAYABILITY_DB = previousPlayability;
    if (previousProfileMode === undefined) delete process.env.MANGO_VOD_CONTENT_PROFILE;
    else process.env.MANGO_VOD_CONTENT_PROFILE = previousProfileMode;
    await rm(directory, { recursive: true, force: true });
  }
}

function documentFor(input: StoryDnaInput): StoryDnaDocument {
  const request = storyDnaRequestItem(input);
  const numeric = Number.parseInt(input.id.replace(/\D/g, ''), 10) || 0;
  const flavor = numeric % 3;
  const confidence = {
    overall: 0.9,
    genre_subgenre: 0.9,
    format: 0.9,
    story_engine: 0.9,
    themes: 0.9,
    character_dynamics: 0.9,
    tone: 0.9,
    setting_era: 0.9,
    geographic_scope: 0.9,
    social_setting: 0.9,
    narrative_structure: 0.9,
    ending_emotional_arc: 0.9,
    facets: 0.9,
  } as const;
  return {
    type: input.type,
    id: input.id,
    schema_version: STORY_DNA_SCHEMA_VERSION,
    ontology_version: STORY_DNA_ONTOLOGY_VERSION,
    teacher_role: 'content-only',
    model_version: 'test-content-teacher',
    prompt_version: STORY_DNA_PROMPT_VERSION,
    input_hash: storyDnaInputHash(input),
    genre_subgenres: [flavor === 0 ? 'action' : flavor === 1 ? 'drama' : 'comedy'],
    format: input.type === 'movie' ? 'feature-film' : 'ongoing-series',
    story_engines: [flavor === 0 ? 'quest' : flavor === 1 ? 'family-conflict' : 'workplace'],
    themes: [flavor === 0 ? 'justice' : flavor === 1 ? 'family' : 'friendship'],
    character_dynamics: [flavor === 0 ? 'lone-protagonist' : flavor === 1 ? 'parent-child' : 'team'],
    tone: [flavor === 0 ? 'suspenseful' : flavor === 1 ? 'warm' : 'witty'],
    setting_era: 'contemporary',
    geographic_scope: 'city',
    social_settings: [flavor === 0 ? 'criminal-underworld' : flavor === 1 ? 'domestic' : 'workplace'],
    narrative_structures: ['linear'],
    ending_emotional_arc: flavor === 0 ? 'triumphant' : flavor === 1 ? 'bittersweet' : 'uplifting',
    facets: {
      pace: flavor === 1 ? 1 : 4,
      action: flavor === 0 ? 4 : 0,
      tension: flavor === 0 ? 4 : 1,
      spectacle: flavor === 0 ? 4 : 1,
      humor: flavor === 2 ? 4 : 0,
      romance: flavor === 1 ? 2 : 0,
      fear: flavor === 0 ? 2 : 0,
      tenderness: flavor === 1 ? 4 : 1,
      sadness: flavor === 1 ? 3 : 0,
      hope: flavor === 1 ? 3 : 2,
      realism: flavor === 1 ? 4 : 2,
      narrative_complexity: 2,
      moral_ambiguity: flavor === 0 ? 3 : 1,
      violence: flavor === 0 ? 4 : 0,
      family_accessibility: flavor === 0 ? 0 : 4,
    },
    confidence,
    provenance: {
      teacher: 'llm-content-teacher',
      content_only: true,
      evidence_hash: storyDnaEvidenceHash(input),
      evidence_fields: storyDnaEvidenceFields(input),
      sources: request.evidence.sources,
    },
    selective_lookup: request.selective_lookup,
  };
}

function inMemoryTeacher(): {
  dependencies: Pick<StoryGraphRefreshDependencies, 'refreshTeacher' | 'loadTeacherCache'>;
  documents: Map<string, StoryDnaDocument>;
} {
  const documents = new Map<string, StoryDnaDocument>();
  return {
    documents,
    dependencies: {
      loadTeacherCache: (inputs) => new Map(inputs.flatMap((input) => {
        const key = `${input.type}:${input.id}`;
        const document = documents.get(key);
        return document?.input_hash === storyDnaInputHash(input)
          ? [[key, document] as const]
          : [];
      })),
      refreshTeacher: async (inputs) => {
        for (const input of inputs) documents.set(`${input.type}:${input.id}`, documentFor(input));
        return {
          requested: inputs.length,
          persisted: inputs.length,
          cached: 0,
          documents: inputs.map(documentFor),
          failures: [],
        };
      },
    },
  };
}

function seedVerifiedMovies(count: number): void {
  seedVerifiedTitles('movie', count, 'm', 3);
}

function seedVerifiedTitles(
  type: 'movie' | 'series',
  count: number,
  prefix: string,
  pad: number,
  options: { sparse?: boolean } = {},
): void {
  const db = getPlayabilityDb();
  const insertTitle = db.prepare(`
INSERT INTO titles(type, id, status, best_source, verified_at, updated_at)
VALUES (?, ?, 'verified', 'test', ?, ?)
`);
  const insertPool = db.prepare(`
INSERT INTO rail_pool(
  rail_id, type, id, score, ingested_at, title, poster_url, year,
  evidence_json, evidence_hash, evidence_source, evidence_retrieved_at
) VALUES (?, ?, ?, 1, ?, ?, ?, '2024', ?, ?, 'test:addon', ?)
`);
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const id = `${prefix}${String(index).padStart(pad, '0')}`;
      const title = `${type === 'movie' ? 'Movie' : 'Series'} ${index}`;
      const evidence = JSON.stringify({
        synopsis: options.sparse
          ? `Short synopsis for ${title}.`
          : `A complete grounded synopsis for ${title} `.repeat(5),
        genres: [index % 3 === 0 ? 'action' : index % 3 === 1 ? 'drama' : 'comedy'],
        keywords: [],
        languages: ['English'],
        countries: ['United States'],
        runtime_minutes: type === 'movie' ? 105 : 48,
        release_state: 'released',
        format: type === 'movie' ? 'feature-film' : 'ongoing-series',
        cast: [`Actor ${index}`],
        characters: [],
        directors: [`Director ${index % 12}`],
        writers: [`Writer ${index % 18}`],
        awards: null,
        certification: 'PG-13',
        external_ids: { catalog: id },
      });
      insertTitle.run(type, id, index + 1, index + 1);
      insertPool.run(
        `theme-${index % 9}`,
        type,
        id,
        index + 1,
        title,
        `https://example.test/${id}.jpg`,
        evidence,
        `evidence-${index}`,
        index + 1,
      );
    }
  })();
}

function evaluationRating(
  type: 'movie' | 'series',
  id: string,
  fire: FireWaterRating['fire'],
  water: FireWaterRating['water'],
): FireWaterRating {
  return {
    profile_id: 'household', type, id, title: id, year: null,
    fire, water, revision: 1, origin: 'couch', taste_tags: [], updated_at: 1,
  };
}

function passingEvaluation(
  input: Parameters<typeof evaluateStoryGraphOffline>[0],
): ReturnType<typeof evaluateStoryGraphOffline> {
  return {
    version: 'vod-story-graph-evaluation-v1',
    rank_generation_id: input.rankGenerationId,
    status: 'passed',
    samples: input.ratings.length,
    folds: 5,
    holistic_ndcg_at_6: { v2: 1, v4: 0.8, relative_improvement: 0.25 },
    paired_bootstrap_90: { low: 0.01, high: 0.2, iterations: 2_000 },
    fire_pairwise_concordance_ge_4: { v2: 1, v4: 1, regression: 0 },
    water_pairwise_concordance_ge_4: { v2: 1, v4: 1, regression: 0 },
    low_low_top_6_intrusion_rate: { v2: 0, v4: 0, regression: 0 },
    verified_accounting_complete: input.accountedCount === input.verifiedCount,
    coverage: input.verifiedCount > 0 ? input.reserveDepth / input.verifiedCount : 1,
    deterministic: true,
    worker_latency_ms: input.workerLatencyMs,
    cached_service_p95_ms: input.cachedServiceP95Ms ?? null,
    promotion_eligible: true,
    reasons: [],
    evaluated_at: input.now,
  };
}

test('theme-stratified backfill interleaves stable curated memberships', () => {
  const inputs = [
    { type: 'movie' as const, id: 'a2', title: 'A2', rail_ids: ['a'] },
    { type: 'movie' as const, id: 'a1', title: 'A1', rail_ids: ['a'] },
    { type: 'movie' as const, id: 'b2', title: 'B2', rail_ids: ['b'] },
    { type: 'movie' as const, id: 'b1', title: 'B1', rail_ids: ['b'] },
  ];
  assert.deepEqual(themeStratifiedStoryDnaInputs(inputs).map((input) => input.id), [
    'a1', 'b1', 'a2', 'b2',
  ]);
});

test('StoryDNA source input excludes AI catalogs and preserves field provenance', () => {
  const row: VerifiedRecommendationCatalogRow = {
    type: 'movie', id: 'TT-CURATED', title: 'Curated', poster: 'poster.jpg', year: '2024',
    rail_ids: ['theme-b', 'ai-household-favorites', 'theme-a', 'theme-b'],
    evidence_json: JSON.stringify({
      synopsis: 'Grounded synopsis.', genres: ['Drama'], keywords: ['Community'],
      field_provenance: { synopsis: ['TMDB'], genres: ['Addon'] },
    }),
    evidence_hash: 'hash', evidence_source: 'addon:catalog', evidence_retrieved_at: 123,
    best_source: 'test', verified_at: 1, updated_at: 2,
  };
  const input = storyDnaInputForVerifiedRow(row)!;
  assert.deepEqual(input.curated_pool_memberships, ['theme-a', 'theme-b']);
  assert.deepEqual(input.keywords, ['Community']);
  assert.deepEqual(input.field_provenance, { genres: ['Addon'], synopsis: ['TMDB'] });
});

test('five-fold assignment is deterministic and stratified by media and axis relevance', () => {
  const ratings: FireWaterRating[] = [];
  for (const type of ['movie', 'series'] as const) {
    for (const [label, fire, water] of [
      ['fire', 5, 0], ['water', 0, 5], ['both', 5, 5], ['low', 2.5, 2.5],
    ] as const) {
      for (let index = 0; index < 10; index += 1) {
        ratings.push(evaluationRating(type, `${label}-${index}`, fire, water));
      }
    }
  }
  const first = stableStoryGraphEvaluationFolds(ratings);
  const replay = stableStoryGraphEvaluationFolds([...ratings].reverse());
  assert.deepEqual([...first].sort(), [...replay].sort());
  for (const type of ['movie', 'series'] as const) {
    for (const label of ['fire', 'water', 'both', 'low']) {
      const folds = new Set(Array.from({ length: 10 }, (_, index) => (
        first.get(`${type}:${label}-${index}`)
      )));
      assert.deepEqual([...folds].sort(), [0, 1, 2, 3, 4]);
    }
  }
});

test('offline nDCG follows risk-adjusted rank_score rather than predicted-rating order', () => {
  const correct = storyGraphServingNdcgAt6([
    { relevance: 1, recommendation: { rank_score: 10 } },
    { relevance: 0.2, recommendation: { rank_score: 1 } },
  ]);
  const reversed = storyGraphServingNdcgAt6([
    { relevance: 1, recommendation: { rank_score: 1 } },
    { relevance: 0.2, recommendation: { rank_score: 10 } },
  ]);
  assert.equal(correct, 1);
  assert.ok(reversed !== null && reversed < 1);
});

test('full v2 publication accounts for every verified row and couch shuffle is cached-only', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(205);
    putRating({
      profile_id: 'household',
      type: 'movie',
      id: 'm000',
      title: 'Movie 0',
      fire: 5,
      water: 5,
      expected_revision: 0,
      origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    let rankCalls = 0;
    const result = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 200,
      teacher_limit: 205,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input) => {
          rankCalls += 1;
          return rankStoryGraphRecommendations(input);
        },
        evaluate: (input) => ({
          ...evaluateStoryGraphOffline(input),
          status: 'passed',
          promotion_eligible: true,
          reasons: [],
        }),
      },
    });
    assert.equal(result.verified_count, 205);
    assert.equal(result.scored_count + result.excluded_count, 205);
    assert.equal(result.reserve_depth, 204);
    assert.equal(result.published, true);
    assert.equal(rankCalls, 1);
    assert.ok(
      result.evaluation.cached_service_p95_ms !== null
        && result.evaluation.cached_service_p95_ms <= 250,
      `prospective cached service p95 ${result.evaluation.cached_service_p95_ms}ms exceeds 250ms`,
    );
    const probeArtifacts = libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM profile_recommendation_served_slates
`).get() as { count: number };
    assert.equal(probeArtifacts.count, 0, 'promotion latency probes must roll back attribution rows');
    const stored = libraryDatabase().prepare(`
SELECT COUNT(*) AS count,
       SUM(CASE WHEN serving_eligible = 1 THEN 1 ELSE 0 END) AS eligible,
       SUM(CASE WHEN exclusion_reason IS NOT NULL THEN 1 ELSE 0 END) AS excluded
FROM vod_rank_items WHERE rank_generation_id = ?
`).get(result.rank_generation_id) as { count: number; eligible: number; excluded: number };
    assert.deepEqual(stored, { count: 205, eligible: 204, excluded: 1 });
    const fixedParents = libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_ontology_edges
WHERE edge_kind = 'parent' AND to_node_key LIKE '%parent%'
`).get() as { count: number };
    assert.ok(fixedParents.count > 0, 'fixed parent relations must be persisted and folded into titles');
    const first = await loadStoryGraphForYouRail('movies');
    assert.equal(first?.items.length, 6);
    assert.equal(first?.items.some((item) => item.id === 'm000'), false);
    const exactSavedId = first!.items[0]!.id;
    saveLibraryItem({
      source: 'stremio',
      type: 'movie',
      id: exactSavedId,
      title: first!.items[0]!.title,
      poster: first!.items[0]!.poster,
    });
    const healed = await loadStoryGraphForYouRail('movies');
    assert.equal(healed?.items.some((item) => item.id === exactSavedId), false);
    const slates: string[][] = [healed!.items.map((item) => item.id)];
    resetStoryGraphServingWorkCounters();
    for (let shuffle = 0; shuffle < 5; shuffle += 1) {
      const rail = await loadStoryGraphForYouRail('movies', { reshuffle: true });
      assert.equal(rail?.items.length, 6);
      const ids = rail!.items.map((item) => item.id);
      for (const prior of slates.slice(-4)) {
        assert.equal(ids.some((id) => prior.includes(id)), false);
      }
      slates.push(ids);
    }
    assert.equal(rankCalls, 1, 'X must not invoke the graph ranker');
    const hotPath = storyGraphServingWorkSnapshot();
    assert.equal(hotPath.full_reserve_queries, 0, 'X must not read the full reserve');
    assert.equal(hotPath.full_reserve_rows_loaded, 0);
    assert.equal(hotPath.dealer_calls, 0, 'X must not deal a new slate');
    assert.ok(hotPath.queue_slates_scanned <= 5 * 8);
    assert.ok(hotPath.slate_items_revalidated <= 5 * (1 + 8) * 6);
    const diagnostics = storyGraphDiagnostics().domains.find((domain) => domain.content_type === 'movie');
    assert.equal(diagnostics?.verified_count, 205);
    assert.equal(diagnostics?.scored_count! + diagnostics?.excluded_count!, 205);
    assert.equal(diagnostics?.evaluation?.status, 'passed');
  });
});

test('rating origin and age do not change Story Graph taste or rank output', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(12);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 0, expected_revision: 0, origin: 'seed',
    });
    // A second single-axis anchor supplies one explicit-equivalent unit while
    // preserving the exact axes used in both comparison generations.
    putRating({
      profile_id: 'household', type: 'movie', id: 'm003', title: 'Movie 3',
      fire: 5, water: 0, expected_revision: 0, origin: 'seed',
    });
    libraryDatabase().prepare(`
UPDATE profile_content_ratings
SET updated_at = 1
WHERE profile_id = 'household' AND content_type = 'movie'
`).run();
    const teacher = inMemoryTeacher();
    const options = {
      now: 1_800_000_000_000,
      bootstrap_minimum: 6,
      teacher_limit: 12,
      cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => (
          rankStoryGraphRecommendations(input)
        ),
        evaluate: passingEvaluation,
      },
    };
    const first = await refreshStoryGraphForYou('movies', options);
    const readRanks = (generation: number) => libraryDatabase().prepare(`
SELECT content_id, best_thread, predicted_fire, predicted_water,
       explicit_support, implicit_support, uncertainty, rank_score
FROM vod_rank_items WHERE rank_generation_id = ? ORDER BY content_id
`).all(generation);
    const readThreads = (generation: number) => libraryDatabase().prepare(`
SELECT thread_index, posterior_json, effective_evidence_mass, fire_uplift,
       water_uplift, uncertainty
FROM vod_taste_threads WHERE taste_generation_id = ? ORDER BY thread_index
`).all(generation);
    const firstRanks = readRanks(first.rank_generation_id);
    const firstThreads = readThreads(first.taste_generation_id);

    libraryDatabase().prepare(`
UPDATE profile_content_ratings
SET origin = 'couch', updated_at = 9_999_999_999_999
WHERE profile_id = 'household' AND content_type = 'movie'
`).run();
    const second = await refreshStoryGraphForYou('movies', options);
    assert.equal(second.story_generation_id, first.story_generation_id);
    assert.deepEqual(readThreads(second.taste_generation_id), firstThreads);
    assert.deepEqual(readRanks(second.rank_generation_id), firstRanks);
  });
});

test('structured lookup rotates fairly, persists only material unions, and records provenance', async () => {
  await withTempDatabases(async () => {
    seedVerifiedTitles('movie', 8, 's', 3, { sparse: true });
    putRating({
      profile_id: 'household', type: 'movie', id: 's000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const previousLimit = process.env.MANGO_STORY_DNA_LOOKUP_LIMIT;
    process.env.MANGO_STORY_DNA_LOOKUP_LIMIT = '1';
    const teacher = inMemoryTeacher();
    const lookupIds: string[] = [];
    let lookupCall = 0;
    const lookup = async (inputs: readonly StoryDnaInput[]): Promise<StoryDnaInput[]> => {
      lookupCall += 1;
      lookupIds.push(...inputs.map((input) => input.id));
      if (lookupCall === 1) return inputs.map((input) => ({ ...input }));
      return inputs.map((input) => ({
        ...input,
        synopsis: `A materially richer structured synopsis for ${input.title}. `.repeat(5),
        genres: ['thriller'],
        keywords: ['investigation'],
        cast: ['Structured Actor'],
        evidence_sources: ['structured:test'],
        field_provenance: {
          synopsis: ['structured:test'], genres: ['structured:test'],
          keywords: ['structured:test'], cast: ['structured:test'],
        },
        retrieved_at: 20_000 + lookupCall,
      }));
    };
    const run = (now: number) => refreshStoryGraphForYou('movies', {
      now,
      bootstrap_minimum: 6,
      teacher_limit: 8,
      cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        lookup,
        rank: async (input) => rankStoryGraphRecommendations(input),
        evaluate: (input) => ({
          ...evaluateStoryGraphOffline(input), status: 'passed',
          promotion_eligible: true, reasons: [],
        }),
      },
    });
    try {
      await run(10_000);
      assert.equal(storyDnaLookupStatus('movie')?.material, 0);
      assert.equal(storyDnaLookupStatus('movie')?.unresolved, 1);
      await run(20_000);
      const materialId = lookupIds[1]!;
      assert.notEqual(materialId, lookupIds[0]);
      assert.equal(storyDnaLookupStatus('movie')?.material, 1);
      assert.equal(storyDnaLookupStatus('movie')?.provider_failed, false);
      const persisted = libraryDatabase().prepare(`
SELECT evidence_json, lookup_used FROM vod_story_dna_documents
WHERE content_type = 'movie' AND content_id = ?
ORDER BY generation_id DESC LIMIT 1
`).get(materialId) as { evidence_json: string; lookup_used: number };
      const request = JSON.parse(persisted.evidence_json) as ReturnType<typeof storyDnaRequestItem>;
      assert.deepEqual(request.evidence.genres, [
        Number.parseInt(materialId.slice(1), 10) % 3 === 0 ? 'action'
          : Number.parseInt(materialId.slice(1), 10) % 3 === 1 ? 'drama' : 'comedy',
        'thriller',
      ]);
      assert.deepEqual(request.evidence.keywords, ['investigation']);
      assert.deepEqual(request.evidence.field_provenance.genres, ['structured:test']);
      assert.equal(request.evidence.retrieved_at, '20002');
      assert.equal(request.selective_lookup.used, true);
      assert.equal(persisted.lookup_used, 1);

      await run(30_000);
      assert.notEqual(lookupIds[2], materialId, 'material lookup cache must not be re-queried');
      assert.equal(new Set(lookupIds).size, 3, 'rotating cursor must not starve later sparse titles');
    } finally {
      if (previousLimit === undefined) delete process.env.MANGO_STORY_DNA_LOOKUP_LIMIT;
      else process.env.MANGO_STORY_DNA_LOOKUP_LIMIT = previousLimit;
    }
  });
});

test('mixed teacher-model generation is rejected while last-good remains active', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(12);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const first = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 6, teacher_limit: 12, cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input) => rankStoryGraphRecommendations(input),
        evaluate: (input) => ({
          ...evaluateStoryGraphOffline(input), status: 'passed',
          promotion_eligible: true, reasons: [],
        }),
      },
    });
    assert.equal(first.activated, true);
    const mixedDependencies: Pick<StoryGraphRefreshDependencies, 'loadTeacherCache' | 'refreshTeacher'> = {
      loadTeacherCache: (inputs) => new Map(inputs.map((input, index) => {
        const document = documentFor(input);
        return [`${input.type}:${input.id}`, {
          ...document,
          model_version: index % 2 === 0 ? 'teacher-a' : 'teacher-b',
        }];
      })),
      refreshTeacher: async () => {
        throw new Error('mixed cached generation must be rejected before teacher refresh');
      },
    };
    await assert.rejects(() => refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 6, teacher_limit: 12,
      dependencies: {
        ...mixedDependencies,
        rank: async (input) => rankStoryGraphRecommendations(input),
      },
    }), /mixed StoryDNA teacher model generation rejected/);
    const active = libraryDatabase().prepare(`
SELECT active_rank_generation_id FROM vod_active_generations WHERE content_type = 'movie'
`).get() as { active_rank_generation_id: number };
    assert.equal(active.active_rank_generation_id, first.rank_generation_id);
    assert.equal((await loadStoryGraphForYouRail('movies'))?.items.length, 6);
  });
});

test('StoryDNA header, children, edges, and completion commit atomically across failure and restart', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(12);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    await assert.rejects(() => refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 6,
      teacher_limit: 12,
      dependencies: {
        ...teacher.dependencies,
        persistStoryGenerationFault: (point) => {
          if (point === 'before_complete') throw new Error('injected-story-persist-crash');
        },
        rank: async (input) => rankStoryGraphRecommendations(input),
        evaluate: passingEvaluation,
      },
    }), /injected-story-persist-crash/);
    const db = libraryDatabase();
    assert.deepEqual(db.prepare(`
SELECT
  (SELECT COUNT(*) FROM vod_story_dna_generations) AS generations,
  (SELECT COUNT(*) FROM vod_story_dna_documents) AS documents,
  (SELECT COUNT(*) FROM vod_story_dna_edges) AS edges
`).get(), { generations: 0, documents: 0, edges: 0 });

    const interrupted = db.prepare(`
INSERT INTO vod_story_dna_generations(
  content_type, schema_version, ontology_version, prompt_version, model_version,
  corpus_generation, evidence_revision, status, verified_count, complete_count,
  failure_count, started_at
) VALUES ('movie', ?, ?, ?, 'test-content-teacher', 1, 'interrupted', 'building', 12, 0, 0, 1)
RETURNING generation_id
`).get(STORY_DNA_SCHEMA_VERSION, STORY_DNA_ONTOLOGY_VERSION, STORY_DNA_PROMPT_VERSION) as {
      generation_id: number;
    };
    assert.equal(reconcileInterruptedStoryDnaGenerations(2), 1);
    assert.deepEqual(db.prepare(`
SELECT status, completed_at, last_error FROM vod_story_dna_generations WHERE generation_id = ?
`).get(interrupted.generation_id), {
      status: 'failed',
      completed_at: 2,
      last_error: 'interrupted_before_atomic_completion',
    });

    const recovered = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 6,
      teacher_limit: 12,
      cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input) => rankStoryGraphRecommendations(input),
        evaluate: passingEvaluation,
      },
    });
    const complete = db.prepare(`
SELECT status, verified_count, complete_count, failure_count
FROM vod_story_dna_generations WHERE generation_id = ?
`).get(recovered.story_generation_id);
    assert.deepEqual(complete, {
      status: 'complete', verified_count: 12, complete_count: 12, failure_count: 0,
    });
  });
});

test('StoryDNA reuse rejects child or edge corruption and builds a clean generation', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(12);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const options = {
      bootstrap_minimum: 6,
      teacher_limit: 12,
      cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => (
          rankStoryGraphRecommendations(input)
        ),
        evaluate: passingEvaluation,
      },
    };
    const first = await refreshStoryGraphForYou('movies', options);
    const db = libraryDatabase();
    const originalEdgeCount = (db.prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_edges
WHERE generation_id = ? AND content_type = 'movie' AND content_id = 'm001'
`).get(first.story_generation_id) as { count: number }).count;
    const victim = db.prepare(`
SELECT node_key FROM vod_story_dna_edges
WHERE generation_id = ? AND content_type = 'movie' AND content_id = 'm001'
ORDER BY node_key LIMIT 1
`).get(first.story_generation_id) as { node_key: string };
    const foreign = db.prepare(`
SELECT node_key, family, intensity, confidence, edge_source
FROM vod_story_dna_edges source
WHERE source.generation_id = ? AND source.content_type = 'movie' AND source.content_id = 'm002'
  AND NOT EXISTS (
    SELECT 1 FROM vod_story_dna_edges target
    WHERE target.generation_id = source.generation_id
      AND target.content_type = 'movie' AND target.content_id = 'm001'
      AND target.node_key = source.node_key
  )
ORDER BY source.node_key LIMIT 1
`).get(first.story_generation_id) as {
      node_key: string;
      family: string;
      intensity: number;
      confidence: number;
      edge_source: string;
    };
    db.transaction(() => {
      db.prepare(`
DELETE FROM vod_story_dna_edges
WHERE generation_id = ? AND content_type = 'movie' AND content_id = 'm001' AND node_key = ?
`).run(first.story_generation_id, victim.node_key);
      db.prepare(`
INSERT INTO vod_story_dna_edges(
  generation_id, content_type, content_id, node_key, family,
  intensity, confidence, edge_source
) VALUES (?, 'movie', 'm001', ?, ?, ?, ?, ?)
`).run(
        first.story_generation_id,
        foreign.node_key,
        foreign.family,
        foreign.intensity,
        foreign.confidence,
        foreign.edge_source,
      );
    })();
    assert.equal((db.prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_edges
WHERE generation_id = ? AND content_type = 'movie' AND content_id = 'm001'
`).get(first.story_generation_id) as { count: number }).count, originalEdgeCount);
    const second = await refreshStoryGraphForYou('movies', options);
    assert.notEqual(second.story_generation_id, first.story_generation_id);
    assert.equal((db.prepare(`
SELECT status FROM vod_story_dna_generations WHERE generation_id = ?
`).get(first.story_generation_id) as { status: string }).status, 'failed');
    const missingEdges = db.prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_documents docs
WHERE docs.generation_id = ? AND docs.status = 'valid'
  AND NOT EXISTS (
    SELECT 1 FROM vod_story_dna_edges edges
    WHERE edges.generation_id = docs.generation_id
      AND edges.content_type = docs.content_type AND edges.content_id = docs.content_id
  )
`).get(second.story_generation_id) as { count: number };
    assert.equal(missingEdges.count, 0);
  });
});

test('household taste changes reuse immutable StoryDNA instead of regenerating content profiles', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(12);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const options = {
      bootstrap_minimum: 6,
      teacher_limit: 12,
      cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => (
          rankStoryGraphRecommendations(input)
        ),
        evaluate: passingEvaluation,
      },
    };
    const first = await refreshStoryGraphForYou('movies', options);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm001', title: 'Movie 1',
      fire: 5, water: 0, expected_revision: 0, origin: 'couch',
    });
    const second = await refreshStoryGraphForYou('movies', {
      ...options,
      trigger_reasons: ['rating_change'],
    });
    assert.equal(second.story_generation_id, first.story_generation_id);
    assert.notEqual(second.taste_generation_id, first.taste_generation_id);
    assert.notEqual(second.rank_generation_id, first.rank_generation_id);
    const count = libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_generations WHERE content_type = 'movie'
`).get() as { count: number };
    assert.equal(count.count, 1);
  });
});

test('initial shadow taste mutation runs one complete promotion and never a priority bootstrap', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(260);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const candidateCounts: number[] = [];
    let evaluationCalls = 0;
    const previousMode = process.env.MANGO_VOD_RECS_V2;
    process.env.MANGO_VOD_RECS_V2 = 'shadow';
    try {
      const result = await refreshStoryGraphForYou('movies', {
        bootstrap_minimum: 200,
        teacher_limit: 260,
        cached_service_p95_ms: 1,
        trigger_reasons: ['rating_change'],
        dependencies: {
          ...teacher.dependencies,
          rank: async (input) => {
            candidateCounts.push(input.candidate_ids?.length ?? input.documents.length);
            return rankStoryGraphRecommendations(input);
          },
          evaluate: (input) => {
            evaluationCalls += 1;
            return passingEvaluation(input);
          },
        },
      });
      assert.deepEqual(candidateCounts, [260]);
      assert.equal(evaluationCalls, 1);
      assert.equal(result.rank_status, 'complete');
      assert.equal(result.scored_count + result.excluded_count, 260);
      assert.equal(result.unscored_count, 0);
      assert.equal(result.activated, true);
      const generations = libraryDatabase().prepare(`
SELECT status, trigger_reasons_json FROM vod_rank_generations ORDER BY rank_generation_id
`).all() as Array<{ status: string; trigger_reasons_json: string }>;
      assert.equal(generations.length, 1);
      assert.equal(generations[0]?.status, 'complete');
      assert.equal(JSON.parse(generations[0]!.trigger_reasons_json).includes('priority_rescore'), false);
    } finally {
      if (previousMode === undefined) delete process.env.MANGO_VOD_RECS_V2;
      else process.env.MANGO_VOD_RECS_V2 = previousMode;
    }
  });
});

test('taste mutation publishes an honest partial reserve before full-corpus follow-up', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(260);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const rankCandidateCounts: number[] = [];
    const activeAtRankStart: Array<number | null> = [];
    let evaluationCalls = 0;
    const dependencies = {
      ...teacher.dependencies,
      rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => {
        rankCandidateCounts.push(input.candidate_ids?.length ?? input.documents.length);
        const active = libraryDatabase().prepare(`
SELECT active_rank_generation_id FROM vod_active_generations WHERE content_type = 'movie'
`).get() as { active_rank_generation_id: number } | undefined;
        activeAtRankStart.push(active?.active_rank_generation_id ?? null);
        return rankStoryGraphRecommendations(input);
      },
      evaluate: (input: Parameters<typeof evaluateStoryGraphOffline>[0]) => {
        evaluationCalls += 1;
        return passingEvaluation(input);
      },
    };
    const initial = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 200, teacher_limit: 260, cached_service_p95_ms: 1,
      dependencies,
    });
    putRating({
      profile_id: 'household', type: 'movie', id: 'm001', title: 'Movie 1',
      fire: 5, water: 0, expected_revision: 0, origin: 'couch',
    });
    const final = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 200, teacher_limit: 260, cached_service_p95_ms: 1,
      trigger_reasons: ['rating_change'],
      dependencies,
    });
    assert.deepEqual(rankCandidateCounts, [260, 240, 260]);
    const intermediateActive = activeAtRankStart[2];
    assert.notEqual(intermediateActive, initial.rank_generation_id);
    assert.notEqual(intermediateActive, final.rank_generation_id);
    const intermediate = libraryDatabase().prepare(`
SELECT verified_count, scored_count, eligible_count, excluded_count, cursor,
       trigger_reasons_json, status, published_at, completed_at
FROM vod_rank_generations WHERE rank_generation_id = ?
`).get(intermediateActive) as {
      verified_count: number;
      scored_count: number;
      eligible_count: number;
      excluded_count: number;
      cursor: string;
      trigger_reasons_json: string;
      status: string;
      published_at: number | null;
      completed_at: number | null;
    };
    assert.ok(intermediate.eligible_count >= 200);
    assert.equal(intermediate.verified_count, 260);
    assert.equal(intermediate.scored_count, intermediate.eligible_count);
    assert.equal(intermediate.scored_count + intermediate.excluded_count, 240);
    assert.equal(intermediate.cursor, 'priority:240/260');
    assert.equal(intermediate.status, 'bootstrap');
    assert.notEqual(intermediate.published_at, null);
    assert.equal(intermediate.completed_at, null);
    assert.equal((libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_rank_items
WHERE rank_generation_id = ? AND exclusion_reason = 'unscored'
`).get(intermediateActive) as { count: number }).count, 0);
    const partialEvaluation = storyGraphOfflineEvaluation('movie', intermediateActive);
    assert.equal(partialEvaluation?.verified_accounting_complete, false);
    assert.equal(partialEvaluation?.promotion_eligible, false);
    assert.ok(partialEvaluation?.reasons.includes('partial_priority_generation'));
    assert.ok(JSON.parse(intermediate.trigger_reasons_json).includes('priority_rescore'));
    const finalGeneration = libraryDatabase().prepare(`
SELECT eligible_count, excluded_count, trigger_reasons_json, status
FROM vod_rank_generations WHERE rank_generation_id = ?
`).get(final.rank_generation_id) as {
      eligible_count: number;
      excluded_count: number;
      trigger_reasons_json: string;
      status: string;
    };
    assert.equal(finalGeneration.eligible_count, 258);
    assert.equal(finalGeneration.eligible_count + finalGeneration.excluded_count, 260);
    assert.equal(finalGeneration.status, 'complete');
    assert.equal(final.rank_status, 'complete');
    assert.equal(final.unscored_count, 0);
    assert.equal(final.coverage, 1);
    assert.equal(evaluationCalls, 2, 'priority bootstrap must not run the offline promotion gate');
    assert.ok(JSON.parse(finalGeneration.trigger_reasons_json).includes('full_corpus_followup'));
    const epochZeroOwners = libraryDatabase().prepare(`
SELECT COUNT(DISTINCT rank_generation_id) AS count
FROM vod_cached_slates WHERE content_type = 'movie' AND shuffle_epoch = 0
`).get() as { count: number };
    assert.ok(epochZeroOwners.count >= 3, 'rank generation is part of cached-slate identity');
  });
});

test('full-follow-up failure leaves the partial last-good honest and a later full scan recovers', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(260);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const common = {
      bootstrap_minimum: 200,
      teacher_limit: 260,
      cached_service_p95_ms: 1,
    };
    const initial = await refreshStoryGraphForYou('movies', {
      ...common,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => (
          rankStoryGraphRecommendations(input)
        ),
        evaluate: passingEvaluation,
      },
    });
    putRating({
      profile_id: 'household', type: 'movie', id: 'm001', title: 'Movie 1',
      fire: 5, water: 0, expected_revision: 0, origin: 'couch',
    });
    let mutationRankCalls = 0;
    let mutationEvaluationCalls = 0;
    await assert.rejects(() => refreshStoryGraphForYou('movies', {
      ...common,
      trigger_reasons: ['rating_change'],
      dependencies: {
        ...teacher.dependencies,
        rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => {
          mutationRankCalls += 1;
          if (mutationRankCalls === 2) throw new Error('injected-full-followup-crash');
          return rankStoryGraphRecommendations(input);
        },
        evaluate: (input) => {
          mutationEvaluationCalls += 1;
          return passingEvaluation(input);
        },
      },
    }), /injected-full-followup-crash/);
    assert.equal(mutationRankCalls, 2);
    assert.equal(mutationEvaluationCalls, 0, 'priority phase cannot run the promotion evaluator');

    const activeAfterCrash = libraryDatabase().prepare(`
SELECT active.active_rank_generation_id, active.previous_complete_rank_generation_id,
       ranks.status, ranks.verified_count, ranks.scored_count, ranks.excluded_count,
       ranks.cursor, ranks.completed_at
FROM vod_active_generations active
JOIN vod_rank_generations ranks ON ranks.rank_generation_id = active.active_rank_generation_id
WHERE active.content_type = 'movie'
`).get() as {
      active_rank_generation_id: number;
      previous_complete_rank_generation_id: number | null;
      status: string;
      verified_count: number;
      scored_count: number;
      excluded_count: number;
      cursor: string;
      completed_at: number | null;
    };
    assert.notEqual(activeAfterCrash.active_rank_generation_id, initial.rank_generation_id);
    assert.equal(activeAfterCrash.previous_complete_rank_generation_id, initial.rank_generation_id);
    assert.equal(activeAfterCrash.status, 'bootstrap');
    assert.equal(activeAfterCrash.verified_count, 260);
    assert.equal(activeAfterCrash.scored_count + activeAfterCrash.excluded_count, 240);
    assert.equal(activeAfterCrash.cursor, 'priority:240/260');
    assert.equal(activeAfterCrash.completed_at, null);
    const partialDiagnostics = storyGraphDiagnostics().domains.find((domain) => (
      domain.content_type === 'movie'
    ));
    assert.equal(partialDiagnostics?.rank_generation_id, activeAfterCrash.active_rank_generation_id);
    assert.equal(partialDiagnostics?.status, 'bootstrap');
    assert.equal(partialDiagnostics?.unscored_count, 20);
    assert.equal(partialDiagnostics?.coverage, 240 / 260);
    assert.equal(partialDiagnostics?.evaluation?.promotion_eligible, false);

    const recovered = await refreshStoryGraphForYou('movies', {
      ...common,
      trigger_reasons: ['manual_refresh'],
      dependencies: {
        ...teacher.dependencies,
        rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => (
          rankStoryGraphRecommendations(input)
        ),
        evaluate: passingEvaluation,
      },
    });
    assert.equal(recovered.rank_status, 'complete');
    assert.equal(recovered.scored_count + recovered.excluded_count, 260);
    assert.equal(recovered.unscored_count, 0);
    assert.equal(recovered.coverage, 1);
    assert.equal(recovered.activated, true);
    assert.equal((libraryDatabase().prepare(`
SELECT active_rank_generation_id FROM vod_active_generations WHERE content_type = 'movie'
`).get() as { active_rank_generation_id: number }).active_rank_generation_id, recovered.rank_generation_id);
  });
});

test('six-card heal failure asynchronously enqueues low-water without ranking in X', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(12);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    let rankCalls = 0;
    await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 6, teacher_limit: 12, cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input) => {
          rankCalls += 1;
          return rankStoryGraphRecommendations(input);
        },
        evaluate: passingEvaluation,
      },
    });
    const current = await loadStoryGraphForYouRail('movies');
    assert.equal(current?.items.length, 6);
    const keep = new Set(current!.items.slice(0, 5).map((item) => item.id));
    const db = getPlayabilityDb();
    db.prepare(`
UPDATE titles SET status = 'failed', updated_at = updated_at + 1
WHERE type = 'movie' AND id NOT IN (${[...keep].map(() => '?').join(',')})
`).run(...keep);
    let enqueued = 0;
    setStoryGraphLowWaterEnqueueHook((request) => {
      enqueued += 1;
      assert.equal(request.tab, 'movies');
      assert.equal(request.available_count, 11);
    });
    try {
      resetStoryGraphServingWorkCounters();
      assert.equal(await loadStoryGraphForYouRail('movies', { reshuffle: true }), null);
      assert.equal(enqueued, 0, 'X must return before the enqueue hook runs');
      assert.equal(rankCalls, 1, 'X must not invoke the ranker');
      assert.deepEqual(libraryDatabase().prepare(`
SELECT status, rank_generation_id, available_count
FROM vod_story_graph_low_water_requests WHERE content_type = 'movie'
`).get(), {
        status: 'pending',
        rank_generation_id: (libraryDatabase().prepare(`
SELECT active_rank_generation_id FROM vod_active_generations WHERE content_type = 'movie'
`).get() as { active_rank_generation_id: number }).active_rank_generation_id,
        available_count: 11,
      });
      const hotPath = storyGraphServingWorkSnapshot();
      assert.equal(hotPath.full_reserve_queries, 0);
      assert.equal(hotPath.dealer_calls, 0);
      assert.ok(hotPath.queue_slates_scanned <= 8);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(enqueued, 1);
      assert.equal(rankCalls, 1);
      assert.equal((libraryDatabase().prepare(`
SELECT status FROM vod_story_graph_low_water_requests WHERE content_type = 'movie'
`).get() as { status: string }).status, 'acknowledged');
      assert.equal(
        storyGraphDiagnostics().domains.find((domain) => domain.content_type === 'movie')
          ?.low_water?.reason,
        'six_card_heal_failed',
      );
    } finally {
      setStoryGraphLowWaterEnqueueHook(null);
    }
  });
});

test('pending low-water survives database restart and is acknowledged only after durable job creation', async () => {
  await withTempDatabases(async () => {
    setStoryGraphLowWaterEnqueueHook(null);
    libraryDatabase().prepare(`
INSERT INTO vod_story_graph_low_water_requests(
  content_type, tab, rank_generation_id, available_count, reason,
  requested_at, status, acknowledged_at, last_error
) VALUES ('movie', 'movies', 77, 5, 'six_card_heal_failed', 100, 'pending', NULL, NULL)
`).run();
    resetLibraryDbForTests();
    libraryDatabase();

    let releaseJob!: () => void;
    const jobCreated = new Promise<void>((resolve) => { releaseJob = resolve; });
    let calls = 0;
    setStoryGraphLowWaterEnqueueHook(async () => {
      calls += 1;
      await jobCreated;
    });
    try {
      replayPendingStoryGraphLowWater();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls, 1);
      assert.equal((libraryDatabase().prepare(`
SELECT status FROM vod_story_graph_low_water_requests WHERE content_type = 'movie'
`).get() as { status: string }).status, 'pending');
      releaseJob();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal((libraryDatabase().prepare(`
SELECT status FROM vod_story_graph_low_water_requests WHERE content_type = 'movie'
`).get() as { status: string }).status, 'acknowledged');
    } finally {
      setStoryGraphLowWaterEnqueueHook(null);
    }
  });
});

test('a newer low-water request arriving during dispatch is not stranded', async () => {
  await withTempDatabases(async () => {
    const db = libraryDatabase();
    db.prepare(`
INSERT INTO vod_story_graph_low_water_requests(
  content_type, tab, rank_generation_id, available_count, reason,
  requested_at, status, acknowledged_at, last_error
) VALUES ('movie', 'movies', 77, 5, 'six_card_heal_failed', 100, 'pending', NULL, NULL)
`).run();
    let releaseFirst!: () => void;
    const firstJob = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const calls: number[] = [];
    setStoryGraphLowWaterEnqueueHook(async (request) => {
      calls.push(request.requested_at);
      if (calls.length === 1) await firstJob;
    });
    try {
      replayPendingStoryGraphLowWater();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(calls, [100]);
      db.prepare(`
UPDATE vod_story_graph_low_water_requests
SET requested_at = 200, rank_generation_id = 78, available_count = 4,
    status = 'pending', acknowledged_at = NULL
WHERE content_type = 'movie'
`).run();
      replayPendingStoryGraphLowWater();
      releaseFirst();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(calls, [100, 200]);
      assert.deepEqual(db.prepare(`
SELECT status, rank_generation_id, requested_at
FROM vod_story_graph_low_water_requests WHERE content_type = 'movie'
`).get(), { status: 'acknowledged', rank_generation_id: 78, requested_at: 200 });
    } finally {
      setStoryGraphLowWaterEnqueueHook(null);
    }
  });
});

test('5,452 movies and 3,794 series bootstrap at 200 then reach complete rank accounting', async () => {
  await withTempDatabases(async () => {
    seedVerifiedTitles('movie', 5_452, 'mv', 5);
    seedVerifiedTitles('series', 3_794, 'tv', 5);
    putRating({
      profile_id: 'household', type: 'movie', id: 'mv00000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    putRating({
      profile_id: 'household', type: 'series', id: 'tv00000', title: 'Series 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const exercise = async (
      tab: 'movies' | 'series',
      type: 'movie' | 'series',
      verified: number,
    ) => {
      const common = {
        bootstrap_minimum: 200,
        cached_service_p95_ms: 1,
        dependencies: {
          ...teacher.dependencies,
          rank: async (input: Parameters<typeof rankStoryGraphRecommendations>[0]) => (
            rankStoryGraphRecommendations(input)
          ),
          evaluate: passingEvaluation,
        },
      };
      const bootstrap = await refreshStoryGraphForYou(tab, {
        ...common,
        teacher_limit: 201,
      });
      assert.equal(bootstrap.verified_count, verified);
      assert.equal(bootstrap.profiled_count, 201);
      assert.equal(bootstrap.reserve_depth, 200);
      assert.equal(bootstrap.scored_count + bootstrap.excluded_count, verified);
      assert.equal(bootstrap.published, true);
      const bootstrapRows = libraryDatabase().prepare(`
SELECT COUNT(*) AS total,
       SUM(serving_eligible) AS eligible,
       SUM(CASE WHEN exclusion_reason IS NOT NULL THEN 1 ELSE 0 END) AS excluded
FROM vod_rank_items WHERE rank_generation_id = ?
`).get(bootstrap.rank_generation_id) as { total: number; eligible: number; excluded: number };
      assert.deepEqual(bootstrapRows, { total: verified, eligible: 200, excluded: verified - 200 });

      const complete = await refreshStoryGraphForYou(tab, {
        ...common,
        teacher_limit: 10_000,
      });
      assert.equal(complete.profiled_count, verified);
      assert.equal(complete.retryable_failure_count, 0);
      assert.equal(complete.reserve_depth, verified - 1);
      assert.equal(complete.scored_count + complete.excluded_count, verified);
      const completeRows = libraryDatabase().prepare(`
SELECT COUNT(*) AS total,
       SUM(serving_eligible) AS eligible,
       SUM(CASE WHEN exclusion_reason IS NOT NULL THEN 1 ELSE 0 END) AS excluded
FROM vod_rank_items WHERE rank_generation_id = ?
`).get(complete.rank_generation_id) as { total: number; eligible: number; excluded: number };
      assert.deepEqual(completeRows, { total: verified, eligible: verified - 1, excluded: 1 });
      const diagnostics = storyGraphDiagnostics().domains.find((domain) => domain.content_type === type);
      assert.equal(diagnostics?.profiled_count, verified);
      assert.equal(diagnostics?.reserve_depth, verified - 1);
      resetStoryGraphServingWorkCounters();
      const cachedLatencies: number[] = [];
      for (let sample = 0; sample < 100; sample += 1) {
        const started = performance.now();
        assert.equal((await loadStoryGraphForYouRail(tab))?.items.length, 6);
        cachedLatencies.push(performance.now() - started);
      }
      assert.equal((await loadStoryGraphForYouRail(tab, { reshuffle: true }))?.items.length, 6);
      cachedLatencies.sort((left, right) => left - right);
      const p95 = cachedLatencies[Math.ceil(cachedLatencies.length * 0.95) - 1]!;
      assert.ok(p95 <= 250, `cached ${tab} service p95 ${p95.toFixed(2)}ms exceeds 250ms`);
      const hotPath = storyGraphServingWorkSnapshot();
      assert.equal(hotPath.full_reserve_queries, 0);
      assert.equal(hotPath.full_reserve_rows_loaded, 0);
      assert.equal(hotPath.dealer_calls, 0);
      assert.ok(hotPath.queue_slates_scanned <= 8);
    };
    await exercise('movies', 'movie', 5_452);
    await exercise('series', 'series', 3_794);
  });
});

test('captured corpus changes mark v2 work stale without replacing last-good', async () => {
  await withTempDatabases(async () => {
    const teacher = inMemoryTeacher();
    const items = Array.from({ length: 6 }, (_, index) => ({
      type: 'movie' as const,
      id: `stale-${index}`,
      title: `Stale ${index}`,
      poster: `https://example.test/stale-${index}.jpg`,
      year: '2024',
      rail_ids: [`theme-${index % 2}`],
      evidence_json: JSON.stringify({
        synopsis: 'Long grounded synopsis. '.repeat(10), genres: ['drama'], external_ids: {},
      }),
      evidence_hash: `hash-${index}`,
      evidence_source: 'test',
      evidence_retrieved_at: 1,
      best_source: 'test',
      verified_at: 1,
      updated_at: 1,
    }));
    await assert.rejects(() => refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 6,
      teacher_limit: 6,
      dependencies: {
        ...teacher.dependencies,
        listPage: async () => ({
          content_type: 'movie', corpus_generation: 10, verified_count: 6,
          after_id: null, next_cursor: null, items,
        }),
        corpusGeneration: async () => 11,
        rank: async (input) => rankStoryGraphRecommendations(input),
      },
    }), StaleStoryGraphGenerationError);
    const row = libraryDatabase().prepare(`
SELECT status, last_error FROM vod_rank_generations ORDER BY rank_generation_id DESC LIMIT 1
`).get() as { status: string; last_error: string };
    assert.deepEqual(row, { status: 'stale', last_error: 'corpus_revision_changed' });
    const active = libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_active_generations
`).get() as { count: number };
    assert.equal(active.count, 0);
  });
});

test('captured teacher configuration cannot publish after its model revision changes', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(8);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const previousModel = process.env.MANGO_STORY_DNA_MODEL_VERSION;
    delete process.env.MANGO_STORY_DNA_MODEL_VERSION;
    try {
      await assert.rejects(() => refreshStoryGraphForYou('movies', {
        bootstrap_minimum: 6,
        teacher_limit: 8,
        dependencies: {
          ...teacher.dependencies,
          rank: async (input) => {
            const result = rankStoryGraphRecommendations(input);
            process.env.MANGO_STORY_DNA_MODEL_VERSION = 'changed-mid-generation';
            return result;
          },
        },
      }), StaleStoryGraphGenerationError);
      const latest = libraryDatabase().prepare(`
SELECT status, last_error FROM vod_rank_generations ORDER BY rank_generation_id DESC LIMIT 1
`).get() as { status: string; last_error: string };
      assert.deepEqual(latest, { status: 'stale', last_error: 'teacher_configuration_changed' });
    } finally {
      if (previousModel === undefined) delete process.env.MANGO_STORY_DNA_MODEL_VERSION;
      else process.env.MANGO_STORY_DNA_MODEL_VERSION = previousModel;
    }
  });
});

test('an insufficient generation remains shadow and cannot become serve-active', async () => {
  await withTempDatabases(async () => {
    seedVerifiedMovies(12);
    putRating({
      profile_id: 'household', type: 'movie', id: 'm000', title: 'Movie 0',
      fire: 5, water: 5, expected_revision: 0, origin: 'couch',
    });
    const teacher = inMemoryTeacher();
    const result = await refreshStoryGraphForYou('movies', {
      bootstrap_minimum: 6,
      teacher_limit: 12,
      cached_service_p95_ms: 1,
      dependencies: {
        ...teacher.dependencies,
        rank: async (input) => rankStoryGraphRecommendations(input),
      },
    });
    assert.equal(result.published, true, 'complete shadow generation is retained for diagnostics');
    assert.equal(result.evaluation.rank_generation_id, result.rank_generation_id);
    assert.equal(result.evaluation.promotion_eligible, false);
    assert.equal(result.activated, false);
    const active = libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_active_generations
`).get() as { count: number };
    assert.equal(active.count, 0);
    const shadowSlates = libraryDatabase().prepare(`
SELECT COUNT(*) AS total,
       SUM(CASE WHEN rendered_at IS NOT NULL THEN 1 ELSE 0 END) AS rendered
FROM vod_cached_slates WHERE rank_generation_id = ?
`).get(result.rank_generation_id) as { total: number; rendered: number };
    assert.ok(shadowSlates.total >= 8, 'shadow generation keeps a bounded predealt queue');
    assert.equal(shadowSlates.rendered, 0, 'unactivated shadow slates never enter rendered history');
  });
});

test('v2 ranking and dealer integration contain no cosine, KNN, MMR, or semantic hash calls', async () => {
  const source = await readFile(new URL('../../src/recommendations/story-graph-service.ts', import.meta.url), 'utf8');
  const ranker = await readFile(new URL('../../src/recommendations/story-graph-v1.ts', import.meta.url), 'utf8');
  for (const forbidden of ['cosineSimilarity(', 'nearestNeighbor', 'MMR', 'semantic-hash-v4']) {
    assert.equal(`${source}\n${ranker}`.includes(forbidden), false, forbidden);
  }
});
