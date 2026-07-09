import assert from 'node:assert/strict';
import test from 'node:test';

import { couchSafeCatalogMessage, playErrorMessage, playTimeoutMessage } from './catalog-errors.js';

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
});
