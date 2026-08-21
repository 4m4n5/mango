import assert from 'node:assert/strict';
import test from 'node:test';
import { CompositeListSource } from './list-source.js';
import { catalogSourceKey } from './source-cursors.js';

test('CompositeListSource tracks independent source keys', () => {
  const source = new CompositeListSource('movies-global-popular', 'movie', [
    {
      addon: 'AIOMetadata',
      catalog: 'mdblist.88302',
      weight: 2,
      manifestUrl: 'https://example/manifest.json',
      sourceLabel: 'AIOMetadata/mdblist.88302',
    },
    {
      addon: 'AIOMetadata',
      catalog: 'mdblist.83666',
      weight: 1,
      manifestUrl: 'https://example/manifest.json',
      sourceLabel: 'AIOMetadata/mdblist.83666',
    },
  ]);

  assert.deepEqual(source.listSourceKeys(), [
    catalogSourceKey('AIOMetadata', 'mdblist.88302'),
    catalogSourceKey('AIOMetadata', 'mdblist.83666'),
  ]);

  source.writeSourceOffsets(new Map([
    [catalogSourceKey('AIOMetadata', 'mdblist.88302'), 12],
    [catalogSourceKey('AIOMetadata', 'mdblist.83666'), 7],
  ]));
  assert.equal(source.readSourceOffsets().get(catalogSourceKey('AIOMetadata', 'mdblist.88302')), 12);
  source.resetAllSourceOffsets();
  assert.equal(source.readSourceOffsets().get(catalogSourceKey('AIOMetadata', 'mdblist.88302')), 0);
});

test('catalogSourceKey uses addon:catalog form', () => {
  assert.equal(catalogSourceKey('Cinemeta', 'imdbRating'), 'Cinemeta:imdbRating');
});
