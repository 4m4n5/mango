import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  getYoutubeItem,
  getYoutubeState,
  getYoutubeV2Embedding,
  setYoutubeState,
  upsertYoutubeItems,
  upsertYoutubeV2Embedding,
} from './db.js';
import { youtubeTitleTokens } from './tokens.js';
import type { YoutubeItem } from './types.js';
import type { YoutubeWatchAnchor } from './taste.js';

export const YOUTUBE_MINILM_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const YOUTUBE_MINILM_DIMS = 384;
export const YOUTUBE_HASH_EMBEDDING_MODEL = 'mango-hash-minilm-64';
export const YOUTUBE_HASH_EMBEDDING_DIMS = 64;

/** @deprecated Use youtubeEmbeddingModelId(); kept for hash-test fixtures. */
export const YOUTUBE_EMBEDDING_MODEL = YOUTUBE_MINILM_MODEL;
export const YOUTUBE_EMBEDDING_DIMS = YOUTUBE_MINILM_DIMS;

const DEFAULT_EMBED_BUDGET_MS = 120_000;
const DEFAULT_EMBED_BATCH = 16;
type MiniLmExtractor = (
  input: string | string[],
  options?: { pooling?: 'mean' | 'none' | 'cls'; normalize?: boolean },
) => Promise<{ data: ArrayLike<number>; dims: number[] }>;

let miniLmExtractor: MiniLmExtractor | null = null;
let miniLmLoad: Promise<MiniLmExtractor> | null = null;
let miniLmLoadError: string | null = null;

export function youtubeEmbeddingsEnabled(
  raw = process.env.MANGO_YOUTUBE_EMBEDDINGS,
): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on';
}

export function youtubeSimilarityMode(
  raw = process.env.MANGO_YOUTUBE_SIM,
): 'lexical' | 'embedding' | 'blend' {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'embedding' || normalized === 'blend') return normalized;
  return 'lexical';
}

export function youtubeEmbeddingBackend(
  raw = process.env.MANGO_YOUTUBE_EMBED_BACKEND,
): 'minilm' | 'hash' {
  return raw?.trim().toLowerCase() === 'hash' ? 'hash' : 'minilm';
}

export function youtubeEmbeddingModelId(): string {
  return youtubeEmbeddingBackend() === 'hash'
    ? YOUTUBE_HASH_EMBEDDING_MODEL
    : YOUTUBE_MINILM_MODEL;
}

export function youtubeEmbeddingDims(): number {
  return youtubeEmbeddingBackend() === 'hash'
    ? YOUTUBE_HASH_EMBEDDING_DIMS
    : YOUTUBE_MINILM_DIMS;
}

export function embeddingsCacheDir(): string {
  const override = process.env.MANGO_EMBEDDINGS_CACHE?.trim();
  if (override) return override;
  return join(homedir(), '.local', 'share', 'mango', 'embeddings');
}

function hashToUnit(value: string): number {
  const digest = createHash('sha256').update(value).digest();
  return ((digest[0]! << 8) | digest[1]!) / 0xffff;
}

/** Deterministic hashed bag-of-tokens embedding. Tests and eval-only fallback. */
export function hashEmbedText(
  text: string,
  dims = YOUTUBE_HASH_EMBEDDING_DIMS,
): Float32Array {
  const vector = new Float32Array(dims);
  const tokens = [...youtubeTitleTokens(text)];
  if (tokens.length === 0) return vector;
  for (const token of tokens) {
    const slot = Math.floor(hashToUnit(`slot:${token}`) * dims) % dims;
    const sign = hashToUnit(`sign:${token}`) >= 0.5 ? 1 : -1;
    vector[slot] += sign;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  const scale = Math.sqrt(norm) || 1;
  for (let index = 0; index < vector.length; index += 1) vector[index] /= scale;
  return vector;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! * left[index]!;
    rightNorm += right[index]! * right[index]!;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

export function embeddingTextForItem(item: YoutubeItem): string {
  return [item.title, item.channel_title, ...(item.tags ?? [])].filter(Boolean).join(' ');
}

function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function bufferFromVector(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function vectorFromBuffer(buffer: Buffer): Float32Array {
  const copy = Buffer.from(buffer);
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4));
}

function miniLmLocalFiles(cacheDir = embeddingsCacheDir()): string[] {
  const root = join(cacheDir, 'Xenova', 'all-MiniLM-L6-v2');
  return [
    join(root, 'tokenizer.json'),
    join(root, 'config.json'),
    join(root, 'onnx', 'model_quantized.onnx'),
    join(root, 'onnx', 'model.onnx'),
    join(root, 'onnx', 'model_q8.onnx'),
  ];
}

export function youtubeMiniLmModelReady(cacheDir = embeddingsCacheDir()): boolean {
  const files = miniLmLocalFiles(cacheDir);
  const tokenizer = files[0]!;
  return existsSync(tokenizer) && files.slice(2).some((path) => existsSync(path));
}

function allowRemoteMiniLmDownload(): boolean {
  const raw = process.env.MANGO_YOUTUBE_EMBED_ALLOW_REMOTE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

async function loadMiniLmExtractor(): Promise<MiniLmExtractor> {
  const cacheDir = embeddingsCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const ready = youtubeMiniLmModelReady(cacheDir);
  if (!ready && !allowRemoteMiniLmDownload()) {
    throw new Error(
      `MiniLM model missing in ${cacheDir}; run scripts/m6-ship/ensure-youtube-embeddings.sh`,
    );
  }
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowLocalModels = true;
  transformers.env.allowRemoteModels = !ready || allowRemoteMiniLmDownload();
  const extractor = await transformers.pipeline(
    'feature-extraction',
    YOUTUBE_MINILM_MODEL,
    { dtype: 'q8', local_files_only: ready },
  );
  return extractor as MiniLmExtractor;
}

async function getMiniLmExtractor(): Promise<MiniLmExtractor> {
  if (miniLmExtractor) return miniLmExtractor;
  if (!miniLmLoad) {
    miniLmLoad = loadMiniLmExtractor().then((extractor) => {
      miniLmExtractor = extractor;
      miniLmLoadError = null;
      return extractor;
    }).catch((error) => {
      miniLmLoad = null;
      miniLmLoadError = error instanceof Error ? error.message : String(error);
      throw error;
    });
  }
  return miniLmLoad;
}

function tensorsFromExtractorOutput(
  output: { data: ArrayLike<number>; dims: number[] },
  expectedRows: number,
): Float32Array[] {
  const dims = output.dims;
  const width = dims.length === 0 ? 0 : dims[dims.length - 1]!;
  if (width <= 0) {
    throw new Error('MiniLM returned an empty embedding width');
  }
  const data = output.data instanceof Float32Array
    ? output.data
    : Float32Array.from(output.data);
  const rows = Math.max(1, Math.floor(data.length / width));
  if (rows !== expectedRows) {
    throw new Error(`MiniLM batch size mismatch: expected ${expectedRows}, got ${rows}`);
  }
  const vectors: Float32Array[] = [];
  for (let index = 0; index < rows; index += 1) {
    vectors.push(data.slice(index * width, (index + 1) * width));
  }
  return vectors;
}

async function embedTextsMiniLm(texts: readonly string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getMiniLmExtractor();
  const output = await extractor([...texts], { pooling: 'mean', normalize: true });
  return tensorsFromExtractorOutput(output, texts.length);
}

export function embeddingForItem(item: YoutubeItem): Float32Array | null {
  const text = embeddingTextForItem(item);
  const hash = textHash(text);
  const model = youtubeEmbeddingModelId();
  const cached = getYoutubeV2Embedding('video', item.id, model);
  if (cached && cached.text_hash === hash) {
    const vector = vectorFromBuffer(cached.vector);
    if (vector.length === youtubeEmbeddingDims()) return vector;
  }
  if (youtubeEmbeddingBackend() === 'hash') return hashEmbedText(text);
  return null;
}

export function maxTasteSimilarity(
  item: YoutubeItem,
  taste: readonly Float32Array[],
): number | null {
  if (taste.length === 0) return null;
  const vector = embeddingForItem(item);
  if (!vector) return null;
  let best = 0;
  for (const other of taste) best = Math.max(best, cosineSimilarity(vector, other));
  return best;
}

export function tasteEmbeddingsFromAnchors(
  watches: readonly YoutubeWatchAnchor[],
  limit = 50,
  options: { allowHashFallback?: boolean } = {},
): Float32Array[] {
  const allowHash = options.allowHashFallback === true
    || youtubeEmbeddingBackend() === 'hash';
  return watches.slice(0, limit).flatMap((watch) => {
    const cachedItem = getYoutubeItem('video', watch.id);
    if (cachedItem) {
      const stored = embeddingForItem(cachedItem);
      if (stored) return [stored];
      if (allowHash) return [hashEmbedText(embeddingTextForItem(cachedItem))];
      return [];
    }
    const stored = getYoutubeV2Embedding('video', watch.id, youtubeEmbeddingModelId());
    if (stored) {
      const vector = vectorFromBuffer(stored.vector);
      if (vector.length === youtubeEmbeddingDims()) return [vector];
    }
    if (allowHash) {
      return [hashEmbedText([watch.title, watch.channel_title].filter(Boolean).join(' '))];
    }
    return [];
  });
}

export function embeddingRelationFactor(similarity: number): number {
  if (similarity >= 0.72) return 1;
  if (similarity >= 0.48) return 0.85;
  if (similarity >= 0.28) return 0.55;
  return 0.35;
}

export function resetYoutubeEmbeddingsForTests(): void {
  miniLmExtractor = null;
  miniLmLoad = null;
  miniLmLoadError = null;
}

function embedBudgetMs(at: number): number {
  const raw = Number(process.env.MANGO_YOUTUBE_EMBED_BUDGET_MS);
  const budget = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_EMBED_BUDGET_MS;
  return at + budget;
}

function embedBatchSize(): number {
  const raw = Number(process.env.MANGO_YOUTUBE_EMBED_BATCH);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(64, Math.floor(raw));
  return DEFAULT_EMBED_BATCH;
}

export async function maybeRefreshYoutubeEmbeddings(input: {
  watches: readonly YoutubeWatchAnchor[];
  itemIds: readonly string[];
  at?: number;
  force?: boolean;
}): Promise<{
  ok: boolean;
  embedded: number;
  skipped: boolean;
  cached: number;
  error?: string;
}> {
  if (!youtubeEmbeddingsEnabled() && !input.force) {
    return { ok: true, embedded: 0, skipped: true, cached: 0 };
  }
  const at = input.at ?? Date.now();
  const deadline = embedBudgetMs(at);
  const model = youtubeEmbeddingModelId();
  const backend = youtubeEmbeddingBackend();
  try {
    const ids = [...new Set([...input.watches.map((watch) => watch.id), ...input.itemIds])];
    const pending: Array<{ id: string; text: string; hash: string }> = [];
    let cached = 0;
    for (const id of ids) {
      const item = getYoutubeItem('video', id);
      if (!item) continue;
      upsertYoutubeItems([item]);
      const text = embeddingTextForItem(item);
      const hash = textHash(text);
      const existing = getYoutubeV2Embedding('video', id, model);
      if (existing?.text_hash === hash && vectorFromBuffer(existing.vector).length === youtubeEmbeddingDims()) {
        cached += 1;
        continue;
      }
      pending.push({ id, text, hash });
    }

    let embedded = 0;
    if (backend === 'hash') {
      for (const row of pending) {
        if (Date.now() >= deadline) break;
        upsertYoutubeV2Embedding({
          kind: 'video',
          id: row.id,
          model,
          vector: bufferFromVector(hashEmbedText(row.text)),
          text_hash: row.hash,
          updated_at: Date.now(),
        });
        embedded += 1;
      }
    } else {
      const batchSize = embedBatchSize();
      for (let offset = 0; offset < pending.length; offset += batchSize) {
        if (Date.now() >= deadline) break;
        const batch = pending.slice(offset, offset + batchSize);
        const vectors = await embedTextsMiniLm(batch.map((row) => row.text));
        const now = Date.now();
        batch.forEach((row, index) => {
          const vector = vectors[index];
          if (!vector) return;
          upsertYoutubeV2Embedding({
            kind: 'video',
            id: row.id,
            model,
            vector: bufferFromVector(vector),
            text_hash: row.hash,
            updated_at: now,
          });
          embedded += 1;
        });
      }
    }

    setYoutubeState('youtube_v3_embeddings', {
      model,
      dims: youtubeEmbeddingDims(),
      backend,
      embedded,
      cached,
      pending: pending.length,
      updated_at: Date.now(),
    });
    setYoutubeState('youtube_v3_embeddings_error', null);
    return { ok: true, embedded, skipped: false, cached };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setYoutubeState('youtube_v3_embeddings_error', { error: message, at: Date.now() });
    return { ok: false, embedded: 0, skipped: false, cached: 0, error: message };
  }
}

export function youtubeEmbeddingDiagnostics(): Record<string, unknown> {
  const enabled = youtubeEmbeddingsEnabled();
  const backend = youtubeEmbeddingBackend();
  const state = getYoutubeState<Record<string, unknown> | null>('youtube_v3_embeddings', null);
  const errorState = getYoutubeState<{ error?: string } | null>('youtube_v3_embeddings_error', null);
  return {
    enabled,
    similarity_mode: youtubeSimilarityMode(),
    backend: enabled ? backend : null,
    model: enabled ? youtubeEmbeddingModelId() : null,
    dims: enabled ? youtubeEmbeddingDims() : null,
    cache_dir: embeddingsCacheDir(),
    model_ready: backend === 'hash' ? true : youtubeMiniLmModelReady(),
    last: state && typeof state === 'object' ? {
      embedded: typeof state.embedded === 'number' ? state.embedded : 0,
      cached: typeof state.cached === 'number' ? state.cached : 0,
      updated_at: typeof state.updated_at === 'number' ? state.updated_at : null,
    } : null,
    error: miniLmLoadError
      || (errorState && typeof errorState.error === 'string' ? errorState.error : null),
  };
}
