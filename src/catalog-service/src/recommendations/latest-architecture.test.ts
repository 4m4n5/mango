import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8');
}

test('VOD exposes only the progressive frontier serving path', () => {
  const service = source('recommendations/service.ts');
  const graph = source('recommendations/story-graph-service.ts');
  const runtime = `${service}\n${graph}`;

  assert.match(service, /loadStoryGraphForYouRail/);
  assert.match(graph, /VOD_CONTENT_PROFILE_VERSION/);
  assert.match(graph, /VOD_STORY_FRONTIER_MODEL_VERSION/);
  for (const removed of [
    'semantic-hash-v4',
    'MANGO_VOD_CONTENT_PROFILE',
    'MANGO_STORY_DNA_AUTONOMOUS_BACKFILL',
    'refreshRecommendationSnapshot',
    "from './rank-worker-client.js'",
  ]) {
    assert.equal(runtime.includes(removed), false, removed);
  }
});

test('YouTube exposes only provenance-gated v2 recommendation acquisition', () => {
  const service = source('youtube/service.ts');
  const api = source('youtube/api.ts');
  const index = source('index.ts');

  for (const removed of [
    'refreshPopularFromApi',
    'refreshFreshFindsFromApi',
    'rebuildForYouReservoir',
    'youtubeAiCatalogPoolItems',
    "rail_id: 'fresh_finds'",
    "rail_id: 'popular'",
    "rail_id: 'because_you_watched'",
    '/youtube/fresh-start',
    "chart: 'mostPopular'",
  ]) {
    assert.equal(`${service}\n${api}\n${index}`.includes(removed), false, removed);
  }
  assert.match(service, /youtubeV2RecommendationRails/);
  assert.match(service, /upsertYoutubeV2CandidateProvenance/);
});

test('cleanup preserves historical schemas but exposes no destructive reset', () => {
  const db = source('youtube/db.ts');
  assert.match(db, /CREATE TABLE IF NOT EXISTS youtube_for_you_candidates/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS youtube_popular_candidates/);
  assert.equal(db.includes('clearYoutubePersonalizationReservoirs'), false);
  assert.equal(db.includes('DELETE FROM youtube_for_you_candidates'), false);
  assert.equal(db.includes('DELETE FROM youtube_popular_candidates'), false);
});
