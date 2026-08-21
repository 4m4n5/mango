import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogCore,
  metaPieceMatchesRequest,
  type Meta,
  type ResolveStreamOptions,
} from './core.js';
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
