import { Worker } from 'node:worker_threads';
import {
  buildStoryDealerCache,
  buildStoryGraphBackground,
  rankStoryGraphRecommendations,
  scoredRecommendationCompare,
  selectStrongestFitPortfolio,
  VOD_STORY_GRAPH_MODEL_VERSION,
  type StoryGraphContentId,
  type StoryGraphRankInput,
  type StoryGraphRankResult,
  type StoryGraphTitle,
} from './story-graph-v1.js';
import type {
  StoryGraphRankWorkerRequest,
  StoryGraphRankWorkerResponse,
} from './story-graph-rank-worker.js';

type StoryGraphRankWorkerHandle = {
  once(event: 'message', listener: (message: StoryGraphRankWorkerResponse) => void): StoryGraphRankWorkerHandle;
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
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(15 * 60_000, parsed)) : 15 * 60_000;
}

export function storyGraphRankPageSize(): number {
  const parsed = Number.parseInt(process.env.MANGO_VOD_RANK_PAGE_SIZE ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(32, Math.min(256, parsed)) : 128;
}

async function terminateWorker(worker: StoryGraphRankWorkerHandle): Promise<void> {
  try {
    await worker.terminate();
  } catch {
    // Preserve the original ranking failure if teardown also fails.
  }
}

/** @internal Compatibility harness for deterministic lifecycle tests. */
export function awaitStoryGraphRankWorkerResult(
  worker: StoryGraphRankWorkerHandle,
  timeoutMs: number,
): Promise<StoryGraphRankResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (fn: () => void, terminate = true): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      void (terminate ? terminateWorker(worker) : Promise.resolve()).then(fn);
    };
    timer = setTimeout(() => finish(
      () => reject(new Error('story graph ranking exceeded its background deadline')),
    ), timeoutMs);
    worker.once('message', (message) => finish(() => {
      if ('ok' in message && message.ok) resolve(message.result);
      else if ('ok' in message) reject(new Error(message.error));
      else reject(new Error('story graph rank worker returned an unexpected protocol message'));
    }));
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => finish(() => reject(new Error(
      code === 0
        ? 'story graph rank worker exited before returning a result'
        : `story graph rank worker exited ${code}`,
    )), false));
  });
}

function key(title: Pick<StoryGraphTitle, 'type' | 'id'>): StoryGraphContentId {
  return `${title.type}:${title.id}`;
}

function protocolMessage(
  worker: Worker,
  request: StoryGraphRankWorkerRequest,
  accept: (response: StoryGraphRankWorkerResponse) => boolean,
  timeoutMs: number,
): Promise<StoryGraphRankWorkerResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('story graph ranking exceeded its background deadline'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = (response: StoryGraphRankWorkerResponse): void => {
      if ('kind' in response && response.kind === 'error') {
        cleanup();
        reject(new Error(response.error));
      } else if (accept(response)) {
        cleanup();
        resolve(response);
      }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const onExit = (code: number): void => {
      cleanup();
      reject(new Error(`story graph rank worker exited ${code} before completing ${request.kind}`));
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage(request);
  });
}

/**
 * Fit once and score bounded pages. Only compact priors/anchors initialize the
 * worker; a full corpus is never passed through workerData or one message.
 */
export async function rankStoryGraphRecommendationsOffThread(
  input: StoryGraphRankInput,
): Promise<StoryGraphRankResult> {
  if (process.env.MANGO_RECOMMENDATION_RANK_WORKER === '0') {
    return rankStoryGraphRecommendations(input);
  }
  const documents = new Map(input.documents.map((title) => [key(title), title]));
  const backgroundIds = input.background_ids ?? [...documents.keys()];
  const background = input.background ?? buildStoryGraphBackground(backgroundIds.map((id) => {
    const title = documents.get(id);
    if (!title) throw new Error(`StoryDNA background has no document: ${id}`);
    return title;
  }));
  const anchorIds = new Set<StoryGraphContentId>([
    ...input.explicit_ratings.map((rating) => `${rating.type}:${rating.id}` as StoryGraphContentId),
    ...(input.implicit_signals ?? []).map((signal) => `${signal.type}:${signal.id}` as StoryGraphContentId),
  ]);
  const anchors = [...anchorIds].flatMap((id) => {
    const title = documents.get(id);
    return title ? [title] : [];
  });
  const candidateIds = input.candidate_ids ?? [...documents.keys()];
  const worker = new Worker(new URL('./story-graph-rank-worker.js', import.meta.url));
  const timeoutMs = storyGraphRankTimeoutMs();
  try {
    const initialized = await protocolMessage(worker, {
      kind: 'initialize',
      background,
      anchors,
      explicit_ratings: input.explicit_ratings,
      implicit_signals: input.implicit_signals ?? [],
      as_of: input.as_of,
    }, (response) => 'kind' in response && response.kind === 'initialized', timeoutMs);
    if (!('kind' in initialized) || initialized.kind !== 'initialized') {
      throw new Error('rank worker initialization failed');
    }
    const ranked = [] as StoryGraphRankResult['ranked'];
    const pageSize = storyGraphRankPageSize();
    for (let offset = 0; offset < candidateIds.length; offset += pageSize) {
      const ids = candidateIds.slice(offset, offset + pageSize);
      const titles = ids.map((id) => {
        const title = documents.get(id);
        if (!title) throw new Error(`story graph candidate has no document: ${id}`);
        return title;
      });
      const response = await protocolMessage(worker, {
        kind: 'score', request_id: offset / pageSize, titles,
      }, (message) => 'kind' in message && message.kind === 'scored'
        && message.request_id === offset / pageSize, timeoutMs);
      if (!('kind' in response) || response.kind !== 'scored') {
        throw new Error('rank worker scoring failed');
      }
      ranked.push(...response.rows);
      await input.on_page?.(Math.min(offset + titles.length, candidateIds.length), candidateIds.length);
    }
    ranked.sort(scoredRecommendationCompare);
    const threadOrder = initialized.model.threads.map((thread) => thread.thread_id);
    await protocolMessage(worker, { kind: 'finish' }, (response) => (
      'kind' in response && response.kind === 'finished'
    ), timeoutMs);
    return {
      model_version: VOD_STORY_GRAPH_MODEL_VERSION,
      background: initialized.model.background,
      selected_k: initialized.model.selected_k,
      threads: initialized.model.threads,
      ranked,
      portfolio: selectStrongestFitPortfolio(ranked, threadOrder),
      dealer_cache: buildStoryDealerCache(ranked, threadOrder),
      loao: initialized.model.loao,
      diagnostics: initialized.model.diagnostics,
    };
  } finally {
    await terminateWorker(worker);
  }
}
