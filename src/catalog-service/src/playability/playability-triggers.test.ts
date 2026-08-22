import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  enqueuePlayabilityTrigger,
  getPlayFailureTitlesForReverify,
  getStaleTitlesForRefresh,
  getTitlePlayability,
  invalidateTitle,
  listUnhandledPlayabilityTriggers,
  markPlayabilityTriggersHandled,
  queueProactiveRenewalsBeforeExpiry,
  recordVerifyResult,
  resetPlayabilityDbForTests,
  sweepExpiredVerified,
} from './db.js';

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playability-triggers-'));
  const oldDb = process.env.MANGO_PLAYABILITY_DB;
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    if (oldDb === undefined) {
      delete process.env.MANGO_PLAYABILITY_DB;
    } else {
      process.env.MANGO_PLAYABILITY_DB = oldDb;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test('H2: listUnhandledPlayabilityTriggers drains play_failure_reverify before voice_request', async () => {
  await withTempDb(async () => {
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-voice',
      reason: 'voice_request:Some Movie',
    });
    await enqueuePlayabilityTrigger({
      trigger_type: 'play_failure_reverify',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-couch-fail',
      reason: 'play_failure',
    });

    const rows = await listUnhandledPlayabilityTriggers(10);
    assert.deepEqual(rows.map((row) => row.trigger_type), ['play_failure_reverify', 'voice_request']);

    const onlyOne = await listUnhandledPlayabilityTriggers(1);
    assert.equal(onlyOne.length, 1);
    assert.equal(onlyOne[0].trigger_type, 'play_failure_reverify');
    assert.equal(onlyOne[0].id_value, 'tt-couch-fail');
  });
});

test('H1: markPlayabilityTriggersHandled sets handled_at and rows drop out of the unhandled queue', async () => {
  await withTempDb(async () => {
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-voice-1',
      reason: 'voice_request:One',
    });
    await enqueuePlayabilityTrigger({
      trigger_type: 'voice_request',
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-voice-2',
      reason: 'voice_request:Two',
    });

    const before = await listUnhandledPlayabilityTriggers(10);
    assert.equal(before.length, 2);

    const changed = await markPlayabilityTriggersHandled([before[0].id]);
    assert.equal(changed, 1);

    const after = await listUnhandledPlayabilityTriggers(10);
    assert.equal(after.length, 1);
    assert.equal(after[0].id_value, 'tt-voice-2');

    // Idempotent: re-handling an already-handled id is a no-op.
    const reHandled = await markPlayabilityTriggersHandled([before[0].id]);
    assert.equal(reHandled, 0);
  });
});

test('Q2: getPlayFailureTitlesForReverify becomes eligible after the short window, unlike a fresh failure', async () => {
  await withTempDb(async () => {
    delete process.env.MANGO_PLAY_FAILURE_RETRY_HOURS;
    const now = Date.now();
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-couch-fail',
      status: 'verified',
      expires_at: now + 60_000,
    });

    await invalidateTitle({
      rail_id: 'movies-india-trending',
      type: 'movie',
      id: 'tt-couch-fail',
      reason: 'play_failure',
    });

    const title = await getTitlePlayability('movie', 'tt-couch-fail');
    assert.equal(title?.status, 'failed');
    assert.equal(title?.fail_reason, 'play_failure');

    const immediately = await getPlayFailureTitlesForReverify(Date.now());
    assert.equal(immediately.some((row) => row.id === 'tt-couch-fail'), false);

    const twoHoursLater = Date.now() + 2 * 60 * 60 * 1000;
    const eligible = await getPlayFailureTitlesForReverify(twoHoursLater);
    assert.equal(eligible.some((row) => row.id === 'tt-couch-fail'), true);
  });
});

test('H3: sweepExpiredVerified demotes expired verified rows to stale, idempotently and bounded', async () => {
  await withTempDb(async () => {
    const now = Date.now();
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-expired',
      status: 'verified',
      expires_at: now - 1000,
    });
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-fresh',
      status: 'verified',
      expires_at: now + 60_000,
    });

    const result = await sweepExpiredVerified(now);
    assert.equal(result.swept, 1);

    const expired = await getTitlePlayability('movie', 'tt-expired');
    const fresh = await getTitlePlayability('movie', 'tt-fresh');
    assert.equal(expired?.status, 'stale');
    assert.equal(fresh?.status, 'verified');

    // Idempotent: the row is no longer status='verified', so a second sweep finds nothing.
    const second = await sweepExpiredVerified(now);
    assert.equal(second.swept, 0);
  });
});

test('proactive renewal queues near-expiry verified titles without demoting them', async () => {
  await withTempDb(async () => {
    const oldLead = process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LEAD_MS;
    const oldLimit = process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LIMIT;
    process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LEAD_MS = String(60 * 60 * 1000);
    process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LIMIT = '10';
    try {
      const now = Date.now();
      await recordVerifyResult({
        type: 'movie',
        id: 'tt-near-expiry',
        status: 'verified',
        expires_at: now + 5 * 60 * 1000,
      });
      await recordVerifyResult({
        type: 'movie',
        id: 'tt-far-expiry',
        status: 'verified',
        expires_at: now + 48 * 60 * 60 * 1000,
      });

      const queued = await queueProactiveRenewalsBeforeExpiry(now);
      assert.equal(queued.queued, 1);
      assert.equal(queued.considered, 1);

      const due = await getStaleTitlesForRefresh(10, now);
      assert.equal(due.some((row) => row.id === 'tt-near-expiry' && row.reason === 'pre_expiry_renewal'), true);
      assert.equal(due.some((row) => row.id === 'tt-far-expiry'), false);

      const near = await getTitlePlayability('movie', 'tt-near-expiry');
      assert.equal(near?.status, 'verified');
    } finally {
      if (oldLead === undefined) {
        delete process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LEAD_MS;
      } else {
        process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LEAD_MS = oldLead;
      }
      if (oldLimit === undefined) {
        delete process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LIMIT;
      } else {
        process.env.MANGO_PLAYABILITY_PROACTIVE_RENEW_LIMIT = oldLimit;
      }
    }
  });
});
