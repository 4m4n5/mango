import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogTimeoutError,
  couchSafeCatalogMessage,
  PlayTimeoutError,
  catalogAvailabilityReason,
  playErrorMessage,
  playTimeoutMessage,
} from './catalog-errors.js';

test('playErrorMessage passes through server couch copy', () => {
  assert.equal(
    playErrorMessage('no streams found for this title — try again later'),
    'no streams found for this title — try again later',
  );
  assert.equal(
    playErrorMessage('trying another source…'),
    'trying another source…',
  );
});

test('playErrorMessage sanitizes raw infra text', () => {
  assert.equal(playErrorMessage('HTTP 502 from AIOStreams: upstream'), 'catalog temporarily unavailable');
  assert.equal(playErrorMessage('fetch failed'), 'catalog temporarily unavailable');
});

test('playErrorMessage empty falls back to temporary unavailable', () => {
  assert.equal(playErrorMessage(''), 'catalog temporarily unavailable');
  assert.equal(playErrorMessage('   '), 'catalog temporarily unavailable');
});

test('browse sanitizer default matches temporary unavailable', () => {
  assert.equal(couchSafeCatalogMessage('weird addon blob'), 'catalog temporarily unavailable');
});

test('playTimeoutMessage is distinct from browse fallback', () => {
  assert.equal(playTimeoutMessage(), 'catalog timed out — try again');
  assert.equal(new CatalogTimeoutError().message, playTimeoutMessage());
  assert.equal(new PlayTimeoutError(true).requestAlreadyFinished, true);
});

test('catalog availability reason is explicit and never TV copy', () => {
  assert.equal(catalogAvailabilityReason(new Error('HTTP 429 rate limit')), 'busy');
  assert.equal(catalogAvailabilityReason(new Error('catalog is busy')), 'busy');
  assert.equal(catalogAvailabilityReason(new Error('catalog timed out')), 'timeout');
  assert.equal(catalogAvailabilityReason(new Error('Failed to fetch')), 'unavailable');
});
