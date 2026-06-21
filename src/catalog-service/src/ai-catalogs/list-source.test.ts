import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSeedTitles } from './list-source.js';

test('mergeSeedTitles prioritizes add_ids from llm hints', () => {
  const seeds = mergeSeedTitles(
    [{ type: 'movie', id: 'tt1', title: 'One' }],
    'movie',
    { add_ids: ['tt2', 'tt1'] },
  );
  assert.equal(seeds.length, 2);
  assert.ok(seeds.some((seed) => seed.id === 'tt2'));
});
