import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogResourceUrl } from './list-source.js';

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
