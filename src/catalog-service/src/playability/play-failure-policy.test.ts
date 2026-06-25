import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldInvalidatePlayabilityAfterPlayError } from './play-failure-policy.js';

test('play failure invalidates when stream attempts were probed', () => {
  assert.equal(shouldInvalidatePlayabilityAfterPlayError({
    isNoPlayableStream: true,
    attempts: [{ ok: false }],
    candidates: 4,
  }), true);
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
