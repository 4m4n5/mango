import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFocusPosition, stepGridPosition } from './focus.js';

function item(focusKey: string): HTMLElement {
  return { dataset: { focusKey } } as unknown as HTMLElement;
}

test('a replaced For You card keeps the same couch row and column when its key disappears', () => {
  const rows = [
    [item('chrome:search'), item('chrome:shuffle')],
    [item('new-0'), item('new-1'), item('new-2'), item('new-3')],
  ];
  assert.deepEqual(resolveFocusPosition(rows, {
    preferredKey: 'old-card',
    fallbackPosition: { row: 1, col: 2 },
  }, { row: 0, col: 0 }), { row: 1, col: 2 });
});

test('focus fallback clamps to the replacement row instead of jumping to chrome', () => {
  const rows = [[item('chrome')], [item('new-0'), item('new-1')]];
  assert.deepEqual(resolveFocusPosition(rows, {
    preferredKey: 'removed',
    fallbackPosition: { row: 1, col: 5 },
  }, { row: 0, col: 0 }), { row: 1, col: 1 });
});

test('vertical moves remember the intended column across a shorter row', () => {
  const down = stepGridPosition(
    [11, 1],
    { row: 0, col: 10, desiredCol: 10 },
    'row',
    1,
  );
  assert.deepEqual(down, { row: 1, col: 0, desiredCol: 10 });
  assert.deepEqual(
    stepGridPosition([11, 1], down, 'row', -1),
    { row: 0, col: 10, desiredCol: 10 },
  );
});

test('Down from a QWERTY column stays in that column on a 10-wide rectangle', () => {
  assert.deepEqual(
    stepGridPosition(
      [10, 10, 10, 10],
      { row: 1, col: 9, desiredCol: 9 },
      'row',
      1,
    ),
    { row: 2, col: 9, desiredCol: 9 },
  );
});
