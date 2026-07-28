export const PLAY_SERVER_BUDGET_MS = 120_000;
export const PLAY_PROCESS_CLEANUP_GRACE_MS = 2_000;

export type PlayDeadline = Readonly<{
  startedAtMs: number;
  deadlineAtMs: number;
  budgetMs: number;
}>;

export class PlayDeadlineExceededError extends Error {
  constructor() {
    super('play deadline exceeded');
    this.name = 'PlayDeadlineExceededError';
  }
}

export function createPlayDeadline(
  nowMs = Date.now(),
  budgetMs = PLAY_SERVER_BUDGET_MS,
): PlayDeadline {
  const boundedBudget = Math.max(1, Math.floor(budgetMs));
  return {
    startedAtMs: nowMs,
    deadlineAtMs: nowMs + boundedBudget,
    budgetMs: boundedBudget,
  };
}

export function remainingPlayBudgetMs(
  deadline: Pick<PlayDeadline, 'deadlineAtMs'> | number,
  nowMs = Date.now(),
): number {
  const deadlineAtMs = typeof deadline === 'number' ? deadline : deadline.deadlineAtMs;
  return Math.max(0, Math.floor(deadlineAtMs - nowMs));
}

export function capToPlayBudgetMs(
  requestedMs: number,
  deadline: Pick<PlayDeadline, 'deadlineAtMs'> | number,
  nowMs = Date.now(),
): number {
  return Math.max(0, Math.min(Math.floor(requestedMs), remainingPlayBudgetMs(deadline, nowMs)));
}

export function assertPlayBudget(
  deadline: Pick<PlayDeadline, 'deadlineAtMs'> | number,
  nowMs = Date.now(),
): void {
  if (remainingPlayBudgetMs(deadline, nowMs) <= 0) {
    throw new PlayDeadlineExceededError();
  }
}
