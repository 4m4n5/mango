import assert from 'node:assert/strict';
import test from 'node:test';
import {
  injectPinnedSessionItems,
  mergePinnedPoolItems,
  parseRailCurationOverrides,
  shouldSkipTitleFilter,
} from './rail-overrides.js';

const overrides = parseRailCurationOverrides(`
version: 1
pins:
  - rail_id: series-comedy
    type: series
    id: tt33094114
    score: 9999
    skip_title_filter: true
    session_slot: 0
blocks:
  - rail_id: series-global-popular
    type: series
    id: tt0944947
`);

test('shouldSkipTitleFilter for pinned IGL', () => {
  assert.equal(shouldSkipTitleFilter('series', 'tt33094114', overrides), true);
  assert.equal(shouldSkipTitleFilter('series', 'tt33094114:1:1', overrides), true);
  assert.equal(shouldSkipTitleFilter('series', 'tt0903747', overrides), false);
});

test('mergePinnedPoolItems injects pin with top score', () => {
  const pool = [
    { type: 'series', id: 'tt1', score: 100 },
    { type: 'series', id: 'tt2', score: 90 },
  ];
  const merged = mergePinnedPoolItems(pool, 'series-comedy', overrides);
  assert.equal(merged[0]?.id, 'tt33094114');
  assert.equal(merged[0]?.score, 9999);
});

test('injectPinnedSessionItems forces pin first', () => {
  const pool = [
    { type: 'series', id: 'tt33094114', score: 9999 },
    { type: 'series', id: 'tt1', score: 100 },
    { type: 'series', id: 'tt2', score: 90 },
  ];
  const selected = [
    { type: 'series', id: 'tt1' },
    { type: 'series', id: 'tt2' },
  ];
  const injected = injectPinnedSessionItems(selected, pool, 'series-comedy', overrides, 3);
  assert.equal(injected[0]?.id, 'tt33094114');
  assert.equal(injected.length, 3);
});

test('mergePinnedPoolItems removes blocked titles', () => {
  const pool = [
    { type: 'series', id: 'tt0944947', score: 100 },
    { type: 'series', id: 'tt2', score: 90 },
  ];
  const merged = mergePinnedPoolItems(pool, 'series-global-popular', overrides);
  assert.deepEqual(merged.map((item) => item.id), ['tt2']);
});
