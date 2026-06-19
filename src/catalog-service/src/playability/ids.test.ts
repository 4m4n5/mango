import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSeriesVerifyId,
  seriesBareId,
  seriesFollowUpEpisodeIds,
} from './ids.js';

test('normalizeSeriesVerifyId appends S1E1 for bare imdb series ids', () => {
  assert.equal(normalizeSeriesVerifyId('series', 'tt0944947'), 'tt0944947:1:1');
  assert.equal(normalizeSeriesVerifyId('series', 'TT0944947'), 'TT0944947:1:1');
});

test('normalizeSeriesVerifyId leaves episode ids unchanged', () => {
  assert.equal(normalizeSeriesVerifyId('series', 'tt0944947:1:1'), 'tt0944947:1:1');
  assert.equal(normalizeSeriesVerifyId('series', 'tt0944947:2:5'), 'tt0944947:2:5');
});

test('normalizeSeriesVerifyId leaves movie ids unchanged', () => {
  assert.equal(normalizeSeriesVerifyId('movie', 'tt0111161'), 'tt0111161');
});

test('seriesFollowUpEpisodeIds queues S1E2 through S1E4', () => {
  assert.deepEqual(seriesFollowUpEpisodeIds('tt0944947'), [
    'tt0944947:1:2',
    'tt0944947:1:3',
    'tt0944947:1:4',
  ]);
});

test('seriesBareId extracts bare id from episode id', () => {
  assert.equal(seriesBareId('tt0944947:1:1'), 'tt0944947');
  assert.equal(seriesBareId('tt0944947'), 'tt0944947');
});
