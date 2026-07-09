export type PlayFailureInvalidationInput = {
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

function isTransientPlayAttemptError(error: unknown): boolean {
  if (typeof error !== 'string') {
    return false;
  }
  return /debrid_nfo_sidecar|debrid_playback_unreadable|debrid_status_clip|supplemental_or_short_release|no error detail captured|play cancelled|play epoch|PlayCancelledError/i
    .test(error);
}

function hasNonTransientAttempt(attempts: unknown): boolean {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return false;
  }
  return attempts.some((attempt) => {
    if (!attempt || typeof attempt !== 'object') {
      return true;
    }
    const error = 'error' in attempt ? (attempt as { error?: unknown }).error : undefined;
    return !isTransientPlayAttemptError(error);
  });
}

/**
 * First couch miss after obligation-floor exhaustion → demote (stale/play_miss), not tombstone.
 * Zero-stream resolve and transient mpv/debrid errors never demote or invalidate.
 */
export function shouldDemoteAfterPlayError(input: PlayFailureInvalidationInput): boolean {
  if (!input.isNoPlayableStream) {
    return false;
  }
  if (typeof input.candidates === 'number' && input.candidates === 0) {
    return false;
  }
  if (!input.obligationFloorRan) {
    return false;
  }
  return hasNonTransientAttempt(input.attempts);
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

export { isTransientPlayAttemptError };
