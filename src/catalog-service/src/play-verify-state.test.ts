import assert from 'node:assert/strict';
import test from 'node:test';
import { isFirstTimeVerifiedPromotion } from './play-verify-state.js';

test('isFirstTimeVerifiedPromotion is true when never verified before', () => {
  assert.equal(isFirstTimeVerifiedPromotion(true, false), true);
});

test('isFirstTimeVerifiedPromotion is false when the playability index is not in use', () => {
  assert.equal(isFirstTimeVerifiedPromotion(false, false), false);
  assert.equal(isFirstTimeVerifiedPromotion(false, true), false);
});

test('isFirstTimeVerifiedPromotion is false when title has prior verify history', () => {
  assert.equal(isFirstTimeVerifiedPromotion(true, true), false);
});
