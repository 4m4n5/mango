import assert from 'node:assert/strict';
import test from 'node:test';
import type { RailPlayabilityConfig } from '../rails.js';
import {
  effectiveGrowPerPass,
  GROW_PRESETS,
  isGrowRefreshMode,
  resolveGrowPreset,
  resolveGrowTarget,
} from './grow-target.js';

const base: RailPlayabilityConfig = {
  display_limit: 9,
  display_max: 9,
  min_display: 6,
  ingest_multiplier: 5,
  pool_target: 60,
  pool_growth_per_refresh: 10,
  pool_max: null,
  grow_per_pass: 20,
  growth_quota: 20,
  growth_attempt_budget: 80,
};

test('resolveGrowTarget doubles when verified pool is below display_limit', () => {
  assert.equal(resolveGrowTarget(base, 8), 40);
  assert.equal(resolveGrowTarget(base, 9), 20);
  assert.equal(resolveGrowTarget(base, 50), 20);
});

test('effectiveGrowPerPass prefers grow_per_pass and honors env override', () => {
  assert.equal(effectiveGrowPerPass(base), 20);
  const withLegacy = { ...base, grow_per_pass: 25, growth_quota: 20 };
  assert.equal(effectiveGrowPerPass(withLegacy), 25);
  const previous = process.env.MANGO_GROW_PER_PASS;
  process.env.MANGO_GROW_PER_PASS = '30';
  try {
    assert.equal(effectiveGrowPerPass(base), 30);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_GROW_PER_PASS;
    } else {
      process.env.MANGO_GROW_PER_PASS = previous;
    }
  }
});

test('resolveGrowPreset defaults to nightly', () => {
  const previous = process.env.MANGO_GROW_PRESET;
  delete process.env.MANGO_GROW_PRESET;
  try {
    assert.equal(resolveGrowPreset().wall_ms, GROW_PRESETS.nightly.wall_ms);
    assert.equal(resolveGrowPreset('quick').max_attempts, 200);
  } finally {
    if (previous !== undefined) {
      process.env.MANGO_GROW_PRESET = previous;
    }
  }
});

test('isGrowRefreshMode maps full and growth to grow unless bootstrap', () => {
  assert.equal(isGrowRefreshMode('full'), true);
  assert.equal(isGrowRefreshMode('growth'), true);
  assert.equal(isGrowRefreshMode('grow'), true);
  assert.equal(isGrowRefreshMode('stale'), false);
  assert.equal(isGrowRefreshMode('full', true), false);
});
