import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlayRequestTerminalEmitter,
  emitPlaybackTelemetry,
  getRecentPlayRequestTerminalSummary,
  noPlayableStreamTerminalStage,
  playbackTelemetryRecord,
  playRequestTerminalTelemetryFields,
  resetPlayRequestTerminalSummaryForTests,
} from './playback-telemetry.js';

test('S7: playback telemetry is structured and drops URL/credential fields', () => {
  assert.deepEqual(playbackTelemetryRecord('resolve', {
    request_id: 'request-7',
    epoch: 4,
    total_deadline_ms: 85_000,
    resolve_request_class: 'user',
    provider_fanout_count: 2,
    provider_fanout_ms: 31,
    signed_url: 'https://secret.example/token',
    provider_userData: 'secret',
  }, 123), {
    component: 'catalog-playback',
    event: 'resolve',
    ts_ms: 123,
    request_id: 'request-7',
    epoch: 4,
    total_deadline_ms: 85_000,
    resolve_request_class: 'user',
    provider_fanout_count: 2,
    provider_fanout_ms: 31,
  });
});

test('async play terminal emitter records exactly one terminal outcome', () => {
  const records: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const terminal = createPlayRequestTerminalEmitter({
    requestId: 'request-once',
    epoch: 7,
    contentType: 'movie',
    startedAtMs: 100,
  }, (event, fields) => { records.push({ event, fields }); }, () => 250);

  assert.equal(terminal('playing', { stage: 'play_start', attempts: 2 }), true);
  assert.equal(terminal('failed_before_frame', { failureClass: 'candidate' }), false);
  assert.equal(terminal('cancelled', { failureClass: 'cancelled' }), false);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.event, 'play_request_terminal');
  assert.equal(records[0]?.fields.outcome, 'playing');
  assert.equal(records[0]?.fields.total_ms, 150);
});

test('recent terminal summary has stable denominators and failure-stage counts', () => {
  resetPlayRequestTerminalSummaryForTests();
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    emitPlaybackTelemetry('play_request_terminal', playRequestTerminalTelemetryFields({
      requestId: 'request-ok', epoch: 1, contentType: 'movie', outcome: 'playing',
      stage: 'play_start', totalMs: 100,
    }));
    emitPlaybackTelemetry('play_request_terminal', playRequestTerminalTelemetryFields({
      requestId: 'request-empty', epoch: 2, contentType: 'series', outcome: 'failed_before_frame',
      failureClass: 'no_stream', stage: 'candidate_ladder', totalMs: 200,
    }));
    emitPlaybackTelemetry('play_request_terminal', playRequestTerminalTelemetryFields({
      requestId: 'request-cancel', epoch: 3, contentType: 'series', outcome: 'cancelled',
      failureClass: 'cancelled', stage: 'session', totalMs: 50,
    }));
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(getRecentPlayRequestTerminalSummary(), {
    window_limit: 256,
    sample_size: 3,
    outcomes: { playing: 1, failed_before_frame: 1, cancelled: 1 },
    failures_by_stage: {
      candidate_ladder: { no_stream: 1 },
      session: { cancelled: 1 },
    },
  });
  resetPlayRequestTerminalSummaryForTests();
});

test('play terminal telemetry has a strict bounded allowlist', () => {
  const fields = playRequestTerminalTelemetryFields({
    requestId: `request-${'x'.repeat(300)}`,
    epoch: 4,
    contentType: 'series',
    outcome: 'failed_before_frame',
    failureClass: 'no_stream',
    stage: 'candidate_ladder',
    totalMs: 999_999,
    resolveMs: 31_250.4,
    attempts: 20,
    candidateCount: 25_000,
    exactMain: false,
    cached: true,
  });
  const record = playbackTelemetryRecord('play_request_terminal', {
    ...fields,
    title: 'must not appear',
    id: 'tt-secret',
    raw_error: 'provider detail',
    signed_url: 'https://secret.example/token',
  }, 123);

  assert.equal(String(record.request_id).length, 160);
  assert.equal(record.total_ms, 600_000);
  assert.equal(record.resolve_ms, 31_250);
  assert.equal(record.candidate_count, 10_000);
  assert.equal('title' in record, false);
  assert.equal('id' in record, false);
  assert.equal('raw_error' in record, false);
  assert.equal('signed_url' in record, false);
});

test('terminal no-stream stage distinguishes resolver empty from ladder exhaustion', () => {
  assert.equal(noPlayableStreamTerminalStage({ candidates: 0, attempts: [] }), 'resolve');
  assert.equal(noPlayableStreamTerminalStage({ candidates: 4, attempts: [] }), 'candidate_ladder');
  assert.equal(noPlayableStreamTerminalStage({ candidates: 4, attempts: [{ ok: false }] }), 'candidate_ladder');
});
