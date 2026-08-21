import { parentPort } from 'node:worker_threads';
import {
  buildStoryTasteModelWithBackground,
  scoreStoryGraphCandidate,
  type StoryGraphBackground,
  type StoryGraphExplicitRating,
  type StoryGraphImplicitSignal,
  type StoryGraphScoredRecommendation,
  type StoryGraphTitle,
  type StoryTasteModel,
} from './story-graph-v1.js';

export type StoryGraphRankWorkerRequest =
  | {
    kind: 'initialize';
    background: StoryGraphBackground;
    anchors: StoryGraphTitle[];
    explicit_ratings: StoryGraphExplicitRating[];
    implicit_signals: StoryGraphImplicitSignal[];
    as_of: number;
  }
  | { kind: 'score'; request_id: number; titles: StoryGraphTitle[] }
  | { kind: 'finish' };

export type StoryGraphRankWorkerResponse =
  | { ok: true; result: import('./story-graph-v1.js').StoryGraphRankResult }
  | { ok: false; error: string }
  | { kind: 'initialized'; model: StoryTasteModel }
  | { kind: 'scored'; request_id: number; rows: StoryGraphScoredRecommendation[] }
  | { kind: 'finished' }
  | { kind: 'error'; request_id?: number; error: string };

if (parentPort === null) throw new Error('story graph rank worker requires a parent port');

let model: StoryTasteModel | null = null;

parentPort.on('message', (message: StoryGraphRankWorkerRequest) => {
  try {
    if (message.kind === 'initialize') {
      model = buildStoryTasteModelWithBackground({
        documents: message.anchors,
        background: message.background,
        explicit_ratings: message.explicit_ratings,
        implicit_signals: message.implicit_signals,
        as_of: message.as_of,
      });
      parentPort!.postMessage({ kind: 'initialized', model } satisfies StoryGraphRankWorkerResponse);
      return;
    }
    if (message.kind === 'score') {
      if (!model) throw new Error('story graph rank worker was not initialized');
      parentPort!.postMessage({
        kind: 'scored',
        request_id: message.request_id,
        rows: message.titles.map((title) => scoreStoryGraphCandidate(model!, title)),
      } satisfies StoryGraphRankWorkerResponse);
      return;
    }
    parentPort!.postMessage({ kind: 'finished' } satisfies StoryGraphRankWorkerResponse);
    parentPort!.close();
  } catch (error) {
    parentPort!.postMessage({
      kind: 'error',
      request_id: message.kind === 'score' ? message.request_id : undefined,
      error: error instanceof Error ? error.message : 'story graph ranking failed',
    } satisfies StoryGraphRankWorkerResponse);
  }
});
