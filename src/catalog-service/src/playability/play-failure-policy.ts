import {
  classifyPlayError,
  type PlayErrorClass,
} from '../play-error-classify.js';

export type PlayFailureInvalidationInput = {
  /** True when the Play request itself failed overall; false for candidate-local fallback failures. */
  terminalFailure?: boolean;
  isNoPlayableStream: boolean;
  attempts?: unknown;
  candidates?: unknown;
  /** True when Phase B obligation floor ran during this play. */
  obligationFloorRan?: boolean;
  /** Prior titles.fail_reason from playability.db (e.g. play_miss). */
  priorFailReason?: string | null;
  /** Prior titles.updated_at ms — used for second-miss window. */
  priorUpdatedAt?: number | null;
  nowMs?: number;
};

const PLAY_MISS_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** User/system cancellations are not failed attempts. Retryable transport errors are. */
function isCancelledClass(cls: PlayErrorClass): boolean {
  return cls === 'cancelled';
}

function isCancelledPlayAttemptError(error: unknown): boolean {
  if (typeof error !== 'string') {
    return false;
  }
  return isCancelledClass(classifyPlayError(error));
}

/**
 * First failed overall couch play → demote (stale/play_miss), not tombstone.
 * Cancellations/user stops never demote or invalidate. Once a Play request
 * fails overall, zero-stream, auth, pipeline, and transient failures hide the
 * affected identity while the reverify queue works in the background.
 * Candidate-local probe failures that later fall back successfully never call
 * this terminal policy.
 */
export function shouldDemoteAfterPlayError(input: PlayFailureInvalidationInput): boolean {
  if (input.terminalFailure === false) {
    return false;
  }
  if (Array.isArray(input.attempts)
    && input.attempts.length > 0
    && input.attempts.every((attempt) => {
      if (!attempt || typeof attempt !== 'object') return false;
      const error = 'error' in attempt ? (attempt as { error?: unknown }).error : undefined;
      return isCancelledPlayAttemptError(error);
    })) {
    return false;
  }
  return true;
}

/**
 * Sustained failure: second obligation-floor exhaustion within 24h after play_miss demotion.
 * Only then purge rail_pool (play_failure tombstone).
 */
export function shouldConfirmPlayFailure(input: PlayFailureInvalidationInput): boolean {
  if (!shouldDemoteAfterPlayError(input)) {
    return false;
  }
  if (input.priorFailReason !== 'play_miss') {
    return false;
  }
  const priorUpdatedAt = typeof input.priorUpdatedAt === 'number' ? input.priorUpdatedAt : 0;
  if (priorUpdatedAt <= 0) {
    return false;
  }
  const now = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  return now - priorUpdatedAt <= PLAY_MISS_CONFIRM_WINDOW_MS;
}

/**
 * @deprecated Prefer shouldDemoteAfterPlayError / shouldConfirmPlayFailure.
 * Kept for callers that only need a boolean "do something to playability".
 * Returns true for demote OR confirm (not for transient/zero-stream).
 */
export function shouldInvalidatePlayabilityAfterPlayError(
  input: PlayFailureInvalidationInput,
): boolean {
  return shouldDemoteAfterPlayError(input) || shouldConfirmPlayFailure(input);
}

export { isCancelledPlayAttemptError };
