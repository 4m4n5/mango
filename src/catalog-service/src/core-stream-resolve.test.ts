import assert from 'node:assert/strict';
import test from 'node:test';

import { hasStreamResolveInfrastructureErrors } from './core.js';

test('stream resolve classifier treats clean zero streams as title exhaustion', () => {
  assert.equal(hasStreamResolveInfrastructureErrors([]), false);
  assert.equal(hasStreamResolveInfrastructureErrors(['zero streams after 2 attempts']), false);
});

test('stream resolve classifier keeps provider failures as infrastructure', () => {
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOStreams: HTTP 502']), true);
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOStreams: timeout after 12000ms']), true);
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOMetadata: rate limit exceeded']), true);
});
