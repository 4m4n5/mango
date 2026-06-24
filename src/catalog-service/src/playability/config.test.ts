import assert from 'node:assert/strict';
import test from 'node:test';
import {
  playabilityFailedRetryMsForReason,
  playabilityRailRejectionTtlMsForReason,
} from './config.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

test('playabilityFailedRetryMsForReason uses seven-day window for no_stream during grow pass', () => {
  const prev = process.env.MANGO_PLAYABILITY_GROW_PASS;
  process.env.MANGO_PLAYABILITY_GROW_PASS = '1';
  try {
    assert.equal(playabilityFailedRetryMsForReason('no_stream'), 7 * 24 * 60 * 60 * 1000);
  } finally {
    if (prev === undefined) {
      delete process.env.MANGO_PLAYABILITY_GROW_PASS;
    } else {
      process.env.MANGO_PLAYABILITY_GROW_PASS = prev;
    }
  }
});

test('playabilityRailRejectionTtlMsForReason classifies rail-level negative memory', () => {
  delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  assert.equal(playabilityRailRejectionTtlMsForReason('theme_probe_skip'), 7 * 24 * 60 * 60 * 1000);
  assert.equal(playabilityRailRejectionTtlMsForReason('no_stream'), 7 * 24 * 60 * 60 * 1000);
  assert.equal(playabilityRailRejectionTtlMsForReason('rate_limited'), 60 * 60 * 1000);
});

test('playabilityFailedRetryMsForReason uses long window for no_stream', () => {
  delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  assert.equal(playabilityFailedRetryMsForReason('no_stream'), 7 * 24 * 60 * 60 * 1000);
});

test('playabilityFailedRetryMsForReason retries all failures immediately during bootstrap', () => {
  process.env.MANGO_PLAYABILITY_BOOTSTRAP = '1';
  assert.equal(playabilityFailedRetryMsForReason('no_stream'), 0);
  assert.equal(playabilityFailedRetryMsForReason('timeout'), 0);
  assert.equal(playabilityFailedRetryMsForReason('status_clip'), 0);
  assert.equal(playabilityFailedRetryMsForReason('probe_failed'), 0);
});

test('playabilityFailedRetryMsForReason uses default window for timeout', () => {
  delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  assert.equal(playabilityFailedRetryMsForReason('timeout'), 24 * 60 * 60 * 1000);
});
