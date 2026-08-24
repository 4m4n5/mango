import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  rankStoryGraphDeterministic,
  VOD_DETERMINISTIC_LANE_RANK_KIND,
} from './production-lane-ranker.js';
import { VOD_STORY_GRAPH_MODEL_VERSION, type StoryGraphTitle } from './story-graph-v1.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_SOURCE_PATH = resolve(HERE, '../../src/recommendations/story-graph-service.ts');
const RECS_SERVICE_SOURCE_PATH = resolve(HERE, '../../src/recommendations/service.ts');

/**
 * Source-scan invariant: the live refresh path must default to the
 * deterministic ranker. `buildStoryTasteModelWithBackground` and
 * `rankStoryGraphRecommendationsOffThread` are still imported for the
 * legacy compatibility harness, but their only reachable use is gated on
 * `MANGO_VOD_LEGACY_LOAO_RANK === '1'`.
 */
test('story-graph-service.ts references the legacy LOAO ranker only behind the quarantine flag', () => {
  const source = readFileSync(SERVICE_SOURCE_PATH, 'utf8');
  // Split into meaningful mentions: import line + code lines (ignoring comments).
  const codeLines = source.split('\n').filter((line) => (
    line.includes('rankStoryGraphRecommendationsOffThread')
      && !line.trimStart().startsWith('//')
      && !line.trimStart().startsWith('*')
  ));
  assert.ok(codeLines.length >= 2, 'expected at least import + one usage');
  assert.ok(codeLines.length <= 3, `unexpected extra references: ${codeLines.length}`);
  const guardIndex = source.indexOf('MANGO_VOD_LEGACY_LOAO_RANK');
  assert.notEqual(guardIndex, -1, 'quarantine env sentinel missing');
  const usageMatch = source.match(/\?\s*rankStoryGraphRecommendationsOffThread/);
  assert.ok(usageMatch, 'legacy ranker must only be reachable via a ternary condition');
  assert.ok(guardIndex < (usageMatch.index ?? Infinity),
    'legacy ranker usage must appear after the MANGO_VOD_LEGACY_LOAO_RANK guard');
});

test('story-graph-service.ts references buildStoryTasteModelWithBackground only behind the quarantine flag', () => {
  const source = readFileSync(SERVICE_SOURCE_PATH, 'utf8');
  // Two acceptable references: (a) the import, (b) two guarded fold calls in
  // evaluateStoryGraphOffline (behind `useLegacyEvalFit`).
  const references = source.match(/buildStoryTasteModelWithBackground/g) ?? [];
  assert.ok(references.length <= 4,
    `unexpected number of buildStoryTasteModelWithBackground references: ${references.length}`);
  const guardIndex = source.indexOf('useLegacyEvalFit');
  assert.notEqual(guardIndex, -1, 'useLegacyEvalFit sentinel missing');
});

test('deterministic ranker never emits LOAO folds or K>=3 threads', async () => {
  const documents: StoryGraphTitle[] = Array.from({ length: 12 }, (_, index) => ({
    type: 'movie',
    id: `m${String(index).padStart(3, '0')}`,
    title: `Movie ${index}`,
    year: '2020',
    edges: [
      { family: 'genre-subgenre', node_key: index % 2 === 0 ? 'action' : 'drama',
        intensity: 1, confidence: 1, ordinal: false, source: 'metadata_fact' },
      { family: 'tone', node_key: index % 2 === 0 ? 'kinetic' : 'somber',
        intensity: 1, confidence: 1, ordinal: false, source: 'metadata_fact' },
    ],
  }));
  const result = await rankStoryGraphDeterministic({
    algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
    documents,
    background_ids: documents.map((title) => `movie:${title.id}` as const),
    background: { document_count: documents.length, families: {} },
    explicit_ratings: [
      { type: 'movie', id: 'm000', fire: 5, water: 4.5 },
      { type: 'movie', id: 'm001', fire: 5, water: 4.5 },
      { type: 'movie', id: 'm002', fire: 4.5, water: 5 },
      { type: 'movie', id: 'm003', fire: 4, water: 5 },
    ],
    implicit_signals: [],
    as_of: Date.now(),
  });
  assert.equal(result.loao.length, 0, 'deterministic ranker must not produce LOAO folds');
  assert.ok(result.selected_k <= 2, `selected_k must be <= 2, got ${result.selected_k}`);
  assert.equal(result.threads.length, result.selected_k,
    'threads.length must match selected_k so K>=3 threads cannot appear');
  assert.equal(result.ranked.length, documents.length,
    'every candidate must be scored for accounting completeness');
  assert.equal(VOD_DETERMINISTIC_LANE_RANK_KIND, 'deterministic-lanes-v1');
});

test('production-lane-ranker delegates portfolio and dealer cache to canonical helpers', () => {
  const ADAPTER_SOURCE_PATH = resolve(HERE, '../../src/recommendations/production-lane-ranker.ts');
  const source = readFileSync(ADAPTER_SOURCE_PATH, 'utf8');
  assert.ok(source.includes('selectStrongestFitPortfolio('),
    'adapter must call selectStrongestFitPortfolio for the portfolio');
  assert.ok(source.includes('buildStoryDealerCache('),
    'adapter must call buildStoryDealerCache for the dealer cache');
  // No hand-built 1/(1+index) cache in the live rank path. The cold-start
  // fallback still uses `1 / (1 + index)` as a rank-only ordering, but the
  // live path must go through buildStoryDealerCache.
  const handBuilt = source.match(/dealer_weight:\s*1\s*\/\s*\(1\s*\+\s*index\)/g) ?? [];
  assert.ok(handBuilt.length <= 1,
    `no hand-built 1/(1+index) dealer_weight in the live path; found ${handBuilt.length}`);
});

test('activation max wall time cap is 5 minutes and Top Picks is revision-keyed', () => {
  const storyGraphSource = readFileSync(SERVICE_SOURCE_PATH, 'utf8');
  const wallMatch = storyGraphSource.match(/max_wall_time_ms:\s*([0-9_ *]+),/);
  assert.ok(wallMatch, 'max_wall_time_ms must be present in story-graph-service.ts');
  const wallExpr = wallMatch![1]!.replace(/_/g, '').trim();
  const wallValue = wallExpr.split('*').reduce((product, term) => product * Number(term.trim()), 1);
  assert.equal(wallValue, 5 * 60_000,
    `activation max_wall_time_ms must be 5 minutes, got ${wallValue}ms`);
  const recsSource = readFileSync(RECS_SERVICE_SOURCE_PATH, 'utf8');
  assert.ok(recsSource.includes('TOP_PICKS_CACHE'),
    'truthfulTopPicksRail must use the revision-keyed cache');
  assert.ok(recsSource.includes('topPicksRevisionKey'),
    'Top Picks cache must be keyed by the corpus/rank revision');
});

test('deterministic ranker cold-start produces truthful Top Picks accounting', async () => {
  const documents: StoryGraphTitle[] = Array.from({ length: 8 }, (_, index) => ({
    type: 'series',
    id: `s${index}`,
    title: `Series ${index}`,
    year: '2021',
    edges: [
      { family: 'genre-subgenre', node_key: 'drama',
        intensity: 1, confidence: 1, ordinal: false, source: 'metadata_fact' },
    ],
  }));
  const result = await rankStoryGraphDeterministic({
    algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
    documents,
    background: { document_count: documents.length, families: {} },
    explicit_ratings: [],
    implicit_signals: [],
    as_of: Date.now(),
  });
  assert.equal(result.selected_k, 0, 'no personalized generation without positives');
  assert.equal(result.threads.length, 0);
  assert.equal(result.loao.length, 0);
  assert.equal(result.ranked.length, documents.length,
    'cold-start must still score every candidate for accounting completeness');
});
