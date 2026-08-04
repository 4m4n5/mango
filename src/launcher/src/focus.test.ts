import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFocusPosition } from './focus.js';

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
