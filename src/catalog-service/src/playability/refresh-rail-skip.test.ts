import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CatalogCore, PlayableRail } from '../core.js';
import { CatalogError } from '../catalog-errors.js';
import {
  resetPlayabilityDbForTests,
} from './db.js';
import { refreshAllRails, runNightlyChainStartHooks } from './refresh.js';
import type { GrowRailResult } from './grow-rail.js';
import type { DrainTriggersResult } from './trigger-consumer.js';
import type { PlayabilityRailStatus } from './db.js';

const ENV = { ...process.env };

test.beforeEach(() => {
  resetPlayabilityDbForTests();
});

test.afterEach(() => {
  resetPlayabilityDbForTests();
  process.env = { ...ENV };
});

const playability = {
  display_limit: 9,
  display_max: 9,
  min_display: 6,
  ingest_multiplier: 5,
  pool_target: 20,
  pool_growth_per_refresh: 15,
  pool_max: 120,
  grow_per_pass: 20,
};

function vodRail(id: string, tab: 'movies' | 'series' = 'movies'): PlayableRail {
  return {
    id,
    label: id,
    tab,
    type: 'composite_list',
    content_type: tab === 'series' ? 'series' : 'movie',
    limit: 20,
    enabled: true,
    sources: [{ addon: 'Test', catalog: id, weight: 1 }],
    playability,
  } as PlayableRail;
}

function nonVodRail(id: string, tab: 'live' | 'youtube'): PlayableRail {
  return {
    id,
    label: id,
    tab,
    type: 'composite_list',
    content_type: 'movie',
    limit: 20,
    enabled: true,
    sources: [{ addon: 'Test', catalog: id, weight: 1 }],
    playability,
  } as PlayableRail;
}

function emptyStatus(railId: string): PlayabilityRailStatus {
  return {
    rail_id: railId,
    pool_depth: 0,
    verified_pool: 0,
    pending: 0,
    stale: 0,
    failed: 0,
    last_verified_at: null,
  };
}

function successGrowResult(railId: string): GrowRailResult {
  const status = emptyStatus(railId);
  return {
    rail_id: railId,
    label: railId,
    ok: true,
    grow_target: 20,
    fresh_verified: 20,
    probe_verified: 20,
    new_to_rail_verified: 20,
    pool_growth: 20,
    grow_target_met: true,
    growth_quota: 20,
    verified_added: 20,
    growth_quota_met: true,
    pool_target: 20,
    candidate_limit: 100,
    attempts: 20,
    max_attempts: 100,
    min_display: 6,
    before: status,
    after: { ...status, verified_pool: 20 },
    candidates_seen: 50,
    linked_existing: 0,
    linked_global: 0,
    verified: 20,
    failed: 0,
    skipped_existing: 0,
    skipped_recent_failed: 0,
    skipped_unresolved_external_id: 0,
    skipped_rejected: 0,
    duplicate_candidates: 0,
    exhausted: false,
    grow_loops: 1,
    results: [],
  };
}

function fakeCore(rails: PlayableRail[]): CatalogCore {
  return {
    growableRails: () => rails.filter((r) => r.tab !== 'live' && r.tab !== 'youtube'),
    browsableRails: () => rails,
    reloadAiCatalogRails: async () => {},
  } as unknown as CatalogCore;
}

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-refresh-rail-skip-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_OPS_LOG_REFRESH = '0';
  process.env.MANGO_GROW_FINAL_RETHEME = '0';
  process.env.MANGO_GROW_REQUIRE_TARGET = '0';
  process.env.MANGO_GROW_RUN_STATE = '0';
  try {
    await fn();
  } finally {
    delete process.env.MANGO_OPS_LOG_REFRESH;
    delete process.env.MANGO_GROW_FINAL_RETHEME;
    delete process.env.MANGO_GROW_REQUIRE_TARGET;
    delete process.env.MANGO_GROW_RUN_STATE;
    await rm(dir, { recursive: true, force: true });
  }
}

const emptyHooks = async (): Promise<{ swept_expired: number; trigger_drain: DrainTriggersResult }> => ({
  swept_expired: 0,
  trigger_drain: {
    drained: 0,
    verified: 0,
    failed: 0,
    promoted: 0,
    by_trigger_type: {},
  },
});

test('growableRails() excludes live and youtube tabs from the VOD grow set', () => {
  const rails = [
    vodRail('movies-a', 'movies'),
    vodRail('series-b', 'series'),
    nonVodRail('ai-cricket-channels', 'live'),
    nonVodRail('yt-music', 'youtube'),
  ];
  const core = fakeCore(rails);
  const growable = core.growableRails();
  assert.deepEqual(growable.map((r) => r.id), ['movies-a', 'series-b']);
});

test('refreshAllRails excludes live and youtube rails from the grow pass', async () => {
  await withTempDb(async () => {
    const rails = [
      vodRail('movies-a', 'movies'),
      vodRail('series-b', 'series'),
      nonVodRail('ai-cricket-channels', 'live'),
      nonVodRail('yt-music', 'youtube'),
    ];
    const growCalls: string[] = [];
    const growFn = async (_core: CatalogCore, railId: string): Promise<GrowRailResult> => {
      growCalls.push(railId);
      return successGrowResult(railId);
    };
    const core = fakeCore(rails);
    const result = await refreshAllRails(core, {
      mode: 'grow',
      growFn,
      hooksRunner: emptyHooks,
    });
    assert.deepEqual(growCalls, ['movies-a', 'series-b']);
    assert.equal(result.rails.length, 2);
    assert.deepEqual(result.rails.map((r) => r.rail_id).sort(), ['movies-a', 'series-b']);
  });
});

test('refreshAllRails marks a sourceless rail as skipped_no_sources and continues others', async () => {
  await withTempDb(async () => {
    const rails = [
      vodRail('movies-a', 'movies'),
      vodRail('ai-cricket-channels', 'movies'), // pretend a sourceless ai_catalog rail slipped through
      vodRail('series-b', 'series'),
    ];
    const growFn = async (_core: CatalogCore, railId: string): Promise<GrowRailResult> => {
      if (railId === 'ai-cricket-channels') {
        throw new CatalogError(503, 'rail has no available catalog sources: ai-cricket-channels');
      }
      return successGrowResult(railId);
    };
    const core = fakeCore(rails);
    const result = await refreshAllRails(core, {
      mode: 'grow',
      growFn,
      hooksRunner: emptyHooks,
    });
    const skipped = result.rails.find((r) => r.rail_id === 'ai-cricket-channels');
    assert.ok(skipped, 'expected skipped rail summary in result');
    assert.equal(skipped?.ok, false);
    assert.equal(skipped?.failure_category, 'skipped_no_sources');
    assert.equal(skipped?.fresh_verified, 0);
    assert.equal(skipped?.grow_target_met, false);
    assert.deepEqual(skipped?.repair_suggestions, [
      'Rail ai-cricket-channels has 0 resolvable catalog sources; add/replace sources before next grow.',
    ]);
    // Other rails' results intact
    const okRailIds = result.rails.filter((r) => r.ok).map((r) => r.rail_id).sort();
    assert.deepEqual(okRailIds, ['movies-a', 'series-b']);
  });
});

test('refreshAllRails re-throws generic growRail errors (not no-sources)', async () => {
  await withTempDb(async () => {
    const rails = [vodRail('movies-a', 'movies')];
    const growFn = async (): Promise<GrowRailResult> => {
      throw new Error('addon timeout');
    };
    const core = fakeCore(rails);
    await assert.rejects(
      () => refreshAllRails(core, { mode: 'grow', growFn, hooksRunner: emptyHooks }),
      /addon timeout/,
    );
  });
});

test('runNightlyChainStartHooks is skipped when MANGO_MAINTENANCE_HOOKS_PRESTAGE=1', async () => {
  await withTempDb(async () => {
    let hooksCalled = false;
    const hooksRunner = async (): Promise<{ swept_expired: number; trigger_drain: DrainTriggersResult }> => {
      hooksCalled = true;
      return {
        swept_expired: 0,
        trigger_drain: { drained: 0, verified: 0, failed: 0, promoted: 0, by_trigger_type: {} },
      };
    };
    const rails = [vodRail('movies-a', 'movies')];
    const growFn = async (_core: CatalogCore, railId: string): Promise<GrowRailResult> => successGrowResult(railId);
    const core = fakeCore(rails);
    process.env.MANGO_MAINTENANCE_HOOKS_PRESTAGE = '1';
    const result = await refreshAllRails(core, {
      mode: 'grow',
      growFn,
      hooksRunner,
    });
    assert.equal(hooksCalled, false);
    assert.equal(result.swept_expired, 0);
    assert.equal(result.trigger_drain?.drained, 0);
  });
});

test('runNightlyChainStartHooks runs by default (no prestage env)', async () => {
  await withTempDb(async () => {
    let hooksCalled = false;
    const hooksRunner = async (): Promise<{ swept_expired: number; trigger_drain: DrainTriggersResult }> => {
      hooksCalled = true;
      return {
        swept_expired: 7,
        trigger_drain: { drained: 3, verified: 2, failed: 0, promoted: 1, by_trigger_type: {} },
      };
    };
    const rails = [vodRail('movies-a', 'movies')];
    const growFn = async (_core: CatalogCore, railId: string): Promise<GrowRailResult> => successGrowResult(railId);
    const core = fakeCore(rails);
    delete process.env.MANGO_MAINTENANCE_HOOKS_PRESTAGE;
    const result = await refreshAllRails(core, {
      mode: 'grow',
      growFn,
      hooksRunner,
    });
    assert.equal(hooksCalled, true);
    assert.equal(result.swept_expired, 7);
    assert.equal(result.trigger_drain?.drained, 3);
  });
});

test('runNightlyChainStartHooks is exported and callable with a stub core', async () => {
  await withTempDb(async () => {
    const core = fakeCore([]);
    const result = await runNightlyChainStartHooks(core);
    assert.equal(result.swept_expired, 0);
    assert.equal(result.trigger_drain.drained, 0);
  });
});
