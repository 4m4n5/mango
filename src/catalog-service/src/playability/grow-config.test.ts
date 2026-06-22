import assert from 'node:assert/strict';
import test from 'node:test';
import {
  growIngestFreshTarget,
  playabilityGrowRequireTarget,
  playabilityGrowSourceResetCycles,
} from './config.js';

test('growIngestFreshTarget scales with remaining quota', () => {
  assert.equal(growIngestFreshTarget(0, 40), 40);
  assert.equal(growIngestFreshTarget(20, 40), 100);
  assert.equal(growIngestFreshTarget(60, 40), 200);
});

test('playabilityGrowSourceResetCycles defaults to 10', () => {
  const previous = process.env.MANGO_GROW_SOURCE_RESET_CYCLES;
  delete process.env.MANGO_GROW_SOURCE_RESET_CYCLES;
  try {
    assert.equal(playabilityGrowSourceResetCycles(), 10);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_GROW_SOURCE_RESET_CYCLES;
    } else {
      process.env.MANGO_GROW_SOURCE_RESET_CYCLES = previous;
    }
  }
});

test('playabilityGrowRequireTarget follows maintenance mode', () => {
  const prevMaint = process.env.MANGO_MAINTENANCE_MODE;
  const prevReq = process.env.MANGO_GROW_REQUIRE_TARGET;
  delete process.env.MANGO_GROW_REQUIRE_TARGET;
  process.env.MANGO_MAINTENANCE_MODE = '1';
  try {
    assert.equal(playabilityGrowRequireTarget(), true);
    process.env.MANGO_GROW_REQUIRE_TARGET = '0';
    assert.equal(playabilityGrowRequireTarget(), false);
  } finally {
    if (prevMaint === undefined) {
      delete process.env.MANGO_MAINTENANCE_MODE;
    } else {
      process.env.MANGO_MAINTENANCE_MODE = prevMaint;
    }
    if (prevReq === undefined) {
      delete process.env.MANGO_GROW_REQUIRE_TARGET;
    } else {
      process.env.MANGO_GROW_REQUIRE_TARGET = prevReq;
    }
  }
});
