import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogCore, type Meta, type ResolveStreamOptions } from './core.js';
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
    { title: 'The Office', year: 2005 },
  );
  assert.equal(context.metaTitle, 'The Office');
  assert.equal(context.metaYear, 2001);
  assert.equal(context.metaCountry, 'United Kingdom');
  assert.equal(context.episodeTitle, 'Downsize');
});
