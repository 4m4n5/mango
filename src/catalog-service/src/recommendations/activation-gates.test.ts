import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildColdStartTopPicksSlate,
  evaluateActivationGates,
} from './activation-gates.js';
import type { StoryGraphOfflineEvaluation } from './story-graph-service.js';

function evaluation(
  overrides: Partial<StoryGraphOfflineEvaluation> = {},
): StoryGraphOfflineEvaluation {
  return {
    version: 'vod-story-frontier-evaluation-v2',
    rank_generation_id: 1,
    status: 'passed',
    samples: 20,
    folds: 5,
    holistic_ndcg_at_6: 0.8,
    fire_pairwise_concordance_ge_4: 0.7,
    water_pairwise_concordance_ge_4: 0.7,
    fire_pairwise_comparisons: 20,
    water_pairwise_comparisons: 20,
    low_low_top_6_intrusion_rate: 0.1,
    verified_accounting_complete: true,
    coverage: 1,
    deterministic: true,
    worker_latency_ms: 30_000,
    cached_service_p95_ms: 100,
    promotion_eligible: true,
    reasons: [],
    evaluated_at: 1,
    ...overrides,
  };
}

const OK: Parameters<typeof evaluateActivationGates>[0] = {
  evaluation: evaluation(),
  reserve_depth: 200,
  playability_minimum_reserve: 60,
  peak_rss_bytes: 900 * 1024 * 1024,
  wall_time_ms: 200_000,
  max_rss_bytes: 1024 * 1024 * 1024,
  max_wall_time_ms: 900_000,
  offline_relevance_samples: 20,
};

test('activation gate approves an evaluated, in-budget generation', () => {
  const decision = evaluateActivationGates(OK);
  assert.deepEqual(decision, { activate: true, basis: 'evaluated', blockers: [] });
});

test('activation gate blocks on accounting drift, replay failure, and reserve deficit', () => {
  const decision = evaluateActivationGates({
    ...OK,
    evaluation: evaluation({
      verified_accounting_complete: false,
      deterministic: false,
    }),
    reserve_depth: 10,
  });
  assert.equal(decision.activate, false);
  assert.equal(decision.basis, 'blocked');
  assert.ok(decision.blockers.includes('verified_corpus_accounting_incomplete'));
  assert.ok(decision.blockers.includes('determinism_replay_failed'));
  assert.ok(decision.blockers.includes('reserve_below_playability_minimum'));
});

test('activation gate blocks on resource envelope breach', () => {
  const decision = evaluateActivationGates({
    ...OK,
    peak_rss_bytes: 2 * 1024 * 1024 * 1024,
    wall_time_ms: 1_800_000,
  });
  assert.equal(decision.activate, false);
  assert.ok(decision.blockers.includes('peak_rss_exceeded'));
  assert.ok(decision.blockers.includes('wall_time_exceeded'));
});

test('activation gate tolerates unmeasured p95 as cold start unless strict', () => {
  const evalWithoutP95 = evaluation({
    cached_service_p95_ms: null,
    promotion_eligible: false,
    reasons: ['insufficient_stratified_ratings', 'ndcg_unavailable'],
  });
  const nonStrict = evaluateActivationGates({ ...OK, evaluation: evalWithoutP95 });
  assert.equal(nonStrict.activate, true);
  assert.equal(nonStrict.basis, 'evidence_cold_start');
  const strict = evaluateActivationGates({
    ...OK, evaluation: evalWithoutP95, strict_p95: true,
  });
  assert.equal(strict.activate, false);
  assert.ok(strict.blockers.includes('cached_service_p95_unmeasured'));
});

test('activation gate tolerates unmeasured p95 when it is the sole non-strict gap', () => {
  const decision = evaluateActivationGates({
    ...OK,
    evaluation: evaluation({
      cached_service_p95_ms: null,
      promotion_eligible: false,
      reasons: ['cached_service_p95_unmeasured'],
    }),
  });
  assert.deepEqual(decision, {
    activate: true,
    basis: 'evidence_cold_start',
    blockers: [],
  });
});

test('activation gate blocks on missing offline relevance samples', () => {
  const decision = evaluateActivationGates({ ...OK, offline_relevance_samples: 0 });
  assert.equal(decision.activate, false);
  assert.ok(decision.blockers.includes('offline_relevance_unavailable'));
});

test('cold start Top Picks is deterministic and honors exclusions', () => {
  const first = buildColdStartTopPicksSlate({
    tab: 'movies',
    verified_titles: [
      { id: 'b', title: 'Beta', poster: 'p/b.jpg', score: 3 },
      { id: 'a', title: 'Alpha', poster: 'p/a.jpg', score: 5 },
      { id: 'c', title: 'Charlie', poster: 'p/c.jpg', score: 5 },
      { id: 'd', title: 'Delta', poster: 'p/d.jpg', score: 1 },
    ],
    limit: 3,
  });
  const second = buildColdStartTopPicksSlate({
    tab: 'movies',
    verified_titles: [
      { id: 'c', title: 'Charlie', poster: 'p/c.jpg', score: 5 },
      { id: 'd', title: 'Delta', poster: 'p/d.jpg', score: 1 },
      { id: 'a', title: 'Alpha', poster: 'p/a.jpg', score: 5 },
      { id: 'b', title: 'Beta', poster: 'p/b.jpg', score: 3 },
    ],
    limit: 3,
  });
  assert.deepEqual(first.items.map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(second.items.map((item) => item.id), first.items.map((item) => item.id),
    'Top Picks must be deterministic under input reorder');

  const excluded = buildColdStartTopPicksSlate({
    tab: 'series',
    verified_titles: first.items.map((item) => ({ ...item, score: 1 })),
    exclude: new Set(['a']),
  });
  assert.equal(excluded.items.some((item) => item.id === 'a'), false);
  assert.equal(excluded.rail_id, 'for-you-series');
});
