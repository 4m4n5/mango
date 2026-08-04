import { parentPort, workerData } from 'node:worker_threads';
import {
  rankRecommendations,
  type RankRecommendationsInput,
  type ScoredRecommendation,
} from './engine.js';

type RankWorkerResponse =
  | { ok: true; result: ScoredRecommendation[] }
  | { ok: false; error: string };

if (parentPort === null) throw new Error('recommendation rank worker requires a parent port');

try {
  const result = rankRecommendations(workerData as RankRecommendationsInput);
  parentPort.postMessage({ ok: true, result } satisfies RankWorkerResponse);
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : 'recommendation ranking failed',
  } satisfies RankWorkerResponse);
}
