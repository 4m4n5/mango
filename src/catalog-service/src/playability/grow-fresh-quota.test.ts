import assert from 'node:assert/strict';
import test from 'node:test';
import type { RailPlayabilityConfig } from '../rails.js';
import {
  createGrowthPassState,
  freshVerifiedCount,
  incrementGrowthPassFresh,
  incrementGrowthPassLinked,
  railMeetsGrowthQuota,
} from './pool-growth.js';
import { growGlobalLinkEnabled } from './grow-global-link.js';
import { growLinkMaxPerRail } from './config.js';

const base: RailPlayabilityConfig = {
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
  id: 'movies-classics',
  label: 'highly rated',
  tab: 'movies' as const,
  type: 'addon_catalog' as const,
  addon: 'Cinemeta',
  catalog: 'imdbRating',
  content_type: 'movie' as const,
  limit: 20,
  enabled: true as const,
  playability: base,
};

test('links do not count toward grow quota', () => {
  const growthPass = createGrowthPassState([rail], new Map([['movies-classics', 20]]));
  for (let index = 0; index < 25; index += 1) {
    incrementGrowthPassLinked(growthPass, ['movies-classics']);
  }
  assert.equal(freshVerifiedCount(growthPass, 'movies-classics'), 0);
  assert.equal(growthPass.linkedThisPass.get('movies-classics'), 25);
  assert.equal(railMeetsGrowthQuota(growthPass, 'movies-classics'), false);
});

test('fresh probes satisfy grow quota independently of links', () => {
  const growthPass = createGrowthPassState([rail], new Map([['movies-classics', 20]]));
  incrementGrowthPassLinked(growthPass, ['movies-classics']);
  for (let index = 0; index < 20; index += 1) {
    incrementGrowthPassFresh(growthPass, ['movies-classics']);
  }
  assert.equal(freshVerifiedCount(growthPass, 'movies-classics'), 20);
  assert.equal(railMeetsGrowthQuota(growthPass, 'movies-classics'), true);
});

test('growLinkMaxPerRail defaults to 0 (global link off)', () => {
  const prevLink = process.env.MANGO_GROW_LINK_MAX;
  const prevGlobal = process.env.MANGO_GROW_GLOBAL_LINK;
  delete process.env.MANGO_GROW_LINK_MAX;
  delete process.env.MANGO_GROW_GLOBAL_LINK;
  try {
    assert.equal(growLinkMaxPerRail(), 0);
    assert.equal(growGlobalLinkEnabled(), false);
    process.env.MANGO_GROW_LINK_MAX = '5';
    assert.equal(growLinkMaxPerRail(), 5);
    assert.equal(growGlobalLinkEnabled(), true);
    process.env.MANGO_GROW_GLOBAL_LINK = '0';
    assert.equal(growGlobalLinkEnabled(), false);
  } finally {
    if (prevLink === undefined) {
      delete process.env.MANGO_GROW_LINK_MAX;
    } else {
      process.env.MANGO_GROW_LINK_MAX = prevLink;
    }
    if (prevGlobal === undefined) {
      delete process.env.MANGO_GROW_GLOBAL_LINK;
    } else {
      process.env.MANGO_GROW_GLOBAL_LINK = prevGlobal;
    }
  }
});
