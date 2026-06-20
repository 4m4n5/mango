import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTitleMatch } from './search.js';

test('scoreTitleMatch ranks exact and prefix matches highest', () => {
  assert.equal(scoreTitleMatch('Panchayat', 'panchayat'), 100);
  assert.ok(scoreTitleMatch('Panchayat Season 2', 'panch') >= 90);
  assert.ok(scoreTitleMatch('The Shawshank Redemption', 'shawshank') >= 70);
  assert.equal(scoreTitleMatch('Dark Knight', 'panchayat'), 0);
});

test('scoreTitleMatch handles multi-word partial matches', () => {
  const score = scoreTitleMatch('Breaking Bad', 'break bad');
  assert.ok(score >= 45);
});
