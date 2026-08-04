import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { libraryDatabase, resetLibraryDbForTests } from '../library/db.js';
import {
  buildAiEnrichedRecommendationFeature,
  loadAiRecommendationFeatures,
  recommendationAiInputHash,
  refreshAiRecommendationFeatures,
} from './ai.js';
import { cosineSimilarity } from './engine.js';

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
