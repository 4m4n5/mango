import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { buildRecommendationFeature, rankRecommendations } from './engine.js';
import {
  awaitRankWorkerResult,
  rankRecommendationsOffThread,
} from './rank-worker-client.js';

class FakeRankWorker extends EventEmitter {
  terminateCalls = 0;

  async terminate(): Promise<number> {
    this.terminateCalls += 1;
    return 1;
  }
}

function awaitFakeWorker(worker: FakeRankWorker, timeoutMs = 1_000) {
  return awaitRankWorkerResult(
    worker as unknown as Parameters<typeof awaitRankWorkerResult>[0],
    timeoutMs,
  );
}

test('worker ranking is byte-for-byte equivalent to deterministic in-process ranking', async () => {
  const input = {
    tab: 'movies' as const,
    candidates: Array.from({ length: 16 }, (_, index) => buildRecommendationFeature({
      type: 'movie',
      id: `candidate-${index}`,
      title: `Candidate ${index}`,
      rail_ids: [`topic-${index % 5}`, index % 2 === 0 ? 'warm' : 'tense'],
    })),
    ratings: [],
    ratingFeatures: new Map(),
    implicitPreferences: [],
    implicitPreferenceGroups: [],
    negativePreferences: [],
    dailySeed: 'worker-parity-seed',
    limit: 12,
    visibleLimit: 6,
  };
  assert.deepEqual(await rankRecommendationsOffThread(input), rankRecommendations(input));
});

test('worker opt-out preserves the same deterministic contract', async () => {
  const previous = process.env.MANGO_RECOMMENDATION_RANK_WORKER;
  process.env.MANGO_RECOMMENDATION_RANK_WORKER = '0';
  try {
    const input = {
      tab: 'series' as const,
      candidates: Array.from({ length: 8 }, (_, index) => buildRecommendationFeature({
        type: 'series', id: `series-${index}`, title: `Series ${index}`,
      })),
      ratings: [],
      ratingFeatures: new Map(),
      dailySeed: 'worker-opt-out',
      limit: 6,
      visibleLimit: 6,
    };
    assert.deepEqual(await rankRecommendationsOffThread(input), rankRecommendations(input));
  } finally {
    if (previous === undefined) delete process.env.MANGO_RECOMMENDATION_RANK_WORKER;
    else process.env.MANGO_RECOMMENDATION_RANK_WORKER = previous;
  }
});

test('worker timeout terminates exactly once and publishes no late result', async () => {
  const worker = new FakeRankWorker();
  const result = awaitFakeWorker(worker, 5);

  await assert.rejects(result, /exceeded its background deadline/);
  assert.equal(worker.terminateCalls, 1);
  worker.emit('message', { ok: true, result: [] });
  assert.equal(worker.terminateCalls, 1);
});

test('worker error terminates exactly once and preserves the original failure', async () => {
  const worker = new FakeRankWorker();
  const result = awaitFakeWorker(worker);

  worker.emit('error', new Error('worker exploded'));
  await assert.rejects(result, /worker exploded/);
  assert.equal(worker.terminateCalls, 1);
  worker.emit('exit', 1);
  assert.equal(worker.terminateCalls, 1);
});

test('clean worker exit without a result rejects instead of waiting for the deadline', async () => {
  const worker = new FakeRankWorker();
  const result = awaitFakeWorker(worker);

  worker.emit('exit', 0);
  await assert.rejects(result, /exited before returning a result/);
  assert.equal(worker.terminateCalls, 0);
});

test('failed ranking cannot replace caller-owned last-good output and a later worker recovers', async () => {
  const lastGood = [{ id: 'last-good' }];
  let published: Array<{ id: string }> = lastGood;
  const malformedInput = {
    tab: 'movies' as const,
    candidates: [buildRecommendationFeature({ type: 'movie', id: 'candidate', title: 'Candidate' })],
    ratings: [{
      profile_id: 'household', type: 'movie' as const, id: 'rated', title: 'Rated', year: null,
      fire: 5 as const, water: 5 as const, revision: 1, origin: 'couch' as const,
      taste_tags: [], updated_at: 1,
    }],
    // Deliberately violates the cloned worker contract so the worker reports
    // a ranking error rather than returning a partial/unsafe slate.
    ratingFeatures: {} as Map<string, ReturnType<typeof buildRecommendationFeature>>,
    dailySeed: 'worker-failure',
  };

  await assert.rejects(async () => {
    published = await rankRecommendationsOffThread(malformedInput);
  }, /ratingFeatures\.get is not a function/);
  assert.strictEqual(published, lastGood);

  const healthyInput = {
    ...malformedInput,
    ratings: [],
    ratingFeatures: new Map(),
    dailySeed: 'worker-recovery',
  };
  const recovered = await rankRecommendationsOffThread(healthyInput);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]!.id, 'candidate');
});
