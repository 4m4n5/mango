import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import {
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
  assert.ok(allocated.indexOf('series-comedy') < allocated.indexOf('series-global-popular'));
});

test('catalog order preserves movies quick-watches before anchor rails', () => {
  const allocated = railsForTabSessionAllocation(
    catalogRailIdsForTab('movies').map((railId) => ({ railId })),
  ).map((rail) => rail.railId);

  assert.ok(allocated.indexOf('movies-quick-watches') < allocated.indexOf('movies-global-popular'));
  assert.ok(allocated.indexOf('movies-quick-watches') < allocated.indexOf('movies-india-trending'));
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
