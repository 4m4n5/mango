import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sourceCircuitDecision,
  sourceCircuitSampleLimitForGrowTarget,
} from './grow-source-circuit.js';
import type { SourceGrowStats } from './source-hitrate-weights.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

function stat(overrides: Partial<SourceGrowStats>): SourceGrowStats {
  return {
    source_key: 'A:c1',
    source_label: 'A/c1',
    content_type: 'movie',
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

test('sourceCircuitDecision suppresses low-yield sources after bounded evidence', () => {
  process.env.MANGO_GROW_SOURCE_NO_VERIFY_SCAN_LIMIT = '25';
  assert.deepEqual(sourceCircuitDecision(stat({ scanned: 24 })), { suppress: false });
  assert.deepEqual(
    sourceCircuitDecision(stat({ scanned: 25 })),
    { suppress: true, reason: 'zero_verified_yield' },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ scanned: 25, returned: 25, fresh_queued: 25 })),
    { suppress: false },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ scanned: 100, verified: 1 })),
    { suppress: false },
  );
});

test('sourceCircuitDecision suppresses high reject ratios even with a small yield', () => {
  process.env.MANGO_GROW_SOURCE_THEME_REJECT_MIN_SAMPLES = '25';
  process.env.MANGO_GROW_SOURCE_THEME_REJECT_RATIO = '0.85';
  process.env.MANGO_GROW_SOURCE_FAIL_MIN_SAMPLES = '20';
  process.env.MANGO_GROW_SOURCE_FAIL_RATIO = '0.85';

  assert.deepEqual(
    sourceCircuitDecision(stat({ verified: 1, theme_rejected: 24 })),
    { suppress: true, reason: 'theme_rejected' },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ verified: 2, failed: 18 })),
    { suppress: false },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ verified: 0, failed: 20 })),
    { suppress: true, reason: 'low_stream_hit_rate' },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ verified: 4, theme_rejected: 21 })),
    { suppress: false },
  );
});

test('sourceCircuitDecision classifies infrastructure, theme, and stream failures', () => {
  process.env.MANGO_GROW_SOURCE_THEME_REJECT_MIN_SAMPLES = '10';
  process.env.MANGO_GROW_SOURCE_FAIL_MIN_SAMPLES = '10';

  assert.deepEqual(
    sourceCircuitDecision(stat({ rate_limited: 1 })),
    { suppress: true, reason: 'rate_limited' },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ catalog_errors: 2 })),
    { suppress: true, reason: 'catalog_errors' },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ theme_rejected: 9, failed: 1 })),
    { suppress: true, reason: 'theme_rejected' },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ failed: 10 })),
    { suppress: true, reason: 'low_stream_hit_rate' },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ unresolved_external_id: 10 })),
    { suppress: true, reason: 'unresolved_external_id' },
  );
});

test('sourceCircuitDecision accepts benchmark-sized stream failure thresholds', () => {
  process.env.MANGO_GROW_SOURCE_FAIL_MIN_SAMPLES = '20';
  assert.deepEqual(sourceCircuitDecision(stat({ failed: 7 }), { failMinSamples: 8 }), { suppress: false });
  assert.deepEqual(
    sourceCircuitDecision(stat({ failed: 8 }), { failMinSamples: 8 }),
    { suppress: true, reason: 'low_stream_hit_rate' },
  );
});

test('sourceCircuitSampleLimitForGrowTarget scales benchmark thresholds without weakening production', () => {
  assert.equal(sourceCircuitSampleLimitForGrowTarget(20, 5, 8), 8);
  assert.equal(sourceCircuitSampleLimitForGrowTarget(20, 20, 8), 20);
  assert.equal(sourceCircuitSampleLimitForGrowTarget(60, 5, 20, 4), 20);
  assert.equal(sourceCircuitSampleLimitForGrowTarget(60, 20, 20, 4), 60);
  assert.equal(sourceCircuitSampleLimitForGrowTarget(25, 5, 8, 1.5), 8);
  assert.equal(sourceCircuitSampleLimitForGrowTarget(25, 20, 8, 1.5), 25);
});

test('sourceCircuitDecision accepts benchmark-sized theme rejection thresholds', () => {
  process.env.MANGO_GROW_SOURCE_THEME_REJECT_MIN_SAMPLES = '25';
  assert.deepEqual(
    sourceCircuitDecision(stat({ theme_rejected: 7 }), { themeRejectMinSamples: 8 }),
    { suppress: false },
  );
  assert.deepEqual(
    sourceCircuitDecision(stat({ theme_rejected: 8 }), { themeRejectMinSamples: 8 }),
    { suppress: true, reason: 'theme_rejected' },
  );
});
