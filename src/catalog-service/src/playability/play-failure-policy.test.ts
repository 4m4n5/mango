import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldConfirmPlayFailure,
  shouldDemoteAfterPlayError,
  shouldInvalidatePlayabilityAfterPlayError,
} from './play-failure-policy.js';

test('transient unreadable / opaque overall failures demote, cancelled does not', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_playback_unreadable' }],
    candidates: 2,
  }), true);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: no error detail captured (exit 1)' }],
    candidates: 3,
  }), true);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'play cancelled' }],
    candidates: 1,
  }), false);
});

test('confirmed garbage (nfo / copyright / status_clip) demotes after obligation floor', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_nfo_sidecar' }],
    candidates: 2,
  }), true);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_copyright_block' }],
    candidates: 2,
  }), true);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_status_clip' }],
    candidates: 2,
  }), true);
});

test('zero-candidate no_playable_stream hides and queues reverify', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    attempts: [],
    candidates: 0,
  }), true);
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    attempts: [],
    candidates: 0,
  }), true);
});

test('obligation floor exhaustion with non-transient errors demotes', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403 for http(s)://<redacted>' }],
    candidates: 4,
  }), true);
});

test('terminal failures before obligation floor still hide and reverify', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: false,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 2,
  }), true);
});

test('candidate-local fallback failures do not demote unless the whole play fails', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: false,
    terminalFailure: false,
    obligationFloorRan: false,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 2,
  }), false);
});

test('second play_miss within 24h confirms play_failure tombstone', () => {
  const now = Date.now();
  assert.equal(shouldConfirmPlayFailure({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 3,
    priorFailReason: 'play_miss',
    priorUpdatedAt: now - 60 * 60 * 1000,
    nowMs: now,
  }), true);
  assert.equal(shouldConfirmPlayFailure({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 3,
    priorFailReason: null,
    priorUpdatedAt: now - 60 * 60 * 1000,
    nowMs: now,
  }), false);
  assert.equal(shouldConfirmPlayFailure({
    isNoPlayableStream: true,
    terminalFailure: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 3,
    priorFailReason: 'play_miss',
    priorUpdatedAt: now - 25 * 60 * 60 * 1000,
    nowMs: now,
  }), false);
});

test('terminal infrastructure errors hide unless they are cancellation-only', () => {
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: false,
    terminalFailure: true,
    attempts: [],
    candidates: undefined,
  }), true);
});
