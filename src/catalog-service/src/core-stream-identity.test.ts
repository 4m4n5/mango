import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CatalogCore,
  metaPieceMatchesRequest,
  type Meta,
  type ResolveStreamOptions,
} from './core.js';
import {
  initPlayabilityDb,
  recordVerifyResult,
  resetPlayabilityDbForTests,
} from './playability/db.js';
import { resetTitleIdentityOverridesForTests } from './title-identity-overrides.js';
import type { StreamFilterContext } from './stream-filters.js';

type CoreIdentityInternals = {
  buildStreamFilterContext(
    type: string,
    id: string,
    identityHint?: ResolveStreamOptions['identityHint'],
  ): Promise<StreamFilterContext>;
  metaCached(type: string, id: string): Promise<Meta>;
};

function identityCore(metaCached: CoreIdentityInternals['metaCached']): CoreIdentityInternals {
  const core = Object.create(CatalogCore.prototype) as CoreIdentityInternals;
  core.metaCached = metaCached;
  return core;
}

test('launcher identity keeps title/year filtering active when optional meta is unavailable', async () => {
  const core = identityCore(async () => {
    throw new Error('meta unavailable');
  });
  const context = await core.buildStreamFilterContext(
    'series',
    'tt0290978:1:1',
    { title: 'The Office', year: 2001 },
  );
  assert.equal(context.metaTitle, 'The Office');
  assert.equal(context.metaYear, 2001);
  assert.equal(context.metaId, 'tt0290978:1:1');
  assert.equal(context.contentType, 'series');
  assert.deepEqual(context.trustedTitles, ['The Office']);
  assert.equal(context.identityCertifiable, true);
});

test('authoritative series meta enriches remake and episode identity', async () => {
  const core = identityCore(async (type, id) => {
    assert.equal(type, 'series');
    assert.equal(id, 'tt0290978');
    return {
      id,
      type,
      name: 'The Office',
      year: 2001,
      country: 'United Kingdom',
      videos: [{ id: 'tt0290978:1:1', title: 'Downsize', season: 1, episode: 1 }],
    };
  });
  const context = await core.buildStreamFilterContext(
    'series',
    'tt0290978:1:1',
    { title: 'The Office', year: 2001 },
  );
  assert.equal(context.metaTitle, 'The Office');
  assert.equal(context.metaYear, 2001);
  assert.equal(context.metaCountry, 'United Kingdom');
  assert.equal(context.episodeTitle, 'Downsize');
  assert.deepEqual(context.trustedTitles, ['The Office']);
  assert.equal(context.identityCertifiable, true);
});

test('compatible exact-id metadata becomes a bounded trusted alias', async () => {
  const core = identityCore(async () => ({
    id: 'tt7829834',
    type: 'series',
    name: 'My Next Guest Needs No Introduction with David Letterman',
    year: 2018,
  }));
  const context = await core.buildStreamFilterContext(
    'series',
    'tt7829834:1:1',
    { title: 'My Next Guest Needs No Introduction', year: 2018 },
  );
  assert.equal(context.metaTitle, 'My Next Guest Needs No Introduction');
  assert.deepEqual(context.trustedTitles, [
    'My Next Guest Needs No Introduction',
    'My Next Guest Needs No Introduction with David Letterman',
  ]);
  assert.equal(context.identityCertifiable, true);
});

test('incompatible exact-id metadata cannot broaden requested identity', async () => {
  const core = identityCore(async () => ({
    id: 'tt5787720',
    type: 'movie',
    name: 'The White Silk Dress',
    year: 2023,
    country: 'Vietnam',
    runtime: '117 min',
  }));
  const context = await core.buildStreamFilterContext(
    'movie',
    'tt5787720',
    { title: 'Dead Silent', year: 2016 },
  );
  assert.equal(context.metaTitle, 'Dead Silent');
  assert.deepEqual(context.trustedTitles, ['Dead Silent']);
  assert.equal(context.identityCertifiable, false);
  assert.equal(context.metaYear, 2016);
  assert.equal(context.metaCountry, undefined);
  assert.equal(context.metaRuntimeMinutes, undefined);
});

test('title identity override supplies missing country and explicit-edition fence', async () => {
  const env = { ...process.env };
  const dir = await mkdtemp(join(tmpdir(), 'mango-title-identity-'));
  process.env.MANGO_TITLE_IDENTITY_OVERRIDES = join(dir, 'identity.yaml');
  await writeFile(process.env.MANGO_TITLE_IDENTITY_OVERRIDES, `
titles:
  series:tt33347879:
    country: India
    trusted_titles:
      - The Traitors
      - The Traitors India
    require_explicit_edition: true
`);
  resetTitleIdentityOverridesForTests();
  try {
    const core = identityCore(async () => ({
      id: 'tt33347879',
      type: 'series',
      name: 'The Traitors',
      year: 2025,
    }));
    const context = await core.buildStreamFilterContext(
      'series',
      'tt33347879:2:1',
      { title: 'The Traitors', year: 2025 },
    );
    assert.equal(context.metaCountry, 'India');
    assert.equal(context.requireExplicitEdition, true);
    assert.deepEqual(context.trustedTitles, ['The Traitors', 'The Traitors India']);
  } finally {
    process.env = { ...env };
    resetTitleIdentityOverridesForTests();
    await rm(dir, { recursive: true, force: true });
  }
});

test('authoritative series metadata blocks wrong-type movie certification for same IMDb id', async () => {
  const env = { ...process.env };
  const dir = await mkdtemp(join(tmpdir(), 'mango-type-collision-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await initPlayabilityDb();
    const now = Date.now();
    await recordVerifyResult({
      type: 'movie',
      id: 'tt27205918',
      status: 'verified',
      observed_at: now,
      proof_version: 2,
      exact_main_win: true,
      request_title_id: 'tt27205918',
    });
    await recordVerifyResult({
      type: 'series',
      id: 'tt27205918',
      status: 'verified',
      observed_at: now + 1,
      proof_version: 2,
      exact_main_win: true,
      request_title_id: 'tt27205918',
    });
    const core = identityCore(async (type) => {
      if (type === 'series') {
        return {
          id: 'tt27205918',
          type: 'series',
          name: 'Chimp Empire',
          year: 2023,
          videos: [
            { id: 'tt27205918:1:1', title: 'Paradise Lost' },
            { id: 'tt27205918:1:2', title: 'Others' },
          ],
        };
      }
      return {
        id: 'tt27205918',
        type: 'movie',
        name: 'Chimp Empire',
        year: 2023,
      };
    });
    const movieContext = await core.buildStreamFilterContext(
      'movie',
      'tt27205918',
      { title: 'Chimp Empire', year: 2023 },
    );
    assert.equal(movieContext.identityCertifiable, false);

    const seriesContext = await core.buildStreamFilterContext(
      'series',
      'tt27205918:1:1',
      { title: 'Chimp Empire', year: 2023 },
    );
    assert.equal(seriesContext.identityCertifiable, true);
    assert.equal(seriesContext.episodeTitle, 'Paradise Lost');
  } finally {
    resetPlayabilityDbForTests();
    process.env = { ...env };
    await rm(dir, { recursive: true, force: true });
  }
});

test('ordinary bare IMDb movies do not pay a series metadata probe without local collision evidence', async () => {
  const env = { ...process.env };
  const dir = await mkdtemp(join(tmpdir(), 'mango-no-type-collision-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    const seenTypes: string[] = [];
    const core = identityCore(async (type, id) => {
      seenTypes.push(type);
      assert.equal(type, 'movie');
      return {
        id,
        type,
        name: 'Valid Movie',
        year: 2024,
      };
    });
    const movieContext = await core.buildStreamFilterContext(
      'movie',
      'tt42424242',
      { title: 'Valid Movie', year: 2024 },
    );
    assert.equal(movieContext.identityCertifiable, true);
    assert.deepEqual(seenTypes, ['movie']);
  } finally {
    resetPlayabilityDbForTests();
    process.env = { ...env };
    await rm(dir, { recursive: true, force: true });
  }
});

test('an exact-id metadata year contradiction cannot broaden or certify the request', async () => {
  const core = identityCore(async () => ({
    id: 'tt7654321',
    type: 'movie',
    name: 'Same Name',
    year: 2023,
    country: 'United States',
    runtime: '120 min',
  }));
  const context = await core.buildStreamFilterContext(
    'movie',
    'tt7654321',
    { title: 'Same Name', year: 2016 },
  );
  assert.equal(context.identityCertifiable, false);
  assert.equal(context.metaYear, 2016);
  assert.deepEqual(context.trustedTitles, ['Same Name']);
  assert.equal(context.metaCountry, undefined);
  assert.equal(context.metaRuntimeMinutes, undefined);
});

test('metadata request fence rejects a wrong id or declared type', () => {
  assert.equal(metaPieceMatchesRequest(
    { id: 'tt1234567', type: 'series', name: 'Example' },
    'series',
    'tt1234567',
  ), true);
  assert.equal(metaPieceMatchesRequest(
    { id: 'tt7654321', type: 'series', name: 'Wrong id' },
    'series',
    'tt1234567',
  ), false);
  assert.equal(metaPieceMatchesRequest(
    { id: 'tt1234567', type: 'movie', name: 'Wrong type' },
    'series',
    'tt1234567',
  ), false);
});
