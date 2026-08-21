import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDescriptiveSearchQuery,
  normalizeSearchQuery,
  scoreNormalizedSearchMatch,
  scoreSearchMatch,
  validateSearchQuery,
} from './normalize.js';

test('normalizeSearchQuery removes diacritics and folds punctuation and whitespace', () => {
  assert.equal(normalizeSearchQuery('  Amélie: Director’s Cut!  '), 'amelie director s cut');
});

test('validateSearchQuery enforces the submitted search bounds', () => {
  assert.throws(() => validateSearchQuery('a'), /at least 2/);
  assert.throws(() => validateSearchQuery('x'.repeat(121)), /120/);
  assert.deepEqual(validateSearchQuery('  Dune   Part Two '), {
    display: 'Dune Part Two',
    normalized: 'dune part two',
  });
});

test('literal ranking keeps exact prefix and complete-token classes ordered', () => {
  const exact = scoreSearchMatch('Dune', 'dune');
  const prefix = scoreSearchMatch('Dune Part Two', 'dune');
  const tokens = scoreSearchMatch('Part Two: A Dune Story', 'dune part');
  assert.equal(exact?.match, 'exact');
  assert.equal(prefix?.match, 'prefix');
  assert.ok((exact?.score || 0) > (prefix?.score || 0));
  assert.ok((prefix?.score || 0) > (tokens?.score || 0));
});

test('pre-normalized index scoring preserves literal ranking exactly', () => {
  const cases = [
    ['Dune', 'dune', 'Dune'],
    ['Dune Part Two', 'dune', 'Dune Part Two'],
    ['Part Two: A Dune Story', 'dune part', 'Part Two: A Dune Story'],
    ['Amélie', 'amelie', 'Amélie Audrey Tautou'],
  ] as const;
  for (const [title, query, searchable] of cases) {
    assert.deepEqual(
      scoreNormalizedSearchMatch(
        normalizeSearchQuery(title),
        normalizeSearchQuery(query),
        normalizeSearchQuery(searchable),
      ),
      scoreSearchMatch(title, query, searchable),
    );
  }
});

test('romanized and descriptive Hinglish queries are retained for optional expansion', () => {
  const query = 'kuch funny hindi videos jo family ke saath dekh sake';
  assert.equal(normalizeSearchQuery(query), query);
  assert.equal(isDescriptiveSearchQuery(query), true);
});
