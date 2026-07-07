/**
 * Pure helpers for additive verify-state fields on the /play response.
 * Extracted from index.ts so they're unit-testable without importing the
 * server entrypoint (index.ts runs `main()` — and its server bootstrap — at
 * module load).
 */

export type PlayabilityStatusValue = 'verified' | 'failed' | 'pending' | 'stale';

/**
 * True when this play is the first to promote a title into the verified
 * library — i.e. its pre-play verify status was failed/pending/stale/absent.
 * `usePlayabilityIndex` mirrors index.ts's own gate (series episodes outside
 * the rail-gate path skip the playability index entirely).
 */
export function isFirstTimeVerifiedPromotion(
  usePlayabilityIndex: boolean,
  previousStatus: PlayabilityStatusValue | null | undefined,
): boolean {
  return usePlayabilityIndex && previousStatus !== 'verified';
}
