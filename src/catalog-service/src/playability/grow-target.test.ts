import assert from 'node:assert/strict';
import test from 'node:test';
import type { RailPlayabilityConfig } from '../rails.js';
import {
  effectiveGrowPerPass,
  GROW_PRESETS,
  isGrowRefreshMode,
  normalizeRefreshMode,
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
};

test('resolveGrowTarget doubles when verified pool is below display_limit', () => {
  assert.equal(resolveGrowTarget(base, 8), 40);
  assert.equal(resolveGrowTarget(base, 9), 20);
  assert.equal(resolveGrowTarget(base, 50), 20);
});

test('effectiveGrowPerPass defaults from yaml and honors env override', () => {
  assert.equal(effectiveGrowPerPass(base), 20);
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

test('normalizeRefreshMode maps deprecated full and growth to grow', () => {
  assert.equal(normalizeRefreshMode('grow'), 'grow');
  assert.equal(normalizeRefreshMode('stale'), 'stale');
  assert.equal(normalizeRefreshMode('full'), 'grow');
  assert.equal(normalizeRefreshMode('growth'), 'grow');
});

test('isGrowRefreshMode treats grow aliases unless bootstrap', () => {
  assert.equal(isGrowRefreshMode('full'), true);
  assert.equal(isGrowRefreshMode('growth'), true);
  assert.equal(isGrowRefreshMode('grow'), true);
  assert.equal(isGrowRefreshMode('stale'), false);
  assert.equal(isGrowRefreshMode('full', true), false);
});
