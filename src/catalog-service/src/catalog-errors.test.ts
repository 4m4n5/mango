import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBlockedCatalogMeta,
  isBlockedCatalogText,
  isAddonRateLimitMessage,
} from './catalog-errors.js';

test('isBlockedCatalogText catches rate-limit copy', () => {
  assert.equal(isBlockedCatalogText('Rate limit exceeded'), true);
  assert.equal(isBlockedCatalogText('Too many requests'), true);
  assert.equal(isBlockedCatalogText('Breaking Bad'), false);
});

test('isBlockedCatalogMeta rejects error metas', () => {
  assert.equal(isBlockedCatalogMeta({
    id: 'tt0111161',
    name: 'Rate limit exceeded',
    description: 'Please wait',
  }), true);
  assert.equal(isBlockedCatalogMeta({
    id: 'tt0111161',
    name: 'The Shawshank Redemption',
    description: 'Two imprisoned men bond over years.',
  }), false);
});

test('isAddonRateLimitMessage still matches HTTP-style errors', () => {
  assert.equal(isAddonRateLimitMessage('HTTP 429'), true);
  assert.equal(isAddonRateLimitMessage('catalog ok'), false);
});
