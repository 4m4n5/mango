import assert from 'node:assert/strict';
import test from 'node:test';
import type { RailThemeGate } from './rail-theme-gate.js';
import type { RailPlayabilityConfig } from '../rails.js';
import { createGrowthPassState } from './pool-growth.js';
import {
  candidateKey,
  linkExistingVerifiedCandidates,
  shouldForceReprobeTitle,
} from './pipeline.js';

test('shouldForceReprobeTitle only reprobes explicit stale keys', () => {
  const key = candidateKey({ type: 'movie', id: 'tt1' });
  const staleKeys = new Set([key]);
  const verified = {
    type: 'movie',
    id: 'tt1',
    status: 'verified' as const,
    expires_at: Date.now() - 60_000,
    updated_at: Date.now(),
    fail_reason: null,
  };

  assert.equal(shouldForceReprobeTitle(verified, staleKeys, key, Date.now()), true);
  assert.equal(shouldForceReprobeTitle(verified, new Set(), key, Date.now()), false);
});

const playability: RailPlayabilityConfig = {
  display_limit: 20,
  display_max: 28,
  min_display: 20,
  ingest_multiplier: 5,
  pool_target: 20,
  pool_growth_per_refresh: 10,
  pool_max: 120,
  grow_per_pass: 20,
};

const rail = {
  id: 'movies-india-trending',
  label: 'Indian cinema',
  tab: 'movies' as const,
  type: 'composite_list' as const,
  content_type: 'movie' as const,
  sources: [],
  limit: 20,
  enabled: true as const,
  playability,
};

test('grow queue skips full-theme mismatches before verification', async () => {
  let fitsCalls = 0;
  const themeGate = {
    shouldSkipProbe: () => false,
    fitsRail: async () => {
      fitsCalls += 1;
      return { fit: false, score: 0, reason: 'below_min_fit' };
    },
  } as unknown as RailThemeGate;
  const growthPass = createGrowthPassState([rail], new Map([[rail.id, 20]]));
  const candidate = {
    type: 'movie',
    id: 'tt-theme-miss',
    title: 'Theme Miss',
  };

  const result = await linkExistingVerifiedCandidates({
    refsByKey: new Map([
      [candidateKey(candidate), [{ railId: rail.id, index: 0, candidate }]],
    ]),
    titleStatuses: new Map(),
    railVerifiedCounts: new Map([[rail.id, 24]]),
    railPoolTargets: new Map([[rail.id, 44]]),
    railPoolKeys: new Map([[rail.id, new Set()]]),
    refreshMode: 'grow',
    growthPass,
    context: { themeGate },
  });

  assert.equal(fitsCalls, 1);
  assert.equal(result.verifyQueue.length, 0);
  assert.equal(result.skipped_theme, 1);
  assert.equal(result.results[0]?.action, 'skipped_theme');
  assert.equal(result.results[0]?.reason, 'theme_probe_skip');
});
