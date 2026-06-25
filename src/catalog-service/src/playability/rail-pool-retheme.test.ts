import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Meta, PlayableRail } from '../core.js';
import { PlayabilityBatchWriter } from './batch-writer.js';
import {
  getRailPoolOverlapSummary,
  listOrphanVerifiedPoolTitles,
  listRailIdsContainingTitle,
  upsertRailPoolTitle,
} from './db.js';
import { rethemeRailPools, type RethemeCore } from './rail-pool-retheme.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

function rail(id: string, contentType: string): PlayableRail {
  return {
    id,
    label: id,
    tab: contentType === 'series' ? 'series' : 'movies',
    type: 'composite_list',
    content_type: contentType,
    limit: 20,
    enabled: true,
    sources: [{ addon: 'Test', catalog: id, weight: 1 }],
    playability: {
      display_limit: 9,
      display_max: 9,
      min_display: 6,
      ingest_multiplier: 5,
      pool_target: 20,
      pool_growth_per_refresh: 15,
      pool_max: 120,
      grow_per_pass: 20,
    },
  };
}

async function setupRethemeTest(metaByKey: Record<string, Meta>): Promise<RethemeCore> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-retheme-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_RAIL_THEME_PROFILES = join(dir, 'rail-theme-profiles.yaml');
  process.env.MANGO_RAIL_CURATION_OVERRIDES = join(dir, 'rail-curation-overrides.yaml');
  process.env.MANGO_RETHEME_PROGRESS_EVERY = '0';

  await writeFile(process.env.MANGO_RAIL_THEME_PROFILES, `
version: 1
rails:
  movies-global-popular:
    intent: popular mainstream
    min_fit: 3
  movies-comedy:
    intent: comedy funny comfort laugh
    exclude: documentary horror
    min_fit: 8
  movies-comfort:
    intent: comedy funny comfort laugh
    exclude: documentary horror
    min_fit: 8
  movies-classics:
    intent: comedy funny comfort laugh
    exclude: documentary horror
    min_fit: 8
  movies-documentaries:
    intent: documentary true story nature crime investigation
    exclude: fiction comedy horror
    min_fit: 8
  series-global-popular:
    intent: popular series
    min_fit: 3
  series-reality-casual:
    intent: reality game show competition
    exclude: scripted sitcom drama
    min_fit: 8
`, 'utf8');
  await writeFile(process.env.MANGO_RAIL_CURATION_OVERRIDES, 'version: 1\npins: []\nblocks: []\n', 'utf8');

  return {
    browsableRails: () => [
      rail('movies-global-popular', 'movie'),
      rail('movies-comedy', 'movie'),
      rail('movies-comfort', 'movie'),
      rail('movies-classics', 'movie'),
      rail('movies-documentaries', 'movie'),
      rail('series-global-popular', 'series'),
      rail('series-reality-casual', 'series'),
    ],
    meta: async (type: string, id: string) => {
      const meta = metaByKey[`${type}:${id}`];
      if (!meta) {
        throw new Error(`missing test meta for ${type}:${id}`);
      }
      return meta;
    },
  };
}

async function verifyTitle(type: string, id: string): Promise<void> {
  const writer = new PlayabilityBatchWriter();
  writer.queueVerify({
    type,
    id,
    status: 'verified',
    rail_id: null,
    outcome: 'verified',
    probe_ms: 10,
  });
  await writer.flush();
}

test('retheme dry-run can attach orphan verified titles to best thematic rail', async () => {
  const core = await setupRethemeTest({
    'movie:tt-comedy-orphan': {
      id: 'tt-comedy-orphan',
      type: 'movie',
      name: 'A Funny Comfort Movie',
      genre: 'Comedy',
      description: 'A warm comedy built around laughs.',
    } as Meta,
  });
  await verifyTitle('movie', 'tt-comedy-orphan');

  const result = await rethemeRailPools(core, {
    dryRun: true,
    includeOrphans: true,
  });

  assert.equal(result.attached, 1);
  assert.equal(result.orphans_scanned, 1);
  assert.deepEqual(result.rails_touched, ['movies-comedy']);
  assert.deepEqual(await listRailIdsContainingTitle('movie', 'tt-comedy-orphan'), []);
  const action = result.actions.find((candidate) => candidate.action === 'attach');
  assert.ok(action);
  assert.equal(action.action, 'attach');
  assert.equal(action.rail_id, 'movies-comedy');
  assert.equal(action.type, 'movie');
  assert.equal(action.id, 'tt-comedy-orphan');
  assert.equal(action.reason, 'orphan_best_fit');
  assert.ok(action.target_score >= 12);
});

test('retheme apply attaches weak-fit orphan verified titles to anchor fallback', async () => {
  const core = await setupRethemeTest({
    'movie:tt-obscure-orphan': {
      id: 'tt-obscure-orphan',
      type: 'movie',
      name: 'Obscure Film',
      genre: 'Drama',
      description: 'A quiet title without a strong configured rail signal.',
    } as Meta,
  });
  await verifyTitle('movie', 'tt-obscure-orphan');

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: true,
  });

  assert.equal(result.attached, 1);
  assert.equal(result.orphans_scanned, 1);
  assert.deepEqual(await listRailIdsContainingTitle('movie', 'tt-obscure-orphan'), ['movies-global-popular']);
  assert.equal((await listOrphanVerifiedPoolTitles()).length, 0);
  const action = result.actions.find((candidate) => candidate.action === 'attach');
  assert.ok(action);
  assert.equal(action.action, 'attach');
  assert.equal(action.rail_id, 'movies-global-popular');
  assert.equal(action.type, 'movie');
  assert.equal(action.id, 'tt-obscure-orphan');
  assert.equal(action.reason, 'orphan_anchor_fallback');
});

test('retheme keeps weak existing anchor titles without same-rail churn', async () => {
  const core = await setupRethemeTest({
    'movie:tt-anchor-weak': {
      id: 'tt-anchor-weak',
      type: 'movie',
      name: 'Obscure Film',
      genre: 'Drama',
      description: 'A quiet title without a strong configured rail signal.',
    } as Meta,
  });
  await verifyTitle('movie', 'tt-anchor-weak');
  await upsertRailPoolTitle({
    rail_id: 'movies-global-popular',
    type: 'movie',
    id: 'tt-anchor-weak',
    score: 75,
    title: 'Obscure Film',
  });

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: true,
  });

  assert.equal(result.kept, 1);
  assert.equal(result.removed, 0);
  assert.equal(result.relocated, 0);
  assert.equal(result.attached, 0);
  assert.deepEqual(await listRailIdsContainingTitle('movie', 'tt-anchor-weak'), ['movies-global-popular']);
  assert.equal((await listOrphanVerifiedPoolTitles()).length, 0);
  assert.ok(!result.actions.some((action) => action.action === 'relocate'));
});

test('retheme orphan target selection avoids rails rejected by exclude tags', async () => {
  const core = await setupRethemeTest({
    'movie:tt-doc-comedy-orphan': {
      id: 'tt-doc-comedy-orphan',
      type: 'movie',
      name: 'Funny True Crime Documentary',
      genre: 'Documentary',
      description: 'A funny documentary investigation built around a true crime case.',
    } as Meta,
  });
  await verifyTitle('movie', 'tt-doc-comedy-orphan');

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: true,
  });

  assert.equal(result.attached, 1);
  assert.deepEqual(await listRailIdsContainingTitle('movie', 'tt-doc-comedy-orphan'), ['movies-documentaries']);
  const action = result.actions.find((candidate) => candidate.action === 'attach');
  assert.ok(action);
  assert.equal(action.action, 'attach');
  assert.equal(action.rail_id, 'movies-documentaries');
  assert.equal(action.reason, 'orphan_best_fit');
});

test('retheme skip mode attaches orphans without pruning existing memberships', async () => {
  const core = await setupRethemeTest({
    'movie:tt-comedy-orphan-skip': {
      id: 'tt-comedy-orphan-skip',
      type: 'movie',
      name: 'A Funny Comfort Orphan',
      genre: 'Comedy',
      description: 'A warm comedy built around laughs.',
    } as Meta,
  });
  await verifyTitle('movie', 'tt-overlap-skip');
  for (const railId of ['movies-comedy', 'movies-comfort', 'movies-classics']) {
    await upsertRailPoolTitle({
      rail_id: railId,
      type: 'movie',
      id: 'tt-overlap-skip',
      score: 80,
      title: 'Existing Overlap',
    });
  }
  await verifyTitle('movie', 'tt-comedy-orphan-skip');

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: true,
    membershipMode: 'skip',
    maxRailsPerTitle: 2,
  });

  assert.equal(result.membership_mode, 'skip');
  assert.equal(result.attached, 1);
  assert.equal(result.overlap_removed, 0);
  assert.deepEqual((await listRailIdsContainingTitle('movie', 'tt-overlap-skip')).sort(), [
    'movies-classics',
    'movies-comedy',
    'movies-comfort',
  ]);
  assert.deepEqual(await listRailIdsContainingTitle('movie', 'tt-comedy-orphan-skip'), ['movies-comedy']);
});

test('retheme caps unpinned overlap to strongest rails', async () => {
  const core = await setupRethemeTest({
    'movie:tt-overlap': {
      id: 'tt-overlap',
      type: 'movie',
      name: 'A Funny Comfort Classic',
      genre: 'Comedy',
      description: 'A funny comfort comedy built for laughs.',
    } as Meta,
  });
  await verifyTitle('movie', 'tt-overlap');
  for (const railId of ['movies-comedy', 'movies-comfort', 'movies-classics']) {
    await upsertRailPoolTitle({
      rail_id: railId,
      type: 'movie',
      id: 'tt-overlap',
      score: 80,
      title: 'A Funny Comfort Classic',
    });
  }

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: true,
    maxRailsPerTitle: 2,
  });

  assert.equal(result.overlap_removed, 1);
  assert.equal((await listRailIdsContainingTitle('movie', 'tt-overlap')).length, 2);
  assert.ok(result.actions.some((action) => (
    action.action === 'remove'
    && action.type === 'movie'
    && action.id === 'tt-overlap'
    && action.reason === 'overlap_cap'
  )));
});

test('retheme overlap-only mode caps overlap without metadata fetches', async () => {
  const core = await setupRethemeTest({});
  await verifyTitle('movie', 'tt-overlap-lightweight');
  await upsertRailPoolTitle({
    rail_id: 'movies-comedy',
    type: 'movie',
    id: 'tt-overlap-lightweight',
    score: 92,
    title: 'Lightweight Comedy',
  });
  await upsertRailPoolTitle({
    rail_id: 'movies-comfort',
    type: 'movie',
    id: 'tt-overlap-lightweight',
    score: 88,
    title: 'Lightweight Comedy',
  });
  await upsertRailPoolTitle({
    rail_id: 'movies-classics',
    type: 'movie',
    id: 'tt-overlap-lightweight',
    score: 60,
    title: 'Lightweight Comedy',
  });

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: false,
    maxRailsPerTitle: 2,
    membershipMode: 'overlap_only',
  });
  const rails = await listRailIdsContainingTitle('movie', 'tt-overlap-lightweight');

  assert.equal(result.membership_mode, 'overlap_only');
  assert.equal(result.meta_fetched, 0);
  assert.equal(result.overlap_removed, 1);
  assert.deepEqual(rails.sort(), ['movies-comedy', 'movies-comfort']);
});

test('retheme overlap cap exempts pinned memberships from rail budget', async () => {
  const core = await setupRethemeTest({
    'movie:tt-pinned-overlap': {
      id: 'tt-pinned-overlap',
      type: 'movie',
      name: 'A Funny Comfort Classic',
      genre: 'Comedy',
      description: 'A funny comfort comedy built for laughs.',
    } as Meta,
  });
  await writeFile(process.env.MANGO_RAIL_CURATION_OVERRIDES!, `
version: 1
pins:
  - rail_id: movies-classics
    type: movie
    id: tt-pinned-overlap
    score: 999
blocks: []
`, 'utf8');
  await verifyTitle('movie', 'tt-pinned-overlap');
  for (const railId of ['movies-comedy', 'movies-comfort', 'movies-classics']) {
    await upsertRailPoolTitle({
      rail_id: railId,
      type: 'movie',
      id: 'tt-pinned-overlap',
      score: 80,
      title: 'A Funny Comfort Classic',
    });
  }

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: true,
    maxRailsPerTitle: 2,
  });
  const rails = await listRailIdsContainingTitle('movie', 'tt-pinned-overlap');
  const overlap = await getRailPoolOverlapSummary({ maxRailsPerTitle: 2 });

  assert.equal(result.overlap_removed, 0);
  assert.deepEqual(rails.sort(), ['movies-classics', 'movies-comedy', 'movies-comfort']);
  assert.equal(overlap.over_cap_titles, 0);
  assert.equal(overlap.max_rails_per_title, 3);
});

test('retheme overlap-only mode exempts pinned memberships from rail budget', async () => {
  const core = await setupRethemeTest({});
  await writeFile(process.env.MANGO_RAIL_CURATION_OVERRIDES!, `
version: 1
pins:
  - rail_id: movies-classics
    type: movie
    id: tt-pinned-overlap-lightweight
    score: 999
blocks: []
`, 'utf8');
  await verifyTitle('movie', 'tt-pinned-overlap-lightweight');
  for (const [railId, score] of [
    ['movies-comedy', 88],
    ['movies-comfort', 92],
    ['movies-classics', 999],
  ] as const) {
    await upsertRailPoolTitle({
      rail_id: railId,
      type: 'movie',
      id: 'tt-pinned-overlap-lightweight',
      score,
      title: 'Pinned Lightweight Comedy',
    });
  }

  const result = await rethemeRailPools(core, {
    dryRun: false,
    includeOrphans: false,
    maxRailsPerTitle: 2,
    membershipMode: 'overlap_only',
  });
  const rails = await listRailIdsContainingTitle('movie', 'tt-pinned-overlap-lightweight');
  const overlap = await getRailPoolOverlapSummary({ maxRailsPerTitle: 2 });

  assert.equal(result.membership_mode, 'overlap_only');
  assert.equal(result.overlap_removed, 0);
  assert.deepEqual(rails.sort(), ['movies-classics', 'movies-comedy', 'movies-comfort']);
  assert.equal(overlap.over_cap_titles, 0);
  assert.equal(overlap.max_rails_per_title, 3);
});
