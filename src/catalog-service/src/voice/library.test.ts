import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLibraryRows } from './library.js';

test('aggregateLibraryRows merges rails for the same title', () => {
  const rows = [
    {
      rail_id: 'movies-india',
      type: 'movie',
      id: 'tt123',
      title: 'Panchayat',
      poster: null,
      year: '2020',
    },
    {
      rail_id: 'series-comedy',
      type: 'movie',
      id: 'tt123',
      title: 'Panchayat',
      poster: null,
      year: '2020',
    },
  ];
  const labels = new Map([
    ['movies-india', 'Indian picks'],
    ['series-comedy', 'Comedy'],
  ]);
  const titles = aggregateLibraryRows(rows, labels);
  assert.equal(titles.length, 1);
  assert.deepEqual(titles[0]?.rails, ['Indian picks', 'Comedy']);
  assert.equal(titles[0]?.tab, 'movies');
});
