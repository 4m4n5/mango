import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateKey, shouldForceReprobeTitle } from './pipeline.js';

test('shouldForceReprobeTitle only reprobes explicit stale keys', () => {
  const key = candidateKey({ type: 'movie', id: 'tt1' });
  const staleKeys = new Set([key]);
  const verified = {
    type: 'movie',
    id: 'tt1',
    status: 'verified' as const,
    expires_at: Date.now() - 60_000,
    updated_at: Date.now(),
    fail_reason: null,
  };

  assert.equal(shouldForceReprobeTitle(verified, staleKeys, key, Date.now()), true);
  assert.equal(shouldForceReprobeTitle(verified, new Set(), key, Date.now()), false);
});
