import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasStreamResolveInfrastructureErrors,
  streamsAreOnlyErrorPlaceholders,
  type ResolveNote,
  type Stream,
} from './core.js';

function note(kind: ResolveNote['kind'], message: string): ResolveNote {
  return { kind, message };
}

test('stream resolve classifier treats clean zero streams as title exhaustion', () => {
  assert.equal(hasStreamResolveInfrastructureErrors([]), false);
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('annotation', 'zero streams after 2 attempts')]),
    false,
  );
});

test('stream resolve classifier keeps provider failures as infrastructure', () => {
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('addon_error', 'AIOStreams: HTTP 502')]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('addon_error', 'AIOStreams: timeout after 12000ms')]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('addon_error', 'AIOMetadata: rate limit exceeded')]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      note('skip', 'stream resolve skipped — recent miss (retry shortly)'),
    ]),
    false,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      note('infra', 'stream resolve skipped — recent rate-limit (retry shortly)'),
    ]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      note('infra', 'stream resolve skipped — recent rate-limit placeholders'),
    ]),
    true,
  );
});

test('stream resolve classifier accepts legacy string[] for transition', () => {
  assert.equal(hasStreamResolveInfrastructureErrors(['zero streams after 2 attempts']), false);
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOStreams: HTTP 502']), true);
  assert.equal(
    hasStreamResolveInfrastructureErrors(['stream resolve skipped — recent miss (retry shortly)']),
    false,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      'stream resolve skipped — recent rate-limit (retry shortly)',
    ]),
    true,
  );
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
