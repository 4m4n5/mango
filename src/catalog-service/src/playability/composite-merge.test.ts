import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateSourceLimits,
  mergeCompositeCandidates,
  type WeightedCandidateBatch,
} from './composite-merge.js';

test('mergeCompositeCandidates dedupes by type:id keeping earliest source', () => {
  const batches: WeightedCandidateBatch[] = [
    {
      sourceIndex: 0,
      sourceLabel: 'top',
      weight: 0.6,
      candidates: [
        { id: 'tt1', type: 'movie', title: 'A' },
        { id: 'tt2', type: 'movie', title: 'B' },
      ],
    },
    {
      sourceIndex: 1,
      sourceLabel: 'year',
      weight: 0.4,
      candidates: [
        { id: 'tt2', type: 'movie', title: 'B duplicate' },
        { id: 'tt3', type: 'movie', title: 'C' },
      ],
    },
  ];
  const merged = mergeCompositeCandidates(batches, 10);
  assert.deepEqual(merged.map((item) => item.id), ['tt1', 'tt2', 'tt3']);
  assert.equal(merged[1]?.source, 'top');
  assert.equal(merged[1]?.title, 'B');
});

test('mergeCompositeCandidates respects offset and limit', () => {
  const batches: WeightedCandidateBatch[] = [{
    sourceIndex: 0,
    sourceLabel: 'one',
    weight: 1,
    candidates: [
      { id: '1', type: 'movie' },
      { id: '2', type: 'movie' },
      { id: '3', type: 'movie' },
    ],
  }];
  assert.deepEqual(
    mergeCompositeCandidates(batches, 2, 1).map((item) => item.id),
    ['2', '3'],
  );
});

test('allocateSourceLimits honors weights with minimum one per source', () => {
  assert.deepEqual(allocateSourceLimits(10, [0.6, 0.4]), [6, 4]);
  assert.deepEqual(allocateSourceLimits(3, [0.5, 0.5]), [2, 1]);
});
