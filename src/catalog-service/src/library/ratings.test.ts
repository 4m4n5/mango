import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activateViewerProfile,
  createViewerProfile,
  libraryDatabase,
  recordLibraryWatch,
  resetLibraryDbForTests,
} from './db.js';
import {
  RatingRevisionConflictError,
  canonicalRatingIdentity,
  clearRating,
  getRating,
  getRatingPromptState,
  importSeedManifest,
  listRatings,
  markRatingPromptEligible,
  putRating,
  ratingToSteps,
  resolveRatingPrompt,
  stepsToRating,
  validateSeedManifest,
  type SeedManifest,
} from './ratings.js';

function withTempLibrary<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-ratings-'));
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

test('all rating half-steps including zero round-trip and invalid values fail', () => {
  for (let steps = 0; steps <= 10; steps += 1) {
    assert.equal(ratingToSteps(steps / 2), steps);
    assert.equal(stepsToRating(steps), steps / 2);
  }
  for (const value of [-0.5, 0.25, 4.75, 5.5, Number.NaN, '3']) {
    assert.throws(() => ratingToSteps(value), /rating/);
  }
});

test('canonical identity is source-independent and series episodes collapse', () => {
  assert.deepEqual(canonicalRatingIdentity('film', 'TT0111161'), { type: 'movie', id: 'tt0111161' });
  assert.deepEqual(canonicalRatingIdentity('series', 'TT123:2:4'), { type: 'series', id: 'tt123' });
  assert.throws(
    () => canonicalRatingIdentity('series', 'tt123:2:4', { rejectEpisode: true }),
    /show id/,
  );
  assert.throws(() => canonicalRatingIdentity('tv', 'anything'), /movie or series/);
});

test('put, edit, clear and stale revision preserve append-only couch precedence', () => withTempLibrary(() => {
  const initial = putRating({
    type: 'movie', id: 'tt1', title: 'One', fire: 0, water: 5, expected_revision: 0,
  });
  assert.ok(initial);
  assert.equal(initial.fire, 0);
  assert.equal(initial.water, 5);
  assert.equal(initial.revision, 1);
  assert.throws(
    () => putRating({
      type: 'movie', id: 'tt1', title: 'One', fire: 1, water: 4, expected_revision: 0,
    }),
    RatingRevisionConflictError,
  );
  const edited = putRating({
    type: 'movie', id: 'tt1', title: 'One', fire: 4.5, water: 1.5, expected_revision: 1,
  });
  assert.ok(edited);
  assert.equal(edited.revision, 2);
  assert.deepEqual(clearRating({ type: 'movie', id: 'tt1', expected_revision: 2 }), {
    cleared: true,
    revision: 3,
  });
  assert.equal(getRating('movie', 'tt1'), null);

  assert.throws(
    () => putRating({
      type: 'movie', id: 'tt1', title: 'Stale One', fire: 1, water: 4, expected_revision: 0,
    }),
    RatingRevisionConflictError,
  );
  assert.equal(getRating('movie', 'tt1'), null);

  const recreated = putRating({
    type: 'movie', id: 'tt1', title: 'One Again', fire: 3, water: 2, expected_revision: 3,
  });
  assert.ok(recreated);
  assert.equal(recreated.revision, 4);
  assert.equal(recreated.title, 'One Again');
  assert.equal(recreated.fire, 3);
  assert.equal(recreated.water, 2);
  assert.deepEqual(clearRating({ type: 'movie', id: 'tt1', expected_revision: 4 }), {
    cleared: true,
    revision: 5,
  });

  const skipped = putRating({
    type: 'movie', id: 'tt1', title: 'Seed One', fire: 5, water: 5, expected_revision: 0,
    origin: 'seed', seed_manifest: 'seed-v1', seed_manifest_hash: 'a'.repeat(64),
  });
  assert.equal(skipped, null);
  assert.deepEqual(listRatings(), []);
  assert.deepEqual(libraryDatabase().prepare(`
SELECT action, revision
FROM profile_content_rating_events
WHERE profile_id = 'household' AND content_type = 'movie' AND content_id = 'tt1'
ORDER BY event_id
`).all(), [
    { action: 'set', revision: 1 },
    { action: 'edit', revision: 2 },
    { action: 'clear', revision: 3 },
    { action: 'set', revision: 4 },
    { action: 'clear', revision: 5 },
  ]);
}));

test('rating prompt is eligible once and resolving never reopens it', () => withTempLibrary(() => {
  assert.equal(getRatingPromptState('movie', 'tt2').eligible, false);
  assert.equal(markRatingPromptEligible('movie', 'tt2', 100).eligible, true);
  assert.equal(resolveRatingPrompt('movie', 'tt2', 'dismissed', 200).eligible, false);
  assert.equal(markRatingPromptEligible('movie', 'tt2', 300).eligible, false);
  assert.equal(getRatingPromptState('movie', 'tt2').resolved_at, 200);
}));

test('natural movie finish and three completed series episodes create a non-blocking prompt', () => withTempLibrary(() => {
  recordLibraryWatch({
    type: 'movie', id: 'tt-movie', title: 'Movie', position_sec: 90, duration_sec: 100, watched_at: 100,
  });
  assert.equal(getRatingPromptState('movie', 'tt-movie').eligible, true);
  for (let episode = 1; episode <= 2; episode += 1) {
    recordLibraryWatch({
      type: 'series', id: 'tt-series', play_id: `tt-series:1:${episode}`, title: 'Series',
      position_sec: 90, duration_sec: 100, watched_at: 200 + episode,
    });
  }
  assert.equal(getRatingPromptState('series', 'tt-series').eligible, false);
  recordLibraryWatch({
    type: 'series', id: 'tt-series', play_id: 'tt-series:1:3', title: 'Series',
    position_sec: 90, duration_sec: 100, watched_at: 203,
  });
  assert.equal(getRatingPromptState('series', 'tt-series').eligible, true);
}));

test('series rating-prompt episode counts cannot be pooled across profiles', () => withTempLibrary(() => {
  const alice = createViewerProfile('Prompt Alice');
  const bob = createViewerProfile('Prompt Bob');
  for (let episode = 1; episode <= 2; episode += 1) {
    recordLibraryWatch({
      profile_id: alice.profile_id,
      type: 'series',
      id: 'tt-shared-prompt',
      play_id: `tt-shared-prompt:1:${episode}`,
      title: 'Shared Prompt Series',
      position_sec: 95,
      duration_sec: 100,
      watched_at: 100 + episode,
    });
  }
  recordLibraryWatch({
    profile_id: bob.profile_id,
    type: 'series',
    id: 'tt-shared-prompt',
    play_id: 'tt-shared-prompt:1:3',
    title: 'Shared Prompt Series',
    position_sec: 95,
    duration_sec: 100,
    watched_at: 200,
  });

  activateViewerProfile(alice.profile_id);
  assert.equal(getRatingPromptState('series', 'tt-shared-prompt').eligible, false);
  activateViewerProfile(bob.profile_id);
  assert.equal(getRatingPromptState('series', 'tt-shared-prompt').eligible, false);
  activateViewerProfile('household');
  assert.equal(getRatingPromptState('series', 'tt-shared-prompt').eligible, false);

  recordLibraryWatch({
    profile_id: alice.profile_id,
    type: 'series',
    id: 'tt-shared-prompt',
    play_id: 'tt-shared-prompt:1:4',
    title: 'Shared Prompt Series',
    position_sec: 95,
    duration_sec: 100,
    watched_at: 300,
  });
  activateViewerProfile(alice.profile_id);
  assert.equal(getRatingPromptState('series', 'tt-shared-prompt').eligible, true);
  activateViewerProfile(bob.profile_id);
  assert.equal(getRatingPromptState('series', 'tt-shared-prompt').eligible, false);
}));

function approvedManifest(): SeedManifest {
  return {
    manifest_name: 'household-v1',
    manifest_version: 1,
    source_hash: 'b'.repeat(64),
    generated_at: '2026-08-02T00:00:00Z',
    items: [{
      status: 'approved',
      type: 'movie',
      id: 'tt0111161',
      title: 'The Shawshank Redemption',
      year: 1994,
      fire_steps: 9,
      water_steps: 10,
      caption_hash: 'c'.repeat(64),
      taste_tags: ['hopeful', 'friendship'],
      match_evidence: { exact_title: true, exact_year: true, director_match: true, candidate_count: 1 },
    }, {
      status: 'excluded',
      type: 'movie',
      title: 'Unresolved',
      exclusion_reason: 'No unique stable identity',
    }],
  };
}

test('seed import is strict, idempotent, and stores no raw caption', () => withTempLibrary(() => {
  const manifest = approvedManifest();
  const first = importSeedManifest(manifest);
  assert.equal(first.imported, 1);
  assert.equal(first.excluded, 1);
  assert.equal(first.noop, false);
  const second = importSeedManifest(manifest);
  assert.equal(second.noop, true);
  assert.equal(listRatings()[0]?.origin, 'seed');
  assert.equal(JSON.stringify(listRatings()).includes('caption'), false);

  const unresolved = approvedManifest();
  unresolved.items[0]!.status = 'review';
  assert.throws(() => validateSeedManifest(unresolved), /unresolved/);

  const invalid = approvedManifest();
  invalid.items[0]!.fire_steps = 3.5;
  assert.throws(() => validateSeedManifest(invalid), /integer half-steps/);

  const unsafe = approvedManifest();
  Object.assign(unsafe.items[0]!, { caption: 'must never persist' });
  assert.throws(() => validateSeedManifest(unsafe), /forbidden raw source/);
}));

test('ratings and prompt eligibility are isolated while seed ratings warm Household only', () => withTempLibrary(() => {
  assert.equal(importSeedManifest(approvedManifest()).imported, 1);
  assert.equal(getRating('movie', 'tt0111161')?.origin, 'seed');

  const alice = createViewerProfile('Alice');
  activateViewerProfile(alice.profile_id);
  assert.equal(getRating('movie', 'tt0111161'), null);
  const aliceRating = putRating({
    type: 'movie', id: 'tt0111161', title: 'The Shawshank Redemption',
    fire: 3.5, water: 4, expected_revision: 0,
  });
  assert.equal(aliceRating?.origin, 'couch');
  assert.equal(aliceRating?.profile_id, alice.profile_id);
  recordLibraryWatch({
    type: 'movie', id: 'tt-alice-finished', title: 'Alice finished',
    position_sec: 90, duration_sec: 100, watched_at: 1_000,
  });
  assert.equal(getRatingPromptState('movie', 'tt-alice-finished').eligible, true);

  const bob = createViewerProfile('Bob');
  activateViewerProfile(bob.profile_id);
  assert.equal(getRating('movie', 'tt0111161'), null);
  assert.equal(getRatingPromptState('movie', 'tt-alice-finished').eligible, false);

  activateViewerProfile('household');
  const household = getRating('movie', 'tt0111161');
  assert.equal(household?.origin, 'seed');
  assert.equal(household?.profile_id, 'household');
  assert.equal(household?.fire, 4.5);
  assert.equal(household?.water, 5);
}));
