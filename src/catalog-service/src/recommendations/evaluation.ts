import type { FireWaterRating, RatingContentType } from '../library/ratings.js';
import {
  cosineSimilarity,
  holisticAffinity,
  predictAxes,
  type RecommendationFeature,
} from './engine.js';

export type RecommendationOfflineEvaluation = {
  samples: number;
  fire_mae: number | null;
  water_mae: number | null;
  affinity_mae: number | null;
};

/**
 * Evaluation identities are deliberately domain-qualified. TMDB (and other
 * catalogs) can assign the same opaque ID to a movie and a series, so a bare
 * ID is not a unique recommendation identity.
 */
export type RecommendationEvaluationContentId = `${RatingContentType}:${string}`;

export type RecommendationSlateEvaluationInput = {
  profile_id: string;
  items: Array<{
    id: RecommendationEvaluationContentId;
    bucket: 'close' | 'adjacent' | 'explore' | 'fallback';
    feature?: RecommendationFeature;
    language_bucket?: string;
  }>;
  relevant_ids: ReadonlySet<RecommendationEvaluationContentId>;
  /**
   * The exact playable/eligible universe for this slate. Coverage uses the
   * union of these typed identities and only counts selected items that were
   * actually eligible for their slate. This keeps global coverage bounded by
   * one even when evaluations span disjoint catalogs.
   */
  eligible_ids: ReadonlySet<RecommendationEvaluationContentId>;
  target_language_shares?: Record<string, number>;
};

export type RecommendationSlateEvaluation = {
  slates: number;
  recall_at_k: number | null;
  ndcg_at_k: number | null;
  catalog_coverage: number | null;
  intra_list_diversity: number | null;
  bucket_calibration_error: number | null;
  language_calibration_error: number | null;
  worst_profile_recall: number | null;
  profile_recall_gap: number | null;
};

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * Deterministic leave-one-out diagnostic. It never promotes a model and never
 * uses titles absent from the stable feature map; couch judgment remains the
 * quality authority.
 */
export function evaluateExplicitRatings(
  ratings: FireWaterRating[],
  ratingFeatures: Map<string, RecommendationFeature>,
): RecommendationOfflineEvaluation {
  const fireErrors: number[] = [];
  const waterErrors: number[] = [];
  const affinityErrors: number[] = [];
  const viewerRatings = new Map<string, FireWaterRating[]>();
  for (const rating of ratings) {
    const group = viewerRatings.get(rating.profile_id) ?? [];
    group.push(rating);
    viewerRatings.set(rating.profile_id, group);
  }
  for (const group of viewerRatings.values()) {
    for (const heldOut of group) {
      const heldOutIdentity = `${heldOut.type}:${heldOut.id}`;
      const candidate = ratingFeatures.get(heldOutIdentity);
      if (!candidate) continue;
      // A Household evaluation receives member ratings flattened together.
      // Train only on the held-out viewer, and remove every duplicate of the
      // held-out title rather than merely removing one array position.
      const training = group.filter((rating) => (
        `${rating.type}:${rating.id}` !== heldOutIdentity
      ));
      if (training.length === 0) continue;
      const predicted = predictAxes({
        candidate,
        ratings: training,
        ratingFeatures,
        tab: heldOut.type === 'movie' ? 'movies' : 'series',
      });
      fireErrors.push(Math.abs(predicted.fire - heldOut.fire));
      waterErrors.push(Math.abs(predicted.water - heldOut.water));
      affinityErrors.push(Math.abs(
        holisticAffinity(predicted.fire, predicted.water)
        - holisticAffinity(heldOut.fire, heldOut.water),
      ));
    }
  }
  return {
    samples: fireErrors.length,
    fire_mae: average(fireErrors),
    water_mae: average(waterErrors),
    affinity_mae: average(affinityErrors),
  };
}

function normalizedShares(values: string[]): Record<string, number> {
  if (values.length === 0) return {};
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Object.fromEntries([...counts].map(([key, count]) => [key, count / values.length]));
}

function totalVariation(left: Record<string, number>, right: Record<string, number>): number {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return 0.5 * [...keys].reduce((sum, key) => sum + Math.abs((left[key] ?? 0) - (right[key] ?? 0)), 0);
}

/**
 * Deterministic slate diagnostics for regression comparison. These metrics are
 * descriptive only: they never auto-promote a model or replace couch review.
 */
export function evaluateRecommendationSlates(
  inputs: RecommendationSlateEvaluationInput[],
): RecommendationSlateEvaluation {
  if (inputs.length === 0) {
    return {
      slates: 0,
      recall_at_k: null,
      ndcg_at_k: null,
      catalog_coverage: null,
      intra_list_diversity: null,
      bucket_calibration_error: null,
      language_calibration_error: null,
      worst_profile_recall: null,
      profile_recall_gap: null,
    };
  }
  const recalls: number[] = [];
  const ndcgs: number[] = [];
  const diversities: number[] = [];
  const bucketErrors: number[] = [];
  const languageErrors: number[] = [];
  const eligibleIds = new Set<RecommendationEvaluationContentId>();
  const selectedEligibleIds = new Set<RecommendationEvaluationContentId>();
  const profileHits = new Map<string, {
    hits: Set<RecommendationEvaluationContentId>;
    relevant: Set<RecommendationEvaluationContentId>;
  }>();
  for (const input of inputs) {
    input.eligible_ids.forEach((id) => eligibleIds.add(id));
    input.items.forEach((item) => {
      if (input.eligible_ids.has(item.id)) selectedEligibleIds.add(item.id);
    });
    const hits = new Set(input.items.filter((item) => input.relevant_ids.has(item.id)).map((item) => item.id));
    if (input.relevant_ids.size > 0) {
      recalls.push(hits.size / input.relevant_ids.size);
    }
    const dcg = input.items.reduce((sum, item, index) => (
      sum + (input.relevant_ids.has(item.id) ? 1 / Math.log2(index + 2) : 0)
    ), 0);
    const idealHits = Math.min(input.items.length, input.relevant_ids.size);
    const ideal = Array.from({ length: idealHits }, (_, index) => 1 / Math.log2(index + 2))
      .reduce((sum, value) => sum + value, 0);
    if (ideal > 0) ndcgs.push(dcg / ideal);

    const features = input.items.map((item) => item.feature).filter(
      (feature): feature is RecommendationFeature => feature !== undefined,
    );
    const pairDistances: number[] = [];
    for (let left = 0; left < features.length; left += 1) {
      for (let right = left + 1; right < features.length; right += 1) {
        pairDistances.push(1 - cosineSimilarity(features[left]!.vector, features[right]!.vector));
      }
    }
    if (pairDistances.length > 0) diversities.push(average(pairDistances)!);

    bucketErrors.push(totalVariation(
      normalizedShares(input.items.map((item) => item.bucket)),
      { close: 4 / 6, adjacent: 1 / 6, explore: 1 / 6 },
    ));
    if (input.target_language_shares) {
      languageErrors.push(totalVariation(
        normalizedShares(input.items.map((item) => item.language_bucket).filter(
          (value): value is string => Boolean(value),
        )),
        input.target_language_shares,
      ));
    }

    if (input.relevant_ids.size > 0) {
      let profile = profileHits.get(input.profile_id);
      if (!profile) {
        profile = { hits: new Set(), relevant: new Set() };
        profileHits.set(input.profile_id, profile);
      }
      hits.forEach((id) => profile!.hits.add(id));
      input.relevant_ids.forEach((id) => profile!.relevant.add(id));
    }
  }
  const profileRecalls = [...profileHits.values()]
    .filter((profile) => profile.relevant.size > 0)
    .map((profile) => profile.hits.size / profile.relevant.size);
  return {
    slates: inputs.length,
    recall_at_k: average(recalls),
    ndcg_at_k: average(ndcgs),
    catalog_coverage: eligibleIds.size > 0 ? selectedEligibleIds.size / eligibleIds.size : null,
    intra_list_diversity: average(diversities),
    bucket_calibration_error: average(bucketErrors),
    language_calibration_error: average(languageErrors),
    worst_profile_recall: profileRecalls.length > 0 ? Math.min(...profileRecalls) : null,
    profile_recall_gap: profileRecalls.length > 0
      ? Math.max(...profileRecalls) - Math.min(...profileRecalls)
      : null,
  };
}
