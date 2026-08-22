import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  initLibraryDb,
  resetLibraryDbForTests,
} from '../library/db.js';
import { putRating } from '../library/ratings.js';
import { currentStoryGraphTasteRevision } from './story-graph-service.js';
import {
  readDesiredRevision,
  updateDesiredRevision,
} from './desired-revision.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_SOURCE_PATH = resolve(HERE, '../../src/index.ts');

function withLibrary(fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mango-desired-revision-integration-'));
  const prior = {
    library: process.env.MANGO_LIBRARY_DB_PATH,
    pins: process.env.MANGO_USER_PINS_PATH,
  };
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    fn();
  } finally {
    resetLibraryDbForTests();
    if (prior.library === undefined) delete process.env.MANGO_LIBRARY_DB_PATH;
    else process.env.MANGO_LIBRARY_DB_PATH = prior.library;
    if (prior.pins === undefined) delete process.env.MANGO_USER_PINS_PATH;
    else process.env.MANGO_USER_PINS_PATH = prior.pins;
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Integration proof for adversarial-review blocker #2: rating/watch signals
 * that leave `corpus_generation` unchanged must still advance the desired
 * revision. We simulate a household rating change by bumping
 * actual rating mutation and the same live taste signature consumed by the
 * catalog's desired-state bridge.
 */
test('rating change advances desired revision even when corpus_generation is unchanged', () => {
  withLibrary(() => {
    const firstTasteSignature = currentStoryGraphTasteRevision('movies', 1_000);
    const first = updateDesiredRevision({
      content_type: 'movie',
      reason: 'signal_change',
      corpus_generation: 42,
      semantic_generation: null,
      taste_signature: firstTasteSignature,
      now: 1_000,
    });
    assert.equal(first.revision, 1);
    assert.equal(first.taste_signature, firstTasteSignature);

    putRating({
      profile_id: 'household',
      type: 'movie',
      id: 'tt-live-signal',
      title: 'Live Signal',
      fire: 4.5,
      water: 3,
      expected_revision: 0,
      origin: 'couch',
      taste_tags: [],
    });
    const secondTasteSignature = currentStoryGraphTasteRevision('movies', 1_000);
    assert.notEqual(secondTasteSignature, firstTasteSignature,
      'a real rating mutation must change the live taste signature');
    const second = updateDesiredRevision({
      content_type: 'movie',
      reason: 'signal_change',
      corpus_generation: 42,
      semantic_generation: null,
      taste_signature: secondTasteSignature,
      now: 2_000,
    });
    assert.equal(second.revision, 2,
      'unchanged corpus + advanced taste signature must advance revision');

    const persisted = readDesiredRevision('movie');
    assert.equal(persisted?.taste_signature, secondTasteSignature);
  });
});

test('index.ts feeds semantic_generation and taste_signature into updateDesiredRevision', () => {
  const source = readFileSync(INDEX_SOURCE_PATH, 'utf8');
  const call = source.match(/updateDesiredRevision\(\{[\s\S]*?\}\)/);
  assert.ok(call, 'updateDesiredRevision call site not found in index.ts');
  const body = call![0];
  assert.ok(body.includes('semantic_generation'),
    'updateDesiredRevision must be called with semantic_generation');
  assert.ok(body.includes('taste_signature'),
    'updateDesiredRevision must be called with taste_signature');
});
