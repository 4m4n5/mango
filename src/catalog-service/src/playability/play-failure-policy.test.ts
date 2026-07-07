import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldInvalidatePlayabilityAfterPlayError } from './play-failure-policy.js';

test('play failure invalidates when stream attempts were probed', () => {
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: true,
    attempts: [{ ok: false, error: 'mpv exited before playback started' }],
    candidates: 4,
  }), true);
});

test('play failure does not invalidate transient TorBox sidecar mismatches', () => {
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: true,
    attempts: [{ ok: false, error: 'debrid_nfo_sidecar' }],
    candidates: 2,
  }), false);
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: true,
    attempts: [{ ok: false, error: 'debrid_playback_unreadable' }],
    candidates: 2,
  }), false);
});

test('play failure invalidates zero-candidate no_playable_stream', () => {
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: true,
    attempts: [],
    candidates: 0,
  }), true);
});

test('play failure does not invalidate unresolved infrastructure errors', () => {
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: false,
    attempts: [],
    candidates: undefined,
  }), false);
});
