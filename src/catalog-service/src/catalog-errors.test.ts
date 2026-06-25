import assert from 'node:assert/strict';
import test from 'node:test';
import {
  couchPlayFailureMessage,
  couchSafeCatalogMessage,
  isBlockedCatalogMeta,
  isBlockedCatalogText,
  isAddonRateLimitMessage,
} from './catalog-errors.js';

test('isBlockedCatalogText catches rate-limit copy', () => {
  assert.equal(isBlockedCatalogText('Rate limit exceeded'), true);
  assert.equal(isBlockedCatalogText('rate-limit exceeded'), true);
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

test('couchPlayFailureMessage treats exhausted titles as title-level failures', () => {
  assert.equal(couchPlayFailureMessage([]), 'no streams found for this title');
  assert.equal(
    couchPlayFailureMessage([{ error: 'mpv exited before playback started' }]),
    'stream did not start — try another option',
  );
});

test('couchSafeCatalogMessage keeps provider failures as catalog failures', () => {
  assert.equal(couchSafeCatalogMessage('AIOStreams: fetch failed'), 'catalog temporarily unavailable');
  assert.equal(couchSafeCatalogMessage('AIOStreams: timeout after 12000ms'), 'catalog timed out — try again');
});
