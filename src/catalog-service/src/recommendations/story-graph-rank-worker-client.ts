import { Worker } from 'node:worker_threads';
import {
  rankStoryGraphRecommendations,
  type StoryGraphRankInput,
  type StoryGraphRankResult,
} from './story-graph-v1.js';
import type { StoryGraphRankWorkerResponse } from './story-graph-rank-worker.js';

type StoryGraphRankWorkerHandle = {
  once(
    event: 'message',
    listener: (message: StoryGraphRankWorkerResponse) => void,
  ): StoryGraphRankWorkerHandle;
  once(event: 'error', listener: (error: Error) => void): StoryGraphRankWorkerHandle;
  once(event: 'exit', listener: (code: number) => void): StoryGraphRankWorkerHandle;
  terminate(): Promise<number>;
};

function storyGraphRankTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.MANGO_STORY_GRAPH_RANK_TIMEOUT_MS
      ?? process.env.MANGO_RECOMMENDATION_RANK_TIMEOUT_MS
      ?? '',
    10,
  );
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(120_000, parsed)) : 30_000;
}

async function terminateWorker(worker: StoryGraphRankWorkerHandle): Promise<void> {
  try {
    await worker.terminate();
  } catch {
    // Preserve the original ranking failure if teardown also fails.
  }
}

/** @internal Exported so lifecycle failures remain deterministic under test. */
export function awaitStoryGraphRankWorkerResult(
  worker: StoryGraphRankWorkerHandle,
  timeoutMs: number,
): Promise<StoryGraphRankResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (
      fn: () => void,
      options: { terminate?: boolean } = { terminate: true },
    ): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      const teardown = options.terminate === false
        ? Promise.resolve()
        : terminateWorker(worker);
      void teardown.then(fn);
    };
    timer = setTimeout(() => {
      finish(() => reject(new Error('story graph ranking exceeded its background deadline')));
    }, timeoutMs);
    worker.once('message', (message) => {
      finish(() => {
        if (message.ok) resolve(message.result);
        else reject(new Error(message.error));
      });
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => finish(
      () => reject(new Error(
        code === 0
          ? 'story graph rank worker exited before returning a result'
          : `story graph rank worker exited ${code}`,
      )),
      { terminate: false },
    ));
  });
}

/** Run full-corpus Story Graph fitting/ranking outside the catalog HTTP loop. */
export function rankStoryGraphRecommendationsOffThread(
  input: StoryGraphRankInput,
): Promise<StoryGraphRankResult> {
  if (process.env.MANGO_RECOMMENDATION_RANK_WORKER === '0') {
    return Promise.resolve(rankStoryGraphRecommendations(input));
  }
  const worker = new Worker(new URL('./story-graph-rank-worker.js', import.meta.url), {
    workerData: input,
  });
  return awaitStoryGraphRankWorkerResult(worker, storyGraphRankTimeoutMs());
}
