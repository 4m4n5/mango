import assert from 'node:assert/strict';
import test from 'node:test';
import { focusedTargetNeedsScroll, resolveFocusPosition, stepGridPosition } from './focus.js';

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

test('already-visible pinned chrome does not need scrollIntoView', () => {
  const chip = { top: 80, right: 400, bottom: 120, left: 40 };
  const viewport = { top: 0, right: 1920, bottom: 1080, left: 0 };
  assert.equal(focusedTargetNeedsScroll(chip, viewport), false);
});

test('a card clipped by its rail scrollport still needs scrollIntoView', () => {
  const card = { top: 900, right: 400, bottom: 1100, left: 40 };
  const port = { top: 200, right: 1920, bottom: 1080, left: 0 };
  assert.equal(focusedTargetNeedsScroll(card, port), true);
});

test('a card in the rail scroll-padding zone still needs scrollIntoView', () => {
  const card = { top: 210, right: 400, bottom: 430, left: 40 };
  const paddedPort = { top: 232, right: 1920, bottom: 1080, left: 0 };
  assert.equal(focusedTargetNeedsScroll(card, paddedPort), true);
});
