import assert from 'node:assert/strict';
import test from 'node:test';
import type { RailPlayabilityConfig } from '../rails.js';
import {
  effectiveCandidateLimit,
  effectiveDisplayLimit,
  effectivePoolTarget,
} from './pool-growth.js';

const base: RailPlayabilityConfig = {
  display_limit: 20,
  display_max: 28,
  min_display: 20,
  ingest_multiplier: 5,
  pool_target: 20,
  pool_growth_per_refresh: 10,
  pool_max: 120,
};

test('effectivePoolTarget grows by pool_growth_per_refresh', () => {
  assert.equal(effectivePoolTarget(base, 20), 30);
  assert.equal(effectivePoolTarget(base, 55), 65);
  assert.equal(effectivePoolTarget(base, 115), 120);
});

test('effectivePoolTarget honors MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH', () => {
  const previous = process.env.MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH;
  process.env.MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH = '8';
  try {
    assert.equal(effectivePoolTarget(base, 20), 28);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH;
    } else {
      process.env.MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH = previous;
    }
  }
});

test('effectivePoolTarget bootstrap uses min_display only', () => {
  assert.equal(effectivePoolTarget(base, 20, { bootstrap: true }), 20);
});

test('effectivePoolTarget legacy mode caps at pool_target when growth is 0', () => {
  const legacy = { ...base, pool_growth_per_refresh: 0 };
  assert.equal(effectivePoolTarget(legacy, 5), 20);
  assert.equal(effectivePoolTarget(legacy, 40), 20);
});

test('effectiveDisplayLimit grows slowly toward display_max', () => {
  assert.equal(effectiveDisplayLimit(base, 20), 20);
  assert.equal(effectiveDisplayLimit(base, 35), 21);
  assert.equal(effectiveDisplayLimit(base, 200), 28);
});

test('effectiveCandidateLimit widens ingest as pool target rises', () => {
  assert.equal(effectiveCandidateLimit(20, 5, 20, 30), 120);
  assert.equal(effectiveCandidateLimit(20, 5, 15, 35), 140);
});
