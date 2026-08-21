import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CatalogError } from '../catalog-errors.js';
import {
  activateViewerProfile,
  createViewerProfile,
  initLibraryDb,
  registerRecommendationServedSlate,
  resetLibraryDbForTests,
} from '../library/db.js';
import { validateOptionalRecommendationMutationAttribution } from './mutation-attribution.js';

function withTempLibrary<T>(fn: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-mutation-attribution-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    return fn();
  } finally {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertConflict(fn: () => unknown, message: RegExp): void {
  assert.throws(fn, (error: unknown) => (
    error instanceof CatalogError && error.status === 409 && message.test(error.message)
  ));
}

test('ordinary mutations remain valid without recommendation attribution', () => withTempLibrary(() => {
  assert.equal(validateOptionalRecommendationMutationAttribution(
    { type: 'movie', id: 'tt-one' },
    'vod',
    { type: 'movie', id: 'tt-one' },
  ), null);
  assert.equal(validateOptionalRecommendationMutationAttribution(
    { type: 'movie', id: 'tt-one', rail_id: 'popular-movies' },
    'vod',
    { type: 'movie', id: 'tt-one' },
  ), null);
}));

test('mutation attribution binds the exact item and rejects partial or injected proof', () => withTempLibrary(() => {
  const alice = createViewerProfile('Mutation Alice');
  activateViewerProfile(alice.profile_id);
  const served = registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'youtube',
    rail_id: 'for_you',
    source_revision: 4,
    items: [{ type: 'youtube_video', id: 'video-one', rank: 0 }],
  });
  const proof = {
    attribution_token: served.attribution_token,
    rail_id: served.rail_id,
    slate_revision: served.slate_revision,
  };

  assert.equal(validateOptionalRecommendationMutationAttribution(
    proof,
    'youtube',
    { type: 'youtube_video', id: 'video-one' },
  )?.profile_id, alice.profile_id);
  assertConflict(
    () => validateOptionalRecommendationMutationAttribution(
      { attribution_token: served.attribution_token, rail_id: served.rail_id },
      'youtube',
      { type: 'youtube_video', id: 'video-one' },
    ),
    /incomplete/,
  );
  for (const invalidRevision of [null, true, '', ' ', '0.0', '-0', '1e0']) {
    assertConflict(
      () => validateOptionalRecommendationMutationAttribution(
        { ...proof, slate_revision: invalidRevision },
        'youtube',
        { type: 'youtube_video', id: 'video-one' },
      ),
      /incomplete/,
    );
  }
  assert.equal(validateOptionalRecommendationMutationAttribution(
    { ...proof, slate_revision: String(served.slate_revision) },
    'youtube',
    { type: 'youtube_video', id: 'video-one' },
  )?.profile_id, alice.profile_id);
  assertConflict(
    () => validateOptionalRecommendationMutationAttribution(
      proof,
      'youtube',
      { type: 'youtube_video', id: 'video-injected' },
    ),
    /no longer current/,
  );
  assertConflict(
    () => validateOptionalRecommendationMutationAttribution(
      proof,
      'vod',
      { type: 'youtube_video', id: 'video-one' },
    ),
    /no longer current/,
  );
}));

test('a recommendation mutation is rejected after its served profile stops being active', () => withTempLibrary(() => {
  const alice = createViewerProfile('Stale Alice');
  const bob = createViewerProfile('Current Bob');
  const served = registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'youtube',
    rail_id: 'for_you',
    source_revision: 8,
    items: [{ type: 'youtube_video', id: 'CaseSensitiveId', rank: 0 }],
  });
  activateViewerProfile(bob.profile_id);

  assertConflict(
    () => validateOptionalRecommendationMutationAttribution({
      attribution_token: served.attribution_token,
      rail_id: served.rail_id,
      slate_revision: served.slate_revision,
    }, 'youtube', { type: 'youtube_video', id: 'CaseSensitiveId' }),
    /profile changed/,
  );
}));

test('YouTube serve accepts Household action proof without taking over a personal VOD owner', () => withTempLibrary(() => {
  const previousVodMode = process.env.MANGO_VOD_RECS_V2;
  const previousYoutubeMode = process.env.MANGO_YOUTUBE_RECS_V2;
  process.env.MANGO_VOD_RECS_V2 = 'shadow';
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  try {
    const personal = createViewerProfile('Mixed Mode');
    activateViewerProfile(personal.profile_id);
    const youtubeServed = registerRecommendationServedSlate({
      profile_id: 'household',
      domain: 'youtube',
      rail_id: 'for_you',
      source_revision: 9,
      items: [{ type: 'youtube_video', id: 'HouseholdVideo', rank: 0 }],
    });
    const proof = {
      attribution_token: youtubeServed.attribution_token,
      rail_id: youtubeServed.rail_id,
      slate_revision: youtubeServed.slate_revision,
    };
    assert.equal(validateOptionalRecommendationMutationAttribution(
      proof,
      'youtube',
      { type: 'youtube_video', id: 'HouseholdVideo' },
    )?.profile_id, 'household');

    const personalYoutubeServed = registerRecommendationServedSlate({
      profile_id: personal.profile_id,
      domain: 'youtube',
      rail_id: 'for_you',
      source_revision: 10,
      items: [{ type: 'youtube_video', id: 'PersonalVideo', rank: 0 }],
    });
    assertConflict(
      () => validateOptionalRecommendationMutationAttribution({
        attribution_token: personalYoutubeServed.attribution_token,
        rail_id: personalYoutubeServed.rail_id,
        slate_revision: personalYoutubeServed.slate_revision,
      }, 'youtube', { type: 'youtube_video', id: 'PersonalVideo' }),
      /profile changed/,
    );
  } finally {
    if (previousVodMode === undefined) delete process.env.MANGO_VOD_RECS_V2;
    else process.env.MANGO_VOD_RECS_V2 = previousVodMode;
    if (previousYoutubeMode === undefined) delete process.env.MANGO_YOUTUBE_RECS_V2;
    else process.env.MANGO_YOUTUBE_RECS_V2 = previousYoutubeMode;
  }
}));
