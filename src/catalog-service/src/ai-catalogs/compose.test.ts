import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAiCatalogPlan,
  scoreInventoryRow,
  tokenizeIntent,
} from './compose.js';
import type { MdbListInventory } from './inventory.js';

const FIXTURE: MdbListInventory = {
  catalogs: [
    {
      catalog_id: 'mdblist.2410',
      name: 'Horror Movies',
      media: 'movie',
      items: 500,
      popularity: 120,
      tags: ['horror', 'movie', 'candidate'],
      hit_rate: { source: 0.75, status: 'measured' },
    },
    {
      catalog_id: 'mdblist.88302',
      name: 'Popular',
      media: 'movie',
      items: 800,
      popularity: 400,
      tags: ['trending', 'movie', 'deployed'],
      rails: ['movies-global-popular'],
      hit_rate: { source: 0.85, status: 'measured' },
    },
    {
      catalog_id: 'mdblist.91223',
      name: 'Comedy',
      media: 'movie',
      items: 300,
      popularity: 90,
      tags: ['comedy', 'movie', 'deployed'],
      rails: ['movies-comedy'],
    },
  ],
};

test('tokenizeIntent picks horror from label and theme', () => {
  const tags = tokenizeIntent('Horror movies latest scares');
  assert.ok(tags.has('horror'));
  assert.ok(tags.has('trending'));
});

test('scoreInventoryRow prefers tag overlap and reserve', () => {
  const intent = tokenizeIntent('horror movies');
  const reserve = new Set(['mdblist.2410']);
  const deployed = new Set(['mdblist.88302']);
  const horror = scoreInventoryRow(FIXTURE.catalogs[0], intent, 'movie', reserve, deployed);
  const comedy = scoreInventoryRow(FIXTURE.catalogs[2], intent, 'movie', reserve, deployed);
  assert.ok(horror > comedy);
});

test('resolveAiCatalogPlan selects horror mdblist and seeds', async () => {
  const plan = await resolveAiCatalogPlan(
    {
      label: 'Horror',
      tab: 'movies',
      content_type: 'movie',
      theme: 'horror movies scary',
    },
    {
      inventory: FIXTURE,
      reserveIds: new Set(['mdblist.2410']),
      searchLibrary: async () => ([
        {
          type: 'movie',
          id: 'tt1438176',
          title: 'Fright Night',
          tab: 'movies',
          score: 90,
        },
      ]),
    },
  );

  assert.equal(plan.sources.some((source) => source.catalog === 'mdblist.2410'), true);
  assert.ok(plan.seed_titles.length >= 1);
  assert.ok(plan.thematic_score > 0);
  assert.ok(plan.catalogs_to_activate.includes('mdblist.2410'));
});

test('resolveAiCatalogPlan escalates fallback when no tag match', async () => {
  const plan = await resolveAiCatalogPlan(
    {
      label: 'Obscure Niche',
      tab: 'movies',
      content_type: 'movie',
      theme: 'xyzunknown genre',
    },
    {
      inventory: FIXTURE,
      reserveIds: new Set(),
      minFallbackLevel: 3,
      searchLibrary: async () => [],
    },
  );

  assert.equal(plan.sources[0]?.addon, 'Cinemeta');
  assert.equal(plan.fallback_level, 3);
});
