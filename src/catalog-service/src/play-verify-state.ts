/**
 * Pure helpers for additive verify-state fields on the /play response.
 * Extracted from index.ts so they're unit-testable without importing the
 * server entrypoint (index.ts runs `main()` — and its server bootstrap — at
 * module load).
 */

/**
 * True when this play is the first to promote a title into the verified
 * library — i.e. no prior verification was ever recorded (`first_verified_at`
 * was absent before this play).
 * `usePlayabilityIndex` mirrors index.ts's own gate (series episodes outside
 * the rail-gate path skip the playability index entirely).
 */
export function isFirstTimeVerifiedPromotion(
  usePlayabilityIndex: boolean,
  hasBeenVerifiedBefore: boolean,
): boolean {
  return usePlayabilityIndex && !hasBeenVerifiedBefore;
}
