import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CatalogCore,
  catalogTabLoadPolicy,
  mergeUserStateRails,
  RecommendationTabRevisionFence,
  vodUtilityRailMembershipMatches,
  vodDiscoveryShufflePolicy,
  vodUtilityHouseholdBlend,
  vodUtilityProfileId,
  type RailItemsResponse,
  type TabRailItemsResponse,
} from './core.js';
import {
  listSavedLibraryItems,
  resetLibraryDbForTests,
  saveLibraryItem,
} from './library/db.js';
import {
  getPlayabilityDb,
  initPlayabilityDb,
  persistVodTabDealV3,
  prepareVodBrowseReservoirV3,
  readVodTabDealV3,
  resetPlayabilityDbForTests,
} from './playability/db.js';
import {
  initProgressDb,
  resetProgressDbForTests,
} from './progress/db.js';

function rail(id: string, count: number): RailItemsResponse {
  return {
    rail_id: id,
    label: id,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      type: 'movie',
      title: `${id} ${index}`,
      subtitle: 'movie',
      poster: '',
      source: id,
    })),
    resolve_ms: 0,
    skipped: 0,
    playability: {
      displayed: count,
      verified_pool: count,
      pending: 0,
      low_water: false,
      session_id: 'test',
    },
  };
}

test('Saved rail is inserted immediately after Continue before discovery rails', () => {
  const ordered = mergeUserStateRails(
    [rail('discover-a', 2), rail('empty', 0), rail('discover-b', 1)],
    rail('continue-watching', 1),
    rail('saved', 2),
  );
  assert.deepEqual(ordered.map((entry) => entry.rail_id), [
    'continue-watching',
    'saved',
    'discover-a',
    'discover-b',
  ]);
});

test('For You is system-owned after Continue and Saved without consuming discovery order', () => {
  const ordered = mergeUserStateRails(
    [rail('ai-slot-1', 1), rail('discover', 1)],
    rail('continue-watching', 1),
    rail('saved', 1),
    { forYouRail: rail('for-you-movies', 12) },
  );
  assert.deepEqual(ordered.map((entry) => entry.rail_id), [
    'continue-watching',
    'saved',
    'for-you-movies',
    'ai-slot-1',
    'discover',
  ]);
});

test('Browse v3 renders Explore after precise For You and before every specialized rail', () => {
  const ordered = mergeUserStateRails(
    [rail('category-a', 9), rail('ai-slot-1', 6)],
    rail('continue-watching', 4),
    rail('saved', 5),
    {
      forYouRail: rail('for-you-movies', 6),
      exploreRail: rail('explore-movies', 9),
    },
  );
  assert.deepEqual(ordered.map((entry) => entry.rail_id), [
    'continue-watching',
    'saved',
    'for-you-movies',
    'explore-movies',
    'category-a',
    'ai-slot-1',
  ]);
});

test('Browse v3 rejects a cached Saved rail whose membership belongs to another tab', () => {
  const saved = rail('saved', 2);
  saved.items = [
    { ...saved.items[0]!, type: 'series', id: 'tt-series-saved' },
    { ...saved.items[1]!, type: 'movie', id: 'tt-dune' },
  ];
  assert.equal(vodUtilityRailMembershipMatches(
    saved,
    new Set(['series:tt-series-saved', 'series:tt-other-saved']),
  ), false);
  saved.items[1] = { ...saved.items[1]!, type: 'series', id: 'tt-other-saved' };
  assert.equal(vodUtilityRailMembershipMatches(
    saved,
    new Set(['series:tt-series-saved', 'series:tt-other-saved']),
  ), true);
});

test('concurrent deep Shuffle requests coalesce to one tab epoch winner', async () => {
  const previous = process.env.MANGO_VOD_BROWSE_V3;
  process.env.MANGO_VOD_BROWSE_V3 = 'serve';
  type ShuffleHarness = {
    tabRailItems: CatalogCore['tabRailItems'];
    tabRailItemsUncoalesced: () => Promise<TabRailItemsResponse>;
  };
  const TestCatalogCore = CatalogCore as unknown as new (...args: unknown[]) => CatalogCore;
  const core = new TestCatalogCore(
    { available: false, error: 'fixture' }, [], {}, null, null, null, null, [],
  ) as unknown as ShuffleHarness;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  core.tabRailItemsUncoalesced = async () => {
    calls += 1;
    await gate;
    return { tab: 'movies', rails: [], resolve_ms: 1 };
  };
  try {
    const first = core.tabRailItems('movies', { reshuffle: true });
    const second = core.tabRailItems('movies', { reshuffle: true });
    release();
    const [winner, loser] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(loser, winner);
  } finally {
    if (previous === undefined) delete process.env.MANGO_VOD_BROWSE_V3;
    else process.env.MANGO_VOD_BROWSE_V3 = previous;
  }
});

test('Browse v3 rejects and replaces a persisted deal contaminated by another tab\'s Saved title', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-core-saved-deal-'));
  const previous = {
    libraryDb: process.env.MANGO_LIBRARY_DB_PATH,
    playabilityDb: process.env.MANGO_PLAYABILITY_DB,
    progressDb: process.env.MANGO_PROGRESS_DB_PATH,
    repoDir: process.env.MANGO_REPO_DIR,
    browseMode: process.env.MANGO_VOD_BROWSE_V3,
    recommendationMode: process.env.MANGO_VOD_RECS_V2,
  };
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_PROGRESS_DB_PATH = join(dir, 'progress.db');
  process.env.MANGO_REPO_DIR = join(process.cwd(), '../..');
  process.env.MANGO_VOD_BROWSE_V3 = 'serve';
  process.env.MANGO_VOD_RECS_V2 = 'off';
  resetLibraryDbForTests();
  resetPlayabilityDbForTests();
  resetProgressDbForTests();

  try {
    const dune = saveLibraryItem({
      source: 'mango', type: 'movie', id: 'tt1160419', title: 'Dune',
      poster: 'https://img/dune.jpg', tab: 'series', saved_at: 1_000,
    });
    const alliance = saveLibraryItem({
      source: 'mango', type: 'series', id: 'tt-series-alliance', title: 'Alliance',
      poster: 'https://img/alliance.jpg', tab: 'series', saved_at: 2_000,
    });
    assert.equal(dune.tab, 'movies');
    assert.deepEqual(listSavedLibraryItems('series').map((item) => item.id), [alliance.id]);

    await initPlayabilityDb();
    await initProgressDb();
    const playability = getPlayabilityDb();
    const insertTitle = playability.prepare(`
INSERT INTO titles(type, id, status, verified_at, first_verified_at, best_source, updated_at)
VALUES ('series', ?, 'verified', ?, ?, 'fixture', ?)
`);
    const insertEvidence = playability.prepare(`
INSERT INTO title_story_evidence(type, id, title, poster_url, year, updated_at)
VALUES ('series', ?, ?, ?, '2026', ?)
`);
    const now = Date.now();
    playability.transaction(() => {
      for (let index = 0; index < 12; index += 1) {
        const id = `tt-series-explore-${index}`;
        insertTitle.run(id, now, now, now);
        insertEvidence.run(id, `Series Explore ${index}`, `https://img/${id}.jpg`, now);
      }
    })();
    await prepareVodBrowseReservoirV3({
      tab: 'series', rails: [], affinityRevision: 'rank:none:taste:none',
    });

    const contaminatedSaved = rail('saved', 1);
    contaminatedSaved.items = [{
      ...contaminatedSaved.items[0]!,
      id: dune.id,
      type: 'movie',
      title: dune.title,
    }];
    const contaminatedPayload: TabRailItemsResponse = {
      tab: 'series', rails: [contaminatedSaved], resolve_ms: 0,
    };
    await persistVodTabDealV3({
      tab: 'series',
      session_id: 'contaminated-series-deal',
      recommendation_revision: null,
      payload_json: JSON.stringify(contaminatedPayload),
      expected_previous_epoch: null,
    });

    type CoreStageHarness = {
      browsableRailsForTab: () => [];
      stageVodBrowseV3: (
        tab: 'movies' | 'series',
        reshuffle: boolean,
        personalization: { active_profile_id: string; updated_at: number },
        recommendationRevision: number | null,
        cacheKey: string,
        cachedTab: undefined,
        started: number,
        options: { publishCache: boolean; forYouOverride: null },
      ) => Promise<{
        value: TabRailItemsResponse;
        commit?: () => Promise<void> | void;
      }>;
    };
    const TestCatalogCore = CatalogCore as unknown as new (...args: unknown[]) => CatalogCore;
    const core = new TestCatalogCore(
      { available: false, error: 'fixture' },
      [],
      {},
      null,
      null,
      null,
      null,
      [],
    ) as unknown as CoreStageHarness;
    core.browsableRailsForTab = () => [];
    const staged = await core.stageVodBrowseV3(
      'series',
      false,
      { active_profile_id: 'household', updated_at: 1 },
      null,
      'series-fixture-cache-key',
      undefined,
      Date.now(),
      { publishCache: false, forYouOverride: null },
    );

    assert.notEqual(staged.value.cached, true);
    assert.deepEqual(
      staged.value.rails.find((entry) => entry.rail_id === 'saved')?.items
        .map((item) => `${item.type}:${item.id}`),
      [`series:${alliance.id}`],
    );
    assert.equal(
      staged.value.rails.some((entry) => entry.items.some((item) => item.id === dune.id)),
      false,
    );
    assert.equal(staged.value.rails.find((entry) => entry.rail_id === 'explore-series')?.items.length, 9);

    await staged.commit?.();
    const active = await readVodTabDealV3('series', 'active');
    const prior = await readVodTabDealV3('series', 'previous');
    assert.equal(active?.deal_epoch, 1);
    assert.equal(prior?.deal_epoch, 0);
    assert.equal(active?.payload_json.includes(dune.id), false);
    assert.equal(prior?.payload_json.includes(dune.id), true);
  } finally {
    resetLibraryDbForTests();
    resetPlayabilityDbForTests();
    resetProgressDbForTests();
    const restore = (key: keyof typeof previous, envKey: string): void => {
      const value = previous[key];
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    };
    restore('libraryDb', 'MANGO_LIBRARY_DB_PATH');
    restore('playabilityDb', 'MANGO_PLAYABILITY_DB');
    restore('progressDb', 'MANGO_PROGRESS_DB_PATH');
    restore('repoDir', 'MANGO_REPO_DIR');
    restore('browseMode', 'MANGO_VOD_BROWSE_V3');
    restore('recommendationMode', 'MANGO_VOD_RECS_V2');
    await rm(dir, { recursive: true, force: true });
  }
});

test('Browse v3 X recency-samples Continue and Saved instead of cloning the previous deal', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourcePath = existsSync(join(here, 'core.ts'))
    ? join(here, 'core.ts')
    : join(here, '../src/core.ts');
  const source = readFileSync(sourcePath, 'utf8');
  assert.equal(
    [...source.matchAll(/shuffleSeed: reshuffle \? dealSeed : undefined/g)].length,
    2,
  );
  assert.equal(source.includes('cloneStoredUtilityRail'), false);
});

test('Saved rail appears first when Continue is empty and is absent when empty', () => {
  assert.deepEqual(
    mergeUserStateRails([rail('discover', 1)], rail('continue-watching', 0), rail('saved', 1))
      .map((entry) => entry.rail_id),
    ['saved', 'discover'],
  );
  assert.deepEqual(
    mergeUserStateRails([rail('discover', 1)], rail('continue-watching', 0), rail('saved', 0))
      .map((entry) => entry.rail_id),
    ['discover'],
  );
});

function userStateIds(
  continueCount: number,
  savedCount: number,
): { continueIds: string[]; savedIds: string[] } {
  const merged = mergeUserStateRails(
    [rail('discover', 1)],
    rail('continue-watching', continueCount),
    rail('saved', savedCount),
  );
  const byId = (id: string) => merged.find((entry) => entry.rail_id === id)?.items.map((i) => i.id) ?? [];
  return { continueIds: byId('continue-watching'), savedIds: byId('saved') };
}

test('user-state rails keep source order when no reshuffle was requested', () => {
  const { continueIds, savedIds } = userStateIds(9, 9);
  assert.deepEqual(continueIds, Array.from({ length: 9 }, (_, i) => `continue-watching-${i}`));
  assert.deepEqual(savedIds, Array.from({ length: 9 }, (_, i) => `saved-${i}`));
});

test('legacy utility merge keeps chronological Continue and Saved rails stable', () => {
  for (const count of [6, 9, 20]) {
    const { continueIds, savedIds } = userStateIds(count, count);
    assert.deepEqual(continueIds, Array.from({ length: count }, (_, i) => `continue-watching-${i}`));
    assert.deepEqual(savedIds, Array.from({ length: count }, (_, i) => `saved-${i}`));
  }
});

test('X does not rotate the global session or start metadata warming', () => {
  assert.deepEqual(catalogTabLoadPolicy(true, 99_999, 1), {
    rotatePlayabilitySession: false,
    warmMetadata: false,
  });
  assert.equal(catalogTabLoadPolicy(false, 10, 100).rotatePlayabilitySession, false);
  assert.equal(catalogTabLoadPolicy(false, 100, 100).rotatePlayabilitySession, true);
});

test('legacy off-mode X policy still deals category rails from cached pools', () => {
  assert.deepEqual(vodDiscoveryShufflePolicy('movies', true), {
    forceCuratedReshuffle: true,
    stableRatio: 1,
    cachedOnly: true,
  });
  assert.deepEqual(vodDiscoveryShufflePolicy('series', true), {
    forceCuratedReshuffle: true,
    stableRatio: 1,
    cachedOnly: true,
  });
  assert.deepEqual(vodDiscoveryShufflePolicy('movies', false), {
    forceCuratedReshuffle: false,
    cachedOnly: false,
  });
  assert.deepEqual(vodDiscoveryShufflePolicy('youtube', true), {
    forceCuratedReshuffle: false,
    cachedOnly: false,
  });
});

test('recommendation revision fences are independent per VOD media type', () => {
  const fence = new RecommendationTabRevisionFence();
  const movies = fence.capture('movies');
  const series = fence.capture('series');
  fence.bump('movies');
  assert.equal(fence.isCurrent('movies', movies), false);
  assert.equal(fence.isCurrent('series', series), true);
});

test('active recommendation modes bind VOD utility rails to exact Household', () => {
  assert.equal(vodUtilityProfileId('movies', 'personal-only', 'serve'), 'household');
  assert.equal(vodUtilityProfileId('series', 'personal-only', 'serve'), 'household');
  assert.equal(vodUtilityProfileId('movies', 'personal-only', 'shadow'), 'household');
  assert.equal(vodUtilityProfileId('movies', 'personal-only', 'off'), 'personal-only');
  assert.equal(vodUtilityProfileId('live', 'personal-only', 'serve'), 'personal-only');
  assert.equal(vodUtilityHouseholdBlend('movies', 'household', 'serve'), false);
  assert.equal(vodUtilityHouseholdBlend('movies', 'household', 'shadow'), false);
  assert.equal(vodUtilityHouseholdBlend('movies', 'personal-only', 'off'), true);
  assert.equal(vodUtilityHouseholdBlend('live', 'household', 'serve'), true);
});
