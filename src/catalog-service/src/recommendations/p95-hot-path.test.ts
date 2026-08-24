import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { storyGraphServingDecision } from './story-graph-service.js';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8');
}

test('activation probe uses bounded sample count, not 100-iteration hot-path loop', () => {
  const graph = source('recommendations/story-graph-service.ts');
  assert.match(graph, /cachedServiceP95Samples\(\)/,
    'sample count must be extracted to a bounded configurable helper');
  assert.match(graph, /MANGO_VOD_STORY_GRAPH_P95_SAMPLES/);
  assert.match(graph, /CACHED_SERVICE_P95_MAX_SAMPLES = 25/);
  assert.equal(
    graph.includes('iteration < 100; iteration += 1'),
    false,
    'the 100-iteration sync p95 probe must be removed from the activation hot path',
  );
});

test('activation persists the p95 measurement for reuse across activations', () => {
  const graph = source('recommendations/story-graph-service.ts');
  assert.match(graph, /vod_story_graph_service_p95:/,
    'measured p95 must be written to recommendation_runtime_state for reuse');
  assert.match(graph, /readCachedServiceP95FromState/);
});

test('non-strict serving decision tolerates unmeasured p95 as evidence_cold_start', () => {
  const prior = process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT;
  delete process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT;
  try {
    const evaluation = {
      version: 'vod-story-frontier-evaluation-v2' as const,
      rank_generation_id: 1,
      status: 'insufficient' as const,
      samples: 0,
      folds: 0,
      holistic_ndcg_at_6: null,
      fire_pairwise_concordance_ge_4: null,
      water_pairwise_concordance_ge_4: null,
      fire_pairwise_comparisons: 0,
      water_pairwise_comparisons: 0,
      low_low_top_6_intrusion_rate: null,
      verified_accounting_complete: true,
      coverage: 1,
      deterministic: true,
      worker_latency_ms: 0,
      cached_service_p95_ms: null,
      promotion_eligible: false,
      reasons: ['insufficient_stratified_ratings', 'ndcg_unavailable'],
      evaluated_at: 1,
    };
    const decision = storyGraphServingDecision(evaluation);
    assert.equal(decision.serve_eligible, true);
    assert.equal(decision.basis, 'evidence_cold_start');
  } finally {
    if (prior === undefined) delete process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT;
    else process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT = prior;
  }
});

test('strict serving decision still blocks on unmeasured p95', () => {
  const prior = process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT;
  process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT = '1';
  try {
    const evaluation = {
      version: 'vod-story-frontier-evaluation-v2' as const,
      rank_generation_id: 1,
      status: 'insufficient' as const,
      samples: 0,
      folds: 0,
      holistic_ndcg_at_6: null,
      fire_pairwise_concordance_ge_4: null,
      water_pairwise_concordance_ge_4: null,
      fire_pairwise_comparisons: 0,
      water_pairwise_comparisons: 0,
      low_low_top_6_intrusion_rate: null,
      verified_accounting_complete: true,
      coverage: 1,
      deterministic: true,
      worker_latency_ms: 0,
      cached_service_p95_ms: null,
      promotion_eligible: false,
      reasons: ['insufficient_stratified_ratings', 'ndcg_unavailable'],
      evaluated_at: 1,
    };
    const decision = storyGraphServingDecision(evaluation);
    assert.equal(decision.serve_eligible, false);
    assert.ok(decision.blockers.includes('cached_service_p95_unmeasured'));
  } finally {
    if (prior === undefined) delete process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT;
    else process.env.MANGO_VOD_STORY_GRAPH_P95_STRICT = prior;
  }
});

test('runtime frontier rerank is gated behind MANGO_VOD_RUNTIME_FRONTIER_RERANK', () => {
  const graph = source('recommendations/story-graph-service.ts');
  assert.match(graph, /runtimeFrontierRerankEnabled/);
  assert.match(graph, /MANGO_VOD_RUNTIME_FRONTIER_RERANK === '1'/);
  // Frontier still processes candidates (runStoryDnaFrontierWorker) so
  // serving-profile and Related dependencies remain fed.
  assert.match(graph, /runStoryDnaFrontierWorker/);
});
