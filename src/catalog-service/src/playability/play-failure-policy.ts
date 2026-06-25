export type PlayFailureInvalidationInput = {
  isNoPlayableStream: boolean;
  attempts?: unknown;
  candidates?: unknown;
};

export function shouldInvalidatePlayabilityAfterPlayError(
  input: PlayFailureInvalidationInput,
): boolean {
  if (Array.isArray(input.attempts) && input.attempts.length > 0) {
    return true;
  }
  return input.isNoPlayableStream
    && typeof input.candidates === 'number'
    && input.candidates === 0;
}
