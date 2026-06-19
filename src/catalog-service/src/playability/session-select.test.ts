import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
