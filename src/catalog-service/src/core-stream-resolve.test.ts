import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasStreamResolveInfrastructureErrors,
  streamsAreOnlyErrorPlaceholders,
  type Stream,
} from './core.js';

test('stream resolve classifier treats clean zero streams as title exhaustion', () => {
  assert.equal(hasStreamResolveInfrastructureErrors([]), false);
  assert.equal(hasStreamResolveInfrastructureErrors(['zero streams after 2 attempts']), false);
});

test('stream resolve classifier keeps provider failures as infrastructure', () => {
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOStreams: HTTP 502']), true);
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOStreams: timeout after 12000ms']), true);
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOMetadata: rate limit exceeded']), true);
  assert.equal(hasStreamResolveInfrastructureErrors(['stream resolve skipped — recent rate-limit placeholders']), true);
});

test('stream resolve classifier treats non-cacheable placeholders as infrastructure', () => {
  assert.equal(streamsAreOnlyErrorPlaceholders([
    {
      url: 'https://example.test/rate-limit-exceeded',
      title: '[❌] TorBox Search failed',
      source: 'AIOStreams',
    } as Stream,
  ]), true);
  assert.equal(streamsAreOnlyErrorPlaceholders([
    {
      url: 'https://example.test/movie.mp4',
      title: 'Movie 1080p',
      source: 'AIOStreams',
    } as Stream,
  ]), false);
});
