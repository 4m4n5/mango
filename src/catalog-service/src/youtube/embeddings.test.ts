import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetYoutubeDbForTests, upsertYoutubeItems } from './db.js';
import {
  cosineSimilarity,
  embeddingForItem,
  embeddingRelationFactor,
  hashEmbedText,
  maxTasteSimilarity,
  maybeRefreshYoutubeEmbeddings,
  youtubeEmbeddingBackend,
  youtubeEmbeddingModelId,
  youtubeEmbeddingsEnabled,
  youtubeMiniLmModelReady,
  youtubeSimilarityMode,
} from './embeddings.js';
import type { YoutubeItem } from './types.js';

function video(id: string, title: string): YoutubeItem {
  return {
    id,
    kind: 'video',
    title,
    subtitle: 'Kitchen',
    description: null,
    thumbnail: `https://img.example/${id}.jpg`,
    channel_id: 'channel-1',
    channel_title: 'Kitchen channel',
    published_at: '2026-07-01T00:00:00Z',
    duration_sec: 600,
    live_status: 'none',
    playlist_id: null,
    updated_at: Date.now(),
  };
}

function withTempYoutube<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-embed-'));
  const previous = {
    db: process.env.MANGO_YOUTUBE_DB_PATH,
    embeddings: process.env.MANGO_YOUTUBE_EMBEDDINGS,
    sim: process.env.MANGO_YOUTUBE_SIM,
    backend: process.env.MANGO_YOUTUBE_EMBED_BACKEND,
    cache: process.env.MANGO_EMBEDDINGS_CACHE,
    remote: process.env.MANGO_YOUTUBE_EMBED_ALLOW_REMOTE,
  };
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  resetYoutubeDbForTests();
  const cleanup = () => {
    resetYoutubeDbForTests();
    if (previous.db === undefined) delete process.env.MANGO_YOUTUBE_DB_PATH;
    else process.env.MANGO_YOUTUBE_DB_PATH = previous.db;
    if (previous.embeddings === undefined) delete process.env.MANGO_YOUTUBE_EMBEDDINGS;
    else process.env.MANGO_YOUTUBE_EMBEDDINGS = previous.embeddings;
    if (previous.sim === undefined) delete process.env.MANGO_YOUTUBE_SIM;
    else process.env.MANGO_YOUTUBE_SIM = previous.sim;
    if (previous.backend === undefined) delete process.env.MANGO_YOUTUBE_EMBED_BACKEND;
    else process.env.MANGO_YOUTUBE_EMBED_BACKEND = previous.backend;
    if (previous.cache === undefined) delete process.env.MANGO_EMBEDDINGS_CACHE;
    else process.env.MANGO_EMBEDDINGS_CACHE = previous.cache;
    if (previous.remote === undefined) delete process.env.MANGO_YOUTUBE_EMBED_ALLOW_REMOTE;
    else process.env.MANGO_YOUTUBE_EMBED_ALLOW_REMOTE = previous.remote;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('embeddings stay off by default and hashed vectors are deterministic', () => {
  delete process.env.MANGO_YOUTUBE_EMBEDDINGS;
  delete process.env.MANGO_YOUTUBE_SIM;
  delete process.env.MANGO_YOUTUBE_EMBED_BACKEND;
  assert.equal(youtubeEmbeddingsEnabled(), false);
  assert.equal(youtubeSimilarityMode(), 'lexical');
  assert.equal(youtubeEmbeddingBackend(), 'minilm');
  const left = hashEmbedText('fermentation science kitchen');
  const right = hashEmbedText('fermentation science kitchen');
  assert.equal(cosineSimilarity(left, right), 1);
  assert.equal(embeddingRelationFactor(0.8), 1);
});

test('missing MiniLM vectors do not rewrite lexical relation', () => withTempYoutube(() => {
  process.env.MANGO_YOUTUBE_EMBEDDINGS = '1';
  process.env.MANGO_YOUTUBE_SIM = 'blend';
  process.env.MANGO_YOUTUBE_EMBED_BACKEND = 'minilm';
  assert.equal(youtubeEmbeddingModelId(), 'Xenova/all-MiniLM-L6-v2');
  const item = video('vid-1', 'Fermentation science kitchen');
  upsertYoutubeItems([item]);
  assert.equal(embeddingForItem(item), null);
  assert.equal(maxTasteSimilarity(item, [hashEmbedText(item.title)]), null);
}));

test('hash backend persists cached vectors for scoring', () => withTempYoutube(async () => {
  process.env.MANGO_YOUTUBE_EMBEDDINGS = '1';
  process.env.MANGO_YOUTUBE_SIM = 'blend';
  process.env.MANGO_YOUTUBE_EMBED_BACKEND = 'hash';
  const kitchen = video('vid-1', 'Fermentation science kitchen');
  const cricket = video('vid-2', 'Unrelated cricket highlights live');
  upsertYoutubeItems([kitchen, cricket]);
  const result = await maybeRefreshYoutubeEmbeddings({
    watches: [],
    itemIds: [kitchen.id, cricket.id],
  });
  assert.equal(result.ok, true);
  assert.equal(result.embedded, 2);
  const kitchenVector = embeddingForItem(kitchen);
  const cricketVector = embeddingForItem(cricket);
  assert.ok(kitchenVector);
  assert.ok(cricketVector);
  assert.equal(kitchenVector.length, 64);
  const kitchenSim = maxTasteSimilarity(kitchen, [kitchenVector]);
  const cricketSim = maxTasteSimilarity(cricket, [kitchenVector]);
  assert.ok(kitchenSim != null && kitchenSim > 0.99);
  assert.ok(cricketSim != null && cricketSim < kitchenSim);
}));

test('MiniLM refresh fails closed when the model is not on disk', () => withTempYoutube(async () => {
  process.env.MANGO_YOUTUBE_EMBEDDINGS = '1';
  process.env.MANGO_YOUTUBE_SIM = 'blend';
  process.env.MANGO_YOUTUBE_EMBED_BACKEND = 'minilm';
  process.env.MANGO_EMBEDDINGS_CACHE = join(tmpdir(), 'mango-missing-minilm-cache');
  process.env.MANGO_YOUTUBE_EMBED_ALLOW_REMOTE = '0';
  const item = video('vid-1', 'Fermentation science kitchen');
  upsertYoutubeItems([item]);
  assert.equal(youtubeMiniLmModelReady(process.env.MANGO_EMBEDDINGS_CACHE), false);
  const result = await maybeRefreshYoutubeEmbeddings({
    watches: [],
    itemIds: [item.id],
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.match(result.error || '', /MiniLM model missing/);
}));
