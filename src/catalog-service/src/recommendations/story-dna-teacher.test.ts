import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetLibraryDbForTests } from '../library/db.js';
import {
  loadStoryDnaTeacherCache,
  refreshStoryDnaTeacherCache,
  storyDnaTeacherConfiguration,
} from './story-dna-teacher.js';
import {
  STORY_DNA_JSON_SCHEMA,
  STORY_DNA_ONTOLOGY_VERSION,
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
  const directory = mkdtempSync(join(tmpdir(), 'mango-story-dna-teacher-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(directory, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(directory, 'pins.json');
  resetLibraryDbForTests();
  const cleanup = () => {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(directory, { recursive: true, force: true });
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
      pace: 2, action: 1, tension: 1, spectacle: 0, humor: 2, romance: 0,
      fear: 0, tenderness: 4, sadness: 2, hope: 4, realism: 3,
      narrative_complexity: 2, moral_ambiguity: 1, violence: 0,
      family_accessibility: 4,
    },
    confidence: {
      overall: 0.8, genre_subgenre: 0.9, format: 1, story_engine: 0.8,
      themes: 0.8, character_dynamics: 0.8, tone: 0.8, setting_era: 0.7,
      geographic_scope: 0.7, social_setting: 0.7, narrative_structure: 0.8,
      ending_emotional_arc: 0.7, facets: 0.8,
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

test('StoryDNA teacher payload is content-only, cached, and uses its dedicated endpoint', () => withTempLibrary(async () => {
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
    return new Response(JSON.stringify({ items: [storyDnaDocument(input)] }), { status: 200 });
  };
  const first = await refreshStoryDnaTeacherCache([input], { fetcher, now: 100_000 });
  assert.deepEqual([first.requested, first.persisted, first.failures.length], [1, 1, 0]);
  const second = await refreshStoryDnaTeacherCache([input], { fetcher, now: 101_000 });
  assert.deepEqual([second.requested, second.cached, calls], [0, 1, 1]);
}));

test('StoryDNA hashes ignore household fields but invalidate canonical evidence changes', () => withTempLibrary(async () => {
  let input: StoryDnaInput & { taste_tags?: string[] } = {
    type: 'movie', id: 'TT1', title: 'One', taste_tags: ['warm'],
    synopsis: 'A short synopsis.', genres: ['drama'], languages: ['hindi'],
  };
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [storyDnaDocument(input)] }), { status: 200 });
  };
  const original = storyDnaInputHash(input);
  await refreshStoryDnaTeacherCache([input], { fetcher, now: 100_000 });
  input = { ...input, taste_tags: ['action', 'profile-secret'] };
  assert.equal(storyDnaInputHash(input), original);
  assert.equal((await refreshStoryDnaTeacherCache([input], { fetcher, now: 101_000 })).requested, 0);
  input = { ...input, synopsis: 'A materially richer canonical synopsis.'.repeat(5) };
  assert.notEqual(storyDnaInputHash(input), original);
  assert.equal((await refreshStoryDnaTeacherCache([input], { fetcher, now: 102_000 })).persisted, 1);
  assert.equal(calls, 2);
}));

test('StoryDNA configuration fingerprint follows model and provider route without exposing URLs', () => {
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

test('StoryDNA validation rejects partial, extra, free-form, and mismatched-ID documents', () => {
  const input: StoryDnaInput = { type: 'movie', id: 'TT1', title: 'One' };
  const valid = storyDnaDocument(input);
  assert.equal(validateStoryDnaDocument(valid, new Set(['movie:TT1'])).id, 'TT1');
  const partial = { ...valid } as Partial<StoryDnaDocument>;
  delete partial.facets;
  assert.throws(() => validateStoryDnaDocument(partial, new Set(['movie:TT1'])), /partial/);
  assert.throws(() => validateStoryDnaDocument({ ...valid, novel_tags: [] }, new Set(['movie:TT1'])), /additional/);
  assert.throws(() => validateStoryDnaDocument({ ...valid, themes: ['invented-theme'] }, new Set(['movie:TT1'])), /themes/);
  assert.throws(() => validateStoryDnaDocument({ ...valid, id: 'tt1' }, new Set(['movie:TT1'])), /stable id/);
});

test('one invalid StoryDNA sibling cannot corrupt a valid sibling', () => withTempLibrary(async () => {
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

test('StoryDNA graph conversion remains deterministic and excludes absent compound edges', () => {
  const input: StoryDnaInput = {
    type: 'movie', id: 'TT1', title: 'One', year: '2025', languages: ['Hindi'],
    countries: ['India'], directors: ['A Director'], writers: ['A Writer'],
    format: 'feature-film',
  };
  const edges = storyDnaToGraphEdges(storyDnaDocument(input), input);
  assert.deepEqual(edges, [...edges].sort((left, right) => left.node_key.localeCompare(right.node_key)));
  assert.ok(edges.some((edge) => edge.family === 'theme' && edge.edge_source === 'teacher'));
  assert.ok(edges.some((edge) => edge.family === 'language' && edge.edge_source === 'metadata'));
  assert.ok(edges.some((edge) => edge.family === 'facet.pace' && edge.intensity === 2));
  assert.ok(edges.some((edge) => edge.family === 'compound' && edge.edge_source === 'compound'));

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
  assert.equal(absentEdges.some((edge) => edge.family === 'compound' && edge.node_key.includes('none')), false);
});

test('StoryDNA JSON Schema is closed and owns the runtime contract', () => {
  assert.equal(STORY_DNA_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    Object.keys(STORY_DNA_JSON_SCHEMA.properties).sort(),
    [...STORY_DNA_JSON_SCHEMA.required].sort(),
  );
});
