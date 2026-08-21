import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { libraryDatabase, resetLibraryDbForTests } from '../library/db.js';
import type { StoryDnaDocument, StoryDnaInput } from './story-dna.js';
import {
  enqueueStoryDnaFrontierCandidates,
  runStoryDnaFrontierWorker,
  storyDnaFrontierDiagnostics,
} from './story-dna-frontier.js';

async function withDb(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mango-frontier-'));
  const priorPath = process.env.MANGO_LIBRARY_DB_PATH;
  const priorPins = process.env.MANGO_USER_PINS_PATH;
  const priorMode = process.env.MANGO_STORY_DNA_WORKER_MODE;
  const priorTeacher = process.env.MANGO_STORY_DNA;
  process.env.MANGO_LIBRARY_DB_PATH = join(directory, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(directory, 'pins.json');
  process.env.MANGO_STORY_DNA_WORKER_MODE = 'frontier';
  resetLibraryDbForTests();
  try {
    libraryDatabase();
    await fn();
  } finally {
    resetLibraryDbForTests();
    if (priorPath === undefined) delete process.env.MANGO_LIBRARY_DB_PATH;
    else process.env.MANGO_LIBRARY_DB_PATH = priorPath;
    if (priorPins === undefined) delete process.env.MANGO_USER_PINS_PATH;
    else process.env.MANGO_USER_PINS_PATH = priorPins;
    if (priorMode === undefined) delete process.env.MANGO_STORY_DNA_WORKER_MODE;
    else process.env.MANGO_STORY_DNA_WORKER_MODE = priorMode;
    if (priorTeacher === undefined) delete process.env.MANGO_STORY_DNA;
    else process.env.MANGO_STORY_DNA = priorTeacher;
    await rm(directory, { recursive: true, force: true });
  }
}

function input(type: 'movie' | 'series', index: number): StoryDnaInput {
  return {
    type, id: `${type}-${index}`, title: `${type} ${index}`, year: 2020,
    synopsis: 'A detective investigation tests family bonds and justice.',
    genres: ['crime'], keywords: ['murder investigation'],
    external_ids: { catalog: `${type}-${index}` },
  };
}

test('frontier enforces per-type nightly budgets and persists only content evidence', async () => {
  await withDb(async () => {
    const candidates = (['movie', 'series'] as const).flatMap((type) => (
      Array.from({ length: 13 }, (_, index) => ({
        input: input(type, index), reason: 'reserve_boundary' as const, priority: 500 - index,
      }))
    ));
    enqueueStoryDnaFrontierCandidates(candidates, 1_000);
    const queued = libraryDatabase().prepare(`
SELECT input_json FROM vod_semantic_frontier_queue ORDER BY queue_id LIMIT 1
`).get() as { input_json: string };
    assert.ok(!/rating|saved|watch|profile|mood|memory/i.test(queued.input_json));

    let maxBatch = 0;
    const result = await runStoryDnaFrontierWorker({
      now: 2_000,
      refreshTeacher: async (inputs) => {
        maxBatch = Math.max(maxBatch, inputs.length);
        return {
          requested: inputs.length,
          persisted: inputs.length,
          cached: 0,
          documents: inputs.map((item) => ({ type: item.type, id: item.id } as StoryDnaDocument)),
          failures: [],
        };
      },
    });
    assert.equal(result.requested, 24, JSON.stringify(result));
    assert.equal(maxBatch, 4);
    assert.deepEqual(result.completed_types, ['movie', 'series']);
    const diagnostics = storyDnaFrontierDiagnostics(2_001);
    assert.deepEqual(diagnostics.used_last_24h, { movie: 12, series: 12 });
    assert.equal(diagnostics.queued, 2);

    const second = await runStoryDnaFrontierWorker({ now: 2_002 });
    assert.equal(second.status, 'budget_exhausted');
    assert.equal(second.requested, 0);
  });
});

test('worker off leaves durable queue untouched', async () => {
  await withDb(async () => {
    process.env.MANGO_STORY_DNA_WORKER_MODE = 'off';
    enqueueStoryDnaFrontierCandidates([{
      input: input('movie', 1), reason: 'positive_anchor', priority: 1_000,
    }], 1_000);
    const result = await runStoryDnaFrontierWorker({ now: 2_000 });
    assert.equal(result.status, 'disabled');
    assert.equal(storyDnaFrontierDiagnostics(2_000).queued, 1);
  });
});

test('global StoryDNA containment overrides frontier mode', async () => {
  await withDb(async () => {
    process.env.MANGO_STORY_DNA_WORKER_MODE = 'frontier';
    process.env.MANGO_STORY_DNA = '0';
    enqueueStoryDnaFrontierCandidates([{
      input: input('movie', 2), reason: 'positive_anchor', priority: 1_000,
    }], 1_000);
    let calls = 0;
    const result = await runStoryDnaFrontierWorker({
      now: 2_000,
      refreshTeacher: async () => {
        calls += 1;
        throw new Error('containment failed');
      },
    });
    assert.equal(result.status, 'disabled');
    assert.equal(calls, 0);
    assert.equal(storyDnaFrontierDiagnostics(2_000).worker_mode, 'off');
  });
});
