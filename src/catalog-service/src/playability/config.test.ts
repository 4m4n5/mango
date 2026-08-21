import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  playabilityFailedRetryMsForReason,
  playabilityAdmissionDeadlineReached,
  playabilityCouchYieldRequested,
  playabilityPlayFailureRetryMs,
  playabilityStaleCandidateLimit,
  playabilityRailRejectionTtlMsForReason,
  playabilitySeriesCrossProbeLimit,
  playabilityVerifyTtlMs,
  triggerConsumerBatchLimit,
  triggerConsumerCooldownMs,
  triggerConsumerEnabled,
  triggerConsumerMaintenanceBatchLimit,
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
  assert.equal(playabilityRailRejectionTtlMsForReason('rate_limit'), 60 * 60 * 1000);
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

test('playabilityFailedRetryMsForReason uses short window for rate limits', () => {
  delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  assert.equal(playabilityFailedRetryMsForReason('rate_limited'), 60 * 60 * 1000);
  assert.equal(playabilityFailedRetryMsForReason('rate_limit'), 60 * 60 * 1000);
});

test('playabilityFailedRetryMsForReason retries legacy uncached quarantine immediately', () => {
  delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  assert.equal(playabilityFailedRetryMsForReason('uncached_verify_legacy'), 0);
  process.env.MANGO_PLAYABILITY_LEGACY_UNCACHED_RETRY_MS = '60000';
  assert.equal(playabilityFailedRetryMsForReason('uncached_verify_legacy'), 60_000);
});

test('playabilitySeriesCrossProbeLimit defaults to zero (no sibling episode scrapes)', () => {
  delete process.env.MANGO_PLAYABILITY_SERIES_CROSS_PROBE_LIMIT;
  assert.equal(playabilitySeriesCrossProbeLimit(), 0);
  process.env.MANGO_PLAYABILITY_SERIES_CROSS_PROBE_LIMIT = '0';
  assert.equal(playabilitySeriesCrossProbeLimit(), 0);
  process.env.MANGO_PLAYABILITY_SERIES_CROSS_PROBE_LIMIT = '99';
  assert.equal(playabilitySeriesCrossProbeLimit(), 24);
});

test('playabilityVerifyTtlMs defaults to a long recheck window', () => {
  delete process.env.MANGO_PLAYABILITY_TTL_MS;
  assert.equal(playabilityVerifyTtlMs(), 30 * 24 * 60 * 60 * 1000);
  process.env.MANGO_PLAYABILITY_TTL_MS = String(180 * 24 * 60 * 60 * 1000);
  assert.equal(playabilityVerifyTtlMs(), 180 * 24 * 60 * 60 * 1000);
});

test('Q2: play_failure gets a short dedicated retry window, distinct from the 7d no_stream tombstone', () => {
  delete process.env.MANGO_PLAYABILITY_BOOTSTRAP;
  delete process.env.MANGO_PLAY_FAILURE_RETRY_HOURS;
  assert.equal(playabilityPlayFailureRetryMs(), 60 * 60 * 1000);
  assert.equal(playabilityFailedRetryMsForReason('play_failure'), 60 * 60 * 1000);
  assert.equal(playabilityFailedRetryMsForReason('no_stream'), 7 * 24 * 60 * 60 * 1000);
});

test('nightly stale candidate admission is bounded', () => {
  delete process.env.MANGO_PLAYABILITY_STALE_CANDIDATE_LIMIT;
  assert.equal(playabilityStaleCandidateLimit(), 200);
  process.env.MANGO_PLAYABILITY_STALE_CANDIDATE_LIMIT = '99999';
  assert.equal(playabilityStaleCandidateLimit(), 2000);
});

test('admission deadline is fail-closed only after a valid absolute deadline', () => {
  delete process.env.MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS;
  assert.equal(playabilityAdmissionDeadlineReached(1_000), false);
  process.env.MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS = '2000';
  assert.equal(playabilityAdmissionDeadlineReached(1_999), false);
  assert.equal(playabilityAdmissionDeadlineReached(2_000), true);
});

test('maintenance yields to couch activity at a work boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mango-couch-yield-'));
  try {
    process.env.MANGO_MAINTENANCE_MODE = '1';
    process.env.MANGO_COUCH_ACTIVITY_STATE = join(directory, 'couch.json');
    process.env.MANGO_COUCH_IDLE_SEC = '1800';
    await writeFile(process.env.MANGO_COUCH_ACTIVITY_STATE, JSON.stringify({ ts: 10_000 }));
    assert.equal(playabilityCouchYieldRequested(10_001), true);
    assert.equal(playabilityCouchYieldRequested(10_000 + 1_800_000), false);
    process.env.MANGO_MAINTENANCE_IGNORE_COUCH_ACTIVITY = '1';
    assert.equal(playabilityCouchYieldRequested(10_001), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Q2: MANGO_PLAY_FAILURE_RETRY_HOURS overrides the play_failure window', () => {
  process.env.MANGO_PLAY_FAILURE_RETRY_HOURS = '2';
  assert.equal(playabilityPlayFailureRetryMs(), 2 * 60 * 60 * 1000);
  assert.equal(playabilityFailedRetryMsForReason('play_failure'), 2 * 60 * 60 * 1000);
});

test('Q2: play_failure retries immediately during bootstrap, matching other reasons', () => {
  process.env.MANGO_PLAYABILITY_BOOTSTRAP = '1';
  assert.equal(playabilityFailedRetryMsForReason('play_failure'), 0);
});

test('H1: trigger consumer config is off by default and bounded when configured', () => {
  delete process.env.MANGO_TRIGGER_CONSUMER;
  delete process.env.MANGO_TRIGGER_CONSUMER_BATCH;
  delete process.env.MANGO_TRIGGER_CONSUMER_MAINTENANCE_BATCH;
  delete process.env.MANGO_TRIGGER_CONSUMER_COOLDOWN_MS;
  assert.equal(triggerConsumerEnabled(), false);
  assert.equal(triggerConsumerBatchLimit(), 10);
  assert.equal(triggerConsumerMaintenanceBatchLimit(), 200);
  assert.equal(triggerConsumerCooldownMs(), 5 * 60 * 1000);

  process.env.MANGO_TRIGGER_CONSUMER = '1';
  process.env.MANGO_TRIGGER_CONSUMER_BATCH = '9999';
  assert.equal(triggerConsumerEnabled(), true);
  assert.equal(triggerConsumerBatchLimit(), 100);
});
