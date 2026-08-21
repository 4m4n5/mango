import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGrowFailure } from './grow-rail.js';

function source(overrides: Partial<Parameters<typeof classifyGrowFailure>[0]['sourceStats'][number]> = {}) {
  return {
    source_key: 'AIOMetadata:test',
    source_label: 'AIOMetadata/test',
    content_type: 'series',
    scanned: 0,
    fresh_queued: 0,
    skipped_verified: 0,
    skipped_recent_failed: 0,
    linked_verified_seen: 0,
    requested: 0,
    returned: 0,
    catalog_errors: 0,
    rate_limited: 0,
    exhausted: false,
    verified: 0,
    failed: 0,
    theme_rejected: 0,
    ...overrides,
  };
}

test('classifyGrowFailure does not let one rate limit mask low stream hit-rate', () => {
  assert.equal(
    classifyGrowFailure({
      sourceStats: [source({ rate_limited: 1, failed: 99, returned: 100 })],
      exhausted: false,
      attempts: 100,
      maxAttempts: 100,
      elapsedMs: 60_000,
      wallMs: 180_000,
      verified: 1,
      failed: 99,
    }),
    'low_stream_hit_rate',
  );
});

test('classifyGrowFailure keeps rate limits dominant when they explain the shortfall', () => {
  assert.equal(
    classifyGrowFailure({
      sourceStats: [source({ rate_limited: 4, failed: 3 })],
      exhausted: false,
      attempts: 7,
      maxAttempts: 100,
      elapsedMs: 60_000,
      wallMs: 180_000,
      verified: 0,
      failed: 3,
    }),
    'rate_limited',
  );
});
