import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAY_SERVER_BUDGET_MS,
  PlayDeadlineExceededError,
  assertPlayBudget,
  capToPlayBudgetMs,
  createPlayDeadline,
  remainingPlayBudgetMs,
} from './play-deadline.js';

test('play deadline owns one absolute 85 second server budget', () => {
  const deadline = createPlayDeadline(1_000);
  assert.equal(deadline.budgetMs, PLAY_SERVER_BUDGET_MS);
  assert.equal(deadline.deadlineAtMs, 86_000);
  assert.equal(remainingPlayBudgetMs(deadline, 6_000), 80_000);
});

test('stage budgets are capped to the remaining absolute budget', () => {
  const deadline = createPlayDeadline(10_000, 1_000);
  assert.equal(capToPlayBudgetMs(5_000, deadline, 10_250), 750);
  assert.equal(capToPlayBudgetMs(500, deadline, 10_250), 500);
  assert.equal(capToPlayBudgetMs(500, deadline, 11_100), 0);
});

test('expired play budget fails deterministically', () => {
  const deadline = createPlayDeadline(1_000, 100);
  assert.throws(() => assertPlayBudget(deadline, 1_100), PlayDeadlineExceededError);
});
