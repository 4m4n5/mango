import { createHash } from 'node:crypto';
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

export const YOUTUBE_EMBEDDING_MODEL = 'mango-hash-minilm-64';
export const YOUTUBE_EMBEDDING_DIMS = 64;

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

function hashToUnit(value: string): number {
  const digest = createHash('sha256').update(value).digest();
  return ((digest[0]! << 8) | digest[1]!) / 0xffff;
}

/** Deterministic hashed bag-of-tokens embedding. No extra model download. */
export function hashEmbedText(text: string, dims = YOUTUBE_EMBEDDING_DIMS): Float32Array {
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
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
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

export function embeddingForItem(item: YoutubeItem): Float32Array {
  const text = embeddingTextForItem(item);
  const hash = textHash(text);
  const cached = getYoutubeV2Embedding('video', item.id, YOUTUBE_EMBEDDING_MODEL);
  if (cached && cached.text_hash === hash) return vectorFromBuffer(cached.vector);
  return hashEmbedText(text);
}

export function maxTasteSimilarity(
  item: YoutubeItem,
  taste: readonly Float32Array[],
): number {
  if (taste.length === 0) return 0;
  const vector = embeddingForItem(item);
  let best = 0;
  for (const other of taste) best = Math.max(best, cosineSimilarity(vector, other));
  return best;
}

export function tasteEmbeddingsFromAnchors(
  watches: readonly YoutubeWatchAnchor[],
  limit = 50,
): Float32Array[] {
  return watches.slice(0, limit).map((watch) => {
    const cached = getYoutubeItem('video', watch.id);
    const text = cached
      ? embeddingTextForItem(cached)
      : [watch.title, watch.channel_title].filter(Boolean).join(' ');
    return hashEmbedText(text);
  });
}

export function embeddingRelationFactor(similarity: number): number {
  if (similarity >= 0.72) return 1;
  if (similarity >= 0.48) return 0.85;
  if (similarity >= 0.28) return 0.55;
  return 0.35;
}

async function tryMiniLmEmbed(_text: string): Promise<Float32Array | null> {
  try {
    const loader = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
      pipeline?: (task: string, model: string) => Promise<(input: string) => Promise<{ data: Float32Array }>>;
    }>;
    const transformers = await loader('@xenova/transformers');
    if (typeof transformers.pipeline !== 'function') return null;
    return null;
  } catch {
    return null;
  }
}

export async function maybeRefreshYoutubeEmbeddings(input: {
  watches: readonly YoutubeWatchAnchor[];
  itemIds: readonly string[];
  at?: number;
  force?: boolean;
}): Promise<{ ok: boolean; embedded: number; skipped: boolean; error?: string }> {
  if (!youtubeEmbeddingsEnabled() && !input.force) {
    return { ok: true, embedded: 0, skipped: true };
  }
  const at = input.at ?? Date.now();
  const deadline = at + 20_000;
  try {
    const ids = [...new Set([...input.itemIds, ...input.watches.map((watch) => watch.id)])];
    let embedded = 0;
    for (const id of ids) {
      if (Date.now() >= deadline) break;
      const item = getYoutubeItem('video', id);
      if (!item) continue;
      upsertYoutubeItems([item]);
      const text = embeddingTextForItem(item);
      const hash = textHash(text);
      const existing = getYoutubeV2Embedding('video', id, YOUTUBE_EMBEDDING_MODEL);
      if (existing?.text_hash === hash) {
        embedded += 1;
        continue;
      }
      const miniLm = await tryMiniLmEmbed(text);
      const vector = miniLm ?? hashEmbedText(text);
      upsertYoutubeV2Embedding({
        kind: 'video',
        id,
        model: YOUTUBE_EMBEDDING_MODEL,
        vector: bufferFromVector(vector),
        text_hash: hash,
        updated_at: Date.now(),
      });
      embedded += 1;
    }
    setYoutubeState('youtube_v3_embeddings', {
      model: YOUTUBE_EMBEDDING_MODEL,
      dims: YOUTUBE_EMBEDDING_DIMS,
      embedded,
      updated_at: Date.now(),
    });
    return { ok: true, embedded, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setYoutubeState('youtube_v3_embeddings_error', { error: message, at: Date.now() });
    return { ok: false, embedded: 0, skipped: false, error: message };
  }
}

export function youtubeEmbeddingDiagnostics(): Record<string, unknown> {
  const enabled = youtubeEmbeddingsEnabled();
  const state = getYoutubeState<Record<string, unknown> | null>('youtube_v3_embeddings', null);
  return {
    enabled,
    similarity_mode: youtubeSimilarityMode(),
    model: enabled ? YOUTUBE_EMBEDDING_MODEL : null,
    last: state && typeof state === 'object' ? {
      embedded: typeof state.embedded === 'number' ? state.embedded : 0,
      updated_at: typeof state.updated_at === 'number' ? state.updated_at : null,
    } : null,
  };
}
