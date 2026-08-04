import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { libraryDatabase, resetLibraryDbForTests } from '../library/db.js';
import {
  buildAiEnrichedRecommendationFeature,
  loadAiRecommendationFeatures,
  loadStoryDnaTeacherCache,
  recommendationAiInputHash,
  refreshAiRecommendationFeatures,
  refreshStoryDnaTeacherCache,
  storyDnaTeacherConfiguration,
} from './ai.js';
import { cosineSimilarity } from './engine.js';
import {
  STORY_DNA_ONTOLOGY_VERSION,
  STORY_DNA_JSON_SCHEMA,
  STORY_DNA_PROMPT_VERSION,
  STORY_DNA_SCHEMA_VERSION,
  storyDnaEvidenceFields,
  storyDnaEvidenceHash,
  storyDnaInputHash,
  storyDnaRequestItem,
  storyDnaToGraphEdges,
  validateStoryDnaDocument,
  type StoryDnaDocument,
  type StoryDnaInput,
} from './story-dna.js';

function withTempLibrary<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-recommendation-ai-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  const cleanup = () => {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

const document = {
  type: 'movie' as const,
  id: 'tt1',
  model_version: 'test-model',
  prompt_version: 'recommendation-semantics-v1',
  input_hash: 'a'.repeat(64),
  themes: ['friendship', 'hopeful'],
  tone: ['warm'],
  pace: 'moderate' as const,
  tension: 0.2,
  humor: 0.5,
  spectacle: 0.1,
  emotional_intensity: 0.8,
  tenderness: 0.9,
  narrative_complexity: 0.4,
};

function storyDnaDocument(input: StoryDnaInput): StoryDnaDocument {
  const request = storyDnaRequestItem(input);
  return {
    type: request.type,
    id: request.id,
    schema_version: STORY_DNA_SCHEMA_VERSION,
    ontology_version: STORY_DNA_ONTOLOGY_VERSION,
    teacher_role: 'content-only',
    model_version: 'test-model',
    prompt_version: STORY_DNA_PROMPT_VERSION,
    input_hash: storyDnaInputHash(input),
    genre_subgenres: ['drama'],
    format: 'feature-film',
    story_engines: ['friendship'],
    themes: ['belonging', 'friendship'],
    character_dynamics: ['found-family'],
    tone: ['warm', 'hopeful'],
    setting_era: 'contemporary',
    geographic_scope: 'city',
    social_settings: ['urban-community'],
    narrative_structures: ['linear'],
    ending_emotional_arc: 'uplifting',
    facets: {
      pace: 2,
      action: 1,
      tension: 1,
      spectacle: 0,
      humor: 2,
      romance: 0,
      fear: 0,
      tenderness: 4,
      sadness: 2,
      hope: 4,
      realism: 3,
      narrative_complexity: 2,
      moral_ambiguity: 1,
      violence: 0,
      family_accessibility: 4,
    },
    confidence: {
      overall: 0.8,
      genre_subgenre: 0.9,
      format: 1,
      story_engine: 0.8,
      themes: 0.8,
      character_dynamics: 0.8,
      tone: 0.8,
      setting_era: 0.7,
      geographic_scope: 0.7,
      social_setting: 0.7,
      narrative_structure: 0.8,
      ending_emotional_arc: 0.7,
      facets: 0.8,
    },
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

test('AI enrichment is validated, cached, and never needs a second cloud call', () => withTempLibrary(async () => {
  let calls = 0;
  const input = [{ type: 'movie' as const, id: 'tt1', title: 'One', rail_ids: ['hopeful-drama'] }];
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      items: [{ ...document, input_hash: recommendationAiInputHash(input[0]!) }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  assert.deepEqual(await refreshAiRecommendationFeatures(input, { fetcher, now: 100_000 }), {
    requested: 1, persisted: 1, cached: 0, failed: false,
  });
  assert.equal(loadAiRecommendationFeatures(input).get('movie:tt1')?.model_version, 'test-model');
  assert.deepEqual(await refreshAiRecommendationFeatures(input, { fetcher, now: 101_000 }), {
    requested: 0, persisted: 0, cached: 1, failed: false,
  });
  assert.equal(calls, 1);
}));

test('AI cache invalidates immediately when normalized title hints or prompt metadata change', () => withTempLibrary(async () => {
  let current = { type: 'movie' as const, id: 'tt1', title: 'One', taste_tags: ['warm'] };
  let calls = 0;
  let modelVersion = 'test-model';
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      items: [{
        ...document,
        model_version: modelVersion,
        title: undefined,
        input_hash: recommendationAiInputHash(current),
      }],
    }), { status: 200 });
  };
  await refreshAiRecommendationFeatures([current], { fetcher, now: 100_000 });
  assert.equal(calls, 1);
  current = { ...current, title: 'One restored', taste_tags: ['warm', 'friendship'] };
  await refreshAiRecommendationFeatures([current], { fetcher, now: 101_000 });
  assert.equal(calls, 2);
  libraryDatabase().prepare(`
UPDATE recommendation_features SET prompt_version = 'old-prompt'
WHERE content_type = 'movie' AND content_id = 'tt1'
`).run();
  await refreshAiRecommendationFeatures([current], { fetcher, now: 102_000 });
  assert.equal(calls, 3);
  process.env.MANGO_RECOMMENDATIONS_AI_MODEL_VERSION = 'next-model';
  modelVersion = 'next-model';
  try {
    await refreshAiRecommendationFeatures([current], { fetcher, now: 103_000 });
    assert.equal(calls, 4);
    assert.equal(loadAiRecommendationFeatures([current]).get('movie:tt1')?.model_version, 'next-model');
  } finally {
    delete process.env.MANGO_RECOMMENDATIONS_AI_MODEL_VERSION;
  }
}));

test('one malformed AI member does not discard valid siblings', () => withTempLibrary(async () => {
  const inputs = [
    { type: 'movie' as const, id: 'tt1', title: 'One' },
    { type: 'movie' as const, id: 'tt2', title: 'Two' },
  ];
  const fetcher = async () => new Response(JSON.stringify({ items: [
    { ...document, input_hash: recommendationAiInputHash(inputs[0]!) },
    { ...document, id: 'tt2', pace: 'impossible', input_hash: recommendationAiInputHash(inputs[1]!) },
  ] }), { status: 200 });
  assert.deepEqual(await refreshAiRecommendationFeatures(inputs, { fetcher, now: 100_000 }), {
    requested: 2,
    persisted: 1,
    cached: 0,
    failed: true,
  });
  assert.deepEqual([...loadAiRecommendationFeatures(inputs).keys()], ['movie:tt1']);
}));

test('AI cache lookups batch safely beyond SQLite variable limits', () => withTempLibrary(async () => {
  const inputs = Array.from({ length: 850 }, (_, index) => ({
    type: 'movie' as const,
    id: `tt-batch-${String(index).padStart(4, '0')}`,
    title: `Batch title ${index}`,
  }));
  for (const index of [5, 805]) {
    const input = inputs[index]!;
    const fetcher = async () => new Response(JSON.stringify({ items: [{
      ...document,
      id: input.id,
      input_hash: recommendationAiInputHash(input),
    }] }), { status: 200 });
    assert.equal((await refreshAiRecommendationFeatures([input], {
      fetcher,
      now: 100_000 + index,
    })).persisted, 1);
  }
  assert.deepEqual(
    [...loadAiRecommendationFeatures(inputs).keys()],
    [inputs[5]!.id, inputs[805]!.id].map((id) => `movie:${id}`),
  );
}));

test('failed AI items rotate behind later stale titles instead of starving the queue', () => withTempLibrary(async () => {
  const inputs = [
    { type: 'movie' as const, id: 'tta', title: 'Alpha' },
    { type: 'movie' as const, id: 'ttb', title: 'Bravo' },
    { type: 'movie' as const, id: 'ttc', title: 'Charlie' },
  ];
  const requested: string[] = [];
  process.env.MANGO_RECOMMENDATIONS_AI_BATCH = '1';
  process.env.MANGO_RECOMMENDATIONS_AI_URL = 'http://127.0.0.1:1/test';
  try {
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { items: Array<{ id: string }> };
      const id = payload.items[0]!.id;
      requested.push(id);
      if (requested.length === 1) return new Response('unavailable', { status: 503 });
      const input = inputs.find((candidate) => candidate.id === id)!;
      return new Response(JSON.stringify({ items: [{
        ...document,
        id,
        input_hash: recommendationAiInputHash(input),
      }] }), { status: 200 });
    };
    assert.equal((await refreshAiRecommendationFeatures(inputs, { fetcher, now: 100_000 })).failed, true);
    assert.equal((await refreshAiRecommendationFeatures(inputs, { fetcher, now: 101_000 })).persisted, 1);
    assert.deepEqual(requested, ['tta', 'ttb']);
  } finally {
    delete process.env.MANGO_RECOMMENDATIONS_AI_BATCH;
    delete process.env.MANGO_RECOMMENDATIONS_AI_URL;
  }
}));

test('a malformed persisted AI cursor heals to a bounded rotation', () => withTempLibrary(async () => {
  libraryDatabase().prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES ('ai_recommendation_batch_cursor', 'not-a-number', 1)
`).run();
  const input = { type: 'movie' as const, id: 'tt1', title: 'One' };
  const fetcher = async () => new Response(JSON.stringify({ items: [{
    ...document,
    input_hash: recommendationAiInputHash(input),
  }] }), { status: 200 });
  assert.equal((await refreshAiRecommendationFeatures([input], { fetcher, now: 100_000 })).persisted, 1);
  const cursor = libraryDatabase().prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = 'ai_recommendation_batch_cursor'
`).get() as { value_json: string };
  assert.equal(Number.isFinite(Number(cursor.value_json)), true);
}));

test('malformed cloud output fails closed and leaves deterministic metadata usable', () => withTempLibrary(async () => {
  const input = [{ type: 'movie' as const, id: 'tt1', title: 'One', rail_ids: ['drama'] }];
  const fetcher = async () => new Response(JSON.stringify({ items: [{ ...document, id: 'invented' }] }), { status: 200 });
  const result = await refreshAiRecommendationFeatures(input, { fetcher, now: 100_000 });
  assert.equal(result.failed, true);
  assert.equal(loadAiRecommendationFeatures(input).size, 0);
  assert.equal(buildAiEnrichedRecommendationFeature(input[0]!).id, 'tt1');
}));

test('AI semantics enrich similarity without allowing AI to choose the slate', () => {
  const enriched = buildAiEnrichedRecommendationFeature(
    { type: 'movie', id: 'tt1', title: 'One' },
    document,
  );
  const hopeful = buildAiEnrichedRecommendationFeature({
    type: 'movie', id: 'tt2', title: 'Two', taste_tags: ['hopeful', 'friendship'],
  });
  const unrelated = buildAiEnrichedRecommendationFeature({
    type: 'movie', id: 'tt3', title: 'Three', taste_tags: ['western', 'cowboy'],
  });
  assert.ok(cosineSimilarity(enriched.vector, hopeful.vector) > cosineSimilarity(enriched.vector, unrelated.vector));
});

test('StoryDNA teacher payload is content-only, cached, and uses the dedicated endpoint', () => withTempLibrary(async () => {
  const input = {
    type: 'movie' as const,
    id: 'TT1',
    title: 'One',
    year: '2025',
    synopsis: 'A grounded friendship story set in Mumbai. '.repeat(5),
    genres: ['Drama'],
    languages: ['Hindi'],
    countries: ['India'],
    directors: ['A Director'],
    source: 'addon',
    rail_ids: ['curated-drama'],
    taste_tags: ['household-secret'],
    profile_id: 'must-not-pass',
    mood: 'cozy',
  } as StoryDnaInput & { profile_id: string; mood: string; taste_tags: string[] };
  let calls = 0;
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    assert.match(String(url), /\/recommendations\/story-dna$/);
    const body = String(init?.body);
    for (const forbidden of ['taste_tags', 'household-secret', 'profile_id', 'must-not-pass', 'mood', 'cozy']) {
      assert.equal(body.includes(forbidden), false);
    }
    const payload = JSON.parse(body) as { items: ReturnType<typeof storyDnaRequestItem>[] };
    assert.equal(payload.items[0]!.selective_lookup.policy, 'structured-only');
    return new Response(JSON.stringify({ items: [storyDnaDocument(input)] }), { status: 200 });
  };
  const first = await refreshStoryDnaTeacherCache([input], { fetcher, now: 100_000 });
  assert.equal(first.requested, 1);
  assert.equal(first.persisted, 1);
  assert.equal(first.failures.length, 0);
  assert.equal(first.documents[0]?.id, 'TT1');
  const second = await refreshStoryDnaTeacherCache([input], { fetcher, now: 101_000 });
  assert.equal(second.requested, 0);
  assert.equal(second.cached, 1);
  assert.equal(calls, 1);
}));

test('StoryDNA records caller-performed structured lookup without granting the teacher lookup access', () => {
  const request = storyDnaRequestItem({
    type: 'movie',
    id: 'TT-LOOKUP',
    title: 'Lookup title',
    year: '2024',
    synopsis: 'Structured provider evidence. '.repeat(8),
    genres: ['drama'],
    source: 'addon-meta',
    lookup_reasons: ['short-synopsis'],
    lookup_used: true,
  });
  assert.equal(request.selective_lookup.requested, true);
  assert.equal(request.selective_lookup.used, true);
  assert.equal(request.selective_lookup.policy, 'structured-only');
});

test('StoryDNA hashes ignore household taste but invalidate on canonical evidence changes', () => withTempLibrary(async () => {
  let current: StoryDnaInput & { taste_tags?: string[] } = {
    type: 'movie', id: 'TT1', title: 'One', taste_tags: ['warm'],
    synopsis: 'A short synopsis.', genres: ['drama'], languages: ['hindi'],
  };
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [storyDnaDocument(current)] }), { status: 200 });
  };
  const originalHash = storyDnaInputHash(current);
  await refreshStoryDnaTeacherCache([current], { fetcher, now: 100_000 });
  current = { ...current, taste_tags: ['action', 'profile-secret'] };
  assert.equal(storyDnaInputHash(current), originalHash);
  assert.equal((await refreshStoryDnaTeacherCache([current], { fetcher, now: 101_000 })).requested, 0);
  current = { ...current, synopsis: 'A materially richer canonical synopsis.'.repeat(5) };
  assert.notEqual(storyDnaInputHash(current), originalHash);
  assert.equal((await refreshStoryDnaTeacherCache([current], { fetcher, now: 102_000 })).persisted, 1);
  assert.equal(calls, 2);
}));

test('StoryDNA field provenance is canonical, hash-bound, and independently versioned', () => {
  const input: StoryDnaInput = {
    type: 'movie', id: 'TT-PROVENANCE', title: 'Provenance',
    synopsis: 'Canonical synopsis.',
    source: 'Catalog',
    field_provenance: {
      Synopsis: ['TMDB', 'tmdb'],
      genres: ['Addon:Catalog'],
    },
  };
  const request = storyDnaRequestItem(input);
  assert.deepEqual(request.evidence.field_provenance, {
    genres: ['addon:catalog'],
    synopsis: ['tmdb'],
  });
  assert.ok(storyDnaEvidenceFields(input).includes('field-provenance'));
  assert.notEqual(
    storyDnaEvidenceHash(input),
    storyDnaEvidenceHash({
      ...input,
      field_provenance: { ...input.field_provenance, synopsis: ['wikidata'] },
    }),
  );
});

test('StoryDNA teacher configuration fingerprint follows model and provider route', () => {
  const previousModel = process.env.MANGO_STORY_DNA_MODEL_VERSION;
  const previousUrl = process.env.MANGO_STORY_DNA_URL;
  try {
    process.env.MANGO_STORY_DNA_MODEL_VERSION = 'teacher-a';
    process.env.MANGO_STORY_DNA_URL = 'http://127.0.0.1:9001/story-dna';
    const first = storyDnaTeacherConfiguration();
    process.env.MANGO_STORY_DNA_URL = 'http://127.0.0.1:9002/story-dna';
    const routeChanged = storyDnaTeacherConfiguration();
    process.env.MANGO_STORY_DNA_MODEL_VERSION = 'teacher-b';
    const modelChanged = storyDnaTeacherConfiguration();
    assert.notEqual(first.provider_routes_hash, routeChanged.provider_routes_hash);
    assert.notEqual(first.revision, routeChanged.revision);
    assert.notEqual(routeChanged.revision, modelChanged.revision);
    assert.equal(modelChanged.expected_model_version, 'teacher-b');
    assert.equal(JSON.stringify(modelChanged).includes('127.0.0.1'), false);
  } finally {
    if (previousModel === undefined) delete process.env.MANGO_STORY_DNA_MODEL_VERSION;
    else process.env.MANGO_STORY_DNA_MODEL_VERSION = previousModel;
    if (previousUrl === undefined) delete process.env.MANGO_STORY_DNA_URL;
    else process.env.MANGO_STORY_DNA_URL = previousUrl;
  }
});

test('StoryDNA v1 rejects partial, extra, free-form, and non-exact-ID documents', () => {
  const input: StoryDnaInput = { type: 'movie', id: 'TT1', title: 'One' };
  const valid = storyDnaDocument(input);
  assert.equal(validateStoryDnaDocument(valid, new Set(['movie:TT1'])).id, 'TT1');
  const partial = { ...valid } as Partial<StoryDnaDocument>;
  delete partial.facets;
  assert.throws(() => validateStoryDnaDocument(partial, new Set(['movie:TT1'])), /partial/);
  const extra = { ...valid, novel_tags: [] };
  assert.throws(() => validateStoryDnaDocument(extra, new Set(['movie:TT1'])), /additional/);
  const freeForm = { ...valid, themes: ['invented-theme'] };
  assert.throws(() => validateStoryDnaDocument(freeForm, new Set(['movie:TT1'])), /themes/);
  assert.throws(() => validateStoryDnaDocument({ ...valid, id: 'tt1' }, new Set(['movie:TT1'])), /stable id/);
});

test('one invalid StoryDNA sibling is isolated and returned as a per-item failure', () => withTempLibrary(async () => {
  const inputs: StoryDnaInput[] = [
    { type: 'movie', id: 'TT1', title: 'One' },
    { type: 'movie', id: 'TT2', title: 'Two' },
  ];
  const invalid = { ...storyDnaDocument(inputs[1]!), unexpected: true };
  const fetcher = async () => new Response(JSON.stringify({ items: [
    storyDnaDocument(inputs[0]!), invalid,
  ] }), { status: 200 });
  const result = await refreshStoryDnaTeacherCache(inputs, { fetcher, now: 100_000 });
  assert.equal(result.persisted, 1);
  assert.deepEqual(result.failures, [{ type: 'movie', id: 'TT2', reason: 'invalid-document' }]);
  assert.deepEqual([...loadStoryDnaTeacherCache(inputs).keys()], ['movie:TT1']);
}));

test('StoryDNA transport failures are independently attributable and leave legacy cache isolated', () => withTempLibrary(async () => {
  const input: StoryDnaInput = { type: 'movie', id: 'TT1', title: 'One' };
  const legacyInput = { type: 'movie' as const, id: 'tt1', title: 'One' };
  await refreshAiRecommendationFeatures([legacyInput], {
    now: 90_000,
    fetcher: async () => new Response(JSON.stringify({ items: [{
      ...document, input_hash: recommendationAiInputHash(legacyInput),
    }] }), { status: 200 }),
  });
  assert.equal(loadStoryDnaTeacherCache([input]).size, 0);
  const result = await refreshStoryDnaTeacherCache([input], {
    fetcher: async () => new Response('unavailable', { status: 503 }),
  });
  assert.deepEqual(result.failures, [{ type: 'movie', id: 'TT1', reason: 'transport' }]);
  assert.equal(loadAiRecommendationFeatures([legacyInput]).size, 1);
}));

test('StoryDNA graph conversion emits deterministic teacher, metadata, ordinal, and compound edges', () => {
  const input: StoryDnaInput = {
    type: 'movie', id: 'TT1', title: 'One', year: '2025', languages: ['Hindi'],
    countries: ['India'], directors: ['A Director'], writers: ['A Writer'],
    format: 'feature-film',
  };
  const edges = storyDnaToGraphEdges(storyDnaDocument(input), input);
  assert.deepEqual(edges, [...edges].sort((left, right) => left.node_key.localeCompare(right.node_key)));
  assert.ok(edges.some((edge) => edge.family === 'theme' && edge.edge_source === 'teacher'));
  assert.ok(edges.some((edge) => edge.family === 'language' && edge.edge_source === 'metadata'));
  assert.ok(edges.some((edge) => edge.family === 'decade' && edge.edge_source === 'metadata'));
  assert.ok(edges.some((edge) => edge.family === 'format' && edge.edge_source === 'metadata'));
  assert.ok(edges.some((edge) => edge.node_key === 'tone:parent%3Dbright'));
  assert.ok(edges.some((edge) => edge.family === 'facet.pace' && edge.intensity === 2));
  assert.ok(edges.some((edge) => edge.family === 'compound' && edge.edge_source === 'compound'));
  assert.ok(edges.some((edge) => edge.node_key.includes('social-setting%3Durban-community%26story-engine%3Dfriendship')));
  assert.equal(edges.some((edge) => edge.node_key.includes('none')), false);
});

test('StoryDNA graph preserves ordered categorical salience and legitimate none evidence', () => {
  const input: StoryDnaInput = { type: 'movie', id: 'TT-SALIENCE', title: 'Salience' };
  const ordered = {
    ...storyDnaDocument(input),
    themes: ['family', 'friendship'] as StoryDnaDocument['themes'],
  };
  const orderedEdges = storyDnaToGraphEdges(ordered);
  assert.equal(orderedEdges.find((edge) => edge.node_key === 'theme:family')?.intensity, 4);
  assert.equal(orderedEdges.find((edge) => edge.node_key === 'theme:friendship')?.intensity, 2);

  const absent = {
    ...storyDnaDocument(input),
    story_engines: ['none'] as StoryDnaDocument['story_engines'],
    themes: ['none'] as StoryDnaDocument['themes'],
    character_dynamics: ['none'] as StoryDnaDocument['character_dynamics'],
    tone: ['none'] as StoryDnaDocument['tone'],
    social_settings: ['none'] as StoryDnaDocument['social_settings'],
  };
  const absentEdges = storyDnaToGraphEdges(absent);
  assert.ok(absentEdges.some((edge) => edge.node_key === 'theme:none'));
  assert.equal(
    absentEdges.some((edge) => edge.family === 'compound' && edge.node_key.includes('none')),
    false,
  );
});

test('StoryDNA JSON Schema is closed and owns the runtime top-level contract', () => {
  assert.equal(STORY_DNA_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    Object.keys(STORY_DNA_JSON_SCHEMA.properties).sort(),
    [...STORY_DNA_JSON_SCHEMA.required].sort(),
  );
  assert.deepEqual(
    STORY_DNA_JSON_SCHEMA.properties.themes.items.enum,
    ['family', 'belonging', 'love', 'friendship', 'identity', 'ambition', 'power',
      'justice', 'duty', 'freedom', 'faith', 'grief', 'redemption', 'class',
      'community', 'survival', 'morality', 'obsession', 'legacy', 'prejudice',
      'nature', 'technology', 'none'],
  );
});
