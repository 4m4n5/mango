import assert from 'node:assert/strict';
import test from 'node:test';
import {
  playabilityFailedRetryMsForReason,
} from './config.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

test('playabilityFailedRetryMsForReason uses long window for no_stream', () => {
  delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  assert.equal(playabilityFailedRetryMsForReason('no_stream'), 7 * 24 * 60 * 60 * 1000);
});

test('playabilityFailedRetryMsForReason retries no_stream immediately during bootstrap', () => {
  process.env.MANGO_PLAYABILITY_BOOTSTRAP = '1';
  assert.equal(playabilityFailedRetryMsForReason('no_stream'), 0);
});

test('playabilityFailedRetryMsForReason uses default window for timeout', () => {
  assert.equal(playabilityFailedRetryMsForReason('timeout'), 24 * 60 * 60 * 1000);
});
