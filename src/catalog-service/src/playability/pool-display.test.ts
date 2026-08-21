import assert from 'node:assert/strict';
import test from 'node:test';
import { displaySnapshotFromCandidate } from './pool-display.js';

test('displaySnapshotFromCandidate uses catalog title and poster', () => {
  const snapshot = displaySnapshotFromCandidate({
    id: 'tt0111161',
    type: 'movie',
    title: 'The Shawshank Redemption',
    poster: 'https://example.test/poster.jpg',
    year: 1994,
  });
  assert.equal(snapshot.title, 'The Shawshank Redemption');
  assert.equal(snapshot.poster_url, 'https://example.test/poster.jpg');
  assert.equal(snapshot.year, '1994');
});

test('displaySnapshotFromCandidate falls back to metahub poster', () => {
  const snapshot = displaySnapshotFromCandidate({
    id: 'tt0111161',
    type: 'movie',
    title: 'Shawshank',
  });
  assert.equal(snapshot.poster_url, 'https://images.metahub.space/poster/medium/tt0111161/img');
});
