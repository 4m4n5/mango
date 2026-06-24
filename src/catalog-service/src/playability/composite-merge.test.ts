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

test('allocateSourceLimits honors ordinary weights', () => {
  assert.deepEqual(allocateSourceLimits(10, [0.6, 0.4]), [6, 4]);
  assert.deepEqual(allocateSourceLimits(3, [0.5, 0.5]), [2, 1]);
});

test('allocateSourceLimits keeps probation sources to a small rotating budget', () => {
  const previousRatio = process.env.MANGO_GROW_SOURCE_PROBATION_BUDGET_RATIO;
  process.env.MANGO_GROW_SOURCE_PROBATION_BUDGET_RATIO = '0.1';
  try {
    assert.deepEqual(
      allocateSourceLimits(20, [1, 0.08, 0.08, 0.08, 0.08], { probationStartIndex: 0 }),
      [18, 1, 1, 0, 0],
    );
    assert.deepEqual(
      allocateSourceLimits(20, [1, 0.08, 0.08, 0.08, 0.08], { probationStartIndex: 2 }),
      [18, 0, 0, 1, 1],
    );
  } finally {
    if (previousRatio === undefined) {
      delete process.env.MANGO_GROW_SOURCE_PROBATION_BUDGET_RATIO;
    } else {
      process.env.MANGO_GROW_SOURCE_PROBATION_BUDGET_RATIO = previousRatio;
    }
  }
});

test('mergeCompositeCandidates interleaves weighted sources instead of source-order monopoly', () => {
  const batches: WeightedCandidateBatch[] = [
    {
      sourceIndex: 0,
      sourceLabel: 'primary',
      weight: 1,
      candidates: Array.from({ length: 8 }, (_, index) => ({
        id: `p${index}`,
        type: 'movie',
        title: `Primary ${index}`,
      })),
    },
    {
      sourceIndex: 1,
      sourceLabel: 'fallback',
      weight: 1,
      candidates: Array.from({ length: 8 }, (_, index) => ({
        id: `f${index}`,
        type: 'movie',
        title: `Fallback ${index}`,
      })),
    },
  ];
  const previous = process.env.MANGO_GROW_SOURCE_CAP_RATIO;
  process.env.MANGO_GROW_SOURCE_CAP_RATIO = '0.55';
  try {
    const merged = mergeCompositeCandidates(batches, 10);
    assert.ok(merged.some((item) => item.source === 'fallback'));
    assert.ok(merged.filter((item) => item.source === 'primary').length <= 6);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_GROW_SOURCE_CAP_RATIO;
    } else {
      process.env.MANGO_GROW_SOURCE_CAP_RATIO = previous;
    }
  }
});

test('mergeCompositeCandidates caps near-duplicate title clusters', () => {
  const previous = process.env.MANGO_GROW_TITLE_CLUSTER_CAP;
  process.env.MANGO_GROW_TITLE_CLUSTER_CAP = '2';
  try {
    const merged = mergeCompositeCandidates([
      {
        sourceIndex: 0,
        sourceLabel: 'sequels',
        weight: 1,
        candidates: [
          { id: 'a1', type: 'movie', title: 'Example Saga 2021' },
          { id: 'a2', type: 'movie', title: 'Example Saga 2022' },
          { id: 'a3', type: 'movie', title: 'Example Saga 2023' },
          { id: 'b1', type: 'movie', title: 'Different Pick' },
        ],
      },
    ], 10);
    assert.deepEqual(merged.map((item) => item.id), ['a1', 'a2', 'b1']);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_GROW_TITLE_CLUSTER_CAP;
    } else {
      process.env.MANGO_GROW_TITLE_CLUSTER_CAP = previous;
    }
  }
});
