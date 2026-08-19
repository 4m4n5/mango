#!/usr/bin/env node
// Download Xenova/all-MiniLM-L6-v2 into the Mango embeddings cache.
// Catalog scoring never downloads during a refresh unless
// MANGO_YOUTUBE_EMBED_ALLOW_REMOTE=1 is set.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cacheDir = process.env.MANGO_EMBEDDINGS_CACHE?.trim()
  || join(homedir(), '.local', 'share', 'mango', 'embeddings');
const model = 'Xenova/all-MiniLM-L6-v2';

mkdirSync(cacheDir, { recursive: true });

let transformers;
try {
  transformers = await import('@huggingface/transformers');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ensure-embeddings: cannot import @huggingface/transformers (${message})`);
  console.error('ensure-embeddings: run npm ci in src/catalog-service first');
  process.exit(1);
}

transformers.env.cacheDir = cacheDir;
transformers.env.allowLocalModels = true;
transformers.env.allowRemoteModels = true;

console.log(`ensure-embeddings: cache=${cacheDir}`);
console.log(`ensure-embeddings: downloading ${model} (q8 ONNX)`);
const extractor = await transformers.pipeline('feature-extraction', model, { dtype: 'q8' });
const probe = await extractor(['mango embedding probe'], { pooling: 'mean', normalize: true });
const width = probe.dims[probe.dims.length - 1];
if (width !== 384) {
  throw new Error(`unexpected MiniLM width ${width}`);
}
console.log(`ensure-embeddings: ready model=${model} dims=${width}`);
