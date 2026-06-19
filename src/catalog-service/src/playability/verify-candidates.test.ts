import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from '../core.js';
import { limitVerifyCandidates } from './verify-candidates.js';

function stream(cacheStatus?: string): Stream {
  return {
    url: 'https://example.test/video.mp4',
    source: 'AIOStreams',
    cache_status: cacheStatus,
  };
}

test('limitVerifyCandidates probes one stream when top candidate is cached', () => {
  const candidates = [
    stream('cached'),
    stream('cached'),
    stream('unknown'),
  ];
  assert.equal(limitVerifyCandidates(candidates).length, 1);
});

test('limitVerifyCandidates keeps max candidates when top is not cached', () => {
  const candidates = [stream('unknown'), stream('cached'), stream('cached')];
  assert.equal(limitVerifyCandidates(candidates).length, 3);
});
