import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeResourceId } from './core.js';

test('normalizeResourceId strips a trailing Stremio .json suffix', () => {
  assert.equal(normalizeResourceId('tt33014583.json'), 'tt33014583');
  assert.equal(normalizeResourceId('tt33014583.JSON'), 'tt33014583');
  assert.equal(normalizeResourceId('tt0290978:1:1.json'), 'tt0290978:1:1');
});

test('normalizeResourceId leaves bare ids unchanged', () => {
  assert.equal(normalizeResourceId('tt33014583'), 'tt33014583');
  assert.equal(normalizeResourceId('tt0290978:1:1'), 'tt0290978:1:1');
  assert.equal(normalizeResourceId('movie.json.extra'), 'movie.json.extra');
});
