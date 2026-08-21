import { createHash } from 'node:crypto';
import { libraryDatabase } from '../library/db.js';
import type { RatingContentType } from '../library/ratings.js';
import {
  STORY_DNA_ONTOLOGY_VERSION,
  STORY_DNA_PROMPT_VERSION,
  STORY_DNA_SCHEMA_VERSION,
  stableStoryDnaJson,
  storyDnaEvidenceFields,
  storyDnaEvidenceHash,
  storyDnaInputHash,
  storyDnaRequestItem,
  validateStoryDnaDocument,
  type StoryDnaDocument,
  type StoryDnaInput,
} from './story-dna.js';

const DEFAULT_STORY_DNA_URLS = [
  'http://127.0.0.1:8766/recommendations/story-dna',
  'http://127.0.0.1:8765/recommendations/story-dna',
];
const AI_LOOKUP_CHUNK = 400;

type PersistedAiFeatureRow = {
  content_type: RatingContentType;
  content_id: string;
  features_json: string;
  updated_at: number;
  input_hash: string | null;
  prompt_version: string | null;
  model_version: string | null;
};

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
export type StoryDnaTeacherFailureReason =
  | 'teacher-disabled'
  | 'invalid-input'
  | 'transport'
  | 'invalid-document'
  | 'missing-document';

export type StoryDnaTeacherFailure = {
  type: RatingContentType;
  id: string;
  reason: StoryDnaTeacherFailureReason;
};

export type StoryDnaTeacherRefreshResult = {
  requested: number;
  persisted: number;
  cached: number;
  documents: StoryDnaDocument[];
  failures: StoryDnaTeacherFailure[];
};

type PersistedStoryDnaRow = PersistedAiFeatureRow;

function uniqueStoryDnaInputs(inputs: StoryDnaInput[]): StoryDnaInput[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = `${input.type}:${input.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readPersistedStoryDnaRows(inputs: StoryDnaInput[]): Map<string, PersistedStoryDnaRow> {
  const rowsByKey = new Map<string, PersistedStoryDnaRow>();
  const unique = uniqueStoryDnaInputs(inputs);
  const db = libraryDatabase();
  for (let offset = 0; offset < unique.length; offset += AI_LOOKUP_CHUNK) {
    const chunk = unique.slice(offset, offset + AI_LOOKUP_CHUNK);
    const identityClause = chunk.map(() => '(content_type = ? AND content_id = ?)').join(' OR ');
    const parameters = chunk.flatMap((input) => [input.type, input.id]);
    const rows = db.prepare(`
SELECT content_type, content_id, features_json, updated_at, input_hash, prompt_version, model_version
FROM recommendation_features
WHERE feature_version = ? AND provenance = 'ai' AND (${identityClause})
`).all(STORY_DNA_SCHEMA_VERSION, ...parameters) as PersistedStoryDnaRow[];
    for (const row of rows) rowsByKey.set(`${row.content_type}:${row.content_id}`, row);
  }
  return rowsByKey;
}

export function expectedStoryDnaModelVersion(): string | null {
  return process.env.MANGO_STORY_DNA_MODEL_VERSION?.trim()
    || process.env.MANGO_LLM_MODEL?.trim()
    || null;
}

export type StoryDnaTeacherConfiguration = {
  schema_version: typeof STORY_DNA_SCHEMA_VERSION;
  ontology_version: typeof STORY_DNA_ONTOLOGY_VERSION;
  prompt_version: typeof STORY_DNA_PROMPT_VERSION;
  expected_model_version: string | null;
  provider_routes_hash: string;
  revision: string;
};

/**
 * Non-secret fingerprint of the explicitly selected content-teacher contract.
 * Endpoint changes create a new shadow generation without persisting URLs or
 * credentials in recommendation diagnostics.
 */
export function storyDnaTeacherConfiguration(): StoryDnaTeacherConfiguration {
  const configuredUrl = process.env.MANGO_STORY_DNA_URL?.trim();
  const providerRoutesHash = createHash('sha256')
    .update(JSON.stringify(configuredUrl ? [configuredUrl] : DEFAULT_STORY_DNA_URLS))
    .digest('hex');
  const contract = {
    schema_version: STORY_DNA_SCHEMA_VERSION,
    ontology_version: STORY_DNA_ONTOLOGY_VERSION,
    prompt_version: STORY_DNA_PROMPT_VERSION,
    expected_model_version: expectedStoryDnaModelVersion(),
    provider_routes_hash: providerRoutesHash,
  };
  return {
    ...contract,
    revision: createHash('sha256').update(stableStoryDnaJson(contract)).digest('hex'),
  };
}

function validatedStoryDnaRow(
  input: StoryDnaInput,
  row: PersistedStoryDnaRow | undefined,
  expectedModelVersion: string | null,
): StoryDnaDocument | null {
  if (!row || row.input_hash !== storyDnaInputHash(input)
    || row.prompt_version !== STORY_DNA_PROMPT_VERSION
    || (expectedModelVersion !== null && row.model_version !== expectedModelVersion)) return null;
  const key = `${input.type}:${input.id}`;
  try {
    const document = validateStoryDnaDocument(JSON.parse(row.features_json), new Set([key]));
    const expectedRequest = storyDnaRequestItem(input);
    if (document.input_hash !== storyDnaInputHash(input)
      || document.provenance.evidence_hash !== storyDnaEvidenceHash(input)
      || stableStoryDnaJson(document.provenance.evidence_fields)
        !== stableStoryDnaJson(storyDnaEvidenceFields(input))
      || stableStoryDnaJson(document.provenance.sources)
        !== stableStoryDnaJson(expectedRequest.evidence.sources)
      || stableStoryDnaJson(document.selective_lookup)
        !== stableStoryDnaJson(expectedRequest.selective_lookup)
      || (expectedModelVersion !== null && document.model_version !== expectedModelVersion)) return null;
    return document;
  } catch {
    return null;
  }
}

/** Exact-version teacher cache. Legacy ai-semantic-v1 rows are never promoted to v1. */
export function loadStoryDnaTeacherCache(
  inputs: StoryDnaInput[],
): Map<string, StoryDnaDocument> {
  const output = new Map<string, StoryDnaDocument>();
  const unique = uniqueStoryDnaInputs(inputs);
  const rows = readPersistedStoryDnaRows(unique);
  const expectedModelVersion = expectedStoryDnaModelVersion();
  for (const input of unique) {
    const key = `${input.type}:${input.id}`;
    const document = validatedStoryDnaRow(input, rows.get(key), expectedModelVersion);
    if (document) output.set(key, document);
  }
  return output;
}

/**
 * Progressive profiles accept any schema-compatible teacher producer. The
 * exact input/provenance checks remain intact; only the general Companion
 * model equality check is removed so a chat-model change cannot invalidate
 * an immutable content artifact.
 */
export function loadCompatibleStoryDnaTeacherCache(
  inputs: StoryDnaInput[],
): Map<string, StoryDnaDocument> {
  const output = new Map<string, StoryDnaDocument>();
  const unique = uniqueStoryDnaInputs(inputs);
  const rows = readPersistedStoryDnaRows(unique);
  for (const input of unique) {
    const key = `${input.type}:${input.id}`;
    const document = validatedStoryDnaRow(input, rows.get(key), null);
    if (document) output.set(key, document);
  }
  return output;
}

function persistStoryDnaDocuments(documents: StoryDnaDocument[], timestamp: number): void {
  if (documents.length === 0) return;
  const insert = libraryDatabase().prepare(`
INSERT INTO recommendation_features(
  content_type, content_id, feature_version, metadata_hash, provenance, confidence,
  features_json, model_version, prompt_version, input_hash, created_at, updated_at
) VALUES (?, ?, ?, ?, 'ai', ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(content_type, content_id, feature_version) DO UPDATE SET
  metadata_hash = excluded.metadata_hash,
  provenance = 'ai',
  confidence = excluded.confidence,
  features_json = excluded.features_json,
  model_version = excluded.model_version,
  prompt_version = excluded.prompt_version,
  input_hash = excluded.input_hash,
  updated_at = excluded.updated_at
`);
  libraryDatabase().transaction(() => {
    for (const document of documents) {
      insert.run(
        document.type,
        document.id,
        STORY_DNA_SCHEMA_VERSION,
        document.provenance.evidence_hash,
        document.confidence.overall,
        JSON.stringify(document),
        document.model_version,
        document.prompt_version,
        document.input_hash,
        timestamp,
        timestamp,
      );
    }
  })();
}

function inputFailure(input: StoryDnaInput, reason: StoryDnaTeacherFailureReason): StoryDnaTeacherFailure {
  return { type: input.type, id: input.id, reason };
}

async function requestStoryDnaBatch(
  batch: StoryDnaInput[],
  fetcher: typeof fetch,
): Promise<unknown[]> {
  const configuredUrl = process.env.MANGO_STORY_DNA_URL?.trim();
  const urls = configuredUrl ? [configuredUrl] : DEFAULT_STORY_DNA_URLS;
  const controller = new AbortController();
  const timeoutMs = boundedInteger(process.env.MANGO_STORY_DNA_TIMEOUT_MS, 90_000, 1_000, 180_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let lastError: unknown;
    for (const url of urls) {
      try {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: batch.map(storyDnaRequestItem) }),
          signal: controller.signal,
        });
        if (!response.ok) {
          lastError = new Error(`StoryDNA teacher returned ${response.status}`);
          continue;
        }
        const payload = await response.json() as { items?: unknown };
        if (!Array.isArray(payload.items)) throw new Error('StoryDNA teacher returned no items');
        return payload.items;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('StoryDNA teacher unavailable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches complete v1 documents in bounded background batches. Valid siblings
 * are cached immediately; each missing or malformed identity is returned as an
 * independent retryable failure for the authoritative v2 generation worker.
 */
export async function refreshStoryDnaTeacherCache(
  inputs: StoryDnaInput[],
  options: {
    enabled?: boolean;
    now?: number;
    fetcher?: typeof fetch;
    batchSize?: number;
  } = {},
): Promise<StoryDnaTeacherRefreshResult> {
  const unique = uniqueStoryDnaInputs(inputs);
  const cachedBefore = loadStoryDnaTeacherCache(unique);
  const invalidInputs = unique.filter((input) => {
    const normalized = storyDnaRequestItem(input);
    return (normalized.type !== 'movie' && normalized.type !== 'series')
      || !normalized.id || !normalized.title;
  });
  const failures = new Map<string, StoryDnaTeacherFailure>();
  for (const input of invalidInputs) {
    failures.set(`${input.type}:${input.id}`, inputFailure(input, 'invalid-input'));
  }
  const pending = unique.filter((input) => !cachedBefore.has(`${input.type}:${input.id}`)
    && !failures.has(`${input.type}:${input.id}`));
  if (options.enabled === false || process.env.MANGO_STORY_DNA === '0') {
    for (const input of pending) {
      failures.set(`${input.type}:${input.id}`, inputFailure(input, 'teacher-disabled'));
    }
    return {
      requested: 0,
      persisted: 0,
      cached: cachedBefore.size,
      documents: [...cachedBefore.values()],
      failures: [...failures.values()],
    };
  }

  const requestedBatchSize = options.batchSize
    ?? boundedInteger(process.env.MANGO_STORY_DNA_BATCH, 24, 1, 24);
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.max(1, Math.min(24, Math.floor(requestedBatchSize)))
    : 24;
  const expectedModelVersion = expectedStoryDnaModelVersion();
  let persisted = 0;
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    let items: unknown[];
    try {
      items = await requestStoryDnaBatch(batch, options.fetcher ?? fetch);
    } catch {
      for (const input of batch) {
        failures.set(`${input.type}:${input.id}`, inputFailure(input, 'transport'));
      }
      continue;
    }
    const inputsByKey = new Map(batch.map((input) => [`${input.type}:${input.id}`, input]));
    const allowed = new Set(inputsByKey.keys());
    const accepted: StoryDnaDocument[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const candidate = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : null;
      const candidateKey = candidate && typeof candidate.type === 'string' && typeof candidate.id === 'string'
        ? `${candidate.type}:${candidate.id}`
        : null;
      try {
        const document = validateStoryDnaDocument(item, allowed);
        const key = `${document.type}:${document.id}`;
        const input = inputsByKey.get(key);
        if (!input || seen.has(key)
          || document.input_hash !== storyDnaInputHash(input)
          || document.provenance.evidence_hash !== storyDnaEvidenceHash(input)
          || stableStoryDnaJson(document.provenance.evidence_fields)
            !== stableStoryDnaJson(storyDnaEvidenceFields(input))
          || stableStoryDnaJson(document.provenance.sources)
            !== stableStoryDnaJson(storyDnaRequestItem(input).evidence.sources)
          || stableStoryDnaJson(document.selective_lookup)
            !== stableStoryDnaJson(storyDnaRequestItem(input).selective_lookup)
          || (expectedModelVersion !== null && document.model_version !== expectedModelVersion)) {
          throw new Error('StoryDNA provenance does not match request');
        }
        accepted.push(document);
        seen.add(key);
        failures.delete(key);
      } catch {
        if (candidateKey && inputsByKey.has(candidateKey) && !seen.has(candidateKey)) {
          const input = inputsByKey.get(candidateKey)!;
          failures.set(candidateKey, inputFailure(input, 'invalid-document'));
        }
      }
    }
    persistStoryDnaDocuments(accepted, options.now ?? Date.now());
    persisted += accepted.length;
    for (const input of batch) {
      const key = `${input.type}:${input.id}`;
      if (!seen.has(key) && !failures.has(key)) {
        failures.set(key, inputFailure(input, 'missing-document'));
      }
    }
  }
  const finalCache = loadStoryDnaTeacherCache(unique);
  const documents = unique
    .map((input) => finalCache.get(`${input.type}:${input.id}`))
    .filter((document): document is StoryDnaDocument => Boolean(document));
  return {
    requested: pending.length,
    persisted,
    cached: cachedBefore.size,
    documents,
    failures: [...failures.values()],
  };
}
