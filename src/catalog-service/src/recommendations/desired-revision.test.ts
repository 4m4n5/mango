import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initLibraryDb,
  resetLibraryDbForTests,
} from '../library/db.js';
import {
  acknowledgeDesiredRevision,
  desiredRevisionDiagnostics,
  readAllDesiredRevisions,
  readDesiredRevision,
  updateDesiredRevision,
} from './desired-revision.js';

function withLibrary(fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mango-desired-revision-'));
  const prior = {
    library: process.env.MANGO_LIBRARY_DB_PATH,
    pins: process.env.MANGO_USER_PINS_PATH,
  };
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    fn();
  } finally {
    resetLibraryDbForTests();
    for (const [name, value] of Object.entries(prior)) {
      const key = name === 'library' ? 'MANGO_LIBRARY_DB_PATH' : 'MANGO_USER_PINS_PATH';
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('updateDesiredRevision creates and coalesces per-domain state', () => {
  withLibrary(() => {
    const first = updateDesiredRevision({
      content_type: 'movie',
      reason: 'playability_corpus_publication',
      corpus_generation: 5,
      semantic_generation: 2,
      taste_signature: 'sig-a',
      now: 1_000,
    });
    assert.equal(first.revision, 1);
    assert.equal(first.pending, true);
    assert.equal(first.acknowledged_revision, 0);
    assert.deepEqual(first.requested_reasons, ['playability_corpus_publication']);

    const same = updateDesiredRevision({
      content_type: 'movie',
      reason: 'rating_change',
      corpus_generation: 5,
      semantic_generation: 2,
      taste_signature: 'sig-a',
      now: 2_000,
    });
    assert.equal(same.revision, 1, 'identical inputs must not advance revision');
    assert.equal(same.requested_at, 2_000);
    assert.ok(same.requested_reasons.includes('rating_change'));
    assert.ok(same.requested_reasons.includes('playability_corpus_publication'));

    const advanced = updateDesiredRevision({
      content_type: 'movie',
      reason: 'signal_change',
      corpus_generation: 5,
      semantic_generation: 2,
      taste_signature: 'sig-b',
      now: 3_000,
    });
    assert.equal(advanced.revision, 2, 'taste signature change must bump revision');
    assert.equal(advanced.pending, true);
    assert.deepEqual(readAllDesiredRevisions().map((row) => row.content_type), ['movie']);
  });
});

test('acknowledgeDesiredRevision only lands non-stale acknowledgements', () => {
  withLibrary(() => {
    updateDesiredRevision({
      content_type: 'series',
      reason: 'startup',
      corpus_generation: 1,
      semantic_generation: 1,
      taste_signature: 'sig-1',
      now: 100,
    });
    updateDesiredRevision({
      content_type: 'series',
      reason: 'signal_change',
      corpus_generation: 2,
      semantic_generation: 1,
      taste_signature: 'sig-1',
      now: 200,
    });
    const ackOld = acknowledgeDesiredRevision({
      content_type: 'series',
      revision: 1,
      rank_generation_id: 41,
      outcome: 'discarded_stale',
      now: 300,
    });
    assert.equal(ackOld?.acknowledged_revision, 0,
      'discarded_stale must never advance acknowledged_revision');

    const ackCurrent = acknowledgeDesiredRevision({
      content_type: 'series',
      revision: 2,
      rank_generation_id: 42,
      outcome: 'activated',
      now: 400,
    });
    assert.equal(ackCurrent?.acknowledged_revision, 2);
    assert.equal(ackCurrent?.pending, false);
    assert.equal(ackCurrent?.acknowledged_rank_generation_id, 42);

    const ackStale = acknowledgeDesiredRevision({
      content_type: 'series',
      revision: 1,
      rank_generation_id: 39,
      outcome: 'activated',
      now: 500,
    });
    assert.equal(ackStale?.acknowledged_revision, 2,
      'never rolls acknowledged_revision back after a later ack');
    assert.equal(ackStale?.acknowledged_rank_generation_id, 42);
  });
});

test('last_good_retained does NOT ack: revision stays pending and retry_after is scheduled', () => {
  withLibrary(() => {
    updateDesiredRevision({
      content_type: 'movie',
      reason: 'startup',
      corpus_generation: 7,
      taste_signature: 'sig',
      now: 10,
    });
    const held = acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 1,
      rank_generation_id: null,
      outcome: 'last_good_retained',
      error: 'rank_worker_timeout',
      now: 20,
    });
    // Non-activation MUST NOT consume the revision — the desired input is
    // still valid and needs to be retried, not discarded.
    assert.equal(held?.acknowledged_revision, 0,
      'last_good_retained must NOT advance acknowledged_revision');
    assert.equal(held?.last_worker_error, 'rank_worker_timeout');
    assert.equal(held?.pending, true);
    assert.equal(held?.attempt_count, 1);
    assert.equal(held?.retry_after, 20 + 60_000, 'first retry scheduled 1 minute out');
    // At now=20, retry is in the future so worker skips it.
    const atFailure = readDesiredRevision('movie', 20)!;
    assert.equal(atFailure.retry_due, false);
    // At now >= retry_after, worker picks it up again.
    const afterBackoff = readDesiredRevision('movie', 20 + 60_000)!;
    assert.equal(afterBackoff.retry_due, true);
    // A second failure exponentially bumps retry_after.
    const secondFail = acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 1,
      rank_generation_id: null,
      outcome: 'last_good_retained',
      error: 'rank_worker_timeout',
      now: 20 + 60_000,
    });
    assert.equal(secondFail?.attempt_count, 2);
    assert.equal(secondFail?.retry_after, 20 + 60_000 + 120_000);
    // Diagnostics expose retry state so operators can see the backoff.
    const diag = desiredRevisionDiagnostics(20 + 60_000);
    assert.equal(diag[0]?.attempt_count, 2);
    assert.equal(diag[0]?.retry_after, 20 + 60_000 + 120_000);
    assert.equal(diag[0]?.pending, true);
  });
});

test('activated acknowledgement resets attempt_count and clears retry_after', () => {
  withLibrary(() => {
    updateDesiredRevision({
      content_type: 'movie',
      reason: 'startup',
      corpus_generation: 7,
      taste_signature: 'sig',
      now: 10,
    });
    acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 1,
      rank_generation_id: null,
      outcome: 'last_good_retained',
      error: 'flake',
      now: 20,
    });
    const failed = readDesiredRevision('movie', 20)!;
    assert.equal(failed.attempt_count, 1);
    assert.equal(failed.retry_after, 20 + 60_000);
    const done = acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 1,
      rank_generation_id: 99,
      outcome: 'activated',
      now: 100_000,
    });
    assert.equal(done?.acknowledged_revision, 1);
    assert.equal(done?.attempt_count, 0);
    assert.equal(done?.retry_after, null);
    assert.equal(done?.last_worker_error, null);
    assert.equal(done?.pending, false);
  });
});

test('new desired input resets retry state so the worker retries immediately', () => {
  withLibrary(() => {
    updateDesiredRevision({
      content_type: 'movie',
      reason: 'startup',
      corpus_generation: 1,
      now: 0,
    });
    acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 1,
      rank_generation_id: null,
      outcome: 'last_good_retained',
      error: 'transient',
      now: 0,
    });
    const failed = readDesiredRevision('movie', 0)!;
    assert.equal(failed.attempt_count, 1);
    assert.equal(failed.retry_after, 60_000);
    const bumped = updateDesiredRevision({
      content_type: 'movie',
      reason: 'signal_change',
      corpus_generation: 2,
      now: 10,
    });
    // New input MUST reset retry state so the fresh signal is not blocked
    // on the previous failure's exponential backoff.
    assert.equal(bumped.revision, 2);
    assert.equal(bumped.attempt_count, 0);
    assert.equal(bumped.retry_after, null);
    assert.equal(bumped.pending, true);
    assert.equal(bumped.retry_due, true);
    assert.equal(bumped.last_worker_error, null,
      'previous transient error must not leak past the new signal');
  });
});

test('discarded_stale outcome leaves retry state alone', () => {
  withLibrary(() => {
    updateDesiredRevision({
      content_type: 'movie',
      reason: 'startup',
      corpus_generation: 1,
      now: 0,
    });
    acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 1,
      rank_generation_id: null,
      outcome: 'last_good_retained',
      error: 'transient',
      now: 0,
    });
    // Revision bumps mid-build; the stale ack for revision=1 must not
    // touch retry state — the newer revision owns lifecycle.
    updateDesiredRevision({
      content_type: 'movie',
      reason: 'signal_change',
      corpus_generation: 2,
      now: 5,
    });
    // But now suppose retry state is scheduled on rev 2 too — simulate.
    acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 2,
      rank_generation_id: null,
      outcome: 'last_good_retained',
      error: 'still bad',
      now: 5,
    });
    const before = readDesiredRevision('movie', 5)!;
    assert.equal(before.attempt_count, 1);
    assert.equal(before.retry_after, 5 + 60_000);
    // A discarded_stale ack for a revision that was superseded MUST leave
    // ack and retry state alone. Also must never move acknowledged_revision.
    // The discard reason is recorded diagnostically in last_worker_error.
    acknowledgeDesiredRevision({
      content_type: 'movie',
      revision: 2,
      rank_generation_id: 77,
      outcome: 'discarded_stale',
      error: 'desired_revision_advanced_during_build',
      now: 30,
    });
    const after = readDesiredRevision('movie', 30)!;
    assert.equal(after.acknowledged_revision, 0);
    assert.equal(after.attempt_count, 1, 'discarded_stale does not bump attempts');
    assert.equal(after.retry_after, 5 + 60_000, 'discarded_stale does not change retry_after');
    assert.equal(after.last_worker_error, 'desired_revision_advanced_during_build');
  });
});

test('readDesiredRevision returns null when nothing has been requested', () => {
  withLibrary(() => {
    assert.equal(readDesiredRevision('movie'), null);
    assert.deepEqual(readAllDesiredRevisions(), []);
    assert.deepEqual(desiredRevisionDiagnostics(), []);
  });
});
