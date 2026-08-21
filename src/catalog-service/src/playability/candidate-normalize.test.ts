import assert from 'node:assert/strict';
import test from 'node:test';
import type { Meta } from '../core.js';
import { normalizeExternalCandidateId } from './candidate-normalize.js';
import type { CandidateMeta } from './list-source.js';

function core(results: Meta[]) {
  return {
    searchMeta: async () => results,
  };
}

function candidate(overrides: Partial<CandidateMeta> = {}): CandidateMeta {
  return {
    type: 'series',
    id: 'tmdb:106314',
    title: 'Just Married Things',
    year: '2019',
    source: 'Bharat Binge/tmdb-hi-recent-series',
    source_key: 'Bharat Binge:tmdb-hi-recent-series',
    ...overrides,
  };
}

test('normalizeExternalCandidateId maps tmdb candidates to unique exact imdb match', async () => {
  const normalized = await normalizeExternalCandidateId(core([
    {
      id: 'tt1234567',
      type: 'series',
      name: 'Just Married Things',
      year: '2019',
      poster: 'https://example.test/poster.jpg',
    },
  ]), candidate());

  assert.equal(normalized.id, 'tt1234567');
  assert.equal(normalized.original_id, 'tmdb:106314');
  assert.equal(normalized.normalized_id, 'tt1234567');
  assert.equal(normalized.normalization_status, 'resolved_imdb');
  assert.equal(normalized.type, 'series');
  assert.equal(normalized.source_key, 'Bharat Binge:tmdb-hi-recent-series');
  assert.equal(normalized.poster, 'https://example.test/poster.jpg');
});

test('normalizeExternalCandidateId uses year to disambiguate exact title matches', async () => {
  const normalized = await normalizeExternalCandidateId(core([
    { id: 'tt1111111', type: 'series', name: 'Hostages', year: '2013' },
    { id: 'tt2222222', type: 'series', name: 'Hostages', year: '2019' },
  ]), candidate({ title: 'Hostages', year: '2019' }));

  assert.equal(normalized.id, 'tt2222222');
});

test('normalizeExternalCandidateId leaves ambiguous title-only matches unchanged', async () => {
  const original = candidate({ title: 'Hostages', year: undefined });
  const normalized = await normalizeExternalCandidateId(core([
    { id: 'tt1111111', type: 'series', name: 'Hostages', year: '2013' },
    { id: 'tt2222222', type: 'series', name: 'Hostages', year: '2019' },
  ]), original);

  assert.equal(normalized.id, 'tmdb:106314');
  assert.equal(normalized.normalization_status, 'unresolved_external_id');
  assert.equal(normalized.original_id, 'tmdb:106314');
});

test('normalizeExternalCandidateId leaves non-exact matches unchanged', async () => {
  const normalized = await normalizeExternalCandidateId(core([
    { id: 'tt1234567', type: 'series', name: 'Just Married' },
  ]), candidate());

  assert.equal(normalized.id, 'tmdb:106314');
  assert.equal(normalized.normalization_status, 'unresolved_external_id');
});
