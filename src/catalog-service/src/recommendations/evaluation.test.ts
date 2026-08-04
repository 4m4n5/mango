import assert from 'node:assert/strict';
import test from 'node:test';
import type { FireWaterRating } from '../library/ratings.js';
import { buildRecommendationFeature, holisticAffinity, predictAxes } from './engine.js';
import {
  evaluateExplicitRatings,
  evaluateRecommendationSlates,
  type RecommendationEvaluationContentId,
} from './evaluation.js';

function rating(
  id: string,
  fire: number,
  water: number,
  options: { profile_id?: string; type?: 'movie' | 'series' } = {},
): FireWaterRating {
  return {
    profile_id: options.profile_id ?? 'household', type: options.type ?? 'movie', id, title: id, year: '2020',
    fire: fire as FireWaterRating['fire'], water: water as FireWaterRating['water'],
    revision: 1, origin: 'couch', taste_tags: [id], updated_at: 1,
  };
}

function contentId(type: 'movie' | 'series', id: string): RecommendationEvaluationContentId {
  return `${type}:${id}`;
}

function contentIds(...ids: RecommendationEvaluationContentId[]): ReadonlySet<RecommendationEvaluationContentId> {
  return new Set(ids);
}

test('leave-one-out evaluation is deterministic and reports both axes', () => {
  const ratings = [rating('warm', 4, 5), rating('action', 5, 2), rating('quiet', 2, 4)];
  const features = new Map(ratings.map((item) => [
    `movie:${item.id}`,
    buildRecommendationFeature({
      type: 'movie', id: item.id, title: item.title, taste_tags: item.taste_tags,
    }),
  ]));
  const first = evaluateExplicitRatings(ratings, features);
  const second = evaluateExplicitRatings(ratings, features);
  assert.deepEqual(first, second);
  assert.equal(first.samples, 3);
  assert.ok(first.fire_mae !== null && first.fire_mae >= 0 && first.fire_mae <= 5);
  assert.ok(first.water_mae !== null && first.water_mae >= 0 && first.water_mae <= 5);
  assert.ok(first.affinity_mae !== null && first.affinity_mae >= 0 && first.affinity_mae <= 5);
});

test('evaluation fails closed to zero samples without training evidence', () => {
  const only = rating('only', 5, 5);
  assert.deepEqual(evaluateExplicitRatings([only], new Map([
    ['movie:only', buildRecommendationFeature({ type: 'movie', id: 'only', title: 'only' })],
  ])), {
    samples: 0, fire_mae: null, water_mae: null, affinity_mae: null,
  });
});

test('Household leave-one-out isolates viewers and cannot train on a duplicate held-out title', () => {
  const aliceRatings = [
    rating('target', 5, 5, { profile_id: 'alice' }),
    rating('neighbor', 1, 1, { profile_id: 'alice' }),
  ];
  const features = new Map(['target', 'neighbor'].map((id) => [
    `movie:${id}`,
    buildRecommendationFeature({ type: 'movie', id, title: id, taste_tags: [id] }),
  ]));
  const withoutHouseholdDuplicate = evaluateExplicitRatings(aliceRatings, features);
  const withHouseholdDuplicate = evaluateExplicitRatings([
    ...aliceRatings,
    rating('target', 0, 0, { profile_id: 'bob' }),
  ], features);
  assert.deepEqual(withHouseholdDuplicate, withoutHouseholdDuplicate);
  assert.equal(withHouseholdDuplicate.samples, 2);
});

test('leave-one-out removes every same-viewer duplicate of the held-out title from evidence', () => {
  const ratings = [
    rating('target', 5, 5, { profile_id: 'alice' }),
    rating('target', 5, 5, { profile_id: 'alice' }),
    rating('neighbor', 1, 1, { profile_id: 'alice' }),
  ];
  const target = buildRecommendationFeature({
    type: 'movie', id: 'target', title: 'target', taste_tags: ['target'],
  });
  const neighbor = buildRecommendationFeature({
    type: 'movie', id: 'neighbor', title: 'neighbor', taste_tags: ['neighbor'],
  });
  const features = new Map([
    ['movie:target', target],
    ['movie:neighbor', neighbor],
  ]);
  const targetPrediction = predictAxes({
    candidate: target,
    ratings: [ratings[2]!],
    ratingFeatures: features,
    tab: 'movies',
  });
  const neighborPrediction = predictAxes({
    candidate: neighbor,
    ratings: ratings.slice(0, 2),
    ratingFeatures: features,
    tab: 'movies',
  });
  const result = evaluateExplicitRatings(ratings, features);
  const expectedFireMae = (
    2 * Math.abs(targetPrediction.fire - 5) + Math.abs(neighborPrediction.fire - 1)
  ) / 3;
  const expectedWaterMae = (
    2 * Math.abs(targetPrediction.water - 5) + Math.abs(neighborPrediction.water - 1)
  ) / 3;
  const expectedAffinityMae = (
    2 * Math.abs(holisticAffinity(targetPrediction.fire, targetPrediction.water) - 5)
    + Math.abs(holisticAffinity(neighborPrediction.fire, neighborPrediction.water) - 1)
  ) / 3;
  assert.equal(result.samples, 3);
  assert.equal(result.fire_mae, expectedFireMae);
  assert.equal(result.water_mae, expectedWaterMae);
  assert.equal(result.affinity_mae, expectedAffinityMae);
});

test('slate evaluation reports ranking, diversity, calibration, coverage, language, and fairness', () => {
  const catalogIds = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
    'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
  ];
  const features = catalogIds.slice(0, 6).map((id) => buildRecommendationFeature({
    type: 'movie', id, title: id, taste_tags: [id],
  }));
  const result = evaluateRecommendationSlates([
    {
      profile_id: 'alice',
      relevant_ids: contentIds(contentId('movie', 'alpha'), contentId('movie', 'bravo')),
      eligible_ids: contentIds(...catalogIds.map((id) => contentId('movie', id))),
      target_language_shares: { latin: 0.5, devanagari: 0.5 },
      items: features.map((feature, index) => ({
        id: contentId('movie', feature.id),
        feature,
        bucket: index < 4 ? 'close' as const : index === 4 ? 'adjacent' as const : 'explore' as const,
        language_bucket: index % 2 === 0 ? 'latin' : 'devanagari',
      })),
    },
    {
      profile_id: 'bob',
      relevant_ids: contentIds(contentId('movie', 'alpha'), contentId('movie', 'missing')),
      eligible_ids: contentIds(...catalogIds.map((id) => contentId('movie', id))),
      items: [
        { id: contentId('movie', 'alpha'), bucket: 'close' },
        { id: contentId('movie', 'golf'), bucket: 'close' },
      ],
    },
  ]);
  assert.equal(result.slates, 2);
  assert.equal(result.recall_at_k, 0.75);
  assert.ok(result.ndcg_at_k !== null && result.ndcg_at_k > 0 && result.ndcg_at_k <= 1);
  assert.equal(result.catalog_coverage, 7 / 12);
  assert.ok(result.intra_list_diversity !== null && result.intra_list_diversity > 0);
  assert.equal(result.language_calibration_error, 0);
  assert.equal(result.worst_profile_recall, 0.5);
  assert.equal(result.profile_recall_gap, 0.5);
  assert.ok(result.bucket_calibration_error !== null && result.bucket_calibration_error > 0);
});

test('global coverage stays bounded across disjoint eligible catalogs', () => {
  const result = evaluateRecommendationSlates([
    {
      profile_id: 'alice',
      relevant_ids: contentIds(),
      eligible_ids: contentIds(contentId('movie', 'a'), contentId('movie', 'b')),
      items: [
        { id: contentId('movie', 'a'), bucket: 'close' },
        { id: contentId('movie', 'b'), bucket: 'close' },
      ],
    },
    {
      profile_id: 'bob',
      relevant_ids: contentIds(),
      eligible_ids: contentIds(contentId('series', 'c'), contentId('series', 'd')),
      items: [
        { id: contentId('series', 'c'), bucket: 'close' },
        { id: contentId('series', 'd'), bucket: 'close' },
        { id: contentId('series', 'not-eligible'), bucket: 'fallback' },
      ],
    },
  ]);
  assert.equal(result.catalog_coverage, 1);
  assert.ok(result.catalog_coverage <= 1);
});

test('movie and series IDs with the same opaque value remain distinct', () => {
  const movie = contentId('movie', '42');
  const series = contentId('series', '42');
  const result = evaluateRecommendationSlates([{
    profile_id: 'household',
    relevant_ids: contentIds(movie, series),
    eligible_ids: contentIds(movie, series),
    items: [
      { id: movie, bucket: 'close' },
      { id: series, bucket: 'adjacent' },
    ],
  }]);
  assert.equal(result.recall_at_k, 1);
  assert.equal(result.catalog_coverage, 1);
});

test('empty-relevance slates and viewers are excluded from recall and fairness', () => {
  const relevant = contentId('movie', 'relevant');
  const result = evaluateRecommendationSlates([
    {
      profile_id: 'alice',
      relevant_ids: contentIds(relevant),
      eligible_ids: contentIds(relevant),
      items: [{ id: relevant, bucket: 'close' }],
    },
    {
      profile_id: 'no-ground-truth',
      relevant_ids: contentIds(),
      eligible_ids: contentIds(contentId('movie', 'other')),
      items: [{ id: contentId('movie', 'other'), bucket: 'close' }],
    },
  ]);
  assert.equal(result.recall_at_k, 1);
  assert.equal(result.ndcg_at_k, 1);
  assert.equal(result.worst_profile_recall, 1);
  assert.equal(result.profile_recall_gap, 0);
});

test('empty slate evaluation is explicit rather than fabricating zero quality', () => {
  assert.deepEqual(evaluateRecommendationSlates([]), {
    slates: 0,
    recall_at_k: null,
    ndcg_at_k: null,
    catalog_coverage: null,
    intra_list_diversity: null,
    bucket_calibration_error: null,
    language_calibration_error: null,
    worst_profile_recall: null,
    profile_recall_gap: null,
  });
});
