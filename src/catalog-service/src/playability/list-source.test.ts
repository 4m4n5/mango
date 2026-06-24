import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogResourceUrl, CompositeListSource } from './list-source.js';

test('catalogResourceUrl passes skip to addon for server-side pagination', () => {
  const base = 'http://127.0.0.1:3036/stremio/uuid/manifest.json';
  assert.equal(
    catalogResourceUrl(base, 'movie', 'mdblist.88302'),
    'http://127.0.0.1:3036/stremio/uuid/catalog/movie/mdblist.88302.json',
  );
  assert.equal(
    catalogResourceUrl(base, 'movie', 'mdblist.88302', { skip: 200 }),
    'http://127.0.0.1:3036/stremio/uuid/catalog/movie/mdblist.88302/skip=200.json',
  );
});

test('CompositeListSource skips exhausted sources until cursor reset', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ metas: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const source = new CompositeListSource('rail', 'movie', [{
      addon: 'A',
      catalog: 'c1',
      weight: 1,
      manifestUrl: 'http://127.0.0.1:3036/stremio/a/manifest.json',
      sourceLabel: 'A/c1',
    }]);

    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(source.areAllSourcesExhausted(), true);
    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(fetches, 1);

    source.resetAllSourceOffsets();
    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CompositeListSource suppresses a source for the current grow run without moving cursor', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ metas: [{ id: `tt${fetches}`, name: `Title ${fetches}` }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const source = new CompositeListSource('rail', 'movie', [{
      addon: 'A',
      catalog: 'c1',
      weight: 1,
      manifestUrl: 'http://127.0.0.1:3036/stremio/a/manifest.json',
      sourceLabel: 'A/c1',
    }]);
    source.setSuppressedSourceKeys(new Set(['A:c1']));

    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(source.areAllSourcesExhausted(), true);
    assert.equal(fetches, 0);
    assert.equal(source.readSourceOffsets().get('A:c1'), undefined);

    source.setSuppressedSourceKeys(new Set());
    assert.equal((await source.candidates({ offset: 0, limit: 10 })).length, 1);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
