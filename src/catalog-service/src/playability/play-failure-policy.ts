export type PlayFailureInvalidationInput = {
  isNoPlayableStream: boolean;
  attempts?: unknown;
  candidates?: unknown;
};

function isTransientPlayAttemptError(error: unknown): boolean {
  if (typeof error !== 'string') {
    return false;
  }
  return /debrid_nfo_sidecar|debrid_playback_unreadable/i.test(error);
}

export function shouldInvalidatePlayabilityAfterPlayError(
  input: PlayFailureInvalidationInput,
): boolean {
  if (Array.isArray(input.attempts) && input.attempts.length > 0) {
    return input.attempts.some((attempt) => {
      if (!attempt || typeof attempt !== 'object') {
        return true;
      }
      const error = 'error' in attempt ? (attempt as { error?: unknown }).error : undefined;
      return !isTransientPlayAttemptError(error);
    });
  }
  return input.isNoPlayableStream
    && typeof input.candidates === 'number'
    && input.candidates === 0;
}
