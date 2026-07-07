import assert from 'node:assert/strict';
import test from 'node:test';
import { isFirstTimeVerifiedPromotion } from './play-verify-state.js';

test('isFirstTimeVerifiedPromotion is true the first time a title verifies (absent status)', () => {
  assert.equal(isFirstTimeVerifiedPromotion(true, undefined), true);
  assert.equal(isFirstTimeVerifiedPromotion(true, null), true);
});

test('isFirstTimeVerifiedPromotion is true when the prior status was failed, pending, or stale', () => {
  assert.equal(isFirstTimeVerifiedPromotion(true, 'failed'), true);
  assert.equal(isFirstTimeVerifiedPromotion(true, 'pending'), true);
  assert.equal(isFirstTimeVerifiedPromotion(true, 'stale'), true);
});

test('isFirstTimeVerifiedPromotion is false when the title was already verified', () => {
  assert.equal(isFirstTimeVerifiedPromotion(true, 'verified'), false);
});

test('isFirstTimeVerifiedPromotion is false when the playability index is not in use', () => {
  assert.equal(isFirstTimeVerifiedPromotion(false, undefined), false);
  assert.equal(isFirstTimeVerifiedPromotion(false, 'failed'), false);
});
