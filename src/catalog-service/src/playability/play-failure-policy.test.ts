import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldConfirmPlayFailure,
  shouldDemoteAfterPlayError,
  shouldInvalidatePlayabilityAfterPlayError,
} from './play-failure-policy.js';

test('transient unreadable / opaque / cancelled do not demote', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_playback_unreadable' }],
    candidates: 2,
  }), false);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: no error detail captured (exit 1)' }],
    candidates: 3,
  }), false);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'play cancelled' }],
    candidates: 1,
  }), false);
});

test('confirmed garbage (nfo / copyright / status_clip) demotes after obligation floor', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_nfo_sidecar' }],
    candidates: 2,
  }), true);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_copyright_block' }],
    candidates: 2,
  }), true);
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'debrid_status_clip' }],
    candidates: 2,
  }), true);
});

test('zero-candidate no_playable_stream does not demote or invalidate', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    attempts: [],
    candidates: 0,
  }), false);
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: true,
    attempts: [],
    candidates: 0,
  }), false);
});

test('obligation floor exhaustion with non-transient errors demotes', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403 for http(s)://<redacted>' }],
    candidates: 4,
  }), true);
});

test('preference ladder only (no obligation floor) does not demote', () => {
  assert.equal(shouldDemoteAfterPlayError({
    isNoPlayableStream: true,
    obligationFloorRan: false,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 2,
  }), false);
});

test('second play_miss within 24h confirms play_failure tombstone', () => {
  const now = Date.now();
  assert.equal(shouldConfirmPlayFailure({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 3,
    priorFailReason: 'play_miss',
    priorUpdatedAt: now - 60 * 60 * 1000,
    nowMs: now,
  }), true);
  assert.equal(shouldConfirmPlayFailure({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 3,
    priorFailReason: null,
    priorUpdatedAt: now - 60 * 60 * 1000,
    nowMs: now,
  }), false);
  assert.equal(shouldConfirmPlayFailure({
    isNoPlayableStream: true,
    obligationFloorRan: true,
    attempts: [{ ok: false, error: 'mpv-play failed: HTTP error 403' }],
    candidates: 3,
    priorFailReason: 'play_miss',
    priorUpdatedAt: now - 25 * 60 * 60 * 1000,
    nowMs: now,
  }), false);
});

test('play failure does not invalidate unresolved infrastructure errors', () => {
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: false,
    attempts: [],
    candidates: undefined,
  }), false);
});
