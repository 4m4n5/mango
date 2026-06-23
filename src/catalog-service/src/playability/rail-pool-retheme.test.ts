import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Meta, PlayableRail } from '../core.js';
import { PlayabilityBatchWriter } from './batch-writer.js';
import { listOrphanVerifiedPoolTitles, listRailIdsContainingTitle } from './db.js';
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
