import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sourceAdvanceJump,
  sourceOffsetsForGrowOutcome,
} from './grow-cursor-policy.js';

test('sourceAdvanceJump is linear per reset cycle', () => {
  assert.equal(sourceAdvanceJump(50, 25), 1250);
  assert.equal(sourceAdvanceJump(50, 5), 250);
});

test('failed deep source exploration rolls back to the pre-deep cursor snapshot', () => {
  const preDeep = new Map([['A:c1', 120], ['A:c2', 40]]);
  const final = new Map([['A:c1', 70120], ['A:c2', 70040]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: false,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
  });

  assert.deepEqual([...offsets?.entries() ?? []], [...preDeep.entries()]);
});

test('successful deep source exploration persists the final cursor snapshot', () => {
  const preDeep = new Map([['A:c1', 120]]);
  const final = new Map([['A:c1', 1370]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: true,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
  });

  assert.deepEqual([...offsets?.entries() ?? []], [...final.entries()]);
});

test('empty exhausted source exploration wraps finite catalogs to head', () => {
  const final = new Map([['A:c1', 500], ['A:c2', 120]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: false,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: new Map(final),
    finalSourceOffsets: final,
    exhausted: true,
    candidatesSeen: 0,
  });

  assert.deepEqual([...offsets?.entries() ?? []], [['A:c1', 0], ['A:c2', 0]]);
});

test('non-empty failed source exploration keeps rollback snapshot', () => {
  const preDeep = new Map([['A:c1', 120]]);
  const final = new Map([['A:c1', 1370]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: false,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
    exhausted: true,
    candidatesSeen: 3,
  });

  assert.deepEqual([...offsets?.entries() ?? []], [...preDeep.entries()]);
});

test('mixed failed exploration rewinds only exhausted empty sources to head', () => {
  const preDeep = new Map([['AIOMetadata:deep-empty', 300], ['Cinemeta:top', 30]]);
  const final = new Map([['AIOMetadata:deep-empty', 420], ['Cinemeta:top', 60]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: false,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
    exhausted: true,
    candidatesSeen: 20,
    sourceOutcomes: [
      {
        source_key: 'AIOMetadata:deep-empty',
        requested: 30,
        returned: 0,
        exhausted: true,
      },
      {
        source_key: 'Cinemeta:top',
        requested: 30,
        returned: 20,
        exhausted: false,
      },
    ],
  });

  assert.deepEqual([...offsets?.entries() ?? []], [
    ['AIOMetadata:deep-empty', 0],
    ['Cinemeta:top', 30],
  ]);
});

test('successful mixed-source growth preserves healthy final cursors while retrying empty source at head', () => {
  const preDeep = new Map([['AIOMetadata:deep-empty', 300], ['Cinemeta:top', 30]]);
  const final = new Map([['AIOMetadata:deep-empty', 420], ['Cinemeta:top', 60]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: true,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
    exhausted: true,
    candidatesSeen: 20,
    sourceOutcomes: [
      {
        source_key: 'AIOMetadata:deep-empty',
        requested: 30,
        returned: 0,
        exhausted: true,
      },
    ],
  });

  assert.deepEqual([...offsets?.entries() ?? []], [
    ['AIOMetadata:deep-empty', 0],
    ['Cinemeta:top', 60],
  ]);
});

test('failed deep exploration does not reset non-empty exhausted sources', () => {
  const preDeep = new Map([['AIOMetadata:finite', 300], ['Cinemeta:top', 30]]);
  const final = new Map([['AIOMetadata:finite', 420], ['Cinemeta:top', 60]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: false,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
    exhausted: true,
    candidatesSeen: 20,
    sourceOutcomes: [
      {
        source_key: 'AIOMetadata:finite',
        requested: 30,
        returned: 12,
        exhausted: true,
      },
    ],
  });

  assert.deepEqual([...offsets?.entries() ?? []], [...preDeep.entries()]);
});

test('failed catalog errors do not masquerade as finite empty catalog exhaustion', () => {
  const preDeep = new Map([['AIOMetadata:outage', 300], ['Cinemeta:top', 30]]);
  const final = new Map([['AIOMetadata:outage', 420], ['Cinemeta:top', 60]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: false,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
    exhausted: true,
    candidatesSeen: 20,
    sourceOutcomes: [
      {
        source_key: 'AIOMetadata:outage',
        requested: 30,
        returned: 0,
        exhausted: true,
        catalog_errors: 1,
      },
      {
        source_key: 'Cinemeta:top',
        requested: 30,
        returned: 20,
        exhausted: false,
      },
    ],
  });

  assert.deepEqual([...offsets?.entries() ?? []], [...preDeep.entries()]);
});

test('rate-limited empty responses do not reset source cursor to head', () => {
  const preDeep = new Map([['AIOMetadata:limited', 300]]);
  const final = new Map([['AIOMetadata:limited', 420]]);

  const offsets = sourceOffsetsForGrowOutcome({
    targetMet: false,
    usedDeepSourceAdvance: true,
    preDeepSourceOffsets: preDeep,
    finalSourceOffsets: final,
    exhausted: true,
    candidatesSeen: 0,
    sourceOutcomes: [
      {
        source_key: 'AIOMetadata:limited',
        requested: 30,
        returned: 0,
        exhausted: true,
        rate_limited: 1,
      },
    ],
  });

  assert.deepEqual([...offsets?.entries() ?? []], [...preDeep.entries()]);
});
