import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStoryFrontierCalibration,
  storyFrontierBandFor,
} from './story-frontier-calibration.js';

test('split-conformal residual bands meet nominal coverage on a populated panel', () => {
  const samples = Array.from({ length: 40 }, (_, index) => ({
    stratum: index < 20 ? 'movie:rich' : 'movie:sparse',
    partial_score: 2.5 + index / 100,
    full_score: 2.5 + index / 100 + ((index % 10) - 5) / 50,
  }));
  const bands = buildStoryFrontierCalibration(samples);
  const pooled = storyFrontierBandFor(bands, '__pooled__');
  assert.equal(pooled?.status, 'calibrated');
  assert.ok((pooled?.empirical_coverage ?? 0) >= 0.9);
  assert.equal(storyFrontierBandFor(bands, 'movie:rich')?.status, 'calibrated');
});

test('small strata use an explicit pooled band and an empty panel is insufficient', () => {
  const samples = Array.from({ length: 24 }, (_, index) => ({
    stratum: index < 3 ? 'rare' : 'common',
    partial_score: 3,
    full_score: 3 + index / 100,
  }));
  const bands = buildStoryFrontierCalibration(samples);
  assert.equal(storyFrontierBandFor(bands, 'rare')?.status, 'pooled');
  assert.equal(storyFrontierBandFor(buildStoryFrontierCalibration([]), 'missing')?.status, 'insufficient');
});
