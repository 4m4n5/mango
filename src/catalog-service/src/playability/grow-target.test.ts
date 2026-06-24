import assert from 'node:assert/strict';
import test from 'node:test';
import type { RailPlayabilityConfig } from '../rails.js';
import {
  defaultGrowPresetId,
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

test('resolveGrowTarget uses grow_per_pass even when verified pool is below display_limit', () => {
  assert.equal(resolveGrowTarget(base, 8), 20);
  assert.equal(resolveGrowTarget(base, 9), 20);
  assert.equal(resolveGrowTarget(base, 50), 20);
});

test('resolveGrowTarget includes anchor rails by default and diets only when explicitly enabled', () => {
  const prev = process.env.MANGO_GROW_ANCHOR_DIET;
  delete process.env.MANGO_GROW_ANCHOR_DIET;
  try {
    assert.equal(resolveGrowTarget(base, 60, 'movies-global-popular'), 20);
    assert.equal(resolveGrowTarget(base, 8, 'movies-global-popular'), 20);
    process.env.MANGO_GROW_ANCHOR_DIET = '1';
    assert.equal(resolveGrowTarget(base, 60, 'movies-global-popular'), 0);
  } finally {
    if (prev === undefined) {
      delete process.env.MANGO_GROW_ANCHOR_DIET;
    } else {
      process.env.MANGO_GROW_ANCHOR_DIET = prev;
    }
  }
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

test('resolveGrowPreset defaults to nightly for maintenance, quick for grow mode', () => {
  const previousPreset = process.env.MANGO_GROW_PRESET;
  const previousMode = process.env.MANGO_PLAYABILITY_REFRESH_MODE;
  delete process.env.MANGO_GROW_PRESET;
  delete process.env.MANGO_PLAYABILITY_REFRESH_MODE;
  try {
    assert.equal(resolveGrowPreset().wall_ms, GROW_PRESETS.nightly.wall_ms);
    process.env.MANGO_PLAYABILITY_REFRESH_MODE = 'grow';
    assert.equal(defaultGrowPresetId(), 'quick');
    assert.equal(resolveGrowPreset().wall_ms, GROW_PRESETS.quick.wall_ms);
    assert.equal(resolveGrowPreset('quick').max_attempts, 200);
  } finally {
    if (previousPreset !== undefined) {
      process.env.MANGO_GROW_PRESET = previousPreset;
    } else {
      delete process.env.MANGO_GROW_PRESET;
    }
    if (previousMode !== undefined) {
      process.env.MANGO_PLAYABILITY_REFRESH_MODE = previousMode;
    } else {
      delete process.env.MANGO_PLAYABILITY_REFRESH_MODE;
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
