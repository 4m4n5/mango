import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import {
  buildTabSessionSelections,
  railsForTabSessionAllocation,
  selectRailSessionItems,
  sessionItemsConflictWithOccupied,
  tabSessionsHaveDuplicateTitles,
  titleKey,
} from './session-select.js';

const pool = [
  { type: 'movie', id: 'tt1', score: 100 },
  { type: 'movie', id: 'tt2', score: 90 },
  { type: 'movie', id: 'tt3', score: 80 },
  { type: 'movie', id: 'tt4', score: 70 },
];

function catalogRailIdsForTab(tab: string): string[] {
  const catalogUrl = new URL('../../../../config/catalog.example.yaml', import.meta.url);
  const catalog = parseYaml(readFileSync(catalogUrl, 'utf8')) as {
    rails?: Array<{ id?: string; tab?: string; enabled?: boolean }>;
  };
  return (catalog.rails ?? [])
    .filter((rail) => rail.enabled !== false && rail.tab === tab && typeof rail.id === 'string')
    .map((rail) => rail.id as string);
}

test('railsForTabSessionAllocation reverses yaml order for niche-first picks', () => {
  const rails = [
    { railId: 'movies-global-popular' },
    { railId: 'movies-quick-watches' },
  ];
  assert.deepEqual(
    railsForTabSessionAllocation(rails).map((rail) => rail.railId),
    ['movies-quick-watches', 'movies-global-popular'],
  );
});

test('catalog order gives optional series rails first tab-session picks', () => {
  const allocated = railsForTabSessionAllocation(
    catalogRailIdsForTab('series').map((railId) => ({ railId })),
  ).map((rail) => rail.railId);

  assert.deepEqual(allocated.slice(0, 2), ['series-comedy', 'series-reality-casual']);
  assert.ok(allocated.indexOf('series-comedy') < allocated.indexOf('series-india-picks'));
});

test('catalog order anchors india before classics on series tab', () => {
  const series = catalogRailIdsForTab('series');
  assert.equal(series[1], 'series-india-picks');
  assert.equal(series[2], 'series-classics');
});

test('catalog order preserves movies quick-watches before anchor rails', () => {
  const allocated = railsForTabSessionAllocation(
    catalogRailIdsForTab('movies').map((railId) => ({ railId })),
  ).map((rail) => rail.railId);

  assert.ok(allocated.indexOf('movies-quick-watches') < allocated.indexOf('movies-global-popular'));
  assert.ok(allocated.indexOf('movies-quick-watches') < allocated.indexOf('movies-india-trending'));
});

test('buildTabSessionSelections tops up anchor rails after niche reserve pass', () => {
  const rails = [
    { railId: 'series-global-popular', displayLimit: 20, minDisplay: 20 },
    { railId: 'series-comedy', displayLimit: 20, minDisplay: 12 },
  ];
  const pools = new Map([
    ['series-global-popular', [
      { type: 'series', id: 'tt1', score: 100 },
      { type: 'series', id: 'tt2', score: 90 },
      { type: 'series', id: 'tt3', score: 80 },
      { type: 'series', id: 'tt4', score: 70 },
      { type: 'series', id: 'tt5', score: 60 },
      { type: 'series', id: 'tt6', score: 50 },
      { type: 'series', id: 'tt7', score: 40 },
      { type: 'series', id: 'tt8', score: 30 },
      { type: 'series', id: 'tt9', score: 20 },
      { type: 'series', id: 'tt10', score: 10 },
    ]],
    ['series-comedy', [
      { type: 'series', id: 'tt1', score: 100 },
      { type: 'series', id: 'tt11', score: 95 },
      { type: 'series', id: 'tt12', score: 85 },
      { type: 'series', id: 'tt13', score: 75 },
      { type: 'series', id: 'tt14', score: 65 },
      { type: 'series', id: 'tt15', score: 55 },
      { type: 'series', id: 'tt16', score: 45 },
      { type: 'series', id: 'tt17', score: 35 },
      { type: 'series', id: 'tt18', score: 25 },
    ]],
  ]);
  const recent = new Map(rails.map((rail) => [rail.railId, new Set<string>()]));
  const selections = buildTabSessionSelections(rails, pools, recent, {
    reserveFloor: 8,
    shuffleFn: (items) => items,
  });
  const global = selections.get('series-global-popular') ?? [];
  const comedy = selections.get('series-comedy') ?? [];
  assert.ok(global.length >= 8, `global starved: ${global.length}`);
  assert.ok(comedy.length >= 8, `comedy starved: ${comedy.length}`);
  const keys = new Set([...global, ...comedy].map((item) => titleKey(item.type, item.id)));
  assert.equal(keys.size, global.length + comedy.length);
});

test('buildTabSessionSelections anchor-first reserve fills global when pools overlap', () => {
  const shared = Array.from({ length: 12 }, (_, index) => ({
    type: 'series',
    id: `tt${index + 1}`,
    score: 100 - index,
  }));
  const rails = [
    { railId: 'series-global-popular', displayLimit: 10, minDisplay: 10 },
    { railId: 'series-classics', displayLimit: 10, minDisplay: 10 },
    { railId: 'series-comedy', displayLimit: 10, minDisplay: 8 },
  ];
  const pools = new Map([
    ['series-global-popular', [...shared]],
    ['series-classics', [...shared]],
    ['series-comedy', [...shared, { type: 'series', id: 'tt99', score: 50 }]],
  ]);
  const recent = new Map(rails.map((rail) => [rail.railId, new Set<string>()]));
  const selections = buildTabSessionSelections(rails, pools, recent, {
    reserveFloor: 8,
    anchorRailCount: 2,
    shuffleFn: (items) => items,
  });
  assert.ok((selections.get('series-global-popular') ?? []).length >= 8);
  assert.ok((selections.get('series-comedy') ?? []).length >= 1);
});

test('selectRailSessionItems excludes tab-occupied titles', () => {
  const occupied = new Set([titleKey('movie', 'tt1')]);
  const selected = selectRailSessionItems(pool, {
    displayLimit: 3,
    recentKeys: new Set(),
    occupiedKeys: occupied,
    shuffleFn: (items) => items,
  });
  assert.deepEqual(selected.map((item) => item.id), ['tt2', 'tt3', 'tt4']);
});

test('selectRailSessionItems deprioritizes recent titles in stable slots', () => {
  const recent = new Set([titleKey('movie', 'tt1')]);
  const selected = selectRailSessionItems(pool, {
    displayLimit: 3,
    recentKeys: recent,
    occupiedKeys: new Set(),
    shuffleFn: (items) => items,
  });
  assert.equal(selected[0]?.id, 'tt2');
  assert.equal(selected[0]?.mix_bucket, 'stable');
  assert.deepEqual(selected.map((item) => item.id), ['tt2', 'tt3', 'tt4']);
});

test('tabSessionsHaveDuplicateTitles detects cross-rail dupes', () => {
  const sessions = new Map([
    ['rail-a', [{ type: 'movie', id: 'tt1' }]],
    ['rail-b', [{ type: 'movie', id: 'tt1' }, { type: 'movie', id: 'tt2' }]],
  ]);
  assert.equal(tabSessionsHaveDuplicateTitles(sessions), true);
  sessions.set('rail-b', [{ type: 'movie', id: 'tt2' }]);
  assert.equal(tabSessionsHaveDuplicateTitles(sessions), false);
});

test('sessionItemsConflictWithOccupied', () => {
  const occupied = new Set([titleKey('series', 'tt9')]);
  assert.equal(
    sessionItemsConflictWithOccupied([{ type: 'series', id: 'tt9' }], occupied),
    true,
  );
  assert.equal(
    sessionItemsConflictWithOccupied([{ type: 'series', id: 'tt8' }], occupied),
    false,
  );
});
