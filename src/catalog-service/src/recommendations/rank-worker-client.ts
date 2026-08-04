import { Worker } from 'node:worker_threads';
import {
  rankRecommendations,
  type RankRecommendationsInput,
  type ScoredRecommendation,
} from './engine.js';

type RankWorkerResponse =
  | { ok: true; result: ScoredRecommendation[] }
  | { ok: false; error: string };

type RankWorkerHandle = {
  once(event: 'message', listener: (message: RankWorkerResponse) => void): RankWorkerHandle;
  once(event: 'error', listener: (error: Error) => void): RankWorkerHandle;
  once(event: 'exit', listener: (code: number) => void): RankWorkerHandle;
  terminate(): Promise<number>;
};

function rankTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.MANGO_RECOMMENDATION_RANK_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(120_000, parsed)) : 30_000;
}

async function terminateWorker(worker: RankWorkerHandle): Promise<void> {
  try {
    await worker.terminate();
  } catch {
    // Preserve the ranking failure that initiated teardown. A failed terminate
    // must never replace it with a second, less useful rejection.
  }
}

/** @internal Exported only so worker lifecycle failure paths stay deterministic under test. */
export function awaitRankWorkerResult(
  worker: RankWorkerHandle,
  timeoutMs: number,
): Promise<ScoredRecommendation[]> {
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
      finish(() => reject(new Error('recommendation ranking exceeded its background deadline')));
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
          ? 'recommendation rank worker exited before returning a result'
          : `recommendation rank worker exited ${code}`,
      )),
      { terminate: false },
    ));
  });
}

/** Keep CPU-heavy scoring/MMR off the catalog HTTP event loop on the Pi. */
export function rankRecommendationsOffThread(
  input: RankRecommendationsInput,
): Promise<ScoredRecommendation[]> {
  if (process.env.MANGO_RECOMMENDATION_RANK_WORKER === '0') {
    return Promise.resolve(rankRecommendations(input));
  }
  const worker = new Worker(new URL('./rank-worker.js', import.meta.url), { workerData: input });
  return awaitRankWorkerResult(worker, rankTimeoutMs());
}
