/**
 * Automatic activation gates for VOD For You.
 *
 * The pre-existing `storyGraphServingDecision` mixed evaluation quality with
 * runtime safety invariants (accounting, deterministic replay, cached-service
 * p95). That coupling made cold-start behavior fragile: an unmeasured p95
 * would block activation entirely even when everything else was fine.
 *
 * This module extracts the "may we activate this generation on the couch?"
 * decision into a pure function over an explicit context, so the worker CLI
 * and diagnostics can share one truthful decision. The rules mirror the
 * target contract:
 *
 *   - deterministic replay must succeed
 *   - accounting must be complete (verified == accounted)
 *   - reserve depth must satisfy playability requirements
 *   - runtime resource envelope (peak RSS, wall time) must be within budget
 *   - offline relevance evidence must exist locally
 *   - failure always retains the last-good active generation
 *
 * Cold-start Top Picks fallback: when no rank generation is activatable at
 * all, callers may present a deterministic "Top Picks" set drawn from the
 * verified corpus (by title asc). That fallback is separate from activation
 * so this module never advances an active pointer to a Top Picks slate.
 */

import type { StoryGraphOfflineEvaluation } from './story-graph-service.js';

export type ActivationGateInput = {
  evaluation: StoryGraphOfflineEvaluation;
  reserve_depth: number;
  playability_minimum_reserve: number;
  peak_rss_bytes: number | null;
  wall_time_ms: number | null;
  max_rss_bytes: number;
  max_wall_time_ms: number;
  offline_relevance_samples: number;
  strict_p95?: boolean;
};

export type ActivationGateDecision = {
  activate: boolean;
  basis: 'evaluated' | 'evidence_cold_start' | 'blocked';
  blockers: string[];
};

const COLD_START_LABEL_GAPS = new Set([
  'insufficient_stratified_ratings',
  'ndcg_unavailable',
]);
const NON_STRICT_COLD_START_GAPS = new Set([
  'cached_service_p95_unmeasured',
]);

/**
 * Pure activation decision. Never touches the database. Callers assemble the
 * input from the current generation and system state, then use `activate` to
 * decide whether to advance the pointer.
 */
export function evaluateActivationGates(input: ActivationGateInput): ActivationGateDecision {
  const strictP95 = input.strict_p95 ?? false;
  const invariantBlockers: string[] = [];
  if (!input.evaluation.verified_accounting_complete) {
    invariantBlockers.push('verified_corpus_accounting_incomplete');
  }
  if (!input.evaluation.deterministic) invariantBlockers.push('determinism_replay_failed');
  if (input.evaluation.cached_service_p95_ms === null) {
    if (strictP95) invariantBlockers.push('cached_service_p95_unmeasured');
  } else if (input.evaluation.cached_service_p95_ms > 250) {
    invariantBlockers.push('cached_service_p95_above_250ms');
  }
  if (input.reserve_depth < input.playability_minimum_reserve) {
    invariantBlockers.push('reserve_below_playability_minimum');
  }
  if (input.peak_rss_bytes !== null && input.peak_rss_bytes > input.max_rss_bytes) {
    invariantBlockers.push('peak_rss_exceeded');
  }
  if (input.wall_time_ms !== null && input.wall_time_ms > input.max_wall_time_ms) {
    invariantBlockers.push('wall_time_exceeded');
  }
  // Offline relevance is only an invariant when the evaluation actually tried
  // to compute promotion signals. In the cold-start regime (no stratified
  // ratings), there is no offline evidence to demand and the gate must not
  // block a truthful evidence_cold_start publication just because samples=0.
  const evaluationAttemptedPromotion = !input.evaluation.reasons.includes('insufficient_stratified_ratings');
  if (evaluationAttemptedPromotion && input.offline_relevance_samples <= 0) {
    invariantBlockers.push('offline_relevance_unavailable');
  }
  const coldGaps = strictP95
    ? COLD_START_LABEL_GAPS
    : new Set([...COLD_START_LABEL_GAPS, ...NON_STRICT_COLD_START_GAPS]);
  const evaluationReasons = input.evaluation.reasons.filter((reason) => (
    strictP95 || !NON_STRICT_COLD_START_GAPS.has(reason)
  ));
  if (input.evaluation.promotion_eligible) {
    const blockers = [...new Set([...evaluationReasons, ...invariantBlockers])];
    return blockers.length === 0
      ? { activate: true, basis: 'evaluated', blockers: [] }
      : { activate: false, basis: 'blocked', blockers };
  }
  const uniqueBlockers = [...new Set([
    ...evaluationReasons.filter((reason) => !coldGaps.has(reason)),
    ...invariantBlockers,
  ])];
  // Classify cold-start eligibility from the original reasons. In non-strict
  // mode `cached_service_p95_unmeasured` is intentionally filtered out of
  // `evaluationReasons`; using the filtered list here would turn that sole
  // tolerated gap into `activation_not_eligible`.
  const labelsAreOnlyGap = input.evaluation.reasons.length > 0
    && input.evaluation.reasons.every((reason) => coldGaps.has(reason));
  if (labelsAreOnlyGap && uniqueBlockers.length === 0) {
    return { activate: true, basis: 'evidence_cold_start', blockers: [] };
  }
  return {
    activate: false,
    basis: 'blocked',
    blockers: uniqueBlockers.length > 0 ? uniqueBlockers : ['activation_not_eligible'],
  };
}

export type ColdStartTopPicksInput = {
  tab: 'movies' | 'series';
  verified_titles: Array<{
    id: string;
    title: string;
    poster: string;
    year?: string;
    score?: number;
  }>;
  limit?: number;
  exclude?: ReadonlySet<string>;
};

export type ColdStartTopPicksSlate = {
  rail_id: 'for-you-movies' | 'for-you-series';
  label: 'Top Picks';
  items: Array<{
    id: string;
    title: string;
    poster: string;
    year?: string;
    source: 'cold-start-top-picks';
  }>;
  basis: 'cold_start_top_picks';
};

/**
 * Deterministic Top Picks fallback when no rank generation is available.
 *
 * The rail is intentionally not a personalized taste model — it's a truthful
 * placeholder that surfaces verified library content. Ordering: highest score
 * desc, then title asc, then id asc so two independent workers produce the
 * same slate for the same corpus. Exclusions honor the caller-supplied set
 * (household hidden/blocked/etc.).
 */
export function buildColdStartTopPicksSlate(
  input: ColdStartTopPicksInput,
): ColdStartTopPicksSlate {
  const limit = input.limit ?? 6;
  const exclude = input.exclude ?? new Set<string>();
  const filtered = input.verified_titles.filter((title) => !exclude.has(title.id));
  filtered.sort((left, right) => (
    (right.score ?? 0) - (left.score ?? 0)
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id)
  ));
  return {
    rail_id: input.tab === 'movies' ? 'for-you-movies' : 'for-you-series',
    label: 'Top Picks',
    items: filtered.slice(0, limit).map((title) => ({
      id: title.id,
      title: title.title,
      poster: title.poster,
      ...(title.year ? { year: title.year } : {}),
      source: 'cold-start-top-picks' as const,
    })),
    basis: 'cold_start_top_picks',
  };
}
