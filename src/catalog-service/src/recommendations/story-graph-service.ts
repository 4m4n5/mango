import { createHash } from 'node:crypto';
import { AI_CATALOG_RAIL_PREFIX } from '../ai-catalogs/types.js';
import {
  libraryDatabase,
  registerRecommendationServedSlate,
} from '../library/db.js';
import { listRatings, type FireWaterRating, type RatingContentType } from '../library/ratings.js';
import {
  getTitlesPlayabilityBulk,
  listVerifiedRecommendationCatalogPage,
  playabilityRecommendationCorpusGeneration,
  playabilityRecommendationSemanticGeneration,
  recordRecommendationSemanticEvidence,
  type VerifiedRecommendationCatalogPage,
  type VerifiedRecommendationCatalogRow,
} from '../playability/db.js';
import {
  loadAiRecommendationFeatures,
  loadCompatibleStoryDnaTeacherCache,
  loadStoryDnaTeacherCache,
  refreshStoryDnaTeacherCache,
  storyDnaTeacherConfiguration,
  buildAiEnrichedRecommendationFeature,
  type RecommendationAiInput,
  type StoryDnaTeacherRefreshResult,
} from './ai.js';
import {
  STORY_DNA_ONTOLOGY_VERSION,
  STORY_DNA_PROMPT_VERSION,
  STORY_DNA_SCHEMA_VERSION,
  stableStoryDnaJson,
  storyDnaDocumentHash,
  storyDnaEvidenceHash,
  storyDnaEvidenceFields,
  storyDnaInputHash,
  storyDnaOntologyParentNodeKey,
  storyDnaRequestItem,
  storyDnaToGraphEdges,
  validateStoryDnaDocument,
  type StoryDnaDocument,
  type StoryDnaEvidence,
  type StoryDnaInput,
  type StoryDnaRequestItem,
} from './story-dna.js';
import {
  VOD_STORY_GRAPH_MODEL_VERSION,
  buildStoryTasteModel,
  dealStoryRecommendations,
  positiveRatingEvidence,
  scoreStoryGraphCandidate,
  storyHolisticAffinity,
  type StoryDealerCache,
  type StoryGraphContentId,
  type StoryGraphExplicitRating,
  type StoryGraphFamily,
  type StoryGraphImplicitSignal,
  type StoryGraphRankInput,
  type StoryGraphRankResult,
  type StoryGraphScoredRecommendation,
  type StoryGraphTitle,
  type StoryTasteModel,
} from './story-graph-v1.js';
import { rankStoryGraphRecommendationsOffThread } from './story-graph-rank-worker-client.js';
import { vodRecommendationsV2Mode } from './v2-mode.js';
import {
  buildRecommendationFeature,
  holisticAffinity,
  predictAxes,
  type RecommendationFeature,
} from './engine.js';
import {
  VOD_CONTENT_PROFILE_COMPILER_VERSION,
  VOD_CONTENT_PROFILE_VERSION,
  VOD_STORY_FRONTIER_MODEL_VERSION,
  compileContentProfileV2,
  contentProfileIsServingEligible,
  contentProfileStoryGraphTitle,
  contentSemanticEvidenceHash,
  type ContentProfileV2,
} from './content-profile-v2.js';
import {
  enqueueStoryDnaFrontierCandidates,
  runStoryDnaFrontierWorker,
  storyDnaFrontierDiagnostics,
  storyDnaWorkerMode,
  type StoryDnaFrontierCandidate,
} from './story-dna-frontier.js';
import { tmdbMetadataStatus } from './tmdb-metadata.js';
import {
  buildStoryFrontierCalibration,
  storyFrontierBandFor,
  type StoryFrontierCalibrationBand,
  type StoryFrontierCalibrationSample,
} from './story-frontier-calibration.js';

export type StoryGraphTab = 'movies' | 'series';
export type VodContentProfileMode = 'strict-v1' | 'progressive-v2';

/** Progressive is the v2 default; strict remains an explicit one-release rollback. */
export function vodContentProfileMode(): VodContentProfileMode {
  return process.env.MANGO_VOD_CONTENT_PROFILE === 'strict-v1' ? 'strict-v1' : 'progressive-v2';
}

export type StoryGraphForYouRail = {
  rail_id: 'for-you-movies' | 'for-you-series';
  label: 'For You';
  slate_sequence: number;
  attribution_token: string;
  items: Array<{
    id: string;
    type: RatingContentType;
    title: string;
    subtitle: string;
    poster: string;
    year?: string;
    source: string;
  }>;
  resolve_ms: number;
  skipped: number;
  cached: true;
  playability: {
    displayed: number;
    verified_pool: number;
    pending: number;
    low_water: boolean;
    session_id: string;
  };
};

export type StoryDnaStructuredLookupProvider = (
  inputs: readonly StoryDnaInput[],
) => Promise<StoryDnaInput[]>;

let structuredLookupProvider: StoryDnaStructuredLookupProvider | null = null;

export type StoryGraphLowWaterRequest = {
  tab: StoryGraphTab;
  content_type: RatingContentType;
  rank_generation_id: number;
  available_count: number;
  reason: 'six_card_heal_failed';
  requested_at: number;
};

export type StoryGraphLowWaterEnqueueHook = (
  request: StoryGraphLowWaterRequest,
) => void | Promise<void>;

let storyGraphLowWaterEnqueueHook: StoryGraphLowWaterEnqueueHook | null = null;
const pendingStoryGraphLowWater = new Set<RatingContentType>();

/** Integration hook into the durable/coalescing recommendation job queue. */
export function setStoryGraphLowWaterEnqueueHook(
  hook: StoryGraphLowWaterEnqueueHook | null,
): void {
  storyGraphLowWaterEnqueueHook = hook;
  if (hook) setImmediate(() => replayPendingStoryGraphLowWater());
}

function lowWaterStateKey(type: RatingContentType): string {
  return `vod_story_graph_low_water:${type}`;
}

function persistPendingStoryGraphLowWater(request: StoryGraphLowWaterRequest): void {
  const db = libraryDatabase();
  db.transaction(() => {
    db.prepare(`
INSERT INTO vod_story_graph_low_water_requests(
  content_type, tab, rank_generation_id, available_count, reason,
  requested_at, status, acknowledged_at, last_error
) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
ON CONFLICT(content_type) DO UPDATE SET
  tab = excluded.tab,
  rank_generation_id = excluded.rank_generation_id,
  available_count = excluded.available_count,
  reason = excluded.reason,
  requested_at = excluded.requested_at,
  status = 'pending',
  acknowledged_at = NULL,
  last_error = NULL
`).run(
      request.content_type,
      request.tab,
      request.rank_generation_id,
      request.available_count,
      request.reason,
      request.requested_at,
    );
    persistLookupRuntimeState(lowWaterStateKey(request.content_type), request, request.requested_at);
  })();
}

async function dispatchPendingStoryGraphLowWater(request: StoryGraphLowWaterRequest): Promise<void> {
  if (!storyGraphLowWaterEnqueueHook || pendingStoryGraphLowWater.has(request.content_type)) return;
  pendingStoryGraphLowWater.add(request.content_type);
  try {
    await storyGraphLowWaterEnqueueHook(request);
    libraryDatabase().prepare(`
UPDATE vod_story_graph_low_water_requests
SET status = 'acknowledged', acknowledged_at = ?, last_error = NULL
WHERE content_type = ? AND rank_generation_id = ? AND requested_at = ? AND status = 'pending'
`).run(Date.now(), request.content_type, request.rank_generation_id, request.requested_at);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    libraryDatabase().prepare(`
UPDATE vod_story_graph_low_water_requests
SET last_error = ?
WHERE content_type = ? AND rank_generation_id = ? AND requested_at = ? AND status = 'pending'
`).run(message, request.content_type, request.rank_generation_id, request.requested_at);
    console.warn(`Story Graph low-water enqueue retained last-good: ${message}`);
  } finally {
    pendingStoryGraphLowWater.delete(request.content_type);
    const latest = libraryDatabase().prepare(`
SELECT tab, content_type, rank_generation_id, available_count, reason, requested_at
FROM vod_story_graph_low_water_requests
WHERE content_type = ? AND status = 'pending'
`).get(request.content_type) as StoryGraphLowWaterRequest | undefined;
    const isNewerRequest = latest !== undefined && (
      latest.rank_generation_id !== request.rank_generation_id
      || latest.requested_at !== request.requested_at
      || latest.available_count !== request.available_count
      || latest.tab !== request.tab
    );
    // A same-row failure stays durable for startup/next detection instead of
    // spinning. A newer coalesced row must be dispatched now that the in-flight
    // guard has cleared, otherwise it could remain stranded until restart.
    if (isNewerRequest) setImmediate(() => void dispatchPendingStoryGraphLowWater(latest));
  }
}

export function replayPendingStoryGraphLowWater(): void {
  if (!storyGraphLowWaterEnqueueHook) return;
  const rows = libraryDatabase().prepare(`
SELECT tab, content_type, rank_generation_id, available_count, reason, requested_at
FROM vod_story_graph_low_water_requests
WHERE status = 'pending'
ORDER BY requested_at, content_type
`).all() as StoryGraphLowWaterRequest[];
  for (const request of rows) void dispatchPendingStoryGraphLowWater(request);
}

function enqueueStoryGraphLowWater(request: StoryGraphLowWaterRequest): void {
  // Durability is part of the X response contract: a crash immediately after
  // returning cannot lose replenishment intent. Only durable job creation is
  // deferred so the couch path remains bounded.
  persistPendingStoryGraphLowWater(request);
  setImmediate(() => void dispatchPendingStoryGraphLowWater(request));
}

/**
 * Register a bounded, structured catalog lookup. The service passes only
 * sparse content evidence; the callback must never receive household state or
 * perform broad web search. Registering null restores cache-only behavior.
 */
export function setStoryDnaStructuredLookupProvider(
  provider: StoryDnaStructuredLookupProvider | null,
): void {
  structuredLookupProvider = provider;
}

export class StaleStoryGraphGenerationError extends Error {
  constructor(message = 'Story Graph generation inputs changed before publication') {
    super(message);
    this.name = 'StaleStoryGraphGenerationError';
  }
}

type HouseholdSignals = {
  implicit: StoryGraphImplicitSignal[];
  rated: Set<StoryGraphContentId>;
  saved: Set<StoryGraphContentId>;
  watched: Set<StoryGraphContentId>;
  hidden: Set<StoryGraphContentId>;
  blocked: Set<StoryGraphContentId>;
  not_for_me: Set<StoryGraphContentId>;
};

export type StoryGraphOfflineEvaluation = {
  version: 'vod-story-graph-evaluation-v1';
  rank_generation_id: number;
  status: 'passed' | 'insufficient' | 'failed';
  samples: number;
  folds: number;
  holistic_ndcg_at_6: { v2: number | null; v4: number | null; relative_improvement: number | null };
  paired_bootstrap_90: { low: number | null; high: number | null; iterations: number };
  fire_pairwise_concordance_ge_4: { v2: number | null; v4: number | null; regression: number | null };
  water_pairwise_concordance_ge_4: { v2: number | null; v4: number | null; regression: number | null };
  low_low_top_6_intrusion_rate: { v2: number | null; v4: number | null; regression: number | null };
  verified_accounting_complete: boolean;
  coverage: number;
  deterministic: boolean;
  worker_latency_ms: number;
  cached_service_p95_ms: number | null;
  promotion_eligible: boolean;
  reasons: string[];
  evaluated_at: number;
};

export type StoryGraphRefreshResult = {
  tab: StoryGraphTab;
  story_generation_id: number;
  taste_generation_id: number;
  rank_generation_id: number;
  corpus_generation: number;
  verified_count: number;
  profiled_count: number;
  retryable_failure_count: number;
  scored_count: number;
  excluded_count: number;
  unscored_count: number;
  coverage: number;
  reserve_depth: number;
  selected_k: number;
  rank_status: 'bootstrap' | 'complete';
  published: boolean;
  activated: boolean;
  evaluation: StoryGraphOfflineEvaluation;
};

export type StoryGraphRefreshDependencies = {
  listPage?: typeof listVerifiedRecommendationCatalogPage;
  corpusGeneration?: typeof playabilityRecommendationCorpusGeneration;
  semanticGeneration?: typeof playabilityRecommendationSemanticGeneration;
  recordSemanticEvidence?: typeof recordRecommendationSemanticEvidence;
  refreshTeacher?: typeof refreshStoryDnaTeacherCache;
  loadTeacherCache?: typeof loadStoryDnaTeacherCache;
  rank?: (input: StoryGraphRankInput) => Promise<StoryGraphRankResult>;
  evaluate?: typeof evaluateStoryGraphOffline;
  lookup?: StoryDnaStructuredLookupProvider | null;
  persistStoryGenerationFault?: (
    point: 'after_header' | 'after_children' | 'before_complete',
    generationId: number,
  ) => void;
};

export type StoryGraphRefreshOptions = {
  now?: number;
  trigger_reasons?: readonly string[];
  bootstrap_minimum?: number;
  teacher_limit?: number;
  cached_service_p95_ms?: number | null;
  dependencies?: StoryGraphRefreshDependencies;
  /** Internal reserve-first phase; public callers use trigger reasons. */
  rank_candidate_ids?: readonly StoryGraphContentId[];
  /** Internal authorization proving a priority rescore replaces promoted v2. */
  priority_base_rank_generation_id?: number;
  /** Complete generation whose offline gate authorizes the priority swap. */
  priority_promotion_rank_generation_id?: number;
};

type PersistedRankRow = {
  rank_generation_id: number;
  content_type: RatingContentType;
  content_id: string;
  title: string;
  poster: string;
  year: string | null;
  rank: number;
  best_thread: number;
  predicted_fire: number;
  predicted_water: number;
  explicit_support: number;
  implicit_support: number;
  uncertainty: number;
  rank_score: number;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_BOOTSTRAP_MINIMUM = 200;
const DEFAULT_TEACHER_LIMIT = 240;
const VISIBLE_LIMIT = 6;
const DEFAULT_PREDEALT_SLATE_COUNT = 32;
const DEFAULT_COUCH_QUEUE_SCAN_LIMIT = 8;
const STORY_DNA_RETRY_BASE_MS = 15 * 60 * 1_000;
const STORY_DNA_RETRY_MAX_MS = DAY_MS;

export type StoryGraphServingWorkCounters = {
  full_reserve_queries: number;
  full_reserve_rows_loaded: number;
  dealer_calls: number;
  queue_slates_scanned: number;
  slate_items_revalidated: number;
};

const storyGraphServingWorkCounters: StoryGraphServingWorkCounters = {
  full_reserve_queries: 0,
  full_reserve_rows_loaded: 0,
  dealer_calls: 0,
  queue_slates_scanned: 0,
  slate_items_revalidated: 0,
};

export function storyGraphServingWorkSnapshot(): StoryGraphServingWorkCounters {
  return { ...storyGraphServingWorkCounters };
}

export function resetStoryGraphServingWorkCounters(): void {
  storyGraphServingWorkCounters.full_reserve_queries = 0;
  storyGraphServingWorkCounters.full_reserve_rows_loaded = 0;
  storyGraphServingWorkCounters.dealer_calls = 0;
  storyGraphServingWorkCounters.queue_slates_scanned = 0;
  storyGraphServingWorkCounters.slate_items_revalidated = 0;
}

function contentTypeForTab(tab: StoryGraphTab): RatingContentType {
  return tab === 'movies' ? 'movie' : 'series';
}

function contentKey(type: RatingContentType, id: string): StoryGraphContentId {
  return `${type}:${id}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStoryDnaJson(value)).digest('hex');
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function safeJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
}

function externalIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => (
    typeof item === 'string' || typeof item === 'number' ? [[key, String(item)]] : []
  )));
}

function stringValues(...values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => (
    Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  )).filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim()))];
}

function fieldProvenance(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([field, sources]) => {
    const normalized = stringValues(sources);
    return normalized.length > 0 ? [[field, normalized]] : [];
  }));
}

/** User-created AI catalogs stay presentational and never become taste evidence. */
export function storyDnaCuratedPoolMemberships(railIds: readonly string[]): string[] {
  return [...new Set(railIds
    .map((railId) => railId.trim())
    .filter((railId) => railId && !railId.startsWith(AI_CATALOG_RAIL_PREFIX)))]
    .sort((left, right) => left.localeCompare(right));
}

export function storyDnaInputForVerifiedRow(row: VerifiedRecommendationCatalogRow): StoryDnaInput | null {
  if (!row.title?.trim()) return null;
  const evidence = safeJsonObject(row.evidence_json);
  const perFieldProvenance = fieldProvenance(
    evidence.field_provenance ?? evidence.field_sources ?? evidence.provenance,
  );
  const evidenceSources = [...new Set([
    ...stringValues(evidence.sources),
    ...Object.values(perFieldProvenance).flat(),
  ])];
  const curatedMemberships = storyDnaCuratedPoolMemberships(row.rail_ids);
  return {
    type: row.type,
    id: row.id,
    title: row.title,
    year: row.year,
    synopsis: typeof evidence.synopsis === 'string' ? evidence.synopsis : null,
    genres: stringList(evidence.genres),
    keywords: stringList(evidence.keywords),
    languages: stringList(evidence.languages),
    countries: stringList(evidence.countries),
    runtime_minutes: Number(evidence.runtime_minutes) || null,
    release_state: typeof evidence.release_state === 'string' ? evidence.release_state : null,
    format: typeof evidence.format === 'string' ? evidence.format : null,
    cast: stringList(evidence.cast),
    characters: stringList(evidence.characters),
    directors: stringList(evidence.directors),
    writers: stringList(evidence.writers),
    awards_certification: stringValues(
      evidence.awards_certification,
      evidence.awards,
      evidence.certification,
    ),
    external_ids: { catalog: row.id, ...externalIds(evidence.external_ids) },
    curated_pool_memberships: curatedMemberships,
    rail_ids: curatedMemberships,
    source: row.evidence_source ?? row.best_source ?? 'verified-catalog',
    evidence_sources: evidenceSources,
    field_provenance: perFieldProvenance,
    retrieved_at: row.evidence_retrieved_at ?? row.updated_at,
  };
}

function inputStratum(input: StoryDnaInput): string {
  const request = storyDnaRequestItem(input);
  return request.evidence.curated_pool_memberships[0]
    ?? request.evidence.genres[0]
    ?? 'unclassified';
}

/** Stable round-robin prevents the first 200 profiles from being ID-biased. */
export function themeStratifiedStoryDnaInputs(inputs: StoryDnaInput[]): StoryDnaInput[] {
  const strata = new Map<string, StoryDnaInput[]>();
  for (const input of inputs) {
    const key = inputStratum(input);
    const rows = strata.get(key) ?? [];
    rows.push(input);
    strata.set(key, rows);
  }
  const ordered = [...strata.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, rows]) => rows.sort((left, right) => (
      `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)
    )));
  const output: StoryDnaInput[] = [];
  for (let offset = 0; ordered.some((rows) => offset < rows.length); offset += 1) {
    for (const rows of ordered) {
      const item = rows[offset];
      if (item) output.push(item);
    }
  }
  return output;
}

const LOOKUP_MATERIAL_EVIDENCE_FIELDS = [
  'synopsis', 'genres', 'keywords', 'languages', 'countries', 'runtime_minutes',
  'release_state', 'format', 'cast', 'characters', 'directors', 'writers',
  'awards_certification', 'external_ids',
] as const satisfies ReadonlyArray<keyof StoryDnaEvidence>;

type StoryDnaLookupMerge = {
  input: StoryDnaInput;
  material_fields: string[];
};

type StoryDnaLookupCacheRecord = {
  version: 'story-dna-structured-lookup-v1';
  raw_evidence_hash: string;
  enriched_input: StoryDnaInput;
  material_fields: string[];
  looked_up_at: number;
};

export type StoryDnaLookupStatus = {
  pending: number;
  requested: number;
  resolved: number;
  material: number;
  unresolved: number;
  provider_failed: boolean;
  provider_registered: boolean;
  cursor: number;
  updated_at: number;
};

function lookupStateKey(type: RatingContentType, id: string): string {
  return `vod_story_dna_lookup:${type}:${sha256(`${type}:${id}`)}`;
}

function lookupCursorKey(type: RatingContentType): string {
  return `vod_story_dna_lookup_cursor:${type}`;
}

function lookupStatusKey(type: RatingContentType): string {
  return `vod_story_dna_lookup_status:${type}`;
}

function unionList(left: string[] | undefined, right: string[] | undefined): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function unionFieldProvenance(
  left: Record<string, string[]> | undefined,
  right: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const fields = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  return Object.fromEntries([...fields].sort().map((field) => [
    field,
    unionList(left?.[field], right?.[field]),
  ]));
}

function mergeStructuredLookup(base: StoryDnaInput, enriched: StoryDnaInput): StoryDnaLookupMerge {
  if (base.type !== enriched.type || base.id !== enriched.id) {
    return { input: base, material_fields: [] };
  }
  const baseSynopsis = base.synopsis?.trim() || base.description?.trim() || '';
  const replacementSynopsis = enriched.synopsis?.trim() || enriched.description?.trim() || '';
  const candidate: StoryDnaInput = {
    ...base,
    // Stable catalog identity is authoritative. Lookup fills or unions evidence;
    // it cannot silently rewrite a known title/year or curated membership.
    title: base.title,
    year: base.year ?? enriched.year,
    synopsis: baseSynopsis.length >= 120 || replacementSynopsis.length <= baseSynopsis.length
      ? baseSynopsis || null
      : replacementSynopsis,
    genres: unionList(base.genres, enriched.genres),
    keywords: unionList(base.keywords, enriched.keywords),
    languages: unionList(base.languages, enriched.languages),
    countries: unionList(base.countries, enriched.countries),
    runtime_minutes: base.runtime_minutes ?? enriched.runtime_minutes,
    release_state: base.release_state?.trim() || enriched.release_state?.trim() || null,
    format: base.format?.trim() || enriched.format?.trim() || null,
    cast: unionList(base.cast, enriched.cast),
    characters: unionList(base.characters, enriched.characters),
    directors: unionList(base.directors, enriched.directors),
    writers: unionList(base.writers, enriched.writers),
    awards_certification: unionList(base.awards_certification, enriched.awards_certification),
    external_ids: { ...(enriched.external_ids ?? {}), ...(base.external_ids ?? {}) },
    curated_pool_memberships: storyDnaCuratedPoolMemberships(base.curated_pool_memberships ?? []),
    rail_ids: storyDnaCuratedPoolMemberships(base.curated_pool_memberships ?? base.rail_ids ?? []),
    source: base.source,
    retrieved_at: base.retrieved_at,
    evidence_sources: [...new Set([
      ...(base.source ? [base.source] : []),
      ...(base.evidence_sources ?? []),
      ...(enriched.evidence_sources ?? []),
      ...(enriched.source ? [enriched.source] : []),
    ])],
    field_provenance: unionFieldProvenance(base.field_provenance, enriched.field_provenance),
    lookup_reasons: storyDnaRequestItem(base).selective_lookup.reasons,
    lookup_used: false,
  };
  const beforeRequest = storyDnaRequestItem(base);
  const afterRequest = storyDnaRequestItem(candidate);
  const materialFields: string[] = LOOKUP_MATERIAL_EVIDENCE_FIELDS.filter((field) => (
    stableStoryDnaJson(beforeRequest.evidence[field])
      !== stableStoryDnaJson(afterRequest.evidence[field])
  ));
  if (beforeRequest.year !== afterRequest.year) materialFields.push('year');
  if (materialFields.length === 0) return { input: base, material_fields: [] };
  return {
    input: {
      ...candidate,
      retrieved_at: enriched.retrieved_at ?? base.retrieved_at,
      lookup_used: true,
    },
    material_fields: [...materialFields],
  };
}

function cachedStructuredLookup(input: StoryDnaInput): StoryDnaInput {
  const row = libraryDatabase().prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = ?
`).get(lookupStateKey(input.type, input.id)) as { value_json: string } | undefined;
  if (!row) return input;
  try {
    const record = JSON.parse(row.value_json) as StoryDnaLookupCacheRecord;
    if (record.version !== 'story-dna-structured-lookup-v1'
      || record.raw_evidence_hash !== storyDnaEvidenceHash(input)
      || record.enriched_input.type !== input.type || record.enriched_input.id !== input.id
      || record.material_fields.length === 0
      || storyDnaRequestItem(record.enriched_input).selective_lookup.used !== true) return input;
    return record.enriched_input;
  } catch {
    return input;
  }
}

function persistLookupRuntimeState(key: string, value: unknown, now: number): void {
  libraryDatabase().prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`).run(key, JSON.stringify(value), now);
}

export function storyDnaLookupStatus(type: RatingContentType): StoryDnaLookupStatus | null {
  const row = libraryDatabase().prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = ?
`).get(lookupStatusKey(type)) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as StoryDnaLookupStatus;
  } catch {
    return null;
  }
}

async function enrichSparseInputs(
  type: RatingContentType,
  inputs: StoryDnaInput[],
  provider: StoryDnaStructuredLookupProvider | null,
  now: number,
): Promise<StoryDnaInput[]> {
  const withCachedLookup = inputs.map(cachedStructuredLookup);
  const limit = boundedInteger(process.env.MANGO_STORY_DNA_LOOKUP_LIMIT, 48, 1, 240);
  const pending = withCachedLookup.filter((input) => {
    const lookup = storyDnaRequestItem(input).selective_lookup;
    return lookup.requested && !lookup.used;
  });
  const cursorRow = libraryDatabase().prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = ?
`).get(lookupCursorKey(type)) as { value_json: string } | undefined;
  const parsedCursor = Number(cursorRow?.value_json ?? 0);
  const offset = pending.length > 0 && Number.isFinite(parsedCursor)
    ? Math.max(0, Math.floor(parsedCursor)) % pending.length
    : 0;
  const rotated = [...pending.slice(offset), ...pending.slice(0, offset)];
  const sparse = rotated.slice(0, limit);
  const nextCursor = pending.length > 0 ? (offset + sparse.length) % pending.length : 0;
  persistLookupRuntimeState(lookupCursorKey(type), nextCursor, now);
  if (!provider || sparse.length === 0) {
    persistLookupRuntimeState(lookupStatusKey(type), {
      pending: pending.length,
      requested: 0,
      resolved: 0,
      material: 0,
      unresolved: 0,
      provider_failed: false,
      provider_registered: provider !== null,
      cursor: nextCursor,
      updated_at: now,
    } satisfies StoryDnaLookupStatus, now);
    return withCachedLookup;
  }
  let enriched: StoryDnaInput[];
  try {
    enriched = await provider(sparse);
  } catch {
    persistLookupRuntimeState(lookupStatusKey(type), {
      pending: pending.length,
      requested: sparse.length,
      resolved: 0,
      material: 0,
      unresolved: sparse.length,
      provider_failed: true,
      provider_registered: true,
      cursor: nextCursor,
      updated_at: now,
    } satisfies StoryDnaLookupStatus, now);
    return withCachedLookup;
  }
  const enrichedByKey = new Map(enriched.map((item) => [contentKey(item.type, item.id), item]));
  const selected = new Set(sparse.map((input) => contentKey(input.type, input.id)));
  let resolved = 0;
  let material = 0;
  const output = withCachedLookup.map((input) => {
    if (!selected.has(contentKey(input.type, input.id))) return input;
    const replacement = enrichedByKey.get(contentKey(input.type, input.id));
    if (!replacement) return input;
    resolved += 1;
    const merged = mergeStructuredLookup(input, replacement);
    if (merged.material_fields.length === 0) return input;
    material += 1;
    const record: StoryDnaLookupCacheRecord = {
      version: 'story-dna-structured-lookup-v1',
      raw_evidence_hash: storyDnaEvidenceHash(input),
      enriched_input: merged.input,
      material_fields: merged.material_fields,
      looked_up_at: now,
    };
    persistLookupRuntimeState(lookupStateKey(input.type, input.id), record, now);
    return merged.input;
  });
  const pendingAfter = output.filter((input) => {
    const lookup = storyDnaRequestItem(input).selective_lookup;
    return lookup.requested && !lookup.used;
  }).length;
  persistLookupRuntimeState(lookupStatusKey(type), {
    pending: pendingAfter,
    requested: sparse.length,
    resolved,
    material,
    unresolved: sparse.length - material,
    provider_failed: false,
    provider_registered: true,
    cursor: nextCursor,
    updated_at: now,
  } satisfies StoryDnaLookupStatus, now);
  return output;
}

async function scanVerifiedCorpus(
  type: RatingContentType,
  listPage: typeof listVerifiedRecommendationCatalogPage,
): Promise<{ rows: VerifiedRecommendationCatalogRow[]; generation: number; verifiedCount: number }> {
  const rows: VerifiedRecommendationCatalogRow[] = [];
  let cursor: string | null = null;
  let generation: number | null = null;
  let verifiedCount = 0;
  do {
    const page: VerifiedRecommendationCatalogPage = await listPage({
      content_type: type,
      cursor,
      limit: 1_000,
    });
    if (generation !== null && page.corpus_generation !== generation) {
      throw new StaleStoryGraphGenerationError('verified corpus changed during StoryDNA scan');
    }
    generation = page.corpus_generation;
    verifiedCount = page.verified_count;
    rows.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor !== null);
  if (rows.length !== verifiedCount) {
    throw new StaleStoryGraphGenerationError(
      `verified corpus accounting drifted during scan (${rows.length}/${verifiedCount})`,
    );
  }
  return { rows, generation: generation ?? 1, verifiedCount };
}

function readHouseholdSignals(type: RatingContentType): HouseholdSignals {
  const db = libraryDatabase();
  const keyRows = (sql: string) => db.prepare(sql).all(type) as Array<{ type: RatingContentType; id: string }>;
  const savedRows = db.prepare(`
SELECT li.type, li.id, psi.saved_at AS occurred_at
FROM profile_saved_items psi
JOIN library_items li ON li.item_key = psi.item_key
WHERE psi.profile_id = 'household' AND li.type = ?
`).all(type) as Array<{ type: RatingContentType; id: string; occurred_at: number }>;
  const watchedRows = db.prepare(`
SELECT li.type, li.id, pws.last_watched_at AS occurred_at,
       CASE WHEN pws.finished_at IS NOT NULL OR pws.progress_pct >= 0.9 THEN 'completion' ELSE 'partial' END AS kind
FROM profile_watch_state pws
JOIN library_items li ON li.item_key = pws.item_key
WHERE pws.profile_id = 'household' AND li.type = ?
  AND (
    pws.finished_at IS NOT NULL OR pws.progress_pct >= 0.9 OR
    (pws.duration_sec > 0 AND pws.position_sec >= MIN(pws.duration_sec * 0.25, 300)) OR
    (pws.duration_sec <= 0 AND pws.position_sec >= 120)
  )
`).all(type) as Array<{
    type: RatingContentType;
    id: string;
    occurred_at: number;
    kind: 'partial' | 'completion';
  }>;
  const toSet = (rows: Array<{ type: RatingContentType; id: string }>) => new Set(
    rows.map((row) => contentKey(row.type, row.id)),
  );
  return {
    implicit: [
      ...savedRows.map((row): StoryGraphImplicitSignal => ({ ...row, kind: 'saved' })),
      ...watchedRows,
    ],
    rated: new Set(listRatings(type, 'household').map((row) => contentKey(row.type, row.id))),
    saved: toSet(savedRows),
    watched: toSet(watchedRows),
    hidden: toSet(keyRows(`
SELECT DISTINCT li.type, li.id FROM library_items li
WHERE li.type = ? AND li.hidden = 1
`)),
    blocked: toSet(keyRows(`
SELECT DISTINCT li.type, li.id FROM library_items li
WHERE li.type = ? AND li.blocked = 1
`)),
    not_for_me: toSet(keyRows(`
SELECT DISTINCT li.type, li.id
FROM profile_library_feedback pf
JOIN library_items li ON li.item_key = pf.item_key
WHERE pf.profile_id = 'household' AND pf.feedback = 'not_interested' AND li.type = ?
`)),
  };
}

function tasteRevision(
  type: RatingContentType,
  ratings: FireWaterRating[],
  signals: HouseholdSignals,
  now: number,
): string {
  return sha256({
    type,
    ratings: ratings.map((rating) => ({
      type: rating.type, id: rating.id, fire: rating.fire, water: rating.water,
      revision: rating.revision,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    implicit: signals.implicit.map((signal) => ({
      type: signal.type, id: signal.id, kind: signal.kind, occurred_at: signal.occurred_at,
    })).sort((left, right) => (
      left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind)
    )),
    exact_vetoes: {
      saved: [...signals.saved].sort(), watched: [...signals.watched].sort(),
      hidden: [...signals.hidden].sort(), blocked: [...signals.blocked].sort(),
      not_for_me: [...signals.not_for_me].sort(),
    },
    watch_decay_bucket: Math.floor(now / DAY_MS),
  });
}

function selectTeacherBackfillBatch(
  type: RatingContentType,
  pending: StoryDnaInput[],
  limit: number,
  now: number,
  priorityKeys: ReadonlySet<StoryGraphContentId> = new Set(),
): StoryDnaInput[] {
  const db = libraryDatabase();
  const latestRows = db.prepare(`
WITH latest AS (
  SELECT content_id, MAX(generation_id) AS generation_id
  FROM vod_story_dna_documents WHERE content_type = ? GROUP BY content_id
)
SELECT docs.content_id, docs.status, docs.evidence_hash, docs.next_retry_at
FROM vod_story_dna_documents docs
JOIN latest ON latest.content_id = docs.content_id AND latest.generation_id = docs.generation_id
WHERE docs.content_type = ?
`).all(type, type) as Array<{
    content_id: string;
    status: string;
    evidence_hash: string;
    next_retry_at: number | null;
  }>;
  const latest = new Map(latestRows.map((row) => [row.content_id, row]));
  const priorityStratified = (values: StoryDnaInput[]) => [
    ...themeStratifiedStoryDnaInputs(values.filter((input) => (
      priorityKeys.has(contentKey(input.type, input.id))
    ))),
    ...themeStratifiedStoryDnaInputs(values.filter((input) => (
      !priorityKeys.has(contentKey(input.type, input.id))
    ))),
  ];
  const changedOrNew = priorityStratified(pending.filter((input) => {
    const prior = latest.get(input.id);
    return !prior || prior.status === 'valid' || prior.evidence_hash !== storyDnaEvidenceHash(input);
  }));
  const retry = priorityStratified(pending.filter((input) => {
    const prior = latest.get(input.id);
    return prior?.status !== 'valid' && prior?.evidence_hash === storyDnaEvidenceHash(input)
      && (prior.next_retry_at === null || prior.next_retry_at <= now);
  }));
  const selected = changedOrNew.slice(0, limit);
  const remaining = limit - selected.length;
  if (remaining <= 0 || retry.length === 0) return selected;
  const cursorKey = `vod_story_dna_retry_cursor:${type}`;
  const cursorRow = db.prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = ?
`).get(cursorKey) as { value_json: string } | undefined;
  const parsed = Number(cursorRow?.value_json ?? 0);
  const offset = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) % retry.length : 0;
  const rotated = [...retry.slice(offset), ...retry.slice(0, offset)];
  db.prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`).run(cursorKey, JSON.stringify((offset + remaining) % retry.length), now);
  return [...selected, ...rotated.slice(0, remaining)];
}

function exclusionReason(
  row: VerifiedRecommendationCatalogRow,
  hasDocument: boolean,
  signals: HouseholdSignals,
): string | null {
  const key = contentKey(row.type, row.id);
  if (!row.title?.trim()) return 'missing_title';
  if (!hasDocument) return 'story_dna_retryable_failure';
  if (!row.poster?.trim()) return 'missing_artwork';
  if (signals.rated.has(key)) return 'rated_exact';
  if (signals.saved.has(key)) return 'saved_exact';
  if (signals.watched.has(key)) return 'meaningfully_watched_exact';
  if (signals.hidden.has(key)) return 'hidden_exact';
  if (signals.blocked.has(key)) return 'blocked_exact';
  if (signals.not_for_me.has(key)) return 'not_for_me_exact';
  return null;
}

function progressiveExclusionReason(
  row: VerifiedRecommendationCatalogRow,
  profile: ContentProfileV2 | undefined,
  signals: HouseholdSignals,
): string | null {
  const key = contentKey(row.type, row.id);
  if (!row.title?.trim() || !profile) return 'missing_title';
  if (!row.poster?.trim()) return 'missing_artwork';
  if (!contentProfileIsServingEligible(profile)) return 'sparse_unresolved';
  if (signals.rated.has(key)) return 'rated_exact';
  if (signals.saved.has(key)) return 'saved_exact';
  if (signals.watched.has(key)) return 'meaningfully_watched_exact';
  if (signals.hidden.has(key)) return 'hidden_exact';
  if (signals.blocked.has(key)) return 'blocked_exact';
  if (signals.not_for_me.has(key)) return 'not_for_me_exact';
  return null;
}

function graphTitle(
  input: StoryDnaInput,
  document: StoryDnaDocument,
): StoryGraphTitle {
  return {
    type: document.type,
    id: document.id,
    title: input.title,
    year: input.year === null || input.year === undefined ? null : String(input.year),
    story_dna: document,
    edges: storyDnaToGraphEdges(document, input).map((edge) => ({
      family: edge.family as StoryGraphFamily,
      node_key: edge.node_key,
      intensity: edge.intensity,
      confidence: edge.confidence,
      ordinal: edge.family.startsWith('facet.'),
      source: edge.edge_source,
    })),
  } as StoryGraphTitle;
}

function loadStructuredMetadataCache(inputs: StoryDnaInput[]): StoryDnaInput[] {
  if (inputs.length === 0) return [];
  const select = libraryDatabase().prepare(`
SELECT source_semantic_hash, enriched_input_json
FROM vod_semantic_metadata_cache
WHERE content_type = ? AND content_id = ?
`);
  return inputs.map((input) => {
    const row = select.get(input.type, input.id) as {
      source_semantic_hash: string;
      enriched_input_json: string;
    } | undefined;
    if (!row || row.source_semantic_hash !== contentSemanticEvidenceHash(input)) return input;
    try {
      const enriched = JSON.parse(row.enriched_input_json) as StoryDnaInput;
      if (enriched.type !== input.type || enriched.id !== input.id) return input;
      return {
        ...enriched,
        curated_pool_memberships: input.curated_pool_memberships,
        rail_ids: input.rail_ids,
      };
    } catch {
      return input;
    }
  });
}

function latestProgressiveProfiles(
  type: RatingContentType,
): Map<StoryGraphContentId, ContentProfileV2> {
  const rows = libraryDatabase().prepare(`
WITH latest AS (
  SELECT docs.content_id, MAX(docs.generation_id) AS generation_id
  FROM vod_story_dna_documents docs
  JOIN vod_story_dna_generations generations ON generations.generation_id = docs.generation_id
  WHERE docs.content_type = ? AND generations.profile_version = ?
    AND docs.profile_json IS NOT NULL
  GROUP BY docs.content_id
)
SELECT docs.content_id, docs.profile_json
FROM vod_story_dna_documents docs
JOIN latest ON latest.content_id = docs.content_id AND latest.generation_id = docs.generation_id
WHERE docs.content_type = ?
`).all(type, VOD_CONTENT_PROFILE_VERSION, type) as Array<{
    content_id: string;
    profile_json: string;
  }>;
  const output = new Map<StoryGraphContentId, ContentProfileV2>();
  for (const row of rows) {
    try {
      const profile = JSON.parse(row.profile_json) as ContentProfileV2;
      if (profile.profile_version === VOD_CONTENT_PROFILE_VERSION
        && profile.type === type && profile.id === row.content_id) {
        output.set(contentKey(type, row.content_id), profile);
      }
    } catch {
      // A malformed prior profile is ignored; the deterministic compiler repairs it.
    }
  }
  return output;
}

function compatibleProgressiveStoryDnaOverlays(
  type: RatingContentType,
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>,
): Map<StoryGraphContentId, StoryDnaDocument> {
  const exact = loadCompatibleStoryDnaTeacherCache([...inputByKey.values()]);
  const output = new Map<StoryGraphContentId, StoryDnaDocument>();
  const immutableRows = libraryDatabase().prepare(`
SELECT content_id, semantic_evidence_hash, document_hash, document_json
FROM vod_story_dna_overlays WHERE content_type = ?
ORDER BY created_at, content_id
`).all(type) as Array<{
    content_id: string;
    semantic_evidence_hash: string;
    document_hash: string;
    document_json: string;
  }>;
  for (const row of immutableRows) {
    const key = contentKey(type, row.content_id);
    if (output.has(key)) continue;
    const current = inputByKey.get(key);
    if (!current || row.semantic_evidence_hash !== contentSemanticEvidenceHash(current)) continue;
    try {
      const document = validateStoryDnaDocument(JSON.parse(row.document_json), new Set([key]));
      if (storyDnaDocumentHash(document) === row.document_hash) output.set(key, document);
    } catch {
      // Immutable corrupt or mismatched overlays detach without mutation.
    }
  }
  for (const [key, document] of exact) {
    const typedKey = key as StoryGraphContentId;
    if (!output.has(typedKey)) output.set(typedKey, document);
  }
  const rows = libraryDatabase().prepare(`
WITH latest AS (
  SELECT content_id, MAX(generation_id) AS generation_id
  FROM vod_story_dna_documents
  WHERE content_type = ? AND status = 'valid' AND story_dna_json IS NOT NULL
  GROUP BY content_id
)
SELECT docs.content_id, docs.title, docs.evidence_json, docs.story_dna_json
FROM vod_story_dna_documents docs
JOIN latest ON latest.content_id = docs.content_id AND latest.generation_id = docs.generation_id
WHERE docs.content_type = ?
`).all(type, type) as Array<{
    content_id: string;
    title: string | null;
    evidence_json: string;
    story_dna_json: string;
  }>;
  for (const row of rows) {
    const key = contentKey(type, row.content_id);
    if (output.has(key)) continue;
    const current = inputByKey.get(key);
    if (!current) continue;
    try {
      const document = validateStoryDnaDocument(JSON.parse(row.story_dna_json), new Set([key]));
      const stored = storyDnaInputFromPersistedEvidence({
        type,
        id: row.content_id,
        title: row.title,
        year: null,
        evidence_json: row.evidence_json,
        document,
      });
      if (stored && contentSemanticEvidenceHash(stored) === contentSemanticEvidenceHash(current)) {
        output.set(key, document);
      }
    } catch {
      // Invalid legacy rows remain preserved but never become ranking evidence.
    }
  }
  return output;
}

function ensureSemanticReferencePanel(input: {
  type: RatingContentType;
  profiles: Map<StoryGraphContentId, ContentProfileV2>;
  overlays: Map<StoryGraphContentId, StoryDnaDocument>;
  now: number;
}): string {
  const selectionProvenance = `stable-hash-existing-story-dna:${VOD_CONTENT_PROFILE_COMPILER_VERSION}:provisional-history-unknown`;
  const frozen = libraryDatabase().prepare(`
SELECT reference_revision
FROM vod_semantic_reference_items
WHERE content_type = ? AND selection_provenance = ?
GROUP BY reference_revision
ORDER BY MIN(selected_at), reference_revision
LIMIT 1
`).get(input.type, selectionProvenance) as { reference_revision: string } | undefined;
  if (frozen) return frozen.reference_revision;
  const eligible = [...input.overlays.entries()].flatMap(([key, document]) => {
    const profile = input.profiles.get(key);
    if (!profile) return [];
    const stratum = progressiveProfileStratum(profile);
    return [{ key, profile, document, stratum, order: sha256(`reference:${key}`) }];
  }).sort((left, right) => left.order.localeCompare(right.order)).slice(0, 400);
  const revision = sha256({
    version: 'vod-semantic-reference-v1',
    compiler_version: VOD_CONTENT_PROFILE_COMPILER_VERSION,
    type: input.type,
    items: eligible.map((item) => ({
      key: item.key,
      document_hash: storyDnaDocumentHash(item.document),
      stratum: item.stratum,
    })),
  });
  const insert = libraryDatabase().prepare(`
INSERT OR IGNORE INTO vod_semantic_reference_items(
  reference_revision, content_type, content_id, document_hash, stratum,
  selection_provenance, selected_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
  libraryDatabase().transaction(() => {
    for (const item of eligible) {
      insert.run(
        revision,
        input.type,
        item.profile.id,
        storyDnaDocumentHash(item.document),
        item.stratum,
        selectionProvenance,
        input.now,
      );
    }
  })();
  return revision;
}

function progressiveProfileStratum(profile: ContentProfileV2): string {
  const language = profile.edges.find((edge) => edge.family === 'language')?.node_key
    ?? 'language-unknown';
  const decade = profile.year ? `${profile.year.slice(0, 3)}0s` : 'unknown-decade';
  const source = profile.profile_state === 'enriched' ? 'teacher-overlay' : 'factual-base';
  return [profile.profile_state, decade, language, source].join(':');
}

function progressiveAcquisitionResiduals(
  profile: ContentProfileV2 | undefined,
  score: StoryGraphScoredRecommendation,
  calibration: readonly StoryFrontierCalibrationBand[],
): { lower: number; upper: number } {
  const band = profile
    ? storyFrontierBandFor(calibration, progressiveProfileStratum(profile))
    : null;
  if (band?.status === 'calibrated' || band?.status === 'pooled') {
    return { lower: band.lower_residual, upper: band.upper_residual };
  }
  return {
    lower: -score.posterior_standard_deviation,
    upper: score.posterior_standard_deviation,
  };
}

function persistProgressiveCalibration(input: {
  type: RatingContentType;
  referenceRevision: string;
  tasteRevision: string;
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>;
  profiles: Map<StoryGraphContentId, ContentProfileV2>;
  ranked: StoryGraphRankResult;
  now: number;
}): StoryFrontierCalibrationBand[] {
  const referenceRows = libraryDatabase().prepare(`
SELECT content_id, stratum FROM vod_semantic_reference_items
WHERE reference_revision = ? AND content_type = ?
ORDER BY content_id
`).all(input.referenceRevision, input.type) as Array<{ content_id: string; stratum: string }>;
  const fullScores = new Map(input.ranked.ranked.map((item) => [
    contentKey(item.type, item.id), item.rank_score,
  ]));
  const exactModel: StoryTasteModel = {
    model_version: input.ranked.model_version,
    background: input.ranked.background,
    threads: input.ranked.threads,
    explicit_evidence_present: input.ranked.diagnostics.qualifying_explicit > 0,
    selected_k: input.ranked.selected_k,
    loao: input.ranked.loao,
    diagnostics: input.ranked.diagnostics,
  };
  const samples: StoryFrontierCalibrationSample[] = [];
  for (const row of referenceRows) {
    const key = contentKey(input.type, row.content_id);
    const storyInput = input.inputByKey.get(key);
    const fullScore = fullScores.get(key);
    if (!storyInput || fullScore === undefined || !input.profiles.has(key)) continue;
    const masked = compileContentProfileV2(storyInput);
    const partialScore = scoreStoryGraphCandidate(
      exactModel,
      contentProfileStoryGraphTitle(masked),
    ).rank_score;
    samples.push({
      stratum: row.stratum,
      partial_score: partialScore,
      full_score: fullScore,
    });
  }
  const bands = buildStoryFrontierCalibration(samples);
  const provisionalReference = (libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_semantic_reference_items
WHERE reference_revision = ? AND content_type = ? AND selection_provenance LIKE '%:provisional-%'
`).get(input.referenceRevision, input.type) as { count: number }).count > 0;
  const reportedBands = provisionalReference ? bands.map((band) => ({
    ...band,
    status: band.status === 'insufficient' ? band.status : 'provisional' as const,
  })) : bands;
  const insert = libraryDatabase().prepare(`
INSERT INTO vod_semantic_calibration(
  reference_revision, content_type, taste_revision, stratum, sample_count,
  lower_residual, upper_residual, empirical_coverage, status, calculated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(reference_revision, content_type, taste_revision, stratum) DO UPDATE SET
  sample_count = excluded.sample_count,
  lower_residual = excluded.lower_residual,
  upper_residual = excluded.upper_residual,
  empirical_coverage = excluded.empirical_coverage,
  status = excluded.status,
  calculated_at = excluded.calculated_at
`);
  libraryDatabase().transaction(() => {
    for (const band of reportedBands) {
      insert.run(
        input.referenceRevision,
        input.type,
        input.tasteRevision,
        band.stratum,
        band.sample_count,
        band.lower_residual,
        band.upper_residual,
        band.empirical_coverage,
        band.status,
        input.now,
      );
    }
  })();
  return reportedBands;
}

function selectProgressiveFrontierCandidates(input: {
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>;
  profiles: Map<StoryGraphContentId, ContentProfileV2>;
  overlays: Map<StoryGraphContentId, StoryDnaDocument>;
  ratings: FireWaterRating[];
  signals: HouseholdSignals;
  ranked: StoryGraphRankResult;
  calibration: StoryFrontierCalibrationBand[];
}): StoryDnaFrontierCandidate[] {
  const selected = new Map<StoryGraphContentId, StoryDnaFrontierCandidate>();
  const add = (key: StoryGraphContentId, reason: StoryDnaFrontierCandidate['reason'], priority: number) => {
    if (input.overlays.has(key)) return;
    const storyInput = input.inputByKey.get(key);
    if (!storyInput) return;
    const previous = selected.get(key);
    if (!previous || priority > previous.priority) selected.set(key, { input: storyInput, reason, priority });
  };
  for (const rating of input.ratings) {
    if (positiveRatingEvidence(rating.fire) <= 0 && positiveRatingEvidence(rating.water) <= 0) continue;
    add(contentKey(rating.type, rating.id), 'positive_anchor', 1_000);
  }
  if (!input.ratings.some((rating) => (
    positiveRatingEvidence(rating.fire) > 0 || positiveRatingEvidence(rating.water) > 0
  ))) {
    for (const signal of input.signals.implicit) {
      add(contentKey(signal.type, signal.id), 'implicit_anchor', 900);
    }
  }
  const byThread = new Map<string, StoryGraphScoredRecommendation[]>();
  for (const item of input.ranked.ranked) {
    if (!item.best_thread_id) continue;
    const rows = byThread.get(item.best_thread_id) ?? [];
    rows.push(item);
    byThread.set(item.best_thread_id, rows);
  }
  for (const [, rows] of byThread) {
    rows.sort((left, right) => right.rank_score - left.rank_score || left.id.localeCompare(right.id));
    const credible = rows.filter((item) => {
      const profile = input.profiles.get(contentKey(item.type, item.id));
      return profile ? contentProfileIsServingEligible(profile) : false;
    });
    const shortage = credible.length < 24;
    const frontier = rows.slice(0, 48);
    const boundary = frontier.at(-1)?.rank_score ?? Number.NEGATIVE_INFINITY;
    for (const item of frontier) {
      const key = contentKey(item.type, item.id);
      const profile = input.profiles.get(key);
      const residuals = progressiveAcquisitionResiduals(profile, item, input.calibration);
      const upperError = Math.max(0, residuals.upper);
      if (shortage) add(key, 'thread_shortage', 800);
      else if (item.rank_score + upperError >= boundary) {
        add(key, 'reserve_boundary', 600 + Math.round(upperError * 100));
      }
    }
    for (const item of rows.slice(48)) {
      const profile = input.profiles.get(contentKey(item.type, item.id));
      const residuals = progressiveAcquisitionResiduals(profile, item, input.calibration);
      const lowerError = Math.min(0, residuals.lower);
      const upperError = Math.max(0, residuals.upper);
      if (item.rank_score + lowerError <= boundary
        && item.rank_score + upperError >= boundary) {
        add(contentKey(item.type, item.id), 'fit_floor_uncertainty', 500);
      }
    }
  }
  const audit = [...input.profiles.entries()]
    .filter(([key, profile]) => !input.overlays.has(key) && profile.profile_state !== 'unrankable')
    .sort(([left], [right]) => sha256(`audit:${left}`).localeCompare(sha256(`audit:${right}`)))
    .slice(0, 2);
  for (const [key] of audit) add(key, 'stable_audit', 100);
  return [...selected.values()].sort((left, right) => (
    right.priority - left.priority
    || `${left.input.type}:${left.input.id}`.localeCompare(`${right.input.type}:${right.input.id}`)
  ));
}

function persistProgressiveProfileGeneration(input: {
  type: RatingContentType;
  corpusGeneration: number;
  semanticRevision: string;
  referenceRevision: string;
  verifiedCount: number;
  rows: VerifiedRecommendationCatalogRow[];
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>;
  profiles: Map<StoryGraphContentId, ContentProfileV2>;
  overlays: Map<StoryGraphContentId, StoryDnaDocument>;
  evidenceRevision: string;
  now: number;
}): number {
  const db = libraryDatabase();
  const teacherContracts = [...new Set([...input.overlays.values()].map((document) => (
    `${document.model_version}:${document.prompt_version}:${document.schema_version}`
  )))].sort();
  const verifiedKeys = new Set(input.rows.map((row) => contentKey(row.type, row.id)));
  const verifiedProfiles = [...input.profiles.entries()].filter(([key]) => verifiedKeys.has(key));
  const baseComplete = verifiedProfiles.filter(([, profile]) => profile.profile_state === 'base').length;
  const enriched = verifiedProfiles.filter(([, profile]) => profile.profile_state === 'enriched').length;
  const partial = verifiedProfiles.filter(([, profile]) => profile.profile_state === 'sparse_unresolved').length;
  const unknownFamilies = verifiedProfiles.reduce((sum, [, profile]) => (
    sum + Object.values(profile.family_coverage).filter((family) => family.state === 'unknown').length
  ), 0);
  const generation = db.prepare(`
INSERT INTO vod_story_dna_generations(
  content_type, schema_version, ontology_version, prompt_version, model_version,
  corpus_generation, evidence_revision, status, verified_count, complete_count,
  failure_count, started_at, completed_at, profile_version, compiler_version,
  semantic_revision, reference_revision, base_complete_count,
  teacher_complete_count, partial_count, unknown_family_count, teacher_contracts_json
) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING generation_id
`).get(
    input.type,
    STORY_DNA_SCHEMA_VERSION,
    STORY_DNA_ONTOLOGY_VERSION,
    STORY_DNA_PROMPT_VERSION,
    'mixed-compatible',
    input.corpusGeneration,
    input.evidenceRevision,
    input.verifiedCount,
    enriched,
    partial,
    input.now,
    VOD_CONTENT_PROFILE_VERSION,
    VOD_CONTENT_PROFILE_COMPILER_VERSION,
    input.semanticRevision,
    input.referenceRevision,
    baseComplete,
    enriched,
    partial,
    unknownFamilies,
    JSON.stringify(teacherContracts),
  ) as { generation_id: number };
  const insertDocument = db.prepare(`
INSERT INTO vod_story_dna_documents(
  generation_id, content_type, content_id, title, evidence_json, evidence_hash,
  story_dna_json, family_confidence_json, stable_external_ids_json, lookup_used,
  status, failure_reason, retry_count, next_retry_at, created_at, updated_at,
  profile_json, profile_hash, semantic_evidence_hash, base_feature_hash,
  family_coverage_json, teacher_document_hash, teacher_contract_revision, profile_status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  const insertEdge = db.prepare(`
INSERT INTO vod_content_profile_edges(
  generation_id, content_type, content_id, node_key, family, intensity,
  confidence, edge_source, producer_version, dependency_hash
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  const insertOverlay = db.prepare(`
INSERT OR IGNORE INTO vod_story_dna_overlays(
  content_type, content_id, semantic_evidence_hash, document_hash, document_json,
  schema_version, ontology_version, prompt_version, model_version, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  db.transaction(() => {
    for (const [key, overlay] of [...input.overlays.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    ))) {
      const storyInput = input.inputByKey.get(key);
      if (!storyInput) continue;
      insertOverlay.run(
        overlay.type,
        overlay.id,
        contentSemanticEvidenceHash(storyInput),
        storyDnaDocumentHash(overlay),
        stableStoryDnaJson(overlay),
        overlay.schema_version,
        overlay.ontology_version,
        overlay.prompt_version,
        overlay.model_version,
        input.now,
      );
    }
    for (const [key, profile] of [...input.profiles.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const storyInput = input.inputByKey.get(key);
      if (!storyInput) continue;
      const overlay = input.overlays.get(key);
      const request = storyDnaRequestItem(storyInput);
      insertDocument.run(
        generation.generation_id,
        profile.type,
        profile.id,
        profile.title,
        stableStoryDnaJson(request),
        profile.semantic_evidence_hash,
        overlay ? JSON.stringify(overlay) : null,
        JSON.stringify(Object.fromEntries(Object.entries(profile.family_coverage).map(([family, coverage]) => (
          [family, coverage.confidence]
        )))),
        JSON.stringify(request.evidence.external_ids),
        request.selective_lookup.used ? 1 : 0,
        profile.profile_state === 'sparse_unresolved' ? 'sparse-profile' : null,
        input.now,
        input.now,
        JSON.stringify(profile),
        profile.profile_hash,
        profile.semantic_evidence_hash,
        profile.base_feature_hash,
        JSON.stringify(profile.family_coverage),
        profile.teacher_document_hash,
        overlay ? `${overlay.model_version}:${overlay.prompt_version}:${overlay.schema_version}` : null,
        profile.profile_state,
      );
      for (const item of profile.edges) {
        insertEdge.run(
          generation.generation_id,
          profile.type,
          profile.id,
          item.node_key,
          item.family,
          item.intensity,
          item.confidence,
          item.source,
          item.source === 'llm_teacher' ? overlay?.model_version ?? 'legacy-teacher'
            : VOD_CONTENT_PROFILE_COMPILER_VERSION,
          profile.semantic_evidence_hash,
        );
      }
    }
    const count = db.prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_documents WHERE generation_id = ?
`).get(generation.generation_id) as { count: number };
    if (count.count !== input.profiles.size) {
      throw new Error(`progressive profile child integrity mismatch: ${count.count}/${input.profiles.size}`);
    }
    db.prepare(`
UPDATE vod_story_dna_generations
SET status = 'complete', completed_at = ?, last_error = NULL
WHERE generation_id = ? AND status = 'building'
`).run(input.now, generation.generation_id);
  })();
  return generation.generation_id;
}

type PriorAnchorEvidence = {
  input: StoryDnaInput;
  document: StoryDnaDocument | null;
};

function storyDnaInputFromPersistedEvidence(input: {
  type: RatingContentType;
  id: string;
  title: string | null;
  year: string | null;
  evidence_json: string;
  document: StoryDnaDocument;
}): StoryDnaInput | null {
  const parsed = safeJsonObject(input.evidence_json);
  const storedRequest = parsed.evidence && typeof parsed.evidence === 'object'
    ? parsed as unknown as StoryDnaRequestItem
    : null;
  const evidence = (storedRequest?.evidence ?? parsed) as unknown as StoryDnaEvidence;
  const sources = stringList(evidence.sources);
  const selective = storedRequest?.selective_lookup ?? input.document.selective_lookup;
  const value: StoryDnaInput = {
    type: input.type,
    id: input.id,
    title: storedRequest?.title?.trim() || input.title?.trim() || input.document.id,
    year: storedRequest?.year ?? input.year,
    synopsis: typeof evidence.synopsis === 'string' ? evidence.synopsis : null,
    genres: stringList(evidence.genres),
    keywords: stringList(evidence.keywords),
    languages: stringList(evidence.languages),
    countries: stringList(evidence.countries),
    runtime_minutes: Number(evidence.runtime_minutes) || null,
    release_state: typeof evidence.release_state === 'string' ? evidence.release_state : null,
    format: typeof evidence.format === 'string' ? evidence.format : null,
    cast: stringList(evidence.cast),
    characters: stringList(evidence.characters),
    directors: stringList(evidence.directors),
    writers: stringList(evidence.writers),
    awards_certification: stringList(evidence.awards_certification),
    external_ids: externalIds(evidence.external_ids),
    curated_pool_memberships: storyDnaCuratedPoolMemberships(
      stringList(evidence.curated_pool_memberships),
    ),
    rail_ids: storyDnaCuratedPoolMemberships(stringList(evidence.curated_pool_memberships)),
    source: sources[0] ?? 'catalog',
    evidence_sources: sources.slice(1),
    field_provenance: fieldProvenance(evidence.field_provenance),
    retrieved_at: typeof evidence.retrieved_at === 'string' ? evidence.retrieved_at : null,
    lookup_reasons: selective?.reasons,
    lookup_used: selective?.used === true,
  };
  if (storedRequest && (storedRequest.type !== input.type || storedRequest.id !== input.id)) return null;
  return value;
}

function validatedDocumentForInput(
  raw: unknown,
  input: StoryDnaInput,
  expectedModelVersion: string | null,
): StoryDnaDocument | null {
  const key = contentKey(input.type, input.id);
  try {
    const document = validateStoryDnaDocument(raw, new Set([key]));
    const request = storyDnaRequestItem(input);
    if (document.input_hash !== storyDnaInputHash(input)
      || document.provenance.evidence_hash !== storyDnaEvidenceHash(input)
      || stableStoryDnaJson(document.provenance.evidence_fields)
        !== stableStoryDnaJson(storyDnaEvidenceFields(input))
      || stableStoryDnaJson(document.provenance.sources)
        !== stableStoryDnaJson(request.evidence.sources)
      || stableStoryDnaJson(document.selective_lookup)
        !== stableStoryDnaJson(request.selective_lookup)
      || (expectedModelVersion !== null && document.model_version !== expectedModelVersion)) return null;
    return document;
  } catch {
    return null;
  }
}

function priorAnchorEvidence(
  type: RatingContentType,
  keys: Set<StoryGraphContentId>,
  existing: Set<StoryGraphContentId>,
  expectedModelVersion: string | null,
): PriorAnchorEvidence[] {
  const db = libraryDatabase();
  const output: PriorAnchorEvidence[] = [];
  const select = db.prepare(`
SELECT docs.title, docs.evidence_json, docs.story_dna_json,
       (SELECT items.year FROM vod_rank_items items
        WHERE items.content_type = docs.content_type AND items.content_id = docs.content_id
        ORDER BY items.rank_generation_id DESC LIMIT 1) AS year
FROM vod_story_dna_documents docs
WHERE docs.content_type = ? AND docs.content_id = ?
  AND docs.status = 'valid' AND docs.story_dna_json IS NOT NULL
ORDER BY docs.generation_id DESC LIMIT 1
`);
  for (const key of [...keys].sort()) {
    if (existing.has(key)) continue;
    const [, id] = key.split(':', 2) as [RatingContentType, string];
    const row = select.get(type, id) as {
      title: string | null;
      year: string | null;
      evidence_json: string;
      story_dna_json: string;
    } | undefined;
    if (!row) continue;
    try {
      const rawDocument = JSON.parse(row.story_dna_json) as unknown;
      const parsedDocument = validateStoryDnaDocument(rawDocument, new Set([key]));
      const storyInput = storyDnaInputFromPersistedEvidence({
        type, id, title: row.title, year: row.year, evidence_json: row.evidence_json,
        document: parsedDocument,
      });
      if (!storyInput) continue;
      output.push({
        input: storyInput,
        document: validatedDocumentForInput(rawDocument, storyInput, expectedModelVersion),
      });
    } catch {
      // Malformed prior evidence/document cannot become an anchor or teacher input.
    }
  }
  return output;
}

function persistOntologyAndStoryEdges(
  generationId: number,
  title: StoryGraphTitle,
): void {
  const db = libraryDatabase();
  const insertNode = db.prepare(`
INSERT OR IGNORE INTO vod_ontology_nodes(
  ontology_version, node_key, family, value_key, parent_key, ordinal
) VALUES (?, ?, ?, ?, ?, ?)
`);
  const insertOntologyEdge = db.prepare(`
INSERT OR IGNORE INTO vod_ontology_edges(
  ontology_version, from_node_key, to_node_key, edge_kind
) VALUES (?, ?, ?, ?)
`);
  const insertTitleEdge = db.prepare(`
INSERT OR REPLACE INTO vod_story_dna_edges(
  generation_id, content_type, content_id, node_key, family,
  intensity, confidence, edge_source
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
  for (const edge of title.edges ?? []) {
    const familyRoot = `family:${edge.family}`;
    const fixedParent = storyDnaOntologyParentNodeKey(edge.node_key);
    insertNode.run(STORY_DNA_ONTOLOGY_VERSION, familyRoot, edge.family, edge.family, null, 0);
    if (fixedParent) {
      insertNode.run(
        STORY_DNA_ONTOLOGY_VERSION,
        fixedParent,
        edge.family,
        fixedParent.slice(fixedParent.indexOf(':') + 1),
        familyRoot,
        0,
      );
      insertOntologyEdge.run(
        STORY_DNA_ONTOLOGY_VERSION,
        fixedParent,
        familyRoot,
        'parent',
      );
    }
    insertNode.run(
      STORY_DNA_ONTOLOGY_VERSION,
      edge.node_key,
      edge.family,
      edge.node_key.slice(edge.node_key.indexOf(':') + 1),
      fixedParent ?? familyRoot,
      edge.ordinal ? 1 : 0,
    );
    insertOntologyEdge.run(
      STORY_DNA_ONTOLOGY_VERSION,
      edge.node_key,
      fixedParent ?? familyRoot,
      fixedParent || edge.node_key.includes('parent%3D')
        ? 'parent'
        : edge.source === 'compound' ? 'compound' : 'parent',
    );
    insertTitleEdge.run(
      generationId,
      title.type,
      title.id,
      edge.node_key,
      edge.family,
      edge.intensity,
      edge.confidence,
      edge.source,
    );
  }
}

function persistedStoryEdgeKeys(
  db: ReturnType<typeof libraryDatabase>,
  generationId: number,
): Map<StoryGraphContentId, string[]> {
  const rows = db.prepare(`
SELECT content_type, content_id, node_key
FROM vod_story_dna_edges
WHERE generation_id = ?
ORDER BY content_type, content_id, node_key
`).all(generationId) as Array<{
    content_type: RatingContentType;
    content_id: string;
    node_key: string;
  }>;
  const byTitle = new Map<StoryGraphContentId, string[]>();
  for (const row of rows) {
    const key = contentKey(row.content_type, row.content_id);
    byTitle.set(key, [...(byTitle.get(key) ?? []), row.node_key]);
  }
  return byTitle;
}

function assertStoryOntologyIntegrity(
  db: ReturnType<typeof libraryDatabase>,
  generationId: number,
): void {
  const broken = db.prepare(`
SELECT COUNT(*) AS count
FROM vod_story_dna_edges title_edge
LEFT JOIN vod_ontology_nodes node
  ON node.ontology_version = ? AND node.node_key = title_edge.node_key
LEFT JOIN vod_ontology_nodes parent
  ON parent.ontology_version = node.ontology_version AND parent.node_key = node.parent_key
LEFT JOIN vod_ontology_edges parent_edge
  ON parent_edge.ontology_version = node.ontology_version
 AND parent_edge.from_node_key = node.node_key
 AND parent_edge.to_node_key = node.parent_key
WHERE title_edge.generation_id = ?
  AND (
    node.node_key IS NULL OR
    (node.parent_key IS NOT NULL AND (parent.node_key IS NULL OR parent_edge.from_node_key IS NULL))
  )
`).get(STORY_DNA_ONTOLOGY_VERSION, generationId) as { count: number };
  if (broken.count !== 0) throw new Error('StoryDNA generation contains broken ontology edges');
}

function persistStoryGeneration(input: {
  type: RatingContentType;
  corpusGeneration: number;
  verifiedCount: number;
  rows: VerifiedRecommendationCatalogRow[];
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>;
  documents: Map<StoryGraphContentId, StoryDnaDocument>;
  failures: Map<StoryGraphContentId, string>;
  evidenceRevision: string;
  modelVersion: string;
  now: number;
  fault?: StoryGraphRefreshDependencies['persistStoryGenerationFault'];
}): number {
  const db = libraryDatabase();
  const verifiedKeys = new Set(input.rows.map((row) => contentKey(row.type, row.id)));
  const validVerifiedCount = [...input.documents.keys()].filter((key) => verifiedKeys.has(key)).length;
  const insertGeneration = db.prepare(`
INSERT INTO vod_story_dna_generations(
  content_type, schema_version, ontology_version, prompt_version, model_version,
  corpus_generation, evidence_revision, status, verified_count, complete_count,
  failure_count, started_at, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?, 0, 0, ?, NULL)
RETURNING generation_id
`);
  const insertDocument = db.prepare(`
INSERT INTO vod_story_dna_documents(
  generation_id, content_type, content_id, title, evidence_json, evidence_hash,
  story_dna_json, family_confidence_json, stable_external_ids_json, lookup_used,
  status, failure_reason, retry_count, next_retry_at, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  const rowsByKey = new Map(input.rows.map((row) => [contentKey(row.type, row.id), row]));
  const priorRetryRows = db.prepare(`
WITH latest AS (
  SELECT content_id, MAX(generation_id) AS generation_id
  FROM vod_story_dna_documents WHERE content_type = ? GROUP BY content_id
)
SELECT docs.content_id, docs.retry_count
FROM vod_story_dna_documents docs
JOIN latest ON latest.content_id = docs.content_id AND latest.generation_id = docs.generation_id
WHERE docs.content_type = ?
`).all(input.type, input.type) as Array<{ content_id: string; retry_count: number }>;
  const priorRetryCount = new Map(priorRetryRows.map((row) => [row.content_id, row.retry_count]));
  let generationId = 0;
  db.transaction(() => {
    const generation = insertGeneration.get(
      input.type,
      STORY_DNA_SCHEMA_VERSION,
      STORY_DNA_ONTOLOGY_VERSION,
      STORY_DNA_PROMPT_VERSION,
      input.modelVersion,
      input.corpusGeneration,
      input.evidenceRevision,
      input.verifiedCount,
      input.now,
    ) as { generation_id: number };
    generationId = generation.generation_id;
    input.fault?.('after_header', generationId);
    for (const row of input.rows) {
      const key = contentKey(row.type, row.id);
      const document = input.documents.get(key);
      const storyInput = input.inputByKey.get(key);
      const evidenceJson = storyInput ? stableStoryDnaJson(storyDnaRequestItem(storyInput)) : '{}';
      const failureReason = document
        ? null
        : input.failures.get(key) ?? (row.title ? 'story-dna-backlog' : 'missing-title');
      const retryCount = document
        ? 0
        : failureReason === 'story-dna-backlog'
          ? priorRetryCount.get(row.id) ?? 0
          : (priorRetryCount.get(row.id) ?? 0) + 1;
      const nextRetryAt = document
        ? null
        : failureReason === 'story-dna-backlog'
          ? input.now
          : input.now + Math.min(
            STORY_DNA_RETRY_MAX_MS,
            STORY_DNA_RETRY_BASE_MS * 2 ** Math.min(8, Math.max(0, retryCount - 1)),
          );
      insertDocument.run(
        generationId,
        row.type,
        row.id,
        row.title,
        evidenceJson,
        document?.provenance.evidence_hash
          ?? (storyInput ? storyDnaEvidenceHash(storyInput) : row.evidence_hash ?? sha256(evidenceJson)),
        document ? JSON.stringify(document) : null,
        document ? JSON.stringify(document.confidence) : null,
        storyInput ? JSON.stringify(storyDnaRequestItem(storyInput).evidence.external_ids) : '{}',
        document?.selective_lookup.used ? 1 : 0,
        document ? 'valid' : 'retryable_failure',
        failureReason,
        retryCount,
        nextRetryAt,
        input.now,
        input.now,
      );
      if (document && storyInput) persistOntologyAndStoryEdges(
        generationId,
        graphTitle(storyInput, document),
      );
    }
    // Retain unplayable anchors in the new generation without counting them in
    // verified coverage. They can teach taste but never enter candidate IDs.
    for (const [key, document] of input.documents) {
      if (rowsByKey.has(key)) continue;
      const storyInput = input.inputByKey.get(key);
      if (!storyInput) continue;
      const evidenceJson = stableStoryDnaJson(storyDnaRequestItem(storyInput));
      insertDocument.run(
        generationId,
        document.type,
        document.id,
        storyInput.title,
        evidenceJson,
        document.provenance.evidence_hash,
        JSON.stringify(document),
        JSON.stringify(document.confidence),
        JSON.stringify(storyDnaRequestItem(storyInput).evidence.external_ids),
        document.selective_lookup.used ? 1 : 0,
        'valid',
        null,
        0,
        null,
        input.now,
        input.now,
      );
      persistOntologyAndStoryEdges(generationId, graphTitle(storyInput, document));
    }
    input.fault?.('after_children', generationId);

    const children = db.prepare(`
SELECT content_type, content_id, status, story_dna_json
FROM vod_story_dna_documents WHERE generation_id = ?
`).all(generationId) as Array<{
      content_type: RatingContentType;
      content_id: string;
      status: 'valid' | 'retryable_failure' | 'permanent_failure';
      story_dna_json: string | null;
    }>;
    const childByKey = new Map(children.map((child) => [
      contentKey(child.content_type, child.content_id), child,
    ]));
    const edgeKeys = persistedStoryEdgeKeys(db, generationId);
    const expectedPersisted = new Set<StoryGraphContentId>();
    for (const row of input.rows) expectedPersisted.add(contentKey(row.type, row.id));
    for (const [key] of input.documents) {
      if (input.inputByKey.has(key)) expectedPersisted.add(key);
    }
    if (children.length !== expectedPersisted.size) {
      throw new Error(`StoryDNA child integrity mismatch: expected ${expectedPersisted.size}, found ${children.length}`);
    }
    for (const key of expectedPersisted) {
      const child = childByKey.get(key);
      if (!child) throw new Error(`StoryDNA child missing for ${key}`);
      const expectedDocument = input.documents.get(key);
      if (!expectedDocument) {
        if (child.status === 'valid' || child.story_dna_json !== null || (edgeKeys.get(key)?.length ?? 0) !== 0) {
          throw new Error(`StoryDNA failed child is not isolated for ${key}`);
        }
        continue;
      }
      if (child.status !== 'valid' || !child.story_dna_json) {
        throw new Error(`StoryDNA valid child missing document for ${key}`);
      }
      const validated = validateStoryDnaDocument(JSON.parse(child.story_dna_json), new Set([key]));
      if (storyDnaDocumentHash(validated) !== storyDnaDocumentHash(expectedDocument)) {
        throw new Error(`StoryDNA persisted document changed for ${key}`);
      }
      const storyInput = input.inputByKey.get(key);
      const expectedEdges = storyInput
        ? storyDnaToGraphEdges(expectedDocument, storyInput).map((edge) => edge.node_key).sort()
        : [];
      const actualEdges = edgeKeys.get(key) ?? [];
      if (expectedEdges.length <= 0
        || actualEdges.length !== expectedEdges.length
        || expectedEdges.some((nodeKey, index) => actualEdges[index] !== nodeKey)) {
        throw new Error(`StoryDNA edge integrity mismatch for ${key}`);
      }
    }
    const invalidEdgeCount = db.prepare(`
SELECT COUNT(*) AS count
FROM vod_story_dna_edges edges
LEFT JOIN vod_story_dna_documents docs
  ON docs.generation_id = edges.generation_id
 AND docs.content_type = edges.content_type
 AND docs.content_id = edges.content_id
WHERE edges.generation_id = ? AND (docs.content_id IS NULL OR docs.status != 'valid')
`).get(generationId) as { count: number };
    if (invalidEdgeCount.count !== 0) throw new Error('StoryDNA generation contains orphan edges');
    assertStoryOntologyIntegrity(db, generationId);
    input.fault?.('before_complete', generationId);
    const completed = db.prepare(`
UPDATE vod_story_dna_generations
SET status = 'complete', complete_count = ?, failure_count = ?, completed_at = ?, last_error = NULL
WHERE generation_id = ? AND status = 'building'
`).run(
      validVerifiedCount,
      Math.max(0, input.verifiedCount - validVerifiedCount),
      input.now,
      generationId,
    );
    if (completed.changes !== 1) throw new Error('StoryDNA generation completion lost its building header');
  })();
  return generationId;
}

/** Mark pre-v14/interrupted headers non-reusable before any restart refresh. */
export function reconcileInterruptedStoryDnaGenerations(now = Date.now()): number {
  const result = libraryDatabase().prepare(`
UPDATE vod_story_dna_generations
SET status = 'failed', completed_at = ?, last_error = 'interrupted_before_atomic_completion'
WHERE status = 'building'
`).run(now);
  return result.changes;
}

function reusableStoryGeneration(input: {
  type: RatingContentType;
  corpusGeneration: number;
  verifiedCount: number;
  profiledCount: number;
  rows: VerifiedRecommendationCatalogRow[];
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>;
  documents: Map<StoryGraphContentId, StoryDnaDocument>;
  evidenceRevision: string;
  modelVersion: string;
}): number | null {
  const db = libraryDatabase();
  const row = db.prepare(`
SELECT generation_id
FROM vod_story_dna_generations
WHERE content_type = ?
  AND schema_version = ?
  AND ontology_version = ?
  AND prompt_version = ?
  AND model_version = ?
  AND corpus_generation = ?
  AND evidence_revision = ?
  AND verified_count = ?
  AND complete_count = ?
  AND failure_count = ?
  AND status = 'complete'
ORDER BY generation_id DESC
LIMIT 1
`).get(
    input.type,
    STORY_DNA_SCHEMA_VERSION,
    STORY_DNA_ONTOLOGY_VERSION,
    STORY_DNA_PROMPT_VERSION,
    input.modelVersion,
    input.corpusGeneration,
    input.evidenceRevision,
    input.verifiedCount,
    input.profiledCount,
    Math.max(0, input.verifiedCount - input.profiledCount),
  ) as { generation_id: number } | undefined;
  if (!row) return null;
  try {
    const children = db.prepare(`
SELECT content_type, content_id, status, story_dna_json, evidence_hash
FROM vod_story_dna_documents WHERE generation_id = ?
`).all(row.generation_id) as Array<{
      content_type: RatingContentType;
      content_id: string;
      status: 'valid' | 'retryable_failure' | 'permanent_failure';
      story_dna_json: string | null;
      evidence_hash: string;
    }>;
    const childByKey = new Map(children.map((child) => [
      contentKey(child.content_type, child.content_id), child,
    ]));
    const edgeKeys = persistedStoryEdgeKeys(db, row.generation_id);
    const expectedKeys = new Set<StoryGraphContentId>(
      input.rows.map((candidate) => contentKey(candidate.type, candidate.id)),
    );
    for (const [key] of input.documents) {
      if (input.inputByKey.has(key)) expectedKeys.add(key);
    }
    if (children.length !== expectedKeys.size) throw new Error('child_count');
    for (const key of expectedKeys) {
      const child = childByKey.get(key);
      if (!child) throw new Error(`missing_child:${key}`);
      const document = input.documents.get(key);
      if (!document) {
        if (child.status === 'valid' || child.story_dna_json !== null || (edgeKeys.get(key)?.length ?? 0) !== 0) {
          throw new Error(`failure_child:${key}`);
        }
        continue;
      }
      if (child.status !== 'valid' || !child.story_dna_json
        || child.evidence_hash !== document.provenance.evidence_hash) {
        throw new Error(`valid_child:${key}`);
      }
      const parsed = validateStoryDnaDocument(JSON.parse(child.story_dna_json), new Set([key]));
      if (storyDnaDocumentHash(parsed) !== storyDnaDocumentHash(document)) {
        throw new Error(`document_hash:${key}`);
      }
      const storyInput = input.inputByKey.get(key);
      const expectedEdges = storyInput
        ? storyDnaToGraphEdges(document, storyInput).map((edge) => edge.node_key).sort()
        : [];
      const actualEdges = edgeKeys.get(key) ?? [];
      if (expectedEdges.length <= 0
        || actualEdges.length !== expectedEdges.length
        || expectedEdges.some((nodeKey, index) => actualEdges[index] !== nodeKey)) {
        throw new Error(`edge_keys:${key}`);
      }
    }
    const invalidEdges = db.prepare(`
SELECT COUNT(*) AS count
FROM vod_story_dna_edges edges
LEFT JOIN vod_story_dna_documents docs
  ON docs.generation_id = edges.generation_id
 AND docs.content_type = edges.content_type
 AND docs.content_id = edges.content_id
WHERE edges.generation_id = ? AND (docs.content_id IS NULL OR docs.status != 'valid')
`).get(row.generation_id) as { count: number };
    if (invalidEdges.count !== 0) throw new Error('orphan_edges');
    assertStoryOntologyIntegrity(db, row.generation_id);
    return row.generation_id;
  } catch (error) {
    db.prepare(`
UPDATE vod_story_dna_generations
SET status = 'failed', completed_at = COALESCE(completed_at, ?), last_error = ?
WHERE generation_id = ? AND status = 'complete'
`).run(Date.now(), `integrity_check_failed:${error instanceof Error ? error.message : String(error)}`, row.generation_id);
    return null;
  }
}

function persistTasteGeneration(input: {
  type: RatingContentType;
  storyGenerationId: number;
  tasteRevision: string;
  rank: StoryGraphRankResult;
  now: number;
}): number {
  const db = libraryDatabase();
  const generation = db.prepare(`
INSERT INTO vod_taste_generations(
  content_type, story_generation_id, taste_revision, watch_decay_bucket, status,
  selected_k, anchor_count, explicit_mass, implicit_mass, created_at, published_at
) VALUES (?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?)
RETURNING taste_generation_id
`).get(
    input.type,
    input.storyGenerationId,
    input.tasteRevision,
    Math.floor(input.now / DAY_MS),
    input.rank.selected_k,
    input.rank.diagnostics.qualifying_explicit + input.rank.diagnostics.qualifying_implicit,
    input.rank.diagnostics.total_explicit_mass,
    input.rank.diagnostics.total_implicit_mass,
    input.now,
    input.now,
  ) as { taste_generation_id: number };
  const insert = db.prepare(`
INSERT INTO vod_taste_threads(
  taste_generation_id, thread_index, posterior_json, effective_evidence_mass,
  fire_uplift, water_uplift, uncertainty, internal_label
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
  db.transaction(() => input.rank.threads.forEach((thread, index) => insert.run(
    generation.taste_generation_id,
    index,
    JSON.stringify(thread),
    thread.effective_evidence_mass,
    thread.fire_uplift,
    thread.water_uplift,
    Math.max(thread.fire_uncertainty, thread.water_uncertainty),
    `thread-${index + 1}`,
  )))();
  return generation.taste_generation_id;
}

function rankScoreByKey(rank: StoryGraphRankResult): Map<StoryGraphContentId, StoryGraphScoredRecommendation> {
  return new Map(rank.ranked.map((item) => [contentKey(item.type, item.id), item]));
}

function persistedRankToRecommendation(row: PersistedRankRow): StoryGraphScoredRecommendation {
  return {
    type: row.content_type,
    id: row.content_id,
    title: row.title,
    year: row.year,
    predicted_fire: row.predicted_fire,
    predicted_water: row.predicted_water,
    holistic: storyHolisticAffinity(row.predicted_fire, row.predicted_water),
    affinity: row.rank_score + 0.5 * row.uncertainty,
    posterior_standard_deviation: row.uncertainty,
    rank_score: row.rank_score,
    best_thread_id: `thread-index:${row.best_thread}`,
    explicit_support: row.explicit_support,
    implicit_support: row.implicit_support,
    feature_confidence: 0,
    thread_matches: [],
  };
}

function dealerCacheFromRows(rows: PersistedRankRow[], selectedK: number): StoryDealerCache {
  const perThreadRank = new Map<number, number>();
  return {
    model_version: VOD_STORY_GRAPH_MODEL_VERSION,
    thread_order: Array.from({ length: selectedK }, (_, index) => `thread-index:${index}`),
    items: rows.map((row) => {
      const denseThreadRank = (perThreadRank.get(row.best_thread) ?? 0) + 1;
      perThreadRank.set(row.best_thread, denseThreadRank);
      return {
        rank: row.rank,
        dealer_weight: denseThreadRank ** -1.5,
        recommendation: persistedRankToRecommendation(row),
      };
    }),
  };
}

function selectCachedSlateIds(input: {
  rows: PersistedRankRow[];
  selectedK: number;
  seed: string;
  recentSlates: Array<{ epoch: number; ids: StoryGraphContentId[] }>;
}): StoryGraphScoredRecommendation[] {
  storyGraphServingWorkCounters.dealer_calls += 1;
  const cache = dealerCacheFromRows(input.rows, input.selectedK);
  const floorRaw = Number(process.env.MANGO_VOD_STORY_GRAPH_FIT_FLOOR ?? 2.5);
  const fitFloor = Number.isFinite(floorRaw) ? floorRaw : 2.5;
  const retained = [...input.recentSlates];
  while (true) {
    const excluded = [...new Set(retained.flatMap((slate) => slate.ids))];
    const strict = dealStoryRecommendations(cache, {
      seed: input.seed,
      exclude_ids: excluded,
      minimum_rank_score: fitFloor,
    });
    if (strict.length === VISIBLE_LIMIT) return strict;
    if (retained.length === 0) break;
    // Recent slates are newest-first; relax the oldest one first.
    retained.pop();
  }
  const relaxedFloor = dealStoryRecommendations(cache, { seed: input.seed });
  return relaxedFloor.length === VISIBLE_LIMIT ? relaxedFloor : [];
}

function currentExactExclusions(type: RatingContentType): Set<StoryGraphContentId> {
  const signals = readHouseholdSignals(type);
  return new Set([
    ...signals.rated, ...signals.saved, ...signals.watched,
    ...signals.hidden, ...signals.blocked, ...signals.not_for_me,
  ]);
}

async function currentlyEligibleRankRows(
  rankGenerationId: number,
  type: RatingContentType,
): Promise<PersistedRankRow[]> {
  storyGraphServingWorkCounters.full_reserve_queries += 1;
  const rows = libraryDatabase().prepare(`
SELECT rank_generation_id, content_type, content_id, title, poster, year, rank,
       best_thread, predicted_fire, predicted_water, explicit_support,
       implicit_support, uncertainty, rank_score
FROM vod_rank_items
WHERE rank_generation_id = ? AND serving_eligible = 1
  AND content_type = ? AND poster IS NOT NULL AND poster != ''
  AND rank IS NOT NULL AND best_thread IS NOT NULL AND rank_score IS NOT NULL
ORDER BY rank ASC
`).all(rankGenerationId, type) as PersistedRankRow[];
  storyGraphServingWorkCounters.full_reserve_rows_loaded += rows.length;
  const playability = await getTitlesPlayabilityBulk(rows.map((row) => ({
    type: row.content_type,
    id: row.content_id,
  })));
  const excluded = currentExactExclusions(type);
  return rows.filter((row) => {
    const key = contentKey(row.content_type, row.content_id);
    return playability.get(key)?.status === 'verified' && !excluded.has(key);
  });
}

function recentCachedSlates(
  rankGenerationId: number,
  type: RatingContentType,
  limit = 4,
  renderedOnly = false,
): Array<{ epoch: number; ids: StoryGraphContentId[] }> {
  const db = libraryDatabase();
  const epochs = db.prepare(`
SELECT shuffle_epoch AS epoch FROM vod_cached_slates
WHERE rank_generation_id = @rank_generation_id AND content_type = @content_type
  AND (@rendered_only = 0 OR rendered_at IS NOT NULL)
ORDER BY shuffle_epoch DESC LIMIT @limit
`).all({
    rank_generation_id: rankGenerationId,
    content_type: type,
    rendered_only: renderedOnly ? 1 : 0,
    limit,
  }) as Array<{ epoch: number }>;
  const selectItems = db.prepare(`
SELECT content_id FROM vod_cached_slate_items
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch = ? ORDER BY slot
`);
  return epochs.map(({ epoch }) => ({
    epoch,
    ids: (selectItems.all(rankGenerationId, type, epoch) as Array<{ content_id: string }>)
      .map((row) => contentKey(type, row.content_id)),
  }));
}

function persistCachedSlate(input: {
  type: RatingContentType;
  epoch: number;
  rankGenerationId: number;
  items: StoryGraphScoredRecommendation[];
  threadIndex: Map<string, number>;
  now: number;
}): void {
  if (input.items.length !== VISIBLE_LIMIT) throw new Error('Story Graph cached slate requires six items');
  const db = libraryDatabase();
  db.transaction(() => {
    db.prepare(`
INSERT INTO vod_cached_slates(
  rank_generation_id, content_type, shuffle_epoch, created_at, rendered_at
) VALUES (?, ?, ?, ?, NULL)
ON CONFLICT(rank_generation_id, content_type, shuffle_epoch) DO UPDATE SET
  created_at = excluded.created_at,
  rendered_at = NULL
`).run(input.rankGenerationId, input.type, input.epoch, input.now);
    db.prepare(`
DELETE FROM vod_cached_slate_items
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch = ?
`).run(input.rankGenerationId, input.type, input.epoch);
    const insert = db.prepare(`
INSERT INTO vod_cached_slate_items(
  rank_generation_id, content_type, shuffle_epoch, slot, content_id, thread_index
) VALUES (?, ?, ?, ?, ?, ?)
`);
    input.items.forEach((item, slot) => {
      const index = item.best_thread_id ? input.threadIndex.get(item.best_thread_id) : undefined;
      if (index === undefined) throw new Error('cached Story Graph item has no supported taste thread');
      insert.run(input.rankGenerationId, input.type, input.epoch, slot, item.id, index);
    });
  })();
}

function createPredealtSlateQueue(input: {
  type: RatingContentType;
  rankGenerationId: number;
  rows: PersistedRankRow[];
  selectedK: number;
  threadIds: string[];
  now: number;
}): number | null {
  if (input.selectedK <= 0 || input.rows.length < VISIBLE_LIMIT) return null;
  const queueDepth = boundedInteger(
    process.env.MANGO_VOD_STORY_GRAPH_PREDEALT_SLATES,
    DEFAULT_PREDEALT_SLATE_COUNT,
    8,
    128,
  );
  const threadIndex = new Map(input.threadIds.map((_thread, index) => [
    `thread-index:${index}`, index,
  ]));
  libraryDatabase().prepare(`
DELETE FROM vod_cached_slates WHERE rank_generation_id = ? AND content_type = ?
`).run(input.rankGenerationId, input.type);
  const generated: Array<{ epoch: number; ids: StoryGraphContentId[] }> = [];
  for (let epoch = 0; epoch < queueDepth; epoch += 1) {
    const items = selectCachedSlateIds({
      rows: input.rows,
      selectedK: input.selectedK,
      seed: `${input.type}:${input.rankGenerationId}:${epoch}`,
      recentSlates: generated.slice(-4).reverse(),
    });
    if (items.length !== VISIBLE_LIMIT) break;
    persistCachedSlate({
      type: input.type,
      epoch,
      rankGenerationId: input.rankGenerationId,
      items,
      threadIndex,
      now: input.now,
    });
    generated.push({
      epoch,
      ids: items.map((item) => contentKey(input.type, item.id)),
    });
  }
  return generated.length > 0 ? generated[0]!.epoch : null;
}

function updateActiveGeneration(input: {
  type: RatingContentType;
  rankGenerationId: number;
  storyGenerationId: number;
  tasteGenerationId: number;
  epoch: number;
  now: number;
  requireSlate?: boolean;
}): void {
  const db = libraryDatabase();
  db.transaction(() => {
    if (input.requireSlate !== false) {
      const slate = db.prepare(`
SELECT COUNT(*) AS item_count, COUNT(DISTINCT content_id) AS unique_count
FROM vod_cached_slate_items
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch = ?
`).get(input.rankGenerationId, input.type, input.epoch) as {
        item_count: number;
        unique_count: number;
      };
      if (slate.item_count !== VISIBLE_LIMIT || slate.unique_count !== VISIBLE_LIMIT) {
        throw new Error('active Story Graph pointer requires one exact six-card cached slate');
      }
    }
    const active = db.prepare(`
SELECT active_rank_generation_id FROM vod_active_generations WHERE content_type = ?
`).get(input.type) as { active_rank_generation_id: number | null } | undefined;
    const previousActive = active?.active_rank_generation_id ?? null;
    const previousComplete = previousActive === null ? null : (db.prepare(`
SELECT rank_generation_id FROM vod_rank_generations
WHERE rank_generation_id = ? AND status = 'complete'
`).get(previousActive) as { rank_generation_id: number } | undefined)?.rank_generation_id ?? null;
    db.prepare(`
INSERT INTO vod_active_generations(
  content_type, active_rank_generation_id, previous_complete_rank_generation_id,
  active_story_generation_id, active_taste_generation_id, shuffle_epoch, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(content_type) DO UPDATE SET
  previous_complete_rank_generation_id = CASE
    WHEN vod_active_generations.active_rank_generation_id != excluded.active_rank_generation_id
      AND ? IS NOT NULL THEN ?
    ELSE vod_active_generations.previous_complete_rank_generation_id
  END,
  active_rank_generation_id = excluded.active_rank_generation_id,
  active_story_generation_id = excluded.active_story_generation_id,
  active_taste_generation_id = excluded.active_taste_generation_id,
  shuffle_epoch = excluded.shuffle_epoch,
  updated_at = excluded.updated_at
`).run(
      input.type,
      input.rankGenerationId,
      previousComplete,
      input.storyGenerationId,
      input.tasteGenerationId,
      input.epoch,
      input.now,
      previousComplete,
      previousComplete,
    );
  })();
}

function ndcgAt6(rows: Array<{ relevance: number; score: number }>): number | null {
  if (rows.length === 0 || rows.every((row) => row.relevance <= 0)) return null;
  const dcg = [...rows].sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .reduce((sum, row, index) => sum + (2 ** row.relevance - 1) / Math.log2(index + 2), 0);
  const ideal = [...rows].sort((left, right) => right.relevance - left.relevance)
    .slice(0, 6)
    .reduce((sum, row, index) => sum + (2 ** row.relevance - 1) / Math.log2(index + 2), 0);
  return ideal > 0 ? dcg / ideal : null;
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function pairwiseConcordance(rows: Array<{ actual: number; predicted: number }>): number | null {
  let concordant = 0;
  let pairs = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const actual = Math.sign(rows[left]!.actual - rows[right]!.actual);
      if (actual === 0) continue;
      const predicted = Math.sign(rows[left]!.predicted - rows[right]!.predicted);
      concordant += predicted === actual ? 1 : predicted === 0 ? 0.5 : 0;
      pairs += 1;
    }
  }
  return pairs > 0 ? concordant / pairs : null;
}

export function stableStoryGraphEvaluationFolds(ratings: FireWaterRating[]): Map<string, number> {
  const groups = new Map<string, FireWaterRating[]>();
  for (const rating of ratings) {
    const fire = positiveRatingEvidence(rating.fire) > 0;
    const water = positiveRatingEvidence(rating.water) > 0;
    const relevance = fire && water ? 'both' : fire ? 'fire' : water ? 'water' : 'low';
    const key = `${rating.type}:${relevance}`;
    const group = groups.get(key) ?? [];
    group.push(rating);
    groups.set(key, group);
  }
  const result = new Map<string, number>();
  for (const [groupKey, group] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    group.sort((left, right) => sha256(`${groupKey}:${left.type}:${left.id}`)
      .localeCompare(sha256(`${groupKey}:${right.type}:${right.id}`)));
    group.forEach((rating, index) => result.set(contentKey(rating.type, rating.id), index % 5));
  }
  return result;
}

/** Offline primary metric follows the exact risk-adjusted serving order. */
export function storyGraphServingNdcgAt6(
  rows: Array<{ relevance: number; recommendation: Pick<StoryGraphScoredRecommendation, 'rank_score'> }>,
): number | null {
  return ndcgAt6(rows.map((row) => ({
    relevance: row.relevance,
    score: row.recommendation.rank_score,
  })));
}

function bootstrapInterval(differences: number[]): { low: number | null; high: number | null; iterations: number } {
  const iterations = 2_000;
  if (differences.length < 2) return { low: null, high: null, iterations };
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let sample = 0; sample < differences.length; sample += 1) {
      const digest = createHash('sha256').update(`${iteration}:${sample}:vod-story-graph`).digest();
      sum += differences[digest.readUInt32BE(0) % differences.length]!;
    }
    means.push(sum / differences.length);
  }
  means.sort((left, right) => left - right);
  return {
    low: means[Math.floor(iterations * 0.05)] ?? null,
    high: means[Math.min(iterations - 1, Math.ceil(iterations * 0.95) - 1)] ?? null,
    iterations,
  };
}

function legacyFeatureMaps(
  ratings: FireWaterRating[],
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>,
): { candidate: Map<StoryGraphContentId, RecommendationFeature>; anchors: Map<StoryGraphContentId, RecommendationFeature> } {
  const aiInputs: RecommendationAiInput[] = [...inputByKey.values()].map((input) => ({
    ...input,
    year: input.year === null || input.year === undefined ? null : String(input.year),
  }));
  const ai = loadAiRecommendationFeatures(aiInputs);
  const candidate = new Map<StoryGraphContentId, RecommendationFeature>();
  for (const rawInput of aiInputs) {
    const key = contentKey(rawInput.type, rawInput.id);
    candidate.set(key, buildAiEnrichedRecommendationFeature({
      ...rawInput,
    }, ai.get(key)));
  }
  const ratingsByKey = new Map(ratings.map((rating) => [contentKey(rating.type, rating.id), rating]));
  const anchors = new Map([...candidate].map(([key, feature]) => {
    const rating = ratingsByKey.get(key);
    if (!rating) return [key, feature] as const;
    const rawInput = inputByKey.get(key);
    return [key, buildRecommendationFeature({
      type: feature.type,
      id: feature.id,
      title: rawInput?.title ?? feature.title,
      year: rawInput?.year === null || rawInput?.year === undefined ? null : String(rawInput.year),
      rail_ids: rawInput?.rail_ids ?? rawInput?.curated_pool_memberships,
      taste_tags: rating.taste_tags,
    })] as const;
  }));
  return { candidate, anchors };
}

export function evaluateStoryGraphOffline(input: {
  rankGenerationId: number;
  documents: StoryGraphTitle[];
  background_ids?: StoryGraphContentId[];
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>;
  ratings: FireWaterRating[];
  verifiedCount: number;
  accountedCount: number;
  reserveDepth: number;
  workerLatencyMs: number;
  cachedServiceP95Ms?: number | null;
  now: number;
}): StoryGraphOfflineEvaluation {
  const documentByKey = new Map(input.documents.map((title) => [
    contentKey(title.type, title.id), title.story_dna,
  ]));
  const eligibleRatings = input.ratings.filter((rating) => documentByKey.has(contentKey(rating.type, rating.id)));
  const foldByKey = stableStoryGraphEvaluationFolds(eligibleRatings);
  const backgroundIds = new Set(input.background_ids ?? [...documentByKey.keys()]);
  const backgroundDocuments = input.documents.filter((document) => (
    backgroundIds.has(contentKey(document.type, document.id))
  ));
  const legacy = legacyFeatureMaps(eligibleRatings, input.inputByKey);
  const foldMetrics: Array<{ v2: number; v4: number }> = [];
  let deterministic = true;
  const predictions: Array<{
    rating: FireWaterRating;
    v2Fire: number;
    v2Water: number;
    v2Score: number;
    v4Fire: number;
    v4Water: number;
    v4Score: number;
    fold: number;
  }> = [];
  for (let fold = 0; fold < 5; fold += 1) {
    const training = eligibleRatings.filter((rating) => foldByKey.get(contentKey(rating.type, rating.id)) !== fold);
    const heldOut = eligibleRatings.filter((rating) => foldByKey.get(contentKey(rating.type, rating.id)) === fold);
    if (training.length === 0 || heldOut.length === 0) continue;
    const model = buildStoryTasteModel({
      documents: input.documents,
      background_documents: backgroundDocuments,
      explicit_ratings: training,
      implicit_signals: [],
      as_of: input.now,
    });
    const replayModel = buildStoryTasteModel({
      documents: input.documents,
      background_documents: backgroundDocuments,
      explicit_ratings: training,
      implicit_signals: [],
      as_of: input.now,
    });
    deterministic = deterministic && stableStoryDnaJson(model) === stableStoryDnaJson(replayModel);
    const ratingFeatures = new Map(training.flatMap((rating) => {
      const key = contentKey(rating.type, rating.id);
      const feature = legacy.anchors.get(key);
      return feature ? [[key, feature] as const] : [];
    }));
    const rows: Array<{ relevance: number; v2: number; v4: number }> = [];
    for (const rating of heldOut) {
      const key = contentKey(rating.type, rating.id);
      const title = input.documents.find((candidate) => contentKey(candidate.type, candidate.id) === key);
      const candidate = legacy.candidate.get(key);
      if (!title || !candidate || ratingFeatures.size === 0) continue;
      const v2 = scoreStoryGraphCandidate(model, title);
      deterministic = deterministic && stableStoryDnaJson(v2)
        === stableStoryDnaJson(scoreStoryGraphCandidate(replayModel, title));
      const v4 = predictAxes({
        candidate,
        ratings: training,
        ratingFeatures,
        tab: rating.type === 'movie' ? 'movies' : 'series',
      });
      const v4Score = holisticAffinity(v4.fire, v4.water);
      const relevance = 0.75 * Math.max(positiveRatingEvidence(rating.fire), positiveRatingEvidence(rating.water))
        + 0.25 * Math.min(positiveRatingEvidence(rating.fire), positiveRatingEvidence(rating.water));
      rows.push({ relevance, v2: v2.rank_score, v4: v4Score });
      predictions.push({
        rating,
        v2Fire: v2.predicted_fire,
        v2Water: v2.predicted_water,
        v2Score: v2.rank_score,
        v4Fire: v4.fire,
        v4Water: v4.water,
        v4Score,
        fold,
      });
    }
    const v2Ndcg = ndcgAt6(rows.map((row) => ({ relevance: row.relevance, score: row.v2 })));
    const v4Ndcg = ndcgAt6(rows.map((row) => ({ relevance: row.relevance, score: row.v4 })));
    if (v2Ndcg !== null && v4Ndcg !== null) foldMetrics.push({ v2: v2Ndcg, v4: v4Ndcg });
  }
  const v2Ndcg = average(foldMetrics.map((metric) => metric.v2));
  const v4Ndcg = average(foldMetrics.map((metric) => metric.v4));
  const relative = v2Ndcg !== null && v4Ndcg !== null && v4Ndcg > 0
    ? (v2Ndcg - v4Ndcg) / v4Ndcg
    : null;
  const interval = bootstrapInterval(foldMetrics.map((metric) => metric.v2 - metric.v4));
  const concordance = (axis: 'fire' | 'water', version: 'v2' | 'v4') => pairwiseConcordance(
    predictions.filter((row) => row.rating[axis] >= 4).map((row) => ({
      actual: row.rating[axis],
      predicted: version === 'v2'
        ? axis === 'fire' ? row.v2Fire : row.v2Water
        : axis === 'fire' ? row.v4Fire : row.v4Water,
    })),
  );
  const fireV2 = concordance('fire', 'v2');
  const fireV4 = concordance('fire', 'v4');
  const waterV2 = concordance('water', 'v2');
  const waterV4 = concordance('water', 'v4');
  const intrusion = (version: 'v2' | 'v4') => {
    const perFold = Array.from({ length: 5 }, (_, fold) => predictions.filter((row) => row.fold === fold));
    return average(perFold.flatMap((rows) => {
      if (rows.length === 0) return [];
      const selected = [...rows].sort((left, right) => (
        version === 'v2' ? right.v2Score - left.v2Score : right.v4Score - left.v4Score
      )).slice(0, 6);
      return [selected.filter((row) => row.rating.fire <= 2.5 && row.rating.water <= 2.5).length
        / selected.length];
    }));
  };
  const intrusionV2 = intrusion('v2');
  const intrusionV4 = intrusion('v4');
  const accounting = input.accountedCount === input.verifiedCount;
  const coverage = input.verifiedCount > 0 ? input.reserveDepth / input.verifiedCount : 1;
  const reasons: string[] = [];
  if (eligibleRatings.length < 30 || foldMetrics.length < 5) reasons.push('insufficient_stratified_ratings');
  if (relative === null || relative < 0.10) reasons.push('ndcg_improvement_below_10_percent');
  if (interval.low === null || interval.low <= 0) reasons.push('paired_bootstrap_interval_not_above_zero');
  const fireRegression = fireV2 === null || fireV4 === null ? null : fireV4 - fireV2;
  const waterRegression = waterV2 === null || waterV4 === null ? null : waterV4 - waterV2;
  const intrusionRegression = intrusionV2 === null || intrusionV4 === null ? null : intrusionV2 - intrusionV4;
  if (fireRegression === null || fireRegression > 0.02) reasons.push('fire_concordance_guardrail');
  if (waterRegression === null || waterRegression > 0.02) reasons.push('water_concordance_guardrail');
  if (intrusionRegression === null || intrusionRegression > 0.02) reasons.push('low_low_intrusion_guardrail');
  if (!accounting) reasons.push('verified_corpus_accounting_incomplete');
  if (!deterministic) reasons.push('determinism_replay_failed');
  if (input.cachedServiceP95Ms === null || input.cachedServiceP95Ms === undefined) {
    reasons.push('cached_service_p95_unmeasured');
  } else if (input.cachedServiceP95Ms > 250) reasons.push('cached_service_p95_above_250ms');
  const insufficient = reasons.includes('insufficient_stratified_ratings')
    || reasons.includes('cached_service_p95_unmeasured');
  return {
    version: 'vod-story-graph-evaluation-v1',
    rank_generation_id: input.rankGenerationId,
    status: reasons.length === 0 ? 'passed' : insufficient ? 'insufficient' : 'failed',
    samples: eligibleRatings.length,
    folds: foldMetrics.length,
    holistic_ndcg_at_6: { v2: v2Ndcg, v4: v4Ndcg, relative_improvement: relative },
    paired_bootstrap_90: interval,
    fire_pairwise_concordance_ge_4: { v2: fireV2, v4: fireV4, regression: fireRegression },
    water_pairwise_concordance_ge_4: { v2: waterV2, v4: waterV4, regression: waterRegression },
    low_low_top_6_intrusion_rate: {
      v2: intrusionV2, v4: intrusionV4, regression: intrusionRegression,
    },
    verified_accounting_complete: accounting,
    coverage,
    deterministic,
    worker_latency_ms: input.workerLatencyMs,
    cached_service_p95_ms: input.cachedServiceP95Ms ?? null,
    promotion_eligible: reasons.length === 0,
    reasons,
    evaluated_at: input.now,
  };
}

function persistOfflineEvaluation(type: RatingContentType, evaluation: StoryGraphOfflineEvaluation): void {
  const write = libraryDatabase().prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`);
  libraryDatabase().transaction(() => {
    write.run(`vod_story_graph_evaluation:${type}`, JSON.stringify(evaluation), evaluation.evaluated_at);
    write.run(
      `vod_story_graph_evaluation:${type}:${evaluation.rank_generation_id}`,
      JSON.stringify(evaluation),
      evaluation.evaluated_at,
    );
  })();
}

export function storyGraphOfflineEvaluation(
  type: RatingContentType,
  rankGenerationId?: number | null,
): StoryGraphOfflineEvaluation | null {
  const row = libraryDatabase().prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = ?
`).get(rankGenerationId == null
    ? `vod_story_graph_evaluation:${type}`
    : `vod_story_graph_evaluation:${type}:${rankGenerationId}`) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as StoryGraphOfflineEvaluation;
  } catch {
    return null;
  }
}

function partialPriorityEvaluation(input: {
  rankGenerationId: number;
  verifiedCount: number;
  accountedCount: number;
  workerLatencyMs: number;
  cachedServiceP95Ms: number | null;
  now: number;
}): StoryGraphOfflineEvaluation {
  return {
    version: 'vod-story-graph-evaluation-v1',
    rank_generation_id: input.rankGenerationId,
    status: 'insufficient',
    samples: 0,
    folds: 0,
    holistic_ndcg_at_6: { v2: null, v4: null, relative_improvement: null },
    paired_bootstrap_90: { low: null, high: null, iterations: 0 },
    fire_pairwise_concordance_ge_4: { v2: null, v4: null, regression: null },
    water_pairwise_concordance_ge_4: { v2: null, v4: null, regression: null },
    low_low_top_6_intrusion_rate: { v2: null, v4: null, regression: null },
    verified_accounting_complete: false,
    coverage: input.verifiedCount > 0 ? input.accountedCount / input.verifiedCount : 1,
    deterministic: true,
    worker_latency_ms: input.workerLatencyMs,
    cached_service_p95_ms: input.cachedServiceP95Ms,
    promotion_eligible: false,
    reasons: ['partial_priority_generation', 'offline_promotion_deferred_to_full_corpus'],
    evaluated_at: input.now,
  };
}

function activePromotedStoryGraphGeneration(type: RatingContentType): {
  active_rank_generation_id: number;
  promotion_rank_generation_id: number;
} | null {
  const active = libraryDatabase().prepare(`
SELECT active.active_rank_generation_id, active.previous_complete_rank_generation_id,
       ranks.status, ranks.model_version
FROM vod_active_generations active
JOIN vod_rank_generations ranks ON ranks.rank_generation_id = active.active_rank_generation_id
WHERE active.content_type = ?
`).get(type) as {
    active_rank_generation_id: number;
    previous_complete_rank_generation_id: number | null;
    status: string;
    model_version: string;
  } | undefined;
  if (!active || active.model_version !== VOD_STORY_GRAPH_MODEL_VERSION
    || !['bootstrap', 'complete'].includes(active.status)) return null;
  const candidates = active.status === 'complete'
    ? [active.active_rank_generation_id, active.previous_complete_rank_generation_id]
    : [active.previous_complete_rank_generation_id];
  for (const candidate of candidates) {
    if (candidate != null && storyGraphOfflineEvaluation(type, candidate)?.promotion_eligible === true) {
      return {
        active_rank_generation_id: active.active_rank_generation_id,
        promotion_rank_generation_id: candidate,
      };
    }
  }
  return null;
}

export function storyGraphPromotionEligible(tab: StoryGraphTab): boolean {
  return activePromotedStoryGraphGeneration(contentTypeForTab(tab)) !== null;
}

function buildStoryGraphForYouRail(input: {
  tab: StoryGraphTab;
  type: RatingContentType;
  rankGenerationId: number;
  epoch: number;
  reserveDepth: number;
  rows: PersistedRankRow[];
  served: { slate_revision: number; attribution_token: string };
  resolveMs: number;
  lowWater: boolean;
}): StoryGraphForYouRail {
  return {
    rail_id: input.tab === 'movies' ? 'for-you-movies' : 'for-you-series',
    label: 'For You',
    slate_sequence: input.served.slate_revision,
    attribution_token: input.served.attribution_token,
    items: input.rows.map((row) => ({
      id: row.content_id,
      type: input.type,
      title: row.title,
      subtitle: [input.type === 'movie' ? 'Movie' : 'TV Show', row.year].filter(Boolean).join(' · '),
      poster: row.poster,
      ...(row.year ? { year: row.year } : {}),
      source: 'for-you',
    })),
    resolve_ms: input.resolveMs,
    skipped: Math.max(0, input.reserveDepth - VISIBLE_LIMIT),
    cached: true,
    playability: {
      displayed: VISIBLE_LIMIT,
      verified_pool: input.reserveDepth,
      pending: input.lowWater ? 1 : 0,
      low_water: input.lowWater,
      session_id: `vod-story-graph-${input.rankGenerationId}-${input.epoch}`,
    },
  };
}

/**
 * Measure the prospective cached rail service path before promotion. Each of
 * 100 samples performs the same cache reads, current playability/exclusion
 * revalidation, attribution registration, response construction, and JSON
 * serialization used by serving. Probe writes are synchronously rolled back
 * so evaluation never creates a couch impression opportunity or revision.
 */
async function measureCachedServiceP95(input: {
  tab: StoryGraphTab;
  type: RatingContentType;
  epoch: number;
  rankGenerationId: number;
  reserveDepth: number;
}): Promise<number | null> {
  const samples: number[] = [];
  const db = libraryDatabase();
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const started = performance.now();
    const rows = cachedSlateRows(input.type, input.epoch, input.rankGenerationId);
    if (!(await validateSlateRows(rows, input.type))) return null;
    db.exec('SAVEPOINT story_graph_service_latency_probe');
    try {
      markCachedSlateRendered(input.rankGenerationId, input.type, input.epoch, Date.now());
      const served = registerRecommendationServedSlate({
        profile_id: 'household',
        domain: 'vod',
        rail_id: input.tab === 'movies' ? 'for-you-movies' : 'for-you-series',
        source_revision: input.rankGenerationId,
        items: rows.map((row, rank) => ({ type: input.type, id: row.content_id, rank })),
      });
      const rail = buildStoryGraphForYouRail({
        ...input,
        rows,
        served,
        resolveMs: performance.now() - started,
        lowWater: false,
      });
      JSON.stringify({ tab: input.tab, rails: [rail] });
      samples.push(performance.now() - started);
    } finally {
      db.exec('ROLLBACK TO story_graph_service_latency_probe');
      db.exec('RELEASE story_graph_service_latency_probe');
    }
  }
  samples.sort((left, right) => left - right);
  return samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] ?? null;
}

function markGenerationsStale(_story: number, taste: number, rank: number, reason: string): never {
  const db = libraryDatabase();
  db.transaction(() => {
    // Content profiles are immutable and taste-independent. A rank/taste
    // capture becoming stale must never corrupt a reusable last-good StoryDNA
    // generation that may also back an active rank.
    db.prepare(`UPDATE vod_taste_generations SET status = 'stale', last_error = ? WHERE taste_generation_id = ?`)
      .run(reason, taste);
    db.prepare(`UPDATE vod_rank_generations SET status = 'stale', last_error = ? WHERE rank_generation_id = ?`)
      .run(reason, rank);
  })();
  throw new StaleStoryGraphGenerationError(reason);
}

async function refreshStoryGraphForYouUnserialized(
  tab: StoryGraphTab,
  options: StoryGraphRefreshOptions = {},
): Promise<StoryGraphRefreshResult> {
  const now = options.now ?? Date.now();
  const type = contentTypeForTab(tab);
  const dependencies = options.dependencies ?? {};
  reconcileInterruptedStoryDnaGenerations(now);
  const listPage = dependencies.listPage ?? listVerifiedRecommendationCatalogPage;
  const currentCorpusGeneration = dependencies.corpusGeneration ?? playabilityRecommendationCorpusGeneration;
  const currentSemanticGeneration = dependencies.semanticGeneration
    ?? playabilityRecommendationSemanticGeneration;
  const refreshTeacher = dependencies.refreshTeacher ?? refreshStoryDnaTeacherCache;
  const loadTeacher = dependencies.loadTeacherCache ?? loadStoryDnaTeacherCache;
  const rank = dependencies.rank ?? rankStoryGraphRecommendationsOffThread;
  const scan = await scanVerifiedCorpus(type, listPage);
  const ratings = listRatings(type, 'household');
  const signals = readHouseholdSignals(type);
  const teacherConfiguration = storyDnaTeacherConfiguration();
  const capturedTasteRevision = tasteRevision(type, ratings, signals, now);
  const anchorKeys = new Set<StoryGraphContentId>([
    ...ratings.map((rating) => contentKey(rating.type, rating.id)),
    ...signals.implicit.map((signal) => contentKey(signal.type, signal.id)),
  ]);
  const rawVerifiedInputs = themeStratifiedStoryDnaInputs(scan.rows.flatMap((row) => {
    const input = storyDnaInputForVerifiedRow(row);
    return input ? [input] : [];
  }));
  const rawVerifiedKeys = new Set(rawVerifiedInputs.map((input) => contentKey(input.type, input.id)));
  const priorAnchors = priorAnchorEvidence(
    type,
    anchorKeys,
    rawVerifiedKeys,
    teacherConfiguration.expected_model_version,
  );
  const rawInputs = [
    ...rawVerifiedInputs,
    ...priorAnchors.map((anchor) => anchor.input),
  ];
  const progressive = vodContentProfileMode() === 'progressive-v2';
  // Progressive refresh is deliberately local-only. Structured metadata and
  // teacher work run from the durable frontier after publication.
  const lookedUpInputs = progressive
    ? loadStructuredMetadataCache(rawInputs)
    : await enrichSparseInputs(
      type,
      rawInputs,
      dependencies.lookup === undefined ? structuredLookupProvider : dependencies.lookup,
      now,
    );
  const cachedBefore = progressive ? new Map<string, StoryDnaDocument>() : loadTeacher(lookedUpInputs);
  const teacherLimit = options.teacher_limit ?? boundedInteger(
    process.env.MANGO_STORY_DNA_REFRESH_LIMIT,
    DEFAULT_TEACHER_LIMIT,
    1,
    10_000,
  );
  const pending = progressive ? [] : selectTeacherBackfillBatch(
    type,
    lookedUpInputs.filter((input) => !cachedBefore.has(contentKey(input.type, input.id))),
    teacherLimit,
    now,
    anchorKeys,
  );
  const teacherResult: StoryDnaTeacherRefreshResult = pending.length > 0
    ? await refreshTeacher(pending, { now })
    : { requested: 0, persisted: 0, cached: lookedUpInputs.length, documents: [], failures: [] };
  const inputByKey = new Map<StoryGraphContentId, StoryDnaInput>(
    lookedUpInputs.map((input) => [contentKey(input.type, input.id), input]),
  );
  const failures = new Map<StoryGraphContentId, string>(teacherResult.failures.map((failure) => [
    contentKey(failure.type, failure.id), failure.reason,
  ]));
  const loaded = new Map<StoryGraphContentId, StoryDnaDocument>();
  for (const anchor of priorAnchors) {
    if (anchor.document) loaded.set(contentKey(anchor.input.type, anchor.input.id), anchor.document);
  }
  if (!progressive) {
    for (const [key, document] of loadTeacher(lookedUpInputs)) {
      loaded.set(key as StoryGraphContentId, document);
    }
  }
  for (const document of teacherResult.documents) {
    loaded.set(contentKey(document.type, document.id), document);
  }
  const documents = new Map<StoryGraphContentId, StoryDnaDocument>();
  for (const [key, storyInput] of inputByKey) {
    const document = validatedDocumentForInput(
      loaded.get(key),
      storyInput,
      teacherConfiguration.expected_model_version,
    );
    if (document) {
      documents.set(key, document);
      failures.delete(key);
    } else if (loaded.has(key)) {
      failures.set(key, 'invalid-canonical-provenance');
    }
  }
  if (progressive) {
    for (const [key, document] of compatibleProgressiveStoryDnaOverlays(type, inputByKey)) {
      documents.set(key, document);
      failures.delete(key);
    }
  }
  const modelVersions = [...new Set([...documents.values()].map((document) => document.model_version))]
    .sort((left, right) => left.localeCompare(right));
  if (!progressive && modelVersions.length > 1) {
    throw new Error(`mixed StoryDNA teacher model generation rejected: ${modelVersions.join(', ')}`);
  }
  const generationModelVersion = progressive ? 'mixed-compatible' : teacherConfiguration.expected_model_version
    ?? modelVersions[0]
    ?? 'unavailable';
  const priorProfiles = progressive ? latestProgressiveProfiles(type) : new Map<StoryGraphContentId, ContentProfileV2>();
  const profiles = new Map<StoryGraphContentId, ContentProfileV2>();
  if (progressive) {
    for (const [key, storyInput] of inputByKey) {
      profiles.set(key, compileContentProfileV2(storyInput, {
        teacher_document: documents.get(key) ?? null,
        prior_profile: priorProfiles.get(key) ?? null,
      }));
    }
  }
  const semanticGeneration = progressive
    ? await (dependencies.recordSemanticEvidence ?? recordRecommendationSemanticEvidence)(
      scan.rows.flatMap((row) => {
        const profile = profiles.get(contentKey(row.type, row.id));
        return profile ? [{
          type: row.type,
          id: row.id,
          semantic_evidence_hash: profile.semantic_evidence_hash,
        }] : [];
      }),
    )
    : 0;
  const referenceRevision = progressive
    ? ensureSemanticReferencePanel({ type, profiles, overlays: documents, now })
    : 'strict-v1';
  const evidenceRevision = progressive ? sha256({
    profile_version: VOD_CONTENT_PROFILE_VERSION,
    compiler_version: VOD_CONTENT_PROFILE_COMPILER_VERSION,
    semantic_generation: semanticGeneration,
    reference_revision: referenceRevision,
    profiles: [...profiles].map(([key, profile]) => ({ key, hash: profile.profile_hash })),
  }) : sha256({
    teacher_configuration_revision: teacherConfiguration.revision,
    model_version: generationModelVersion,
    evidence: lookedUpInputs.map((storyInput) => ({
      key: contentKey(storyInput.type, storyInput.id),
      evidence_hash: storyDnaEvidenceHash(storyInput),
      input_hash: storyDnaInputHash(storyInput),
    })).sort((left, right) => left.key.localeCompare(right.key)),
    documents: [...documents].map(([key, document]) => ({
      key,
      document_hash: storyDnaDocumentHash(document),
    })).sort((left, right) => left.key.localeCompare(right.key)),
  });
  const profiledVerifiedCount = scan.rows.filter((row) => (
    documents.has(contentKey(row.type, row.id))
  )).length;
  const storyGenerationId = progressive ? persistProgressiveProfileGeneration({
    type,
    corpusGeneration: scan.generation,
    semanticRevision: String(semanticGeneration),
    referenceRevision,
    verifiedCount: scan.verifiedCount,
    rows: scan.rows,
    inputByKey,
    profiles,
    overlays: documents,
    evidenceRevision,
    now,
  }) : reusableStoryGeneration({
    type,
    corpusGeneration: scan.generation,
    verifiedCount: scan.verifiedCount,
    profiledCount: profiledVerifiedCount,
    rows: scan.rows,
    inputByKey,
    documents,
    evidenceRevision,
    modelVersion: generationModelVersion,
  }) ?? persistStoryGeneration({
      type,
      corpusGeneration: scan.generation,
      verifiedCount: scan.verifiedCount,
      rows: scan.rows,
      inputByKey,
      documents,
      failures,
      evidenceRevision,
      modelVersion: generationModelVersion,
      now,
      fault: dependencies.persistStoryGenerationFault,
    });
  const titles = progressive ? [...profiles.values()].map(contentProfileStoryGraphTitle) : [...documents].flatMap(([key, document]) => {
    const storyInput = inputByKey.get(key);
    return storyInput ? [graphTitle(storyInput, document)] : [];
  });
  const candidateIds = scan.rows.flatMap((row) => {
    const key = contentKey(row.type, row.id);
    return progressive ? (profiles.has(key) ? [key] : []) : (documents.has(key) ? [key] : []);
  });
  const candidateIdSet = new Set(candidateIds);
  const priorityPhase = options.rank_candidate_ids !== undefined;
  const rankCandidateIds = options.rank_candidate_ids === undefined
    ? candidateIds
    : [...new Set(options.rank_candidate_ids)].filter((identity) => candidateIdSet.has(identity));
  const rankCandidateIdSet = new Set(rankCandidateIds);
  const rankStartedAt = Date.now();
  let ranked: StoryGraphRankResult;
  try {
    ranked = await rank({
      algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
      documents: titles,
      background_ids: candidateIds,
      candidate_ids: rankCandidateIds,
      explicit_ratings: ratings.map((rating): StoryGraphExplicitRating => ({
        type: rating.type, id: rating.id, fire: rating.fire, water: rating.water,
      })),
      implicit_signals: signals.implicit,
      as_of: now,
    });
  } catch (error) {
    // StoryDNA already published successfully. A rank-worker failure belongs
    // to the rank job and cannot poison immutable content profiles.
    throw error;
  }
  const workerLatency = Date.now() - rankStartedAt;
  const calibration = progressive ? persistProgressiveCalibration({
    type,
    referenceRevision,
    tasteRevision: capturedTasteRevision,
    inputByKey,
    profiles,
    ranked,
    now,
  }) : [];
  const tasteGenerationId = persistTasteGeneration({
    type,
    storyGenerationId,
    tasteRevision: capturedTasteRevision,
    rank: ranked,
    now,
  });
  const db = libraryDatabase();
  const rankGeneration = db.prepare(`
INSERT INTO vod_rank_generations(
  content_type, model_version, feature_version, ontology_version,
  story_generation_id, taste_generation_id, taste_revision, corpus_generation,
  trigger_reasons_json, cursor, status, verified_count, started_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'building', ?, ?)
RETURNING rank_generation_id
`).get(
    type,
    progressive ? VOD_STORY_FRONTIER_MODEL_VERSION : VOD_STORY_GRAPH_MODEL_VERSION,
    progressive ? VOD_CONTENT_PROFILE_VERSION : STORY_DNA_SCHEMA_VERSION,
    STORY_DNA_ONTOLOGY_VERSION,
    storyGenerationId,
    tasteGenerationId,
    capturedTasteRevision,
    scan.generation,
    JSON.stringify([...new Set(options.trigger_reasons ?? ['refresh'])].sort()),
    scan.verifiedCount,
    now,
  ) as { rank_generation_id: number };
  const scoreByKey = rankScoreByKey(ranked);
  const rankPositionByKey = new Map(ranked.ranked.map((item, index) => [
    contentKey(item.type, item.id), index + 1,
  ]));
  const threadIndex = new Map(ranked.threads.map((thread, index) => [thread.thread_id, index]));
  const insertRank = db.prepare(`
INSERT INTO vod_rank_items(
  rank_generation_id, content_type, content_id, title, poster, year, rank,
  best_thread, predicted_fire, predicted_water, explicit_support, implicit_support,
  uncertainty, rank_score, feature_hash, serving_eligible, exclusion_reason,
  created_at, updated_at, profile_status, feature_confidence,
  acquisition_lower_score, acquisition_upper_score, profile_hash
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  let eligibleCount = 0;
  let excludedCount = 0;
  db.transaction(() => {
    for (const row of scan.rows) {
      const key = contentKey(row.type, row.id);
      if (priorityPhase && !rankCandidateIdSet.has(key)) continue;
      const score = scoreByKey.get(key);
      const profile = profiles.get(key);
      const acquisitionResiduals = score
        ? progressiveAcquisitionResiduals(profile, score, calibration)
        : null;
      const reason = progressive
        ? progressiveExclusionReason(row, profile, signals)
        : exclusionReason(row, documents.has(key), signals);
      // A partial reserve rescore records only candidates the ranker actually
      // inspected plus real eligibility vetoes. Untouched or unexpectedly
      // unscored corpus rows remain absent and visible as unscored coverage;
      // they are never relabeled as exclusions to make the generation look
      // complete.
      if (!score && reason === null) continue;
      if (reason === null) eligibleCount += 1;
      else excludedCount += 1;
      insertRank.run(
        rankGeneration.rank_generation_id,
        row.type,
        row.id,
        row.title,
        row.poster,
        row.year,
        score ? rankPositionByKey.get(key) ?? null : null,
        score?.best_thread_id ? threadIndex.get(score.best_thread_id) ?? null : null,
        score?.predicted_fire ?? null,
        score?.predicted_water ?? null,
        score?.explicit_support ?? 0,
        score?.implicit_support ?? 0,
        score?.posterior_standard_deviation ?? 0,
        score?.rank_score ?? null,
        progressive
          ? profile?.profile_hash ?? row.evidence_hash
          : documents.get(key) ? storyDnaDocumentHash(documents.get(key)!) : row.evidence_hash,
        reason === null && score ? 1 : 0,
        reason,
        now,
        now,
        progressive ? profile?.profile_state ?? 'unrankable' : null,
        score?.feature_confidence ?? profile?.feature_confidence ?? null,
        score && acquisitionResiduals ? score.rank_score + acquisitionResiduals.lower : null,
        score && acquisitionResiduals ? score.rank_score + acquisitionResiduals.upper : null,
        progressive ? profile?.profile_hash ?? null : null,
      );
    }
  })();
  const accountedCount = eligibleCount + excludedCount;
  const unscoredCount = Math.max(0, scan.verifiedCount - accountedCount);
  const accountingCoverage = scan.verifiedCount > 0 ? accountedCount / scan.verifiedCount : 1;
  const generationCursor = priorityPhase
    ? `priority:${accountedCount}/${scan.verifiedCount}`
    : scan.rows.at(-1)?.id ?? null;
  if (!priorityPhase && accountedCount !== scan.verifiedCount) {
    db.prepare(`
UPDATE vod_rank_generations
SET cursor = ?, status = 'failed', scored_count = ?, eligible_count = ?,
    excluded_count = ?, completed_at = ?, last_error = 'incomplete_rank_accounting'
WHERE rank_generation_id = ?
`).run(
      generationCursor,
      eligibleCount,
      eligibleCount,
      excludedCount,
      now,
      rankGeneration.rank_generation_id,
    );
    throw new Error(
      `full Story Graph accounting incomplete: ${accountedCount}/${scan.verifiedCount}`,
    );
  }
  const freshCorpus = await currentCorpusGeneration();
  const freshRatings = listRatings(type, 'household');
  const freshSignals = readHouseholdSignals(type);
  const freshTasteRevision = tasteRevision(type, freshRatings, freshSignals, now);
  const freshTeacherConfiguration = storyDnaTeacherConfiguration().revision;
  const freshSemanticGeneration = progressive ? await currentSemanticGeneration() : 0;
  if (freshCorpus !== scan.generation || freshTasteRevision !== capturedTasteRevision
    || (!progressive && freshTeacherConfiguration !== teacherConfiguration.revision)
    || (progressive && freshSemanticGeneration !== semanticGeneration)) {
    markGenerationsStale(
      storyGenerationId,
      tasteGenerationId,
      rankGeneration.rank_generation_id,
      freshCorpus !== scan.generation
        ? 'corpus_revision_changed'
        : freshTasteRevision !== capturedTasteRevision
          ? 'taste_revision_changed'
          : progressive ? 'semantic_revision_changed' : 'teacher_configuration_changed',
    );
  }
  const newerActive = db.prepare(`
SELECT active_rank_generation_id FROM vod_active_generations WHERE content_type = ?
`).get(type) as { active_rank_generation_id: number | null } | undefined;
  if ((newerActive?.active_rank_generation_id ?? 0) > rankGeneration.rank_generation_id) {
    markGenerationsStale(
      storyGenerationId,
      tasteGenerationId,
      rankGeneration.rank_generation_id,
      'newer_rank_generation_already_active',
    );
  }
  const bootstrapMinimum = options.bootstrap_minimum ?? boundedInteger(
    process.env.MANGO_VOD_STORY_GRAPH_BOOTSTRAP_MIN,
    DEFAULT_BOOTSTRAP_MINIMUM,
    VISIBLE_LIMIT,
    10_000,
  );
  const eligibleRows = await currentlyEligibleRankRows(rankGeneration.rank_generation_id, type);
  const published = eligibleRows.length >= bootstrapMinimum && ranked.selected_k > 0;
  const publishedEmptyState = !priorityPhase && ranked.selected_k === 0;
  let epoch: number | null = null;
  if (published) {
    epoch = createPredealtSlateQueue({
      type,
      rankGenerationId: rankGeneration.rank_generation_id,
      rows: eligibleRows,
      selectedK: ranked.selected_k,
      threadIds: ranked.threads.map((thread) => thread.thread_id),
      now,
    });
  }
  const canPublish = published && epoch !== null;
  const promotedActive = priorityPhase ? activePromotedStoryGraphGeneration(type) : null;
  const priorityReplacementAuthorized = priorityPhase
    && options.priority_base_rank_generation_id !== undefined
    && options.priority_promotion_rank_generation_id !== undefined
    && promotedActive?.active_rank_generation_id === options.priority_base_rank_generation_id
    && promotedActive.promotion_rank_generation_id === options.priority_promotion_rank_generation_id;
  const publishesState = priorityPhase
    ? canPublish && priorityReplacementAuthorized
    : canPublish || publishedEmptyState;
  if (priorityPhase) {
    db.prepare(`
UPDATE vod_rank_generations
SET cursor = ?, status = 'bootstrap', scored_count = ?, eligible_count = ?,
    excluded_count = ?, published_at = ?, completed_at = NULL,
    last_error = CASE WHEN ? THEN NULL ELSE 'priority_replacement_not_authorized' END
WHERE rank_generation_id = ?
`).run(
      generationCursor,
      eligibleCount,
      eligibleCount,
      excludedCount,
      publishesState ? now : null,
      priorityReplacementAuthorized ? 1 : 0,
      rankGeneration.rank_generation_id,
    );
  } else {
    db.prepare(`
UPDATE vod_rank_generations
SET cursor = ?, status = 'complete', scored_count = ?, eligible_count = ?,
    excluded_count = ?, published_at = ?, completed_at = ?
WHERE rank_generation_id = ?
`).run(
      generationCursor,
      eligibleCount,
      eligibleCount,
      excludedCount,
      publishesState ? now : null,
      now,
      rankGeneration.rank_generation_id,
    );
  }
  db.prepare(`
UPDATE vod_story_dna_generations
SET published_at = COALESCE(published_at, ?)
WHERE generation_id = ?
`).run(publishesState ? now : null, storyGenerationId);
  const measuredCachedP95 = canPublish && options.cached_service_p95_ms === undefined
    ? await measureCachedServiceP95({
      tab,
      type,
      epoch: epoch!,
      rankGenerationId: rankGeneration.rank_generation_id,
      reserveDepth: eligibleCount,
    })
    : null;
  const cachedServiceP95 = options.cached_service_p95_ms === undefined
    ? measuredCachedP95
    : options.cached_service_p95_ms;
  const evaluation = priorityPhase
    ? partialPriorityEvaluation({
      rankGenerationId: rankGeneration.rank_generation_id,
      verifiedCount: scan.verifiedCount,
      accountedCount,
      workerLatencyMs: workerLatency,
      cachedServiceP95Ms: cachedServiceP95,
      now,
    })
    : (dependencies.evaluate ?? evaluateStoryGraphOffline)({
      rankGenerationId: rankGeneration.rank_generation_id,
      documents: titles,
      background_ids: candidateIds,
      inputByKey,
      ratings,
      verifiedCount: scan.verifiedCount,
      accountedCount,
      reserveDepth: eligibleCount,
      workerLatencyMs: workerLatency,
      cachedServiceP95Ms: cachedServiceP95,
      now,
    });
  persistOfflineEvaluation(type, evaluation);
  // Evaluation and the local p95 probe can yield to mutation handlers. Capture
  // revisions again so neither a stale nor an untied evaluation can activate.
  const activationCorpus = await currentCorpusGeneration();
  const activationRatings = listRatings(type, 'household');
  const activationSignals = readHouseholdSignals(type);
  const activationSemanticGeneration = progressive ? await currentSemanticGeneration() : 0;
  if (activationCorpus !== scan.generation
    || tasteRevision(type, activationRatings, activationSignals, now) !== capturedTasteRevision
    || (!progressive && storyDnaTeacherConfiguration().revision !== teacherConfiguration.revision)
    || (progressive && activationSemanticGeneration !== semanticGeneration)) {
    const activationTasteRevision = tasteRevision(
      type,
      activationRatings,
      activationSignals,
      now,
    );
    markGenerationsStale(
      storyGenerationId,
      tasteGenerationId,
      rankGeneration.rank_generation_id,
      activationCorpus !== scan.generation
        ? 'corpus_revision_changed_before_activation'
        : activationTasteRevision !== capturedTasteRevision
          ? 'taste_revision_changed_before_activation'
          : progressive
            ? 'semantic_revision_changed_before_activation'
            : 'teacher_configuration_changed_before_activation',
    );
  }
  const activationPromotedActive = priorityPhase ? activePromotedStoryGraphGeneration(type) : null;
  const priorityActivationAuthorized = priorityReplacementAuthorized
    && activationPromotedActive?.active_rank_generation_id === options.priority_base_rank_generation_id
    && activationPromotedActive?.promotion_rank_generation_id
      === options.priority_promotion_rank_generation_id;
  const activatesRank = canPublish && (priorityPhase
    ? priorityActivationAuthorized
    : evaluation.promotion_eligible);
  const activatesEmptyState = !priorityPhase
    && publishedEmptyState && vodRecommendationsV2Mode() === 'serve';
  const activated = activatesRank || activatesEmptyState;
  if (activated) {
    const current = db.prepare(`
SELECT shuffle_epoch FROM vod_active_generations WHERE content_type = ?
`).get(type) as { shuffle_epoch: number } | undefined;
    updateActiveGeneration({
      type,
      rankGenerationId: rankGeneration.rank_generation_id,
      storyGenerationId,
      tasteGenerationId,
      epoch: epoch ?? current?.shuffle_epoch ?? 0,
      now,
      requireSlate: activatesRank,
    });
  }
  if (progressive) {
    enqueueStoryDnaFrontierCandidates(selectProgressiveFrontierCandidates({
      inputByKey,
      profiles,
      overlays: documents,
      ratings,
      signals,
      ranked,
      calibration,
    }), now);
  }
  return {
    tab,
    story_generation_id: storyGenerationId,
    taste_generation_id: tasteGenerationId,
    rank_generation_id: rankGeneration.rank_generation_id,
    corpus_generation: scan.generation,
    verified_count: scan.verifiedCount,
    profiled_count: scan.rows.filter((row) => documents.has(contentKey(row.type, row.id))).length,
    retryable_failure_count: progressive
      ? scan.rows.filter((row) => profiles.get(contentKey(row.type, row.id))?.profile_state === 'sparse_unresolved').length
      : scan.rows.filter((row) => !documents.has(contentKey(row.type, row.id))).length,
    scored_count: eligibleCount,
    excluded_count: excludedCount,
    unscored_count: unscoredCount,
    coverage: accountingCoverage,
    reserve_depth: eligibleCount,
    selected_k: ranked.selected_k,
    rank_status: priorityPhase ? 'bootstrap' : 'complete',
    published: publishesState,
    activated,
    evaluation,
  };
}

const storyGraphRefreshTails: Record<StoryGraphTab, Promise<void>> = {
  movies: Promise.resolve(),
  series: Promise.resolve(),
};
const storyGraphBackfillTimers = new Map<StoryGraphTab, ReturnType<typeof setTimeout>>();
let storyDnaFrontierTimer: ReturnType<typeof setTimeout> | null = null;

const TASTE_MUTATION_TRIGGER_REASONS = new Set([
  'signal_change', 'rating_change', 'rating_clear', 'save', 'unsave',
  'meaningful_watch', 'watch_completion',
]);

function activePriorityReserveIds(
  type: RatingContentType,
  activeRankGenerationId: number,
  limit: number,
): StoryGraphContentId[] {
  const rows = libraryDatabase().prepare(`
SELECT items.content_id
FROM vod_rank_items items
WHERE items.rank_generation_id = ? AND items.content_type = ?
  AND items.serving_eligible = 1 AND items.rank IS NOT NULL
ORDER BY items.rank ASC, items.content_id ASC
LIMIT ?
`).all(activeRankGenerationId, type, limit) as Array<{ content_id: string }>;
  return rows.map((row) => contentKey(type, row.content_id));
}

function isTasteMutationRefresh(reasons: readonly string[] | undefined): boolean {
  return (reasons ?? []).some((reason) => TASTE_MUTATION_TRIGGER_REASONS.has(reason));
}

async function refreshStoryGraphWithPriorityPhase(
  tab: StoryGraphTab,
  options: StoryGraphRefreshOptions,
): Promise<StoryGraphRefreshResult> {
  const bootstrapMinimum = options.bootstrap_minimum ?? boundedInteger(
    process.env.MANGO_VOD_STORY_GRAPH_BOOTSTRAP_MIN,
    DEFAULT_BOOTSTRAP_MINIMUM,
    VISIBLE_LIMIT,
    10_000,
  );
  const priorityLimit = boundedInteger(
    process.env.MANGO_VOD_STORY_GRAPH_PRIORITY_RESERVE,
    Math.max(240, bootstrapMinimum),
    bootstrapMinimum,
    2_000,
  );
  const type = contentTypeForTab(tab);
  const promotedActive = isTasteMutationRefresh(options.trigger_reasons)
    ? activePromotedStoryGraphGeneration(type)
    : null;
  const priorityIds = promotedActive
    ? activePriorityReserveIds(type, promotedActive.active_rank_generation_id, priorityLimit)
    : [];
  if (priorityIds.length >= bootstrapMinimum) {
    await refreshStoryGraphForYouUnserialized(tab, {
      ...options,
      trigger_reasons: [...new Set([
        ...(options.trigger_reasons ?? []),
        'priority_rescore',
      ])],
      rank_candidate_ids: priorityIds,
      priority_base_rank_generation_id: promotedActive!.active_rank_generation_id,
      priority_promotion_rank_generation_id: promotedActive!.promotion_rank_generation_id,
    });
    return refreshStoryGraphForYouUnserialized(tab, {
      ...options,
      trigger_reasons: [...new Set([
        ...(options.trigger_reasons ?? []),
        'full_corpus_followup',
      ])],
      rank_candidate_ids: undefined,
    });
  }
  return refreshStoryGraphForYouUnserialized(tab, options);
}

function scheduleAutonomousStoryDnaBackfill(
  tab: StoryGraphTab,
  result: StoryGraphRefreshResult,
): void {
  if (vodContentProfileMode() === 'progressive-v2'
    || process.env.MANGO_STORY_DNA_AUTONOMOUS_BACKFILL === '0'
    || result.retryable_failure_count <= 0 || storyGraphBackfillTimers.has(tab)) return;
  const type = contentTypeForTab(tab);
  const backlog = libraryDatabase().prepare(`
SELECT
  SUM(CASE WHEN failure_reason = 'story-dna-backlog' THEN 1 ELSE 0 END) AS backlog_count,
  MIN(CASE WHEN failure_reason != 'story-dna-backlog' THEN next_retry_at END) AS next_retry_at
FROM vod_story_dna_documents
WHERE generation_id = ? AND content_type = ? AND status = 'retryable_failure'
`).get(result.story_generation_id, type) as {
    backlog_count: number | null;
    next_retry_at: number | null;
  };
  const immediateDelay = boundedInteger(
    process.env.MANGO_STORY_DNA_BACKFILL_DELAY_MS,
    1_000,
    100,
    60_000,
  );
  const delay = (backlog.backlog_count ?? 0) > 0
    ? immediateDelay
    : Math.max(immediateDelay, (backlog.next_retry_at ?? Date.now() + STORY_DNA_RETRY_MAX_MS) - Date.now());
  const timer = setTimeout(() => {
    storyGraphBackfillTimers.delete(tab);
    void refreshStoryGraphForYou(tab, { trigger_reasons: ['story_dna_backfill'] })
      .catch((error) => {
        console.warn(`StoryDNA autonomous ${tab} backfill retained last-good: ${
          error instanceof Error ? error.message : String(error)
        }`);
      });
  }, delay);
  timer.unref?.();
  storyGraphBackfillTimers.set(tab, timer);
}

function scheduleStoryDnaFrontierWorker(): void {
  if (vodContentProfileMode() !== 'progressive-v2'
    || storyDnaWorkerMode() !== 'frontier' || storyDnaFrontierTimer) return;
  const delay = boundedInteger(
    process.env.MANGO_STORY_DNA_FRONTIER_COALESCE_MS,
    15 * 60 * 1_000,
    1_000,
    60 * 60 * 1_000,
  );
  storyDnaFrontierTimer = setTimeout(() => {
    storyDnaFrontierTimer = null;
    void runStoryDnaFrontierWorker({
      lookup: structuredLookupProvider,
      onProfilesChanged: async (types) => {
        for (const type of types) {
          await refreshStoryGraphForYou(type === 'movie' ? 'movies' : 'series', {
            trigger_reasons: ['story_dna_frontier_complete'],
          });
        }
      },
    }).catch((error) => console.warn(`StoryDNA frontier retained local profiles: ${
      error instanceof Error ? error.message : String(error)
    }`));
  }, delay);
  storyDnaFrontierTimer.unref?.();
}

/** Per-media serialization prevents Movies and Series from blocking each other. */
export function refreshStoryGraphForYou(
  tab: StoryGraphTab,
  options: StoryGraphRefreshOptions = {},
): Promise<StoryGraphRefreshResult> {
  const run = storyGraphRefreshTails[tab]
    .catch(() => undefined)
    .then(() => refreshStoryGraphWithPriorityPhase(tab, options));
  storyGraphRefreshTails[tab] = run.then(() => undefined, () => undefined);
  if (options.dependencies !== undefined) return run;
  return run.then((result) => {
    if (vodContentProfileMode() === 'progressive-v2') scheduleStoryDnaFrontierWorker();
    else scheduleAutonomousStoryDnaBackfill(tab, result);
    return result;
  });
}

function cachedSlateRows(
  type: RatingContentType,
  epoch: number,
  rankGenerationId: number,
): PersistedRankRow[] {
  return libraryDatabase().prepare(`
SELECT ri.rank_generation_id, ri.content_type, ri.content_id, ri.title, ri.poster,
       ri.year, ri.rank, ri.best_thread, ri.predicted_fire, ri.predicted_water,
       ri.explicit_support, ri.implicit_support, ri.uncertainty, ri.rank_score
FROM vod_cached_slate_items csi
JOIN vod_cached_slates cs
  ON cs.rank_generation_id = csi.rank_generation_id
 AND cs.content_type = csi.content_type AND cs.shuffle_epoch = csi.shuffle_epoch
JOIN vod_rank_items ri
  ON ri.rank_generation_id = csi.rank_generation_id
 AND ri.content_type = csi.content_type AND ri.content_id = csi.content_id
WHERE csi.rank_generation_id = ? AND csi.content_type = ? AND csi.shuffle_epoch = ?
ORDER BY csi.slot
`).all(rankGenerationId, type, epoch) as PersistedRankRow[];
}

function currentExactExclusionsForIds(
  type: RatingContentType,
  ids: readonly string[],
): Set<StoryGraphContentId> {
  if (ids.length === 0) return new Set();
  const requestedValues = ids.map(() => '(?)').join(', ');
  const rows = libraryDatabase().prepare(`
WITH requested(content_id) AS (VALUES ${requestedValues})
SELECT requested.content_id
FROM requested
WHERE EXISTS (
  SELECT 1 FROM profile_content_ratings ratings
  WHERE ratings.profile_id = 'household' AND ratings.content_type = ?
    AND ratings.content_id = requested.content_id
) OR EXISTS (
  SELECT 1 FROM profile_saved_items saved
  JOIN library_items item ON item.item_key = saved.item_key
  WHERE saved.profile_id = 'household' AND item.type = ? AND item.id = requested.content_id
) OR EXISTS (
  SELECT 1 FROM profile_watch_state watched
  JOIN library_items item ON item.item_key = watched.item_key
  WHERE watched.profile_id = 'household' AND item.type = ? AND item.id = requested.content_id
    AND (
      watched.finished_at IS NOT NULL OR watched.progress_pct >= 0.9 OR
      (watched.duration_sec > 0 AND watched.position_sec >= MIN(watched.duration_sec * 0.25, 300)) OR
      (watched.duration_sec <= 0 AND watched.position_sec >= 120)
    )
) OR EXISTS (
  SELECT 1 FROM library_items item
  WHERE item.type = ? AND item.id = requested.content_id
    AND (item.hidden = 1 OR item.blocked = 1)
) OR EXISTS (
  SELECT 1 FROM profile_library_feedback feedback
  JOIN library_items item ON item.item_key = feedback.item_key
  WHERE feedback.profile_id = 'household' AND feedback.feedback = 'not_interested'
    AND item.type = ? AND item.id = requested.content_id
)
`).all(...ids, type, type, type, type, type) as Array<{ content_id: string }>;
  return new Set(rows.map((row) => contentKey(type, row.content_id)));
}

async function validateSlateRows(rows: PersistedRankRow[], type: RatingContentType): Promise<boolean> {
  if (rows.length !== VISIBLE_LIMIT || new Set(rows.map((row) => row.content_id)).size !== VISIBLE_LIMIT) {
    return false;
  }
  if (rows.some((row) => !row.poster)) return false;
  storyGraphServingWorkCounters.slate_items_revalidated += rows.length;
  const current = await getTitlesPlayabilityBulk(rows.map((row) => ({ type, id: row.content_id })));
  const exclusions = currentExactExclusionsForIds(type, rows.map((row) => row.content_id));
  return rows.every((row) => {
    const key = contentKey(type, row.content_id);
    return current.get(key)?.status === 'verified' && !exclusions.has(key);
  });
}

function queuedSlateEpochs(
  rankGenerationId: number,
  type: RatingContentType,
  afterEpoch: number,
  limit: number,
): number[] {
  return (libraryDatabase().prepare(`
SELECT shuffle_epoch
FROM vod_cached_slates
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch > ?
ORDER BY shuffle_epoch ASC
LIMIT ?
`).all(rankGenerationId, type, afterEpoch, limit) as Array<{ shuffle_epoch: number }>)
    .map((row) => row.shuffle_epoch);
}

function advanceActiveSlate(input: {
  type: RatingContentType;
  rankGenerationId: number;
  expectedEpoch: number;
  nextEpoch: number;
  now: number;
}): boolean {
  const db = libraryDatabase();
  return db.transaction(() => {
    const target = db.prepare(`
SELECT COUNT(*) AS item_count, COUNT(DISTINCT content_id) AS unique_count
FROM vod_cached_slate_items
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch = ?
`).get(input.rankGenerationId, input.type, input.nextEpoch) as {
      item_count: number;
      unique_count: number;
    };
    if (target.item_count !== VISIBLE_LIMIT || target.unique_count !== VISIBLE_LIMIT) return false;
    const advanced = db.prepare(`
UPDATE vod_active_generations
SET shuffle_epoch = ?, updated_at = ?
WHERE content_type = ? AND active_rank_generation_id = ? AND shuffle_epoch = ?
`).run(
      input.nextEpoch,
      input.now,
      input.type,
      input.rankGenerationId,
      input.expectedEpoch,
    ).changes === 1;
    if (advanced) {
      db.prepare(`
UPDATE vod_cached_slates SET rendered_at = COALESCE(rendered_at, ?)
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch = ?
`).run(input.now, input.rankGenerationId, input.type, input.nextEpoch);
    }
    return advanced;
  })();
}

function markCachedSlateRendered(
  rankGenerationId: number,
  type: RatingContentType,
  epoch: number,
  now: number,
): void {
  libraryDatabase().prepare(`
UPDATE vod_cached_slates SET rendered_at = COALESCE(rendered_at, ?)
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch = ?
`).run(now, rankGenerationId, type, epoch);
}

export function hasPublishedStoryGraphGeneration(tab: StoryGraphTab): boolean {
  const type = contentTypeForTab(tab);
  const row = libraryDatabase().prepare(`
SELECT 1 AS present
FROM vod_active_generations active
JOIN vod_rank_generations ranks
  ON ranks.rank_generation_id = active.active_rank_generation_id
WHERE active.content_type = ? AND ranks.status IN ('bootstrap', 'complete')
LIMIT 1
`).get(type) as { present: number } | undefined;
  return Boolean(row);
}

/** A valid no-thread publication intentionally suppresses For You. */
export function storyGraphPublishedHasNoTaste(tab: StoryGraphTab): boolean {
  const type = contentTypeForTab(tab);
  const row = libraryDatabase().prepare(`
SELECT taste.selected_k
FROM vod_active_generations active
JOIN vod_rank_generations ranks ON ranks.rank_generation_id = active.active_rank_generation_id
JOIN vod_taste_generations taste ON taste.taste_generation_id = active.active_taste_generation_id
WHERE active.content_type = ? AND ranks.status IN ('bootstrap', 'complete')
`).get(type) as { selected_k: number } | undefined;
  return row?.selected_k === 0;
}

export async function loadStoryGraphForYouRail(
  tab: StoryGraphTab,
  options: { reshuffle?: boolean } = {},
): Promise<StoryGraphForYouRail | null> {
  const startedAt = Date.now();
  const type = contentTypeForTab(tab);
  const db = libraryDatabase();
  const active = db.prepare(`
SELECT active.active_rank_generation_id AS rank_generation_id,
       active.active_taste_generation_id AS taste_generation_id,
       active.shuffle_epoch, taste.selected_k
FROM vod_active_generations active
JOIN vod_rank_generations ranks ON ranks.rank_generation_id = active.active_rank_generation_id
JOIN vod_taste_generations taste ON taste.taste_generation_id = active.active_taste_generation_id
WHERE active.content_type = ? AND ranks.status IN ('bootstrap', 'complete')
`).get(type) as {
    rank_generation_id: number;
    taste_generation_id: number;
    shuffle_epoch: number;
    selected_k: number;
  } | undefined;
  if (!active || active.selected_k <= 0) return null;
  const reserveDepth = (db.prepare(`
SELECT eligible_count FROM vod_rank_generations WHERE rank_generation_id = ?
`).get(active.rank_generation_id) as { eligible_count: number } | undefined)?.eligible_count ?? 0;
  let epoch = active.shuffle_epoch;
  let rows = cachedSlateRows(type, epoch, active.rank_generation_id);
  let currentValid = await validateSlateRows(rows, type);
  let lowWater = false;
  if (options.reshuffle || !currentValid) {
    const scanLimit = boundedInteger(
      process.env.MANGO_VOD_STORY_GRAPH_COUCH_QUEUE_SCAN,
      DEFAULT_COUCH_QUEUE_SCAN_LIMIT,
      1,
      32,
    );
    let replacement: { epoch: number; rows: PersistedRankRow[] } | null = null;
    const validQueued: Array<{ epoch: number; rows: PersistedRankRow[] }> = [];
    for (const candidateEpoch of queuedSlateEpochs(
      active.rank_generation_id,
      type,
      epoch,
      scanLimit,
    )) {
      storyGraphServingWorkCounters.queue_slates_scanned += 1;
      const candidateRows = cachedSlateRows(type, candidateEpoch, active.rank_generation_id);
      if (await validateSlateRows(candidateRows, type)) {
        validQueued.push({ epoch: candidateEpoch, rows: candidateRows });
      }
    }
    const rendered = recentCachedSlates(active.rank_generation_id, type, 4, true);
    const retainedRendered = [...rendered];
    while (!replacement && validQueued.length > 0) {
      const excluded = new Set(retainedRendered.flatMap((slate) => slate.ids));
      replacement = validQueued.find((candidate) => candidate.rows.every(
        (row) => !excluded.has(contentKey(type, row.content_id)),
      )) ?? null;
      if (replacement || retainedRendered.length === 0) break;
      // Rendered history is newest-first; relax the oldest slate first.
      retainedRendered.pop();
    }
    replacement ??= validQueued[0] ?? null;
    if (!replacement && !currentValid) {
      for (const previous of rendered.filter((slate) => slate.epoch !== epoch).slice(0, scanLimit)) {
        storyGraphServingWorkCounters.queue_slates_scanned += 1;
        const candidateRows = cachedSlateRows(type, previous.epoch, active.rank_generation_id);
        if (await validateSlateRows(candidateRows, type)) {
          replacement = { epoch: previous.epoch, rows: candidateRows };
          break;
        }
      }
    }
    if (replacement) {
      const advanced = advanceActiveSlate({
        type,
        rankGenerationId: active.rank_generation_id,
        expectedEpoch: epoch,
        nextEpoch: replacement.epoch,
        now: Date.now(),
      });
      if (advanced) {
        epoch = replacement.epoch;
        rows = replacement.rows;
        currentValid = true;
      } else {
        const current = db.prepare(`
SELECT active_rank_generation_id AS rank_generation_id, shuffle_epoch
FROM vod_active_generations WHERE content_type = ?
`).get(type) as { rank_generation_id: number; shuffle_epoch: number } | undefined;
        if (!current || current.rank_generation_id !== active.rank_generation_id) return null;
        epoch = current.shuffle_epoch;
        rows = cachedSlateRows(type, epoch, active.rank_generation_id);
        currentValid = await validateSlateRows(rows, type);
      }
    }
    if (!replacement || !currentValid) {
      lowWater = true;
      enqueueStoryGraphLowWater({
        tab,
        content_type: type,
        rank_generation_id: active.rank_generation_id,
        available_count: reserveDepth,
        reason: 'six_card_heal_failed',
        requested_at: Date.now(),
      });
    }
  }
  if (!currentValid) return null;
  markCachedSlateRendered(active.rank_generation_id, type, epoch, Date.now());
  const served = registerRecommendationServedSlate({
    profile_id: 'household',
    domain: 'vod',
    rail_id: tab === 'movies' ? 'for-you-movies' : 'for-you-series',
    source_revision: active.rank_generation_id,
    items: rows.map((row, rank) => ({ type, id: row.content_id, rank })),
  });
  return buildStoryGraphForYouRail({
    tab,
    type,
    rankGenerationId: active.rank_generation_id,
    epoch,
    reserveDepth,
    rows,
    served,
    resolveMs: Date.now() - startedAt,
    lowWater,
  });
}

export type StoryGraphDiagnostics = {
  model_version: typeof VOD_STORY_GRAPH_MODEL_VERSION | typeof VOD_STORY_FRONTIER_MODEL_VERSION;
  profile_mode: VodContentProfileMode;
  frontier: ReturnType<typeof storyDnaFrontierDiagnostics>;
  tmdb: ReturnType<typeof tmdbMetadataStatus>;
  schema_version: typeof STORY_DNA_SCHEMA_VERSION;
  ontology_version: typeof STORY_DNA_ONTOLOGY_VERSION;
  teacher_configuration_revision: string;
  mode_ready: boolean;
  domains: Array<{
    content_type: RatingContentType;
    rank_generation_id: number | null;
    story_generation_id: number | null;
    taste_generation_id: number | null;
    corpus_generation: number | null;
    teacher_model_version: string | null;
    evidence_revision: string | null;
    status: string | null;
    verified_count: number;
    profiled_count: number;
    base_profile_count: number;
    enriched_profile_count: number;
    sparse_profile_count: number;
    compiler_version: string | null;
    semantic_revision: string | null;
    reference_revision: string | null;
    failure_count: number;
    scored_count: number;
    excluded_count: number;
    unscored_count: number;
    coverage: number;
    reserve_depth: number;
    active_thread_count: number;
    cursor: string | null;
    last_good_publication: number | null;
    uncertainty: { mean: number | null; maximum: number | null };
    family_coverage: Record<string, number>;
    edge_sources: Record<string, number>;
    calibration: {
      status: StoryFrontierCalibrationBand['status'] | null;
      sample_count: number;
      empirical_coverage: number | null;
      lower_residual: number | null;
      upper_residual: number | null;
    };
    stale_reasons: string[];
    lookup: StoryDnaLookupStatus | null;
    low_water: StoryGraphLowWaterRequest | null;
    evaluation: StoryGraphOfflineEvaluation | null;
  }>;
};

export function storyGraphDiagnostics(): StoryGraphDiagnostics {
  const db = libraryDatabase();
  const domains = (['movie', 'series'] as const).map((type) => {
    const row = db.prepare(`
SELECT ranks.rank_generation_id, ranks.story_generation_id, ranks.taste_generation_id,
       ranks.corpus_generation, ranks.taste_revision, ranks.status, ranks.verified_count, ranks.scored_count,
       ranks.excluded_count, ranks.eligible_count, ranks.cursor, ranks.published_at,
       ranks.last_error, story.complete_count, story.failure_count, story.model_version,
       story.evidence_revision, story.base_complete_count, story.teacher_complete_count,
       story.partial_count, story.compiler_version, story.semantic_revision,
       story.reference_revision, taste.selected_k,
       (SELECT AVG(uncertainty) FROM vod_rank_items items
        WHERE items.rank_generation_id = ranks.rank_generation_id AND items.serving_eligible = 1) AS mean_uncertainty,
       (SELECT MAX(uncertainty) FROM vod_rank_items items
        WHERE items.rank_generation_id = ranks.rank_generation_id AND items.serving_eligible = 1) AS max_uncertainty
FROM vod_rank_generations ranks
JOIN vod_story_dna_generations story ON story.generation_id = ranks.story_generation_id
JOIN vod_taste_generations taste ON taste.taste_generation_id = ranks.taste_generation_id
WHERE ranks.content_type = ? ORDER BY ranks.rank_generation_id DESC LIMIT 1
`).get(type) as {
      rank_generation_id: number;
      story_generation_id: number;
      taste_generation_id: number;
      corpus_generation: number;
      taste_revision: string;
      model_version: string;
      evidence_revision: string;
      status: string;
      verified_count: number;
      scored_count: number;
      excluded_count: number;
      eligible_count: number;
      cursor: string | null;
      published_at: number | null;
      last_error: string | null;
      complete_count: number;
      base_complete_count: number;
      teacher_complete_count: number;
      partial_count: number;
      compiler_version: string | null;
      semantic_revision: string | null;
      reference_revision: string | null;
      failure_count: number;
      selected_k: number;
      mean_uncertainty: number | null;
      max_uncertainty: number | null;
    } | undefined;
    const familyCoverage = row ? Object.fromEntries((db.prepare(`
SELECT family, COUNT(DISTINCT content_id) AS count
FROM vod_content_profile_edges WHERE generation_id = ? GROUP BY family ORDER BY family
`).all(row.story_generation_id) as Array<{ family: string; count: number }>).map((item) => (
      [item.family, item.count]
    ))) : {};
    const edgeSources = row ? Object.fromEntries((db.prepare(`
SELECT edge_source, COUNT(*) AS count
FROM vod_content_profile_edges WHERE generation_id = ? GROUP BY edge_source ORDER BY edge_source
`).all(row.story_generation_id) as Array<{ edge_source: string; count: number }>).map((item) => (
      [item.edge_source, item.count]
    ))) : {};
    const calibration = row?.reference_revision ? db.prepare(`
SELECT sample_count, lower_residual, upper_residual, empirical_coverage, status
FROM vod_semantic_calibration
WHERE reference_revision = ? AND content_type = ? AND taste_revision = ? AND stratum = '__pooled__'
`).get(row.reference_revision, type, row.taste_revision) as {
      sample_count: number;
      lower_residual: number;
      upper_residual: number;
      empirical_coverage: number;
      status: StoryFrontierCalibrationBand['status'];
    } | undefined : undefined;
    return {
      content_type: type,
      rank_generation_id: row?.rank_generation_id ?? null,
      story_generation_id: row?.story_generation_id ?? null,
      taste_generation_id: row?.taste_generation_id ?? null,
      corpus_generation: row?.corpus_generation ?? null,
      teacher_model_version: row?.model_version ?? null,
      evidence_revision: row?.evidence_revision ?? null,
      status: row?.status ?? null,
      verified_count: row?.verified_count ?? 0,
      profiled_count: row?.complete_count ?? 0,
      base_profile_count: row?.base_complete_count ?? 0,
      enriched_profile_count: row?.teacher_complete_count ?? row?.complete_count ?? 0,
      sparse_profile_count: row?.partial_count ?? 0,
      compiler_version: row?.compiler_version ?? null,
      semantic_revision: row?.semantic_revision ?? null,
      reference_revision: row?.reference_revision ?? null,
      failure_count: row?.failure_count ?? 0,
      scored_count: row?.scored_count ?? 0,
      excluded_count: row?.excluded_count ?? 0,
      unscored_count: Math.max(
        0,
        (row?.verified_count ?? 0) - (row?.scored_count ?? 0) - (row?.excluded_count ?? 0),
      ),
      coverage: (row?.verified_count ?? 0) > 0
        ? ((row?.scored_count ?? 0) + (row?.excluded_count ?? 0)) / row!.verified_count
        : 1,
      reserve_depth: row?.eligible_count ?? 0,
      active_thread_count: row?.selected_k ?? 0,
      cursor: row?.cursor ?? null,
      last_good_publication: row?.published_at ?? null,
      uncertainty: { mean: row?.mean_uncertainty ?? null, maximum: row?.max_uncertainty ?? null },
      family_coverage: familyCoverage,
      edge_sources: edgeSources,
      calibration: {
        status: calibration?.status ?? null,
        sample_count: calibration?.sample_count ?? 0,
        empirical_coverage: calibration?.empirical_coverage ?? null,
        lower_residual: calibration?.lower_residual ?? null,
        upper_residual: calibration?.upper_residual ?? null,
      },
      stale_reasons: row?.last_error ? [row.last_error] : [],
      lookup: storyDnaLookupStatus(type),
      low_water: (() => {
        const state = db.prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = ?
`).get(lowWaterStateKey(type)) as { value_json: string } | undefined;
        if (!state) return null;
        try {
          return JSON.parse(state.value_json) as StoryGraphLowWaterRequest;
        } catch {
          return null;
        }
      })(),
      evaluation: storyGraphOfflineEvaluation(type, row?.rank_generation_id),
    };
  });
  return {
    model_version: vodContentProfileMode() === 'progressive-v2'
      ? VOD_STORY_FRONTIER_MODEL_VERSION : VOD_STORY_GRAPH_MODEL_VERSION,
    profile_mode: vodContentProfileMode(),
    frontier: storyDnaFrontierDiagnostics(),
    tmdb: tmdbMetadataStatus(),
    schema_version: STORY_DNA_SCHEMA_VERSION,
    ontology_version: STORY_DNA_ONTOLOGY_VERSION,
    teacher_configuration_revision: storyDnaTeacherConfiguration().revision,
    mode_ready: domains.some((domain) => domain.rank_generation_id !== null),
    domains,
  };
}
