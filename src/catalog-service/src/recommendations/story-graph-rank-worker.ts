import { parentPort, workerData } from 'node:worker_threads';
import {
  rankStoryGraphRecommendations,
  type StoryGraphRankInput,
  type StoryGraphRankResult,
} from './story-graph-v1.js';

export type StoryGraphRankWorkerResponse =
  | { ok: true; result: StoryGraphRankResult }
  | { ok: false; error: string };

if (parentPort === null) throw new Error('story graph rank worker requires a parent port');

try {
  const result = rankStoryGraphRecommendations(workerData as StoryGraphRankInput);
  parentPort.postMessage({ ok: true, result } satisfies StoryGraphRankWorkerResponse);
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : 'story graph ranking failed',
  } satisfies StoryGraphRankWorkerResponse);
}
