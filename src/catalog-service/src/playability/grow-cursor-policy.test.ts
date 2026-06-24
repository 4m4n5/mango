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
