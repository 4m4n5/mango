import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeUserStateRails, type RailItemsResponse } from './core.js';

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

