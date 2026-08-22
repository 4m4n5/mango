import assert from 'node:assert/strict';
import test from 'node:test';
import { rankStoryGraphDeterministic } from './production-lane-ranker.js';
import {
  VOD_STORY_GRAPH_MODEL_VERSION,
  type StoryGraphContentId,
  type StoryGraphTitle,
} from './story-graph-v1.js';

const NOW = 1_800_000_000_000;

function title(id: string, node: string): StoryGraphTitle {
  return {
    type: 'movie',
    id,
    title: id,
    edges: [{
      family: 'genre-subgenre',
      node_key: node,
      intensity: 1,
      confidence: 1,
      ordinal: false,
      source: 'metadata',
    }],
  };
}

test('persisted deterministic thread uplifts remain within the schema 0..1 contract', async () => {
  const anchor = title('anchor', 'genre:drama');
  const candidates = Array.from({ length: 8 }, (_, index) => (
    title(`candidate-${index}`, index % 2 === 0 ? 'genre:drama' : 'genre:comedy')
  ));
  const result = await rankStoryGraphDeterministic({
    algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
    documents: [anchor, ...candidates],
    background_ids: candidates.map((candidate) => `movie:${candidate.id}` as StoryGraphContentId),
    candidate_ids: candidates.map((candidate) => `movie:${candidate.id}` as StoryGraphContentId),
    explicit_ratings: [{
      type: 'movie',
      id: anchor.id,
      fire: 5,
      water: 2,
    }],
    as_of: NOW,
  });

  assert.equal(result.selected_k, 1);
  assert.equal(result.threads.length, 1);
  for (const thread of result.threads) {
    assert.ok(thread.fire_uplift >= 0 && thread.fire_uplift <= 1);
    assert.ok(thread.water_uplift >= 0 && thread.water_uplift <= 1);
  }
  assert.equal(result.threads[0]!.water_uplift, 0);
});
