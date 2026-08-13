import { createHash, randomUUID } from 'node:crypto';
import { AI_CATALOG_RAIL_PREFIX } from '../ai-catalogs/types.js';
import {
  libraryDatabase,
  pruneStoryGraphGenerationHistory,
  registerRecommendationServedSlate,
  STORY_GRAPH_INLINE_PRUNE_LIMIT,
  SYNTHETIC_LIBRARY_SOURCE,
} from '../library/db.js';
import { listRatings, type FireWaterRating, type RatingContentType } from '../library/ratings.js';
import {
  getTitlesPlayabilityBulk,
  initPlayabilityDb,
  listCurrentlyVerifiedTitleKeys,
  listVerifiedRecommendationCatalogPage,
  playabilityRecommendationCorpusGeneration,
  playabilityRecommendationSemanticGeneration,
  recordRecommendationSemanticEvidence,
  type VerifiedRecommendationCatalogPage,
  type VerifiedRecommendationCatalogRow,
} from '../playability/db.js';
import {
  loadCompatibleStoryDnaTeacherCache,
  storyDnaTeacherConfiguration,
} from './story-dna-teacher.js';
import {
  STORY_DNA_ONTOLOGY_VERSION,
  STORY_DNA_PROMPT_VERSION,
  STORY_DNA_SCHEMA_VERSION,
  stableStoryDnaJson,
  storyDnaDocumentHash,
  storyDnaEvidenceHash,
  storyDnaEvidenceFields,
  storyDnaInputHash,
  storyDnaRequestItem,
  validateStoryDnaDocument,
  type StoryDnaDocument,
  type StoryDnaEvidence,
  type StoryDnaInput,
  type StoryDnaRequestItem,
} from './story-dna.js';
import {
  VOD_STORY_GRAPH_MODEL_VERSION,
  buildStoryGraphBackground,
  buildStoryDealerCache,
  buildStoryTasteModelWithBackground,
  dealStoryRecommendations,
  effectiveStoryGraphServingFitFloor,
  positiveRatingEvidence,
  scoreStoryGraphCandidate,
  storyHolisticAffinity,
  type StoryDealerCache,
  type StoryGraphContentId,
  type StoryGraphBackground,
  type StoryGraphExplicitRating,
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
  VOD_CONTENT_PROFILE_COMPILER_VERSION,
  VOD_CONTENT_PROFILE_VERSION,
  VOD_STORY_FRONTIER_MODEL_VERSION,
  compileContentProfileV2,
  contentProfileIsServingEligible,
  contentProfileStoryGraphTitle,
  contentSemanticEvidenceHash,
  mergeCompatibleHistoricalStoryDnaEvidence,
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
  acquireRecommendationMaintenanceLease,
  CouchPreemptedRecommendationRefreshError,
  recommendationMemorySnapshot,
  type RecommendationMemorySnapshot,
} from './maintenance.js';
import { updateRecommendationRefreshJobRuntime } from './jobs.js';
import {
  buildStoryFrontierCalibration,
  storyFrontierBandFor,
  type StoryFrontierCalibrationBand,
  type StoryFrontierCalibrationSample,
} from './story-frontier-calibration.js';
import {
  clampUnit,
  DEEP_WEIGHTED_ALGORITHM_VERSION,
  DEEP_WEIGHTED_EXPLORATION_FRACTION,
  relatedEvidenceQualifies,
  relatedScore,
  relatedWeight,
  strongestRelatedFrontier,
  vodBrowseV3Mode,
  weightedDeal,
} from './vod-browse-v3.js';

export type StoryGraphTab = 'movies' | 'series';
export type VodContentProfileMode = 'progressive-v2';

/** The progressive compiler is the sole executable VOD content-profile path. */
export function vodContentProfileMode(): VodContentProfileMode {
  return 'progressive-v2';
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
    persistRecommendationRuntimeState(lowWaterStateKey(request.content_type), request, request.requested_at);
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
  version: 'vod-story-frontier-evaluation-v2';
  rank_generation_id: number;
  status: 'passed' | 'insufficient' | 'failed';
  samples: number;
  folds: number;
  holistic_ndcg_at_6: number | null;
  fire_pairwise_concordance_ge_4: number | null;
  water_pairwise_concordance_ge_4: number | null;
  fire_pairwise_comparisons?: number;
  water_pairwise_comparisons?: number;
  low_low_top_6_intrusion_rate: number | null;
  verified_accounting_complete: boolean;
  coverage: number;
  deterministic: boolean;
  worker_latency_ms: number;
  cached_service_p95_ms: number | null;
  promotion_eligible: boolean;
  reasons: string[];
  evaluated_at: number;
};

export type StoryGraphServingDecision = {
  serve_eligible: boolean;
  basis: 'evaluated' | 'evidence_cold_start' | 'blocked';
  blockers: string[];
};

const COLD_START_EVALUATION_GAPS = new Set([
  'insufficient_stratified_ratings',
  'ndcg_unavailable',
]);

/**
 * Offline label quality and operational serving safety are deliberately
 * separate. A household can have a useful Saved/watch-derived taste model
 * before it has enough explicit ratings for five-fold nDCG. That absence of
 * labels is not a serving failure, but every measurable safety invariant still
 * has to pass. Setting serve mode remains the operator's explicit exposure
 * decision; this function never changes a rollout mode.
 */
export function storyGraphServingDecision(
  evaluation: StoryGraphOfflineEvaluation,
): StoryGraphServingDecision {
  const invariantBlockers: string[] = [];
  if (!evaluation.verified_accounting_complete) {
    invariantBlockers.push('verified_corpus_accounting_incomplete');
  }
  if (!evaluation.deterministic) invariantBlockers.push('determinism_replay_failed');
  if (evaluation.cached_service_p95_ms === null) {
    invariantBlockers.push('cached_service_p95_unmeasured');
  } else if (evaluation.cached_service_p95_ms > 250) {
    invariantBlockers.push('cached_service_p95_above_250ms');
  }
  if (evaluation.promotion_eligible) {
    const blockers = [...new Set([...evaluation.reasons, ...invariantBlockers])];
    return blockers.length === 0
      ? { serve_eligible: true, basis: 'evaluated', blockers: [] }
      : { serve_eligible: false, basis: 'blocked', blockers };
  }
  const uniqueBlockers = [...new Set([
    ...evaluation.reasons.filter((reason) => !COLD_START_EVALUATION_GAPS.has(reason)),
    ...invariantBlockers,
  ])];
  const labelsAreOnlyGap = evaluation.reasons.length > 0
    && evaluation.reasons.every((reason) => COLD_START_EVALUATION_GAPS.has(reason));
  if (labelsAreOnlyGap && uniqueBlockers.length === 0) {
    return { serve_eligible: true, basis: 'evidence_cold_start', blockers: [] };
  }
  return {
    serve_eligible: false,
    basis: 'blocked',
    blockers: uniqueBlockers.length > 0 ? uniqueBlockers : ['evaluation_not_serve_eligible'],
  };
}

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
  rank?: (input: StoryGraphRankInput) => Promise<StoryGraphRankResult>;
  evaluate?: typeof evaluateStoryGraphOffline;
  persistStoryGenerationFault?: (
    point: 'after_header' | 'after_children' | 'before_complete',
    generationId: number,
  ) => void;
};

export type StoryGraphRefreshOptions = {
  now?: number;
  trigger_reasons?: readonly string[];
  bootstrap_minimum?: number;
  cached_service_p95_ms?: number | null;
  dependencies?: StoryGraphRefreshDependencies;
  /** Internal reserve-first phase; public callers use trigger reasons. */
  rank_candidate_ids?: readonly StoryGraphContentId[];
  /** Internal authorization proving a priority rescore replaces promoted v2. */
  priority_base_rank_generation_id?: number;
  /** Complete generation whose serving decision authorizes the priority swap. */
  priority_authorization_rank_generation_id?: number;
  /** Durable refresh jobs receiving additive phase/resource diagnostics. */
  job_ids?: readonly string[];
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
const VISIBLE_LIMIT = 6;
const DYNAMIC_SLATE_HISTORY_DEPTH = 4;

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
const eligibleRankRowsCache = new Map<RatingContentType, {
  db: ReturnType<typeof libraryDatabase>;
  rank_generation_id: number;
  rows: PersistedRankRow[];
}>();
const franchiseKeysCache = new Map<RatingContentType, {
  db: ReturnType<typeof libraryDatabase>;
  story_generation_id: number;
  keys: Map<StoryGraphContentId, string[]>;
}>();
const householdExclusionCache = new Map<RatingContentType, {
  at: number;
  keys: Set<StoryGraphContentId>;
}>();
const HOUSEHOLD_EXCLUSION_TTL_MS = 2_000;
type ForYouServingMemory = {
  rankGenerationId: number;
  epoch: number;
  recent: Array<{ epoch: number; ids: StoryGraphContentId[] }>;
};
const forYouServingMemory = new Map<RatingContentType, ForYouServingMemory>();
type PendingForYouPersist = {
  type: RatingContentType;
  tab: StoryGraphTab;
  rankGenerationId: number;
  expectedEpoch: number;
  nextEpoch: number;
  selectedK: number;
  items: StoryGraphScoredRecommendation[];
  rows: PersistedRankRow[];
  attributionToken: string;
};
const pendingForYouPersist = new Map<RatingContentType, PendingForYouPersist>();

export function storyGraphServingWorkSnapshot(): StoryGraphServingWorkCounters {
  return { ...storyGraphServingWorkCounters };
}

export function resetStoryGraphServingWorkCounters(): void {
  storyGraphServingWorkCounters.full_reserve_queries = 0;
  storyGraphServingWorkCounters.full_reserve_rows_loaded = 0;
  storyGraphServingWorkCounters.dealer_calls = 0;
  storyGraphServingWorkCounters.queue_slates_scanned = 0;
  storyGraphServingWorkCounters.slate_items_revalidated = 0;
  eligibleRankRowsCache.clear();
  franchiseKeysCache.clear();
  householdExclusionCache.clear();
  forYouServingMemory.clear();
  pendingForYouPersist.clear();
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

function persistRecommendationRuntimeState(key: string, value: unknown, now: number): void {
  libraryDatabase().prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`).run(key, JSON.stringify(value), now);
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
  const keyRows = (sql: string) => db.prepare(sql).all(
    type,
    SYNTHETIC_LIBRARY_SOURCE,
  ) as Array<{ type: RatingContentType; id: string }>;
  const savedRows = db.prepare(`
SELECT li.type, li.id, psi.saved_at AS occurred_at
FROM profile_saved_items psi
JOIN library_items li ON li.item_key = psi.item_key
WHERE psi.profile_id = 'household' AND li.type = ? AND li.source != ?
`).all(type, SYNTHETIC_LIBRARY_SOURCE) as Array<{
  type: RatingContentType;
  id: string;
  occurred_at: number;
}>;
  const watchedRows = db.prepare(`
SELECT li.type, li.id, pws.last_watched_at AS occurred_at,
       CASE WHEN pws.finished_at IS NOT NULL OR pws.progress_pct >= 0.9 THEN 'completion' ELSE 'partial' END AS kind
FROM profile_watch_state pws
JOIN library_items li ON li.item_key = pws.item_key
WHERE pws.profile_id = 'household' AND li.type = ? AND li.source != ?
  AND (
    pws.finished_at IS NOT NULL OR pws.progress_pct >= 0.9 OR
    (pws.duration_sec > 0 AND pws.position_sec >= MIN(pws.duration_sec * 0.25, 300)) OR
    (pws.duration_sec <= 0 AND pws.position_sec >= 120)
  )
`).all(type, SYNTHETIC_LIBRARY_SOURCE) as Array<{
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
WHERE li.type = ? AND li.source != ? AND li.hidden = 1
`)),
    blocked: toSet(keyRows(`
SELECT DISTINCT li.type, li.id FROM library_items li
WHERE li.type = ? AND li.source != ? AND li.blocked = 1
`)),
    not_for_me: toSet(keyRows(`
SELECT DISTINCT li.type, li.id
FROM profile_library_feedback pf
JOIN library_items li ON li.item_key = pf.item_key
WHERE pf.profile_id = 'household' AND pf.feedback = 'not_interested' AND li.type = ?
  AND li.source != ?
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

function reusableProgressiveGeneration(input: {
  type: RatingContentType;
  corpusGeneration: number;
  semanticRevision: string;
}): { generation_id: number; reference_revision: string; profiles: Map<StoryGraphContentId, ContentProfileV2> } | null {
  const db = libraryDatabase();
  const generation = db.prepare(`
SELECT generation_id, reference_revision
FROM vod_story_dna_generations
WHERE content_type = ? AND corpus_generation = ? AND semantic_revision = ?
  AND profile_version = ? AND compiler_version = ? AND ontology_version = ?
  AND status = 'complete'
ORDER BY generation_id DESC LIMIT 1
`).get(
    input.type,
    input.corpusGeneration,
    input.semanticRevision,
    VOD_CONTENT_PROFILE_VERSION,
    VOD_CONTENT_PROFILE_COMPILER_VERSION,
    STORY_DNA_ONTOLOGY_VERSION,
  ) as { generation_id: number; reference_revision: string | null } | undefined;
  if (!generation?.reference_revision) return null;
  const rows = db.prepare(`
SELECT content_id, profile_json FROM vod_story_dna_documents
WHERE generation_id = ? AND content_type = ? AND profile_json IS NOT NULL
ORDER BY content_id
`).all(generation.generation_id, input.type) as Array<{
    content_id: string;
    profile_json: string;
  }>;
  const profiles = new Map<StoryGraphContentId, ContentProfileV2>();
  for (const row of rows) {
    try {
      const profile = JSON.parse(row.profile_json) as ContentProfileV2;
      if (profile.profile_version === VOD_CONTENT_PROFILE_VERSION
        && profile.type === input.type && profile.id === row.content_id) {
        profiles.set(contentKey(input.type, row.content_id), profile);
      }
    } catch {
      return null;
    }
  }
  return profiles.size === rows.length && rows.length > 0
    ? { generation_id: generation.generation_id, reference_revision: generation.reference_revision, profiles }
    : null;
}

function compatibleProgressiveStoryDnaOverlays(
  type: RatingContentType,
  inputByKey: Map<StoryGraphContentId, StoryDnaInput>,
): Map<StoryGraphContentId, StoryDnaDocument> {
  const output = new Map<StoryGraphContentId, StoryDnaDocument>();
  // A newer sparse profile must not hide a valid older StoryDNA document and
  // the structured evidence that grounded it. Select the newest document that
  // actually contains an overlay, validate it against its original evidence,
  // then recover only missing/non-conflicting facts into the current input.
  const historicalRows = libraryDatabase().prepare(`
WITH latest AS (
  SELECT content_id, MAX(generation_id) AS generation_id
  FROM vod_story_dna_documents
  WHERE content_type = ? AND status = 'valid' AND story_dna_json IS NOT NULL
  GROUP BY content_id
)
SELECT docs.content_id, docs.title, docs.evidence_json, docs.story_dna_json,
       (SELECT items.year FROM vod_rank_items items
        WHERE items.content_type = docs.content_type AND items.content_id = docs.content_id
        ORDER BY items.rank_generation_id DESC LIMIT 1) AS year
FROM vod_story_dna_documents docs
JOIN latest ON latest.content_id = docs.content_id AND latest.generation_id = docs.generation_id
WHERE docs.content_type = ?
ORDER BY docs.content_id
`).all(type, type) as Array<{
    content_id: string;
    title: string | null;
    year: string | null;
    evidence_json: string;
    story_dna_json: string;
  }>;
  for (const row of historicalRows) {
    const key = contentKey(type, row.content_id);
    const current = inputByKey.get(key);
    if (!current) continue;
    try {
      const raw = JSON.parse(row.story_dna_json) as unknown;
      const document = validateStoryDnaDocument(raw, new Set([key]));
      const historical = storyDnaInputFromPersistedEvidence({
        type, id: row.content_id, title: row.title, year: row.year,
        evidence_json: row.evidence_json, document,
      });
      if (!historical || !validatedDocumentForInput(raw, historical, null)) continue;
      const merged = mergeCompatibleHistoricalStoryDnaEvidence(current, historical);
      if (!merged) continue;
      inputByKey.set(key, merged);
      output.set(key, document);
    } catch {
      // Invalid historical rows remain preserved but detached.
    }
  }

  const exact = loadCompatibleStoryDnaTeacherCache([...inputByKey.values()]);
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
  checkpoint?: (phase: string, cursor: string) => void;
}): number {
  const db = libraryDatabase();
  const reusable = db.prepare(`
SELECT generation_id, status
FROM vod_story_dna_generations
WHERE content_type = ? AND corpus_generation = ? AND evidence_revision = ?
  AND semantic_revision = ? AND profile_version = ? AND compiler_version = ?
  AND ontology_version = ? AND status IN ('complete', 'building')
ORDER BY generation_id DESC LIMIT 1
`).get(
    input.type,
    input.corpusGeneration,
    input.evidenceRevision,
    input.semanticRevision,
    VOD_CONTENT_PROFILE_VERSION,
    VOD_CONTENT_PROFILE_COMPILER_VERSION,
    STORY_DNA_ONTOLOGY_VERSION,
  ) as { generation_id: number; status: 'complete' | 'building' } | undefined;
  if (reusable?.status === 'complete') return reusable.generation_id;
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
  const generation = reusable ?? db.prepare(`
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
  ) as { generation_id: number; status?: string };
  const insertDocument = db.prepare(`
INSERT OR REPLACE INTO vod_story_dna_documents(
  generation_id, content_type, content_id, title, evidence_json, evidence_hash,
  story_dna_json, family_confidence_json, stable_external_ids_json, lookup_used,
  status, failure_reason, retry_count, next_retry_at, created_at, updated_at,
  profile_json, profile_hash, semantic_evidence_hash, base_feature_hash,
  family_coverage_json, teacher_document_hash, teacher_contract_revision, profile_status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
  const insertEdge = db.prepare(`
INSERT OR REPLACE INTO vod_content_profile_edges(
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
  })();
  const orderedProfiles = [...input.profiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const pageSize = boundedInteger(process.env.MANGO_VOD_PROFILE_PAGE_SIZE, 128, 32, 256);
  for (let offset = 0; offset < orderedProfiles.length; offset += pageSize) {
    db.transaction(() => {
      for (const [key, profile] of orderedProfiles.slice(offset, offset + pageSize)) {
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
    })();
    input.checkpoint?.(
      'content_profiles',
      `${Math.min(offset + pageSize, orderedProfiles.length)}/${orderedProfiles.length}`,
    );
  }
  db.transaction(() => {
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

function persistedStoryGraphBackground(input: {
  storyGenerationId: number;
  type: RatingContentType;
  documents: StoryGraphTitle[];
  now: number;
}): StoryGraphBackground {
  const db = libraryDatabase();
  const existing = db.prepare(`
SELECT background_json, background_hash, document_count
FROM vod_story_graph_backgrounds WHERE story_generation_id = ?
`).get(input.storyGenerationId) as {
    background_json: string;
    background_hash: string;
    document_count: number;
  } | undefined;
  if (existing) {
    try {
      const background = JSON.parse(existing.background_json) as StoryGraphBackground;
      if (background.document_count === existing.document_count
        && sha256(background) === existing.background_hash) return background;
    } catch {
      // Rebuild a corrupt derived artifact without touching source profiles.
    }
  }
  const background = buildStoryGraphBackground(input.documents);
  const serialized = stableStoryDnaJson(background);
  db.prepare(`
INSERT INTO vod_story_graph_backgrounds(
  story_generation_id, content_type, profile_version, compiler_version,
  ontology_version, document_count, background_json, background_hash, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(story_generation_id) DO UPDATE SET
  document_count = excluded.document_count,
  background_json = excluded.background_json,
  background_hash = excluded.background_hash,
  created_at = excluded.created_at
`).run(
    input.storyGenerationId,
    input.type,
    VOD_CONTENT_PROFILE_VERSION,
    VOD_CONTENT_PROFILE_COMPILER_VERSION,
    STORY_DNA_ONTOLOGY_VERSION,
    background.document_count,
    serialized,
    sha256(background),
    input.now,
  );
  return background;
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

export function reconcileInterruptedStoryDnaGenerations(now = Date.now()): number {
  void now;
  const row = libraryDatabase().prepare(`
SELECT COUNT(*) AS count FROM vod_story_dna_generations WHERE status = 'building'
`).get() as { count: number };
  return row.count;
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

function dealerCacheFromRows(rows: PersistedRankRow[], selectedK: number): {
  cache: StoryDealerCache;
  fitFloor: number;
} {
  const recommendations = rows.map(persistedRankToRecommendation);
  const absoluteRaw = Number(process.env.MANGO_VOD_STORY_GRAPH_FIT_FLOOR ?? 2.5);
  const absoluteFloor = Number.isFinite(absoluteRaw) ? absoluteRaw : 2.5;
  const minimumReserve = boundedInteger(
    process.env.MANGO_VOD_STORY_GRAPH_BOOTSTRAP_MIN,
    DEFAULT_BOOTSTRAP_MINIMUM,
    VISIBLE_LIMIT,
    10_000,
  );
  const fitFloor = vodBrowseV3Mode() === 'off'
    ? absoluteFloor
    : effectiveStoryGraphServingFitFloor(recommendations, absoluteFloor, minimumReserve);
  return {
    cache: buildStoryDealerCache(
      recommendations,
      Array.from({ length: selectedK }, (_, index) => `thread-index:${index}`),
      vodBrowseV3Mode() === 'off' ? 'rank' : 'relevance',
      absoluteFloor,
      minimumReserve,
    ),
    fitFloor,
  };
}

function selectCachedSlateIds(input: {
  rows: PersistedRankRow[];
  selectedK: number;
  seed: string;
  recentSlates: Array<{ epoch: number; ids: StoryGraphContentId[] }>;
  fixedExcludeIds?: readonly StoryGraphContentId[];
  franchiseKeysById?: ReadonlyMap<StoryGraphContentId, readonly string[]>;
}): StoryGraphScoredRecommendation[] {
  storyGraphServingWorkCounters.dealer_calls += 1;
  const { cache, fitFloor } = dealerCacheFromRows(input.rows, input.selectedK);
  const fixed = [...new Set(input.fixedExcludeIds ?? [])];
  const retained = [...input.recentSlates];
  while (true) {
    const excluded = [...new Set([...fixed, ...retained.flatMap((slate) => slate.ids)])];
    const preferred = dealStoryRecommendations(cache, {
      seed: input.seed,
      exclude_ids: excluded,
      minimum_rank_score: fitFloor,
      group_keys_by_id: input.franchiseKeysById,
      max_per_group: 2,
    });
    if (preferred.length === VISIBLE_LIMIT) return preferred;
    if (retained.length === 0) break;
    // Recent slates are newest-first; relax the oldest one first.
    retained.pop();
  }

  if (vodBrowseV3Mode() !== 'off') return [];
  const relaxed = [...input.recentSlates];
  while (true) {
    const excluded = [...new Set([...fixed, ...relaxed.flatMap((slate) => slate.ids)])];
    const preferred = dealStoryRecommendations(cache, {
      seed: input.seed,
      exclude_ids: excluded,
      group_keys_by_id: input.franchiseKeysById,
      max_per_group: 2,
    });
    if (preferred.length === VISIBLE_LIMIT) return preferred;
    if (relaxed.length === 0) return [];
    relaxed.pop();
  }
}

function currentExactExclusions(type: RatingContentType): Set<StoryGraphContentId> {
  const cached = householdExclusionCache.get(type);
  const now = Date.now();
  if (cached && now - cached.at < HOUSEHOLD_EXCLUSION_TTL_MS) return cached.keys;
  const signals = readHouseholdSignals(type);
  const keys = new Set([
    ...signals.rated, ...signals.saved, ...signals.watched,
    ...signals.hidden, ...signals.blocked, ...signals.not_for_me,
  ]);
  householdExclusionCache.set(type, { at: now, keys });
  return keys;
}

async function currentlyEligibleRankRows(
  rankGenerationId: number,
  type: RatingContentType,
): Promise<PersistedRankRow[]> {
  storyGraphServingWorkCounters.full_reserve_queries += 1;
  const db = libraryDatabase();
  const cached = eligibleRankRowsCache.get(type);
  const rows = cached?.db === db && cached.rank_generation_id === rankGenerationId
    ? cached.rows
    : db.prepare(`
SELECT rank_generation_id, content_type, content_id, title, poster, year, rank,
       best_thread, predicted_fire, predicted_water, explicit_support,
       implicit_support, uncertainty, rank_score
FROM vod_rank_items
WHERE rank_generation_id = ? AND serving_eligible = 1
  AND content_type = ? AND poster IS NOT NULL AND poster != ''
  AND rank IS NOT NULL AND best_thread IS NOT NULL AND rank_score IS NOT NULL
ORDER BY rank ASC
`).all(rankGenerationId, type) as PersistedRankRow[];
  if (cached?.db !== db || cached.rank_generation_id !== rankGenerationId) {
    eligibleRankRowsCache.set(type, { db, rank_generation_id: rankGenerationId, rows });
  }
  storyGraphServingWorkCounters.full_reserve_rows_loaded += rows.length;
  await initPlayabilityDb();
  const verified = listCurrentlyVerifiedTitleKeys(type);
  const excluded = currentExactExclusions(type);
  return rows.filter((row) => {
    const key = contentKey(row.content_type, row.content_id);
    return verified.has(key) && !excluded.has(key);
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
ORDER BY rendered_at DESC, shuffle_epoch DESC LIMIT @limit
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

function franchiseKeysForGeneration(
  storyGenerationId: number,
  type: RatingContentType,
): Map<StoryGraphContentId, string[]> {
  const db = libraryDatabase();
  const cached = franchiseKeysCache.get(type);
  if (cached?.db === db && cached.story_generation_id === storyGenerationId) return cached.keys;
  const rows = db.prepare(`
SELECT content_id, node_key
FROM vod_content_profile_edges
WHERE generation_id = ? AND content_type = ? AND family = 'franchise'
ORDER BY content_id, node_key
`).all(storyGenerationId, type) as Array<{ content_id: string; node_key: string }>;
  const result = new Map<StoryGraphContentId, string[]>();
  for (const row of rows) {
    const identity = contentKey(type, row.content_id);
    const keys = result.get(identity) ?? [];
    keys.push(row.node_key);
    result.set(identity, keys);
  }
  franchiseKeysCache.set(type, { db, story_generation_id: storyGenerationId, keys: result });
  return result;
}

function createInitialDynamicSlate(input: {
  type: RatingContentType;
  storyGenerationId: number;
  rankGenerationId: number;
  rows: PersistedRankRow[];
  selectedK: number;
  threadIds: string[];
  now: number;
}): number | null {
  if (input.selectedK <= 0 || input.rows.length < VISIBLE_LIMIT) return null;
  const threadIndex = new Map(input.threadIds.map((_thread, index) => [
    `thread-index:${index}`, index,
  ]));
  const franchiseKeysById = franchiseKeysForGeneration(input.storyGenerationId, input.type);
  libraryDatabase().prepare(`
DELETE FROM vod_cached_slates WHERE rank_generation_id = ? AND content_type = ?
`).run(input.rankGenerationId, input.type);
  const epoch = 0;
  const items = selectCachedSlateIds({
    rows: input.rows,
    selectedK: input.selectedK,
    seed: `deep-weighted-v1:${input.type}:${input.rankGenerationId}:${epoch}:for-you`,
    recentSlates: [],
    franchiseKeysById,
  });
  if (items.length !== VISIBLE_LIMIT) return null;
  persistCachedSlate({
    type: input.type,
    epoch,
    rankGenerationId: input.rankGenerationId,
    items,
    threadIndex,
    now: input.now,
  });
  return epoch;
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
  pruneStoryGraphGenerationHistory({ maxDeletes: STORY_GRAPH_INLINE_PRUNE_LIMIT });
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

/** Only profiles meeting the thematic serving evidence contract can validate quality. */
export function storyGraphTitleSupportsOfflineEvaluation(title: StoryGraphTitle): boolean {
  return title.profile_state === 'base' || title.profile_state === 'enriched';
}

/**
 * Determinism proof for the fitted taste result, excluding the immutable
 * corpus background passed to both fits. Serializing the complete prior here
 * blocked the catalog event loop for tens of seconds without adding evidence.
 */
export function storyTasteEvaluationFingerprint(model: StoryTasteModel): string {
  return sha256({
    model_version: model.model_version,
    threads: model.threads,
    explicit_evidence_present: model.explicit_evidence_present,
    selected_k: model.selected_k,
    loao: model.loao,
    diagnostics: model.diagnostics,
  });
}

/**
 * Cross-validated strong-vs-lower-preference concordance for one axis.
 *
 * Ratings >=4 are strong preferences. Lower values are weaker preferences,
 * not negative labels; only values below one are negative. Pair only held-out
 * rows from the same fold so scores from separately fitted fold models are
 * never compared as though they shared one calibrated scale.
 */
export function storyGraphHighPreferenceConcordance(rows: Array<{
  actual: number;
  predicted: number;
  fold: number;
}>): {
  value: number | null;
  comparisons: number;
  strong_preferences: number;
  lower_preferences: number;
} {
  let concordant = 0;
  let comparisons = 0;
  const strongPreferences = rows.filter((row) => row.actual >= 4);
  const lowerPreferences = rows.filter((row) => row.actual < 4);
  for (const strong of strongPreferences) {
    for (const lower of lowerPreferences) {
      if (strong.fold !== lower.fold) continue;
      concordant += strong.predicted > lower.predicted
        ? 1
        : strong.predicted === lower.predicted ? 0.5 : 0;
      comparisons += 1;
    }
  }
  return {
    value: comparisons > 0 ? concordant / comparisons : null,
    comparisons,
    strong_preferences: strongPreferences.length,
    lower_preferences: lowerPreferences.length,
  };
}

/** Only sub-one values on both axes are true negative Fire/Water labels. */
export function isStoryGraphTrueNegativeRating(rating: {
  fire: number;
  water: number;
}): boolean {
  return rating.fire < 1 && rating.water < 1;
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

export function evaluateStoryGraphOffline(input: {
  rankGenerationId: number;
  documents: StoryGraphTitle[];
  background: StoryGraphBackground;
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
  void input.inputByKey;
  const ratingKeys = new Set(input.ratings.map((rating) => contentKey(rating.type, rating.id)));
  const documentByKey = new Map(input.documents.flatMap((title) => {
    const key = contentKey(title.type, title.id);
    return ratingKeys.has(key) && storyGraphTitleSupportsOfflineEvaluation(title)
      ? [[key, title] as const]
      : [];
  }));
  const eligibleRatings = input.ratings.filter((rating) => (
    documentByKey.has(contentKey(rating.type, rating.id))
  ));
  const accounting = input.accountedCount === input.verifiedCount;
  const coverage = input.verifiedCount > 0 ? input.reserveDepth / input.verifiedCount : 1;
  if (eligibleRatings.length < 15) {
    const reasons = ['insufficient_stratified_ratings', 'ndcg_unavailable'];
    if (!accounting) reasons.push('verified_corpus_accounting_incomplete');
    if (input.cachedServiceP95Ms === null || input.cachedServiceP95Ms === undefined) {
      reasons.push('cached_service_p95_unmeasured');
    } else if (input.cachedServiceP95Ms > 250) {
      reasons.push('cached_service_p95_above_250ms');
    }
    return {
      version: 'vod-story-frontier-evaluation-v2',
      rank_generation_id: input.rankGenerationId,
      status: 'insufficient',
      samples: eligibleRatings.length,
      folds: 0,
      holistic_ndcg_at_6: null,
      fire_pairwise_concordance_ge_4: null,
      water_pairwise_concordance_ge_4: null,
      fire_pairwise_comparisons: 0,
      water_pairwise_comparisons: 0,
      low_low_top_6_intrusion_rate: null,
      verified_accounting_complete: accounting,
      coverage,
      deterministic: true,
      worker_latency_ms: input.workerLatencyMs,
      cached_service_p95_ms: input.cachedServiceP95Ms ?? null,
      promotion_eligible: false,
      reasons,
      evaluated_at: input.now,
    };
  }
  const foldByKey = stableStoryGraphEvaluationFolds(eligibleRatings);
  const foldNdcg: number[] = [];
  let deterministic = true;
  const predictions: Array<{
    rating: FireWaterRating;
    fire: number;
    water: number;
    score: number;
    fold: number;
  }> = [];
  for (let fold = 0; fold < 5; fold += 1) {
    const training = eligibleRatings.filter((rating) => (
      foldByKey.get(contentKey(rating.type, rating.id)) !== fold
    ));
    const heldOut = eligibleRatings.filter((rating) => (
      foldByKey.get(contentKey(rating.type, rating.id)) === fold
    ));
    if (training.length === 0 || heldOut.length === 0) continue;
    // Evaluation owns only rated profiles. Passing the complete corpus here
    // retained thousands of irrelevant profiles through five model fits even
    // though the immutable background prior was already persisted.
    const modelInput = {
      documents: training.flatMap((rating) => {
        const title = documentByKey.get(contentKey(rating.type, rating.id));
        return title ? [title] : [];
      }),
      background: input.background,
      explicit_ratings: training,
      implicit_signals: [],
      as_of: input.now,
    };
    const model = buildStoryTasteModelWithBackground(modelInput);
    const replay = buildStoryTasteModelWithBackground(modelInput);
    deterministic = deterministic
      && storyTasteEvaluationFingerprint(model) === storyTasteEvaluationFingerprint(replay);
    const rows: Array<{ relevance: number; score: number }> = [];
    for (const rating of heldOut) {
      const title = documentByKey.get(contentKey(rating.type, rating.id));
      if (!title) continue;
      const scored = scoreStoryGraphCandidate(model, title);
      deterministic = deterministic
        && stableStoryDnaJson(scored) === stableStoryDnaJson(scoreStoryGraphCandidate(replay, title));
      const relevance = 0.75 * Math.max(
        positiveRatingEvidence(rating.fire),
        positiveRatingEvidence(rating.water),
      ) + 0.25 * Math.min(
        positiveRatingEvidence(rating.fire),
        positiveRatingEvidence(rating.water),
      );
      rows.push({ relevance, score: scored.rank_score });
      predictions.push({
        rating,
        fire: scored.predicted_fire,
        water: scored.predicted_water,
        score: scored.rank_score,
        fold,
      });
    }
    const ndcg = ndcgAt6(rows);
    if (ndcg !== null) foldNdcg.push(ndcg);
  }
  const ndcg = average(foldNdcg);
  const concordance = (axis: 'fire' | 'water') => storyGraphHighPreferenceConcordance(
    predictions.map((row) => ({
      actual: row.rating[axis],
      predicted: axis === 'fire' ? row.fire : row.water,
      fold: row.fold,
    })),
  );
  const intrusion = average(Array.from({ length: 5 }, (_, fold) => {
    const selected = predictions
      .filter((row) => row.fold === fold)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
    return selected.length === 0
      ? null
      : selected.filter((row) => isStoryGraphTrueNegativeRating(row.rating)).length
        / selected.length;
  }));
  const fireConcordance = concordance('fire');
  const waterConcordance = concordance('water');
  const reasons: string[] = [];
  if (eligibleRatings.length < 15 || foldNdcg.length < 5) reasons.push('insufficient_stratified_ratings');
  if (ndcg === null) reasons.push('ndcg_unavailable');
  if (fireConcordance.value !== null && fireConcordance.value < 0.5) {
    reasons.push('fire_concordance_below_chance');
  }
  if (waterConcordance.value !== null && waterConcordance.value < 0.5) {
    reasons.push('water_concordance_below_chance');
  }
  if (intrusion !== null && intrusion > 1 / 3) reasons.push('low_low_intrusion_above_one_third');
  if (!accounting) reasons.push('verified_corpus_accounting_incomplete');
  if (!deterministic) reasons.push('determinism_replay_failed');
  if (input.cachedServiceP95Ms === null || input.cachedServiceP95Ms === undefined) {
    reasons.push('cached_service_p95_unmeasured');
  } else if (input.cachedServiceP95Ms > 250) {
    reasons.push('cached_service_p95_above_250ms');
  }
  const insufficient = reasons.includes('insufficient_stratified_ratings')
    || reasons.includes('cached_service_p95_unmeasured');
  return {
    version: 'vod-story-frontier-evaluation-v2',
    rank_generation_id: input.rankGenerationId,
    status: reasons.length === 0 ? 'passed' : insufficient ? 'insufficient' : 'failed',
    samples: eligibleRatings.length,
    folds: foldNdcg.length,
    holistic_ndcg_at_6: ndcg,
    fire_pairwise_concordance_ge_4: fireConcordance.value,
    water_pairwise_concordance_ge_4: waterConcordance.value,
    fire_pairwise_comparisons: fireConcordance.comparisons,
    water_pairwise_comparisons: waterConcordance.comparisons,
    low_low_top_6_intrusion_rate: intrusion,
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

function persistOfflineEvaluation(
  type: RatingContentType,
  evaluation: StoryGraphOfflineEvaluation,
): void {
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
    version: 'vod-story-frontier-evaluation-v2',
    rank_generation_id: input.rankGenerationId,
    status: 'insufficient',
    samples: 0,
    folds: 0,
    holistic_ndcg_at_6: null,
    fire_pairwise_concordance_ge_4: null,
    water_pairwise_concordance_ge_4: null,
    fire_pairwise_comparisons: 0,
    water_pairwise_comparisons: 0,
    low_low_top_6_intrusion_rate: null,
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

function activeServeAuthorizedStoryGraphGeneration(type: RatingContentType): {
  active_rank_generation_id: number;
  authorization_rank_generation_id: number;
  authorization_basis: Exclude<StoryGraphServingDecision['basis'], 'blocked'>;
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
  if (!active || active.model_version !== VOD_STORY_FRONTIER_MODEL_VERSION
    || !['bootstrap', 'complete'].includes(active.status)) return null;
  // A complete generation must stand on its own evaluation. Carrying an older
  // generation's authorization onto a newer complete rank would silently
  // bypass a measured regression. Only a bounded priority bootstrap may borrow
  // the exact previous complete authorization while its full-corpus follow-up
  // is still building.
  const candidates = active.status === 'complete'
    ? [active.active_rank_generation_id]
    : [active.previous_complete_rank_generation_id];
  for (const candidate of candidates) {
    const evaluation = candidate == null ? null : storyGraphOfflineEvaluation(type, candidate);
    const decision = evaluation ? storyGraphServingDecision(evaluation) : null;
    if (candidate != null && decision?.serve_eligible) {
      return {
        active_rank_generation_id: active.active_rank_generation_id,
        authorization_rank_generation_id: candidate,
        authorization_basis: decision.basis as Exclude<StoryGraphServingDecision['basis'], 'blocked'>,
      };
    }
  }
  return null;
}

export function storyGraphServeAuthorized(tab: StoryGraphTab): boolean {
  return activeServeAuthorizedStoryGraphGeneration(contentTypeForTab(tab)) !== null;
}

/**
 * Cheap startup freshness gate. A catalog restart must not rescan and rerank a
 * current full corpus merely to rediscover the active generation. Real taste,
 * semantic, playability, or executable-contract changes still enqueue work.
 */
export async function storyGraphRefreshRequired(
  tab: StoryGraphTab,
  now = Date.now(),
  options: {
    preserveActiveDecayBucket?: boolean;
    preserveActiveSemanticRevision?: boolean;
  } = {},
): Promise<boolean> {
  const type = contentTypeForTab(tab);
  const active = libraryDatabase().prepare(`
SELECT ranks.status, ranks.model_version, ranks.feature_version,
       ranks.ontology_version, ranks.corpus_generation, ranks.taste_revision,
       story.semantic_revision, story.compiler_version, story.status AS story_status,
       taste.selected_k, active.shuffle_epoch, ranks.started_at,
       (SELECT COUNT(*) FROM vod_cached_slate_items items
        WHERE items.rank_generation_id = ranks.rank_generation_id
          AND items.content_type = ranks.content_type
          AND items.shuffle_epoch = active.shuffle_epoch) AS slate_items
FROM vod_active_generations active
JOIN vod_rank_generations ranks
  ON ranks.rank_generation_id = active.active_rank_generation_id
JOIN vod_story_dna_generations story
  ON story.generation_id = ranks.story_generation_id
JOIN vod_taste_generations taste
  ON taste.taste_generation_id = ranks.taste_generation_id
WHERE active.content_type = ?
`).get(type) as {
    status: string;
    model_version: string;
    feature_version: string;
    ontology_version: string;
    corpus_generation: number;
    taste_revision: string;
    semantic_revision: string | null;
    compiler_version: string | null;
    story_status: string;
    selected_k: number;
    shuffle_epoch: number;
    started_at: number;
    slate_items: number;
  } | undefined;
  if (!active
    || active.status !== 'complete'
    || active.story_status !== 'complete'
    || active.model_version !== VOD_STORY_FRONTIER_MODEL_VERSION
    || active.feature_version !== VOD_CONTENT_PROFILE_VERSION
    || active.compiler_version !== VOD_CONTENT_PROFILE_COMPILER_VERSION
    || active.ontology_version !== STORY_DNA_ONTOLOGY_VERSION
    || (active.selected_k > 0 && active.slate_items !== VISIBLE_LIMIT)) {
    return true;
  }
  const [corpusGeneration, semanticGeneration] = await Promise.all([
    playabilityRecommendationCorpusGeneration(),
    playabilityRecommendationSemanticGeneration(),
  ]);
  if (active.corpus_generation !== corpusGeneration) return true;
  if (!options.preserveActiveSemanticRevision
    && active.semantic_revision !== String(semanticGeneration)) return true;
  const ratings = listRatings(type, 'household');
  const signals = readHouseholdSignals(type);
  const tasteClock = options.preserveActiveDecayBucket ? active.started_at : now;
  return active.taste_revision !== tasteRevision(type, ratings, signals, tasteClock);
}

/**
 * Startup must recover real signal/corpus drift without launching a full
 * in-process rerank solely because midnight advanced the decay bucket. The
 * ordinary maintenance gate still observes the current day and can schedule
 * that non-urgent decay refresh away from process boot.
 */
export function storyGraphStartupRefreshRequired(tab: StoryGraphTab): Promise<boolean> {
  return storyGraphRefreshRequired(tab, Date.now(), {
    preserveActiveDecayBucket: true,
    // The semantic counter is global while active generations are per domain:
    // publishing Series necessarily makes the Movie number older. Semantic
    // mutations already enqueue their exact domain; this global mismatch is
    // not valid startup evidence for reranking the other domain.
    preserveActiveSemanticRevision: true,
  });
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
  const phaseMetrics: Record<string, RecommendationMemorySnapshot> = {};
  const lease = options.dependencies === undefined
    ? acquireRecommendationMaintenanceLease({
      owner: `vod:${tab}`,
      now,
      ignoreCouch: process.env.MANGO_RECOMMENDATION_IGNORE_COUCH_ACTIVITY === '1',
    })
    : null;
  const checkpoint = (phase: string, cursor: string | null = null): void => {
    const snapshot = lease?.checkpoint(phase, cursor) ?? recommendationMemorySnapshot();
    phaseMetrics[`${phase}:${cursor ?? ''}`] = snapshot;
    const previousPeak = phaseMetrics.peak;
    phaseMetrics.peak = previousPeak ? {
      rss: Math.max(previousPeak.rss, snapshot.rss),
      heap_used: Math.max(previousPeak.heap_used, snapshot.heap_used),
      heap_total: Math.max(previousPeak.heap_total, snapshot.heap_total),
      external: Math.max(previousPeak.external, snapshot.external),
      array_buffers: Math.max(previousPeak.array_buffers, snapshot.array_buffers),
      captured_at: snapshot.captured_at,
    } : snapshot;
    updateRecommendationRefreshJobRuntime(options.job_ids ?? [], {
      phase,
      phase_cursor: cursor,
      heartbeat_at: snapshot.captured_at,
      deadline_at: lease?.deadline_at ?? null,
      checkpoint: { phase, cursor },
      resource_metrics: phaseMetrics,
    });
  };
  const heartbeatTimer = lease ? setInterval(() => {
    try {
      checkpoint('heartbeat');
    } catch (error) {
      updateRecommendationRefreshJobRuntime(options.job_ids ?? [], {
        error_code: error instanceof CouchPreemptedRecommendationRefreshError
          ? error.code
          : 'heartbeat_failed',
      });
    }
  }, 10_000) : null;
  heartbeatTimer?.unref?.();
  checkpoint('scan', '0');
  try {
  reconcileInterruptedStoryDnaGenerations(now);
  const listPage = dependencies.listPage ?? listVerifiedRecommendationCatalogPage;
  const currentCorpusGeneration = dependencies.corpusGeneration ?? playabilityRecommendationCorpusGeneration;
  const currentSemanticGeneration = dependencies.semanticGeneration
    ?? playabilityRecommendationSemanticGeneration;
  const rank = dependencies.rank ?? rankStoryGraphRecommendationsOffThread;
  const scan = await scanVerifiedCorpus(type, listPage);
  checkpoint('scan', `${scan.verifiedCount}/${scan.verifiedCount}`);
  const capturedSemanticGeneration = await currentSemanticGeneration();
  const reusableContent = reusableProgressiveGeneration({
    type,
    corpusGeneration: scan.generation,
    semanticRevision: String(capturedSemanticGeneration),
  });
  const ratings = listRatings(type, 'household');
  const signals = readHouseholdSignals(type);
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
    null,
  );
  const rawInputs = [
    ...rawVerifiedInputs,
    ...priorAnchors.map((anchor) => anchor.input),
  ];
  // Refresh is deliberately local-only. Optional metadata and Companion work
  // populate durable caches asynchronously; ranking only reads those caches.
  const lookedUpInputs = loadStructuredMetadataCache(rawInputs);
  const inputByKey = new Map<StoryGraphContentId, StoryDnaInput>(
    lookedUpInputs.map((input) => [contentKey(input.type, input.id), input]),
  );
  const loaded = new Map<StoryGraphContentId, StoryDnaDocument>();
  for (const anchor of priorAnchors) {
    if (anchor.document) loaded.set(contentKey(anchor.input.type, anchor.input.id), anchor.document);
  }
  const documents = new Map<StoryGraphContentId, StoryDnaDocument>();
  for (const [key, document] of compatibleProgressiveStoryDnaOverlays(type, inputByKey)) {
    documents.set(key, document);
  }
  for (const [key, raw] of loaded) {
    const storyInput = inputByKey.get(key);
    if (!storyInput || documents.has(key)) continue;
    const document = validatedDocumentForInput(raw, storyInput, null);
    if (document) documents.set(key, document);
  }
  const profiles = reusableContent?.profiles ?? new Map<StoryGraphContentId, ContentProfileV2>();
  if (!reusableContent) {
    const priorProfiles = latestProgressiveProfiles(type);
    const entries = [...inputByKey.entries()].sort(([left], [right]) => left.localeCompare(right));
    const compilePageSize = boundedInteger(process.env.MANGO_VOD_PROFILE_PAGE_SIZE, 128, 32, 256);
    for (let offset = 0; offset < entries.length; offset += compilePageSize) {
      for (const [key, storyInput] of entries.slice(offset, offset + compilePageSize)) {
        profiles.set(key, compileContentProfileV2(storyInput, {
          teacher_document: documents.get(key) ?? null,
          prior_profile: priorProfiles.get(key) ?? null,
        }));
      }
      checkpoint('compile_profiles', `${Math.min(offset + compilePageSize, entries.length)}/${entries.length}`);
    }
  }
  const semanticGeneration = reusableContent ? capturedSemanticGeneration
    : await (dependencies.recordSemanticEvidence ?? recordRecommendationSemanticEvidence)(
    scan.rows.flatMap((row) => {
      const profile = profiles.get(contentKey(row.type, row.id));
      return profile ? [{
        type: row.type,
        id: row.id,
        semantic_evidence_hash: profile.semantic_evidence_hash,
      }] : [];
    }),
  );
  const referenceRevision = reusableContent?.reference_revision
    ?? ensureSemanticReferencePanel({ type, profiles, overlays: documents, now });
  const evidenceRevision = sha256({
    profile_version: VOD_CONTENT_PROFILE_VERSION,
    compiler_version: VOD_CONTENT_PROFILE_COMPILER_VERSION,
    semantic_generation: semanticGeneration,
    reference_revision: referenceRevision,
    profiles: [...profiles].map(([key, profile]) => ({ key, hash: profile.profile_hash })),
  });
  const storyGenerationId = reusableContent?.generation_id ?? persistProgressiveProfileGeneration({
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
    checkpoint,
  });
  updateRecommendationRefreshJobRuntime(options.job_ids ?? [], { story_generation_id: storyGenerationId });
  const titles = [...profiles.values()].map(contentProfileStoryGraphTitle);
  const candidateIds = scan.rows.flatMap((row) => {
    const key = contentKey(row.type, row.id);
    return profiles.has(key) ? [key] : [];
  });
  const candidateIdSet = new Set(candidateIds);
  const background = persistedStoryGraphBackground({
    storyGenerationId,
    type,
    documents: titles.filter((title) => candidateIdSet.has(contentKey(title.type, title.id))),
    now,
  });
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
      background,
      candidate_ids: rankCandidateIds,
      explicit_ratings: ratings.map((rating): StoryGraphExplicitRating => ({
        type: rating.type, id: rating.id, fire: rating.fire, water: rating.water,
      })),
      implicit_signals: signals.implicit,
      as_of: now,
      on_page: async (cursor, total) => checkpoint('rank', `${cursor}/${total}`),
    });
  } catch (error) {
    // StoryDNA already published successfully. A rank-worker failure belongs
    // to the rank job and cannot poison immutable content profiles.
    throw error;
  }
  const workerLatency = Date.now() - rankStartedAt;
  const calibration = persistProgressiveCalibration({
    type,
    referenceRevision,
    tasteRevision: capturedTasteRevision,
    inputByKey,
    profiles,
    ranked,
    now,
  });
  const tasteGenerationId = persistTasteGeneration({
    type,
    storyGenerationId,
    tasteRevision: capturedTasteRevision,
    rank: ranked,
    now,
  });
  updateRecommendationRefreshJobRuntime(options.job_ids ?? [], { taste_generation_id: tasteGenerationId });
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
    VOD_STORY_FRONTIER_MODEL_VERSION,
    VOD_CONTENT_PROFILE_VERSION,
    STORY_DNA_ONTOLOGY_VERSION,
    storyGenerationId,
    tasteGenerationId,
    capturedTasteRevision,
    scan.generation,
    JSON.stringify([...new Set(options.trigger_reasons ?? ['refresh'])].sort()),
    scan.verifiedCount,
    now,
  ) as { rank_generation_id: number };
  updateRecommendationRefreshJobRuntime(options.job_ids ?? [], {
    rank_generation_id: rankGeneration.rank_generation_id,
  });
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
  const rankPageSize = boundedInteger(process.env.MANGO_VOD_RANK_PAGE_SIZE, 128, 32, 256);
  for (let offset = 0; offset < scan.rows.length; offset += rankPageSize) {
    db.transaction(() => {
      for (const row of scan.rows.slice(offset, offset + rankPageSize)) {
      const key = contentKey(row.type, row.id);
      if (priorityPhase && !rankCandidateIdSet.has(key)) continue;
      const score = scoreByKey.get(key);
      const profile = profiles.get(key);
      const acquisitionResiduals = score
        ? progressiveAcquisitionResiduals(profile, score, calibration)
        : null;
      const reason = progressiveExclusionReason(row, profile, signals);
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
        profile?.profile_hash ?? row.evidence_hash,
        reason === null && score ? 1 : 0,
        reason,
        now,
        now,
        profile?.profile_state ?? 'unrankable',
        score?.feature_confidence ?? profile?.feature_confidence ?? null,
        score && acquisitionResiduals ? score.rank_score + acquisitionResiduals.lower : null,
        score && acquisitionResiduals ? score.rank_score + acquisitionResiduals.upper : null,
        profile?.profile_hash ?? null,
      );
      }
      db.prepare(`
UPDATE vod_rank_generations SET cursor = ? WHERE rank_generation_id = ? AND status = 'building'
`).run(
        `${Math.min(offset + rankPageSize, scan.rows.length)}/${scan.rows.length}`,
        rankGeneration.rank_generation_id,
      );
    })();
    checkpoint('persist_rank', `${Math.min(offset + rankPageSize, scan.rows.length)}/${scan.rows.length}`);
  }
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
  const freshSemanticGeneration = await currentSemanticGeneration();
  if (freshCorpus !== scan.generation || freshTasteRevision !== capturedTasteRevision
    || freshSemanticGeneration !== semanticGeneration) {
    markGenerationsStale(
      storyGenerationId,
      tasteGenerationId,
      rankGeneration.rank_generation_id,
      freshCorpus !== scan.generation
        ? 'corpus_revision_changed'
        : freshTasteRevision !== capturedTasteRevision
          ? 'taste_revision_changed'
          : 'semantic_revision_changed',
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
    epoch = createInitialDynamicSlate({
      type,
      storyGenerationId,
      rankGenerationId: rankGeneration.rank_generation_id,
      rows: eligibleRows,
      selectedK: ranked.selected_k,
      threadIds: ranked.threads.map((thread) => thread.thread_id),
      now,
    });
  }
  const canPublish = published && epoch !== null;
  const authorizedActive = priorityPhase ? activeServeAuthorizedStoryGraphGeneration(type) : null;
  const priorityReplacementAuthorized = priorityPhase
    && options.priority_base_rank_generation_id !== undefined
    && options.priority_authorization_rank_generation_id !== undefined
    && authorizedActive?.active_rank_generation_id === options.priority_base_rank_generation_id
    && authorizedActive.authorization_rank_generation_id
      === options.priority_authorization_rank_generation_id;
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
      background,
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
  const activationSemanticGeneration = await currentSemanticGeneration();
  if (activationCorpus !== scan.generation
    || tasteRevision(type, activationRatings, activationSignals, now) !== capturedTasteRevision
    || activationSemanticGeneration !== semanticGeneration) {
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
          : 'semantic_revision_changed_before_activation',
    );
  }
  const activationAuthorizedActive = priorityPhase
    ? activeServeAuthorizedStoryGraphGeneration(type)
    : null;
  const priorityActivationAuthorized = priorityReplacementAuthorized
    && activationAuthorizedActive?.active_rank_generation_id === options.priority_base_rank_generation_id
    && activationAuthorizedActive?.authorization_rank_generation_id
      === options.priority_authorization_rank_generation_id;
  const activatesRank = canPublish && (priorityPhase
    ? priorityActivationAuthorized
    : storyGraphServingDecision(evaluation).serve_eligible);
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
  enqueueStoryDnaFrontierCandidates(selectProgressiveFrontierCandidates({
    inputByKey,
    profiles,
    overlays: documents,
    ratings,
    signals,
    ranked,
    calibration,
  }), now);
  checkpoint('complete', String(rankGeneration.rank_generation_id));
  return {
    tab,
    story_generation_id: storyGenerationId,
    taste_generation_id: tasteGenerationId,
    rank_generation_id: rankGeneration.rank_generation_id,
    corpus_generation: scan.generation,
    verified_count: scan.verifiedCount,
    profiled_count: scan.rows.filter((row) => documents.has(contentKey(row.type, row.id))).length,
    retryable_failure_count: scan.rows.filter((row) => (
      profiles.get(contentKey(row.type, row.id))?.profile_state === 'sparse_unresolved'
    )).length,
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
  } catch (error) {
    updateRecommendationRefreshJobRuntime(options.job_ids ?? [], {
      error_code: error instanceof CouchPreemptedRecommendationRefreshError
        ? error.code
        : error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'refresh_failed',
      resource_metrics: phaseMetrics,
    });
    throw error;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    lease?.release();
  }
}

let storyGraphRefreshTail: Promise<void> = Promise.resolve();
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
  const authorizedActive = isTasteMutationRefresh(options.trigger_reasons)
    ? activeServeAuthorizedStoryGraphGeneration(type)
    : null;
  const priorityIds = authorizedActive
    ? activePriorityReserveIds(type, authorizedActive.active_rank_generation_id, priorityLimit)
    : [];
  if (priorityIds.length >= bootstrapMinimum) {
    await refreshStoryGraphForYouUnserialized(tab, {
      ...options,
      trigger_reasons: [...new Set([
        ...(options.trigger_reasons ?? []),
        'priority_rescore',
      ])],
      rank_candidate_ids: priorityIds,
      priority_base_rank_generation_id: authorizedActive!.active_rank_generation_id,
      priority_authorization_rank_generation_id: authorizedActive!.authorization_rank_generation_id,
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

function scheduleStoryDnaFrontierWorker(): void {
  if (storyDnaWorkerMode() !== 'frontier' || storyDnaFrontierTimer) return;
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

/** One heavy worker across Movies and TV bounds peak memory deterministically. */
export function refreshStoryGraphForYou(
  tab: StoryGraphTab,
  options: StoryGraphRefreshOptions = {},
): Promise<StoryGraphRefreshResult> {
  const run = storyGraphRefreshTail
    .catch(() => undefined)
    .then(() => refreshStoryGraphWithPriorityPhase(tab, options));
  storyGraphRefreshTail = run.then(() => undefined, () => undefined);
  if (options.dependencies !== undefined) return run;
  return run.then((result) => {
    scheduleStoryDnaFrontierWorker();
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

async function validateSlateRows(rows: PersistedRankRow[], type: RatingContentType): Promise<boolean> {
  if (rows.length !== VISIBLE_LIMIT || new Set(rows.map((row) => row.content_id)).size !== VISIBLE_LIMIT) {
    return false;
  }
  if (rows.some((row) => !row.poster)) return false;
  storyGraphServingWorkCounters.slate_items_revalidated += rows.length;
  await initPlayabilityDb();
  const verified = listCurrentlyVerifiedTitleKeys(type);
  const exclusions = currentExactExclusions(type);
  return rows.every((row) => {
    const key = contentKey(type, row.content_id);
    return verified.has(key) && !exclusions.has(key);
  });
}

/** Persist one freshly dealt slate and advance its active pointer in one CAS transaction. */
function persistAndAdvanceDynamicSlate(input: {
  type: RatingContentType;
  rankGenerationId: number;
  expectedEpoch: number;
  nextEpoch: number;
  selectedK: number;
  items: StoryGraphScoredRecommendation[];
  now: number;
}): boolean {
  if (input.items.length !== VISIBLE_LIMIT) return false;
  const db = libraryDatabase();
  return db.transaction(() => {
    const active = db.prepare(`
SELECT shuffle_epoch FROM vod_active_generations
WHERE content_type = ? AND active_rank_generation_id = ?
`).get(input.type, input.rankGenerationId) as { shuffle_epoch: number } | undefined;
    if (!active || active.shuffle_epoch !== input.expectedEpoch) return false;
    const threadIndex = new Map(Array.from({ length: input.selectedK }, (_, index) => [
      `thread-index:${index}`, index,
    ]));
    db.prepare(`
INSERT INTO vod_cached_slates(
  rank_generation_id, content_type, shuffle_epoch, created_at, rendered_at
) VALUES (?, ?, ?, ?, ?)
`).run(input.rankGenerationId, input.type, input.nextEpoch, input.now, input.now);
    const insert = db.prepare(`
INSERT INTO vod_cached_slate_items(
  rank_generation_id, content_type, shuffle_epoch, slot, content_id, thread_index
) VALUES (?, ?, ?, ?, ?, ?)
`);
    input.items.forEach((item, slot) => {
      const index = item.best_thread_id ? threadIndex.get(item.best_thread_id) : undefined;
      if (index === undefined) throw new Error('dynamic Story Graph item has no supported taste thread');
      insert.run(input.rankGenerationId, input.type, input.nextEpoch, slot, item.id, index);
    });
    const advanced = db.prepare(`
UPDATE vod_active_generations SET shuffle_epoch = ?, updated_at = ?
WHERE content_type = ? AND active_rank_generation_id = ? AND shuffle_epoch = ?
`).run(
      input.nextEpoch,
      input.now,
      input.type,
      input.rankGenerationId,
      input.expectedEpoch,
    ).changes === 1;
    if (!advanced) throw new Error('dynamic Story Graph pointer CAS lost inside transaction');
    db.prepare(`
DELETE FROM vod_cached_slates
WHERE rank_generation_id = ? AND content_type = ? AND shuffle_epoch NOT IN (
  SELECT shuffle_epoch FROM vod_cached_slates
  WHERE rank_generation_id = ? AND content_type = ?
  ORDER BY rendered_at DESC, shuffle_epoch DESC LIMIT ?
)
`).run(
      input.rankGenerationId,
      input.type,
      input.rankGenerationId,
      input.type,
      DYNAMIC_SLATE_HISTORY_DEPTH + 1,
    );
    return true;
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

export type VodBrowseAffinity = {
  taste_adjacency: number;
  profile_confidence: number | null;
  rank_score: number | null;
  profile_status: string | null;
};

export type VodBrowseAffinitySnapshot = {
  revision: string;
  values: Map<string, VodBrowseAffinity>;
};

/** Compact, read-only household affinity hints for offline Browse-v3 preparation. */
export function loadVodBrowseAffinitySnapshot(tab: StoryGraphTab): VodBrowseAffinitySnapshot {
  const type = contentTypeForTab(tab);
  const active = libraryDatabase().prepare(`
SELECT active_rank_generation_id, active_taste_generation_id
FROM vod_active_generations WHERE content_type = ?
`).get(type) as {
    active_rank_generation_id: number;
    active_taste_generation_id: number;
  } | undefined;
  const rows = libraryDatabase().prepare(`
SELECT ri.content_id, ri.rank, ri.rank_score, ri.feature_confidence, ri.profile_status
FROM vod_active_generations active
JOIN vod_rank_items ri ON ri.rank_generation_id = active.active_rank_generation_id
WHERE active.content_type = ? AND ri.content_type = ?
ORDER BY CASE WHEN ri.rank IS NULL THEN 1 ELSE 0 END, ri.rank ASC, ri.content_id ASC
`).all(type, type) as Array<{
    content_id: string;
    rank: number | null;
    rank_score: number | null;
    feature_confidence: number | null;
    profile_status: string | null;
  }>;
  const rankedCount = rows.filter((row) => row.rank !== null).length;
  return {
    revision: active
      ? `rank:${active.active_rank_generation_id}:taste:${active.active_taste_generation_id}`
      : 'rank:none:taste:none',
    values: new Map(rows.map((row) => {
    const adjacency = row.rank === null || rankedCount <= 1
      ? 0.5
      : clampUnit(1 - (row.rank - 1) / (rankedCount - 1));
    return [contentKey(type, row.content_id), {
      taste_adjacency: adjacency,
      profile_confidence: row.feature_confidence,
      rank_score: row.rank_score,
      profile_status: row.profile_status,
    }];
    })),
  };
}

export function loadVodBrowseAffinity(tab: StoryGraphTab): Map<string, VodBrowseAffinity> {
  return loadVodBrowseAffinitySnapshot(tab).values;
}

export function householdVodDiscoveryExclusions(tab: StoryGraphTab): Set<string> {
  return new Set(currentExactExclusions(contentTypeForTab(tab)));
}

type RelatedEdgeRow = {
  content_id: string;
  family: string;
  node_key: string;
  intensity: number;
  confidence: number;
  node_frequency: number;
  title: string | null;
  poster: string | null;
  year: string | null;
  rank: number | null;
};

export type StoryGraphRelatedItem = {
  id: string;
  type: RatingContentType;
  title: string;
  poster: string;
  year: string | null;
  source: 'vod-related-v1';
};

const RELATED_SEMANTIC_FAMILIES = new Set([
  'genre-subgenre', 'story-engine', 'theme', 'character-dynamic', 'tone',
  'setting-era', 'geographic-scope', 'social-setting', 'narrative-structure',
  'ending-emotional-arc', 'compound',
  'facet.pace', 'facet.action', 'facet.tension', 'facet.spectacle',
  'facet.humor', 'facet.romance', 'facet.fear', 'facet.tenderness',
  'facet.sadness', 'facet.hope', 'facet.realism', 'facet.narrative_complexity',
  'facet.moral_ambiguity', 'facet.violence', 'facet.family_accessibility',
]);

/** StoryDNA/content-profile item-to-item relation. No provider or teacher call occurs here. */
export async function loadStoryGraphRelatedTitles(input: {
  tab: StoryGraphTab;
  content_id: string;
  exclude_keys?: ReadonlySet<string>;
  limit?: number;
}): Promise<StoryGraphRelatedItem[]> {
  const type = contentTypeForTab(input.tab);
  const limit = Math.max(1, Math.min(24, Math.floor(input.limit ?? 8)));
  const db = libraryDatabase();
  const active = db.prepare(`
SELECT COALESCE((
         SELECT generations.generation_id
         FROM vod_story_dna_generations generations
         WHERE generations.content_type = active.content_type
           AND generations.status = 'complete'
           AND generations.profile_version = ?
           AND generations.compiler_version = ?
         ORDER BY generations.generation_id DESC LIMIT 1
       ), active.active_story_generation_id) AS story_generation_id,
       active.active_rank_generation_id AS rank_generation_id,
       ranks.eligible_count
FROM vod_active_generations active
JOIN vod_rank_generations ranks ON ranks.rank_generation_id = active.active_rank_generation_id
WHERE active.content_type = ? AND ranks.status IN ('bootstrap', 'complete')
`).get(VOD_CONTENT_PROFILE_VERSION, VOD_CONTENT_PROFILE_COMPILER_VERSION, type) as {
    story_generation_id: number;
    rank_generation_id: number;
    eligible_count: number;
  } | undefined;
  if (!active) return [];

  const anchorEdges = db.prepare(`
SELECT family, node_key, intensity, confidence
FROM vod_content_profile_edges
WHERE generation_id = ? AND content_type = ? AND content_id = ?
ORDER BY family, node_key
`).all(active.story_generation_id, type, input.content_id) as Array<{
    family: string;
    node_key: string;
    intensity: number;
    confidence: number;
  }>;
  if (anchorEdges.length === 0) return [];
  const anchorProfile = db.prepare(`
SELECT profile_status, teacher_document_hash
FROM vod_story_dna_documents
WHERE generation_id = ? AND content_type = ? AND content_id = ?
`).get(active.story_generation_id, type, input.content_id) as {
    profile_status: string | null;
    teacher_document_hash: string | null;
  } | undefined;
  const anchorEnriched = anchorProfile?.profile_status === 'enriched'
    && Boolean(anchorProfile.teacher_document_hash);
  const nodeKeys = [...new Set(anchorEdges.map((edge) => edge.node_key))];
  const placeholders = nodeKeys.map(() => '?').join(', ');
  const rows = db.prepare(`
WITH node_frequency AS (
  SELECT family, node_key, COUNT(DISTINCT content_id) AS frequency
  FROM vod_content_profile_edges
  WHERE generation_id = ? AND content_type = ? AND node_key IN (${placeholders})
  GROUP BY family, node_key
)
SELECT edges.content_id, edges.family, edges.node_key, edges.intensity, edges.confidence,
       frequency.frequency AS node_frequency,
       ranks.title, ranks.poster, ranks.year, ranks.rank
FROM vod_content_profile_edges edges
JOIN node_frequency frequency
  ON frequency.family = edges.family AND frequency.node_key = edges.node_key
JOIN vod_rank_items ranks
  ON ranks.rank_generation_id = ? AND ranks.content_type = edges.content_type
 AND ranks.content_id = edges.content_id
WHERE edges.generation_id = ? AND edges.content_type = ?
  AND edges.content_id != ? AND edges.node_key IN (${placeholders})
  AND ranks.poster IS NOT NULL AND ranks.poster != ''
ORDER BY edges.content_id, edges.family, edges.node_key
`).all(
    active.story_generation_id,
    type,
    ...nodeKeys,
    active.rank_generation_id,
    active.story_generation_id,
    type,
    input.content_id,
    ...nodeKeys,
  ) as RelatedEdgeRow[];
  if (rows.length === 0) return [];

  const anchorByNode = new Map(anchorEdges.map((edge) => [`${edge.family}\u0000${edge.node_key}`, edge]));
  const anchorFamilyCounts = new Map<string, number>();
  for (const edge of anchorEdges) {
    anchorFamilyCounts.set(edge.family, (anchorFamilyCounts.get(edge.family) ?? 0) + 1);
  }
  const byCandidate = new Map<string, RelatedEdgeRow[]>();
  for (const row of rows) {
    const candidate = byCandidate.get(row.content_id) ?? [];
    candidate.push(row);
    byCandidate.set(row.content_id, candidate);
  }
  const excluded = new Set([
    ...currentExactExclusions(type),
    ...(input.exclude_keys ?? []),
    contentKey(type, input.content_id),
  ]);
  const candidates = [...byCandidate].flatMap(([contentId, edges]) => {
    if (excluded.has(contentKey(type, contentId))) return [];
    const shared = edges.flatMap((edge) => (
      anchorByNode.has(`${edge.family}\u0000${edge.node_key}`)
        ? [{ family: edge.family, nodeKey: edge.node_key }]
        : []
    ));
    if (!relatedEvidenceQualifies({ anchorEnriched, shared })) return [];
    const familyTotals = new Map<string, { total: number; count: number }>();
    for (const edge of edges) {
      const anchor = anchorByNode.get(`${edge.family}\u0000${edge.node_key}`);
      if (!anchor) continue;
      const confidence = Math.min(anchor.confidence, edge.confidence);
      const intensity = 1 - Math.min(4, Math.abs(anchor.intensity - edge.intensity)) / 4;
      const rarity = 1 + Math.min(
        1,
        Math.log((Math.max(1, active.eligible_count) + 1) / (edge.node_frequency + 1)) / 4,
      );
      const current = familyTotals.get(edge.family) ?? { total: 0, count: 0 };
      current.total += confidence * intensity * rarity;
      current.count += 1;
      familyTotals.set(edge.family, current);
    }
    const families = [...familyTotals].map(([family, value]) => ({
      family,
      score: clampUnit(value.total / Math.max(1, anchorFamilyCounts.get(family) ?? value.count)),
      semantic: RELATED_SEMANTIC_FAMILIES.has(family),
    }));
    const householdAffinity = edges[0]?.rank === null || active.eligible_count <= 1
      ? 0.5
      : clampUnit(1 - ((edges[0]!.rank ?? active.eligible_count) - 1) / (active.eligible_count - 1));
    const relation = relatedScore({ families, householdAffinity });
    // The direct-evidence gate rejects parent/facet-only coincidences. Retain
    // the general two-family invariant as defense in depth.
    if (relation.sharedFamilies < 2 || relation.semanticFamilies < 1) return [];
    const first = edges[0]!;
    if (!first.poster) return [];
    return [{
      type,
      id: contentId,
      weight: relatedWeight(relation.score),
      title: first.title ?? contentId,
      poster: first.poster,
      year: first.year,
      relation_score: relation.score,
    }];
  });
  if (candidates.length === 0) return [];
  const playability = await getTitlesPlayabilityBulk(candidates.map((candidate) => ({
    type,
    id: candidate.id,
  })));
  const eligible = candidates.filter((candidate) => (
    playability.get(contentKey(type, candidate.id))?.status === 'verified'
  ));
  // Weighting rotates within a high-confidence semantic frontier. Letting the
  // 16x sampler draw from every merely admissible candidate reintroduced weak
  // tail matches on large corpora even though stronger neighbors existed.
  const frontierLimit = Math.max(limit * 8, 64);
  const frontier = strongestRelatedFrontier(eligible, frontierLimit);
  const day = Math.floor(Date.now() / (24 * 60 * 60 * 1_000));
  const ordered = weightedDeal(
    frontier,
    frontier.length,
    `${type}:${input.content_id}:${active.story_generation_id}:${day}`,
  );

  const identityRows = ordered.length === 0 ? [] : db.prepare(`
SELECT content_id, family, node_key
FROM vod_content_profile_edges
WHERE generation_id = ? AND content_type = ?
  AND content_id IN (${ordered.map(() => '?').join(', ')})
  AND family IN ('franchise', 'creator')
ORDER BY content_id, family, node_key
`).all(active.story_generation_id, type, ...ordered.map((item) => item.id)) as Array<{
    content_id: string;
    family: 'franchise' | 'creator';
    node_key: string;
  }>;
  const identityByCandidate = new Map<string, typeof identityRows>();
  for (const row of identityRows) {
    const list = identityByCandidate.get(row.content_id) ?? [];
    list.push(row);
    identityByCandidate.set(row.content_id, list);
  }
  const franchiseCounts = new Map<string, number>();
  const creatorCounts = new Map<string, number>();
  const selected: typeof ordered = [];
  for (const candidate of ordered) {
    const identities = identityByCandidate.get(candidate.id) ?? [];
    const franchises = identities.filter((row) => row.family === 'franchise').map((row) => row.node_key);
    const creators = identities.filter((row) => row.family === 'creator').map((row) => row.node_key);
    if (franchises.some((key) => (franchiseCounts.get(key) ?? 0) >= 2)) continue;
    if (franchises.length === 0 && creators.some((key) => (creatorCounts.get(key) ?? 0) >= 1)) continue;
    selected.push(candidate);
    franchises.forEach((key) => franchiseCounts.set(key, (franchiseCounts.get(key) ?? 0) + 1));
    creators.forEach((key) => creatorCounts.set(key, (creatorCounts.get(key) ?? 0) + 1));
    if (selected.length >= limit) break;
  }
  return selected.map((candidate) => ({
    id: candidate.id,
    type,
    title: candidate.title,
    poster: candidate.poster,
    year: candidate.year,
    source: 'vod-related-v1',
  }));
}

function rankRowsForSelection(
  eligible: PersistedRankRow[],
  selected: StoryGraphScoredRecommendation[],
): PersistedRankRow[] {
  const byId = new Map(eligible.map((row) => [row.content_id, row]));
  return selected.map((item) => {
    const row = byId.get(item.id);
    if (!row) throw new Error('dealt Story Graph item missing from eligible reserve');
    return row;
  });
}

function rememberForYouServing(
  type: RatingContentType,
  rankGenerationId: number,
  epoch: number,
  ids: StoryGraphContentId[],
): void {
  const previous = forYouServingMemory.get(type);
  const recent = previous?.rankGenerationId === rankGenerationId
    ? previous.recent
    : recentCachedSlates(rankGenerationId, type, DYNAMIC_SLATE_HISTORY_DEPTH, true);
  forYouServingMemory.set(type, {
    rankGenerationId,
    epoch,
    recent: [{ epoch, ids }, ...recent.filter((slate) => slate.epoch !== epoch)]
      .slice(0, DYNAMIC_SLATE_HISTORY_DEPTH),
  });
}

function forYouRecentSlates(
  rankGenerationId: number,
  type: RatingContentType,
): Array<{ epoch: number; ids: StoryGraphContentId[] }> {
  const memory = forYouServingMemory.get(type);
  if (memory?.rankGenerationId === rankGenerationId && memory.recent.length > 0) {
    return memory.recent.slice(0, DYNAMIC_SLATE_HISTORY_DEPTH);
  }
  return recentCachedSlates(rankGenerationId, type, DYNAMIC_SLATE_HISTORY_DEPTH, true);
}

function persistPendingForYou(pending: PendingForYouPersist): void {
  const advanced = persistAndAdvanceDynamicSlate({
    type: pending.type,
    rankGenerationId: pending.rankGenerationId,
    expectedEpoch: pending.expectedEpoch,
    nextEpoch: pending.nextEpoch,
    selectedK: pending.selectedK,
    items: pending.items,
    now: Date.now(),
  });
  if (!advanced) return;
  markCachedSlateRendered(pending.rankGenerationId, pending.type, pending.nextEpoch, Date.now());
  registerRecommendationServedSlate({
    profile_id: 'household',
    domain: 'vod',
    rail_id: pending.tab === 'movies' ? 'for-you-movies' : 'for-you-series',
    source_revision: pending.rankGenerationId,
    attribution_token: pending.attributionToken,
    slate_revision: pending.nextEpoch,
    items: pending.rows.map((row, rank) => ({ type: pending.type, id: row.content_id, rank })),
  });
}

/** Capture a deferred For You persist so a later X cannot overwrite it. */
export function captureDeferredStoryGraphForYou(tab: StoryGraphTab): () => void {
  const pending = pendingForYouPersist.get(contentTypeForTab(tab));
  if (pending) pendingForYouPersist.delete(pending.type);
  return () => {
    if (pending) persistPendingForYou(pending);
  };
}

export async function loadStoryGraphForYouRail(
  tab: StoryGraphTab,
  options: {
    reshuffle?: boolean;
    exclude_keys?: ReadonlySet<string>;
    persist?: boolean;
  } = {},
): Promise<StoryGraphForYouRail | null> {
  const startedAt = Date.now();
  const persist = options.persist !== false;
  const type = contentTypeForTab(tab);
  const db = libraryDatabase();
  const active = db.prepare(`
SELECT active.active_rank_generation_id AS rank_generation_id,
       active.active_story_generation_id AS story_generation_id,
       active.active_taste_generation_id AS taste_generation_id,
       active.shuffle_epoch, taste.selected_k
FROM vod_active_generations active
JOIN vod_rank_generations ranks ON ranks.rank_generation_id = active.active_rank_generation_id
JOIN vod_taste_generations taste ON taste.taste_generation_id = active.active_taste_generation_id
WHERE active.content_type = ? AND ranks.status IN ('bootstrap', 'complete')
`).get(type) as {
    rank_generation_id: number;
    story_generation_id: number;
    taste_generation_id: number;
    shuffle_epoch: number;
    selected_k: number;
  } | undefined;
  if (!active || active.selected_k <= 0) return null;
  const reserveDepth = (db.prepare(`
SELECT eligible_count FROM vod_rank_generations WHERE rank_generation_id = ?
`).get(active.rank_generation_id) as { eligible_count: number } | undefined)?.eligible_count ?? 0;
  const memory = forYouServingMemory.get(type);
  let epoch = memory?.rankGenerationId === active.rank_generation_id
    ? memory.epoch
    : active.shuffle_epoch;
  const externalExclusions = options.exclude_keys ?? new Set<string>();
  const hasExternalExclusion = (candidateRows: PersistedRankRow[]): boolean => candidateRows.some(
    (row) => externalExclusions.has(contentKey(type, row.content_id)),
  );
  let rows: PersistedRankRow[] = [];
  let currentValid = false;
  if (!options.reshuffle) {
    rows = cachedSlateRows(type, epoch, active.rank_generation_id);
    currentValid = !hasExternalExclusion(rows) && await validateSlateRows(rows, type);
  }
  let lowWater = false;
  if (options.reshuffle || !currentValid) {
    const eligibleRows = await currentlyEligibleRankRows(active.rank_generation_id, type);
    const nextEpoch = memory?.rankGenerationId === active.rank_generation_id
      ? memory.epoch + 1
      : Number((db.prepare(`
SELECT COALESCE(MAX(shuffle_epoch), -1) + 1 AS next_epoch
FROM vod_cached_slates WHERE rank_generation_id = ? AND content_type = ?
`).get(active.rank_generation_id, type) as { next_epoch: number }).next_epoch);
    const selected = selectCachedSlateIds({
      rows: eligibleRows,
      selectedK: active.selected_k,
      seed: `deep-weighted-v1:${type}:${active.rank_generation_id}:${nextEpoch}:for-you`,
      recentSlates: forYouRecentSlates(active.rank_generation_id, type),
      fixedExcludeIds: [...externalExclusions] as StoryGraphContentId[],
      franchiseKeysById: franchiseKeysForGeneration(active.story_generation_id, type),
    });
    if (selected.length === VISIBLE_LIMIT) {
      const selectedRows = rankRowsForSelection(eligibleRows, selected);
      if (!hasExternalExclusion(selectedRows)) {
        const attributionToken = randomUUID();
        const pending: PendingForYouPersist = {
          type,
          tab,
          rankGenerationId: active.rank_generation_id,
          expectedEpoch: epoch,
          nextEpoch,
          selectedK: active.selected_k,
          items: selected,
          rows: selectedRows,
          attributionToken,
        };
        if (persist) {
          const advanced = persistAndAdvanceDynamicSlate({
            type,
            rankGenerationId: active.rank_generation_id,
            expectedEpoch: epoch,
            nextEpoch,
            selectedK: active.selected_k,
            items: selected,
            now: Date.now(),
          });
          if (advanced) {
            epoch = nextEpoch;
            rows = selectedRows;
            currentValid = await validateSlateRows(rows, type);
            if (currentValid) {
              rememberForYouServing(
                type,
                active.rank_generation_id,
                epoch,
                rows.map((row) => contentKey(type, row.content_id)),
              );
            }
          } else {
            const current = db.prepare(`
SELECT active_rank_generation_id AS rank_generation_id, shuffle_epoch
FROM vod_active_generations WHERE content_type = ?
`).get(type) as { rank_generation_id: number; shuffle_epoch: number } | undefined;
            if (!current || current.rank_generation_id !== active.rank_generation_id) return null;
            epoch = current.shuffle_epoch;
            rows = cachedSlateRows(type, epoch, active.rank_generation_id);
            currentValid = !hasExternalExclusion(rows) && await validateSlateRows(rows, type);
          }
        } else {
          pendingForYouPersist.set(type, pending);
          rememberForYouServing(
            type,
            active.rank_generation_id,
            nextEpoch,
            selectedRows.map((row) => contentKey(type, row.content_id)),
          );
          epoch = nextEpoch;
          rows = selectedRows;
          currentValid = true;
          return buildStoryGraphForYouRail({
            tab,
            type,
            rankGenerationId: active.rank_generation_id,
            epoch,
            reserveDepth,
            rows,
            served: { slate_revision: nextEpoch, attribution_token: attributionToken },
            resolveMs: Date.now() - startedAt,
            lowWater: false,
          });
        }
      }
    }
    if ((!currentValid) || selected.length !== VISIBLE_LIMIT) {
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
  rememberForYouServing(
    type,
    active.rank_generation_id,
    epoch,
    rows.map((row) => contentKey(type, row.content_id)),
  );
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
  algorithm: typeof DEEP_WEIGHTED_ALGORITHM_VERSION;
  exploration_fraction: number;
  dynamic_dealer_mode: true;
  retained_history_limit: number;
  previous_slate_exclusion: 'four_slates';
  model_version: typeof VOD_STORY_GRAPH_MODEL_VERSION | typeof VOD_STORY_FRONTIER_MODEL_VERSION;
  profile_mode: VodContentProfileMode;
  frontier: ReturnType<typeof storyDnaFrontierDiagnostics>;
  tmdb: ReturnType<typeof tmdbMetadataStatus>;
  schema_version: typeof STORY_DNA_SCHEMA_VERSION;
  ontology_version: typeof STORY_DNA_ONTOLOGY_VERSION;
  teacher_configuration_revision: string;
  mode_ready: boolean;
  public_ready: boolean;
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
    theoretical_probability_floor: number;
    retained_history_depth: number;
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
    low_water: StoryGraphLowWaterRequest | null;
    evaluation: StoryGraphOfflineEvaluation | null;
    serving_pointer: {
      active_ready: boolean;
      active_rank_generation_id: number | null;
      previous_complete_rank_generation_id: number | null;
      active_story_generation_id: number | null;
      active_taste_generation_id: number | null;
      active_model_version: string | null;
      active_status: string | null;
      active_published_at: number | null;
      shuffle_epoch: number | null;
      updated_at: number | null;
      promotion_rank_generation_id: number | null;
      promotion_eligible: boolean;
      serve_eligible: boolean;
      serve_basis: StoryGraphServingDecision['basis'];
      serve_blockers: string[];
      public_rank_generation_id: number | null;
      public_shuffle_epoch: number | null;
    };
  }>;
};

export function storyGraphDiagnostics(): StoryGraphDiagnostics {
  const db = libraryDatabase();
  const mode = vodRecommendationsV2Mode();
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
    const active = db.prepare(`
SELECT active.active_rank_generation_id, active.previous_complete_rank_generation_id,
       active.active_story_generation_id, active.active_taste_generation_id,
       active.shuffle_epoch, active.updated_at,
       ranks.model_version, ranks.status, ranks.published_at
FROM vod_active_generations active
LEFT JOIN vod_rank_generations ranks
  ON ranks.rank_generation_id = active.active_rank_generation_id
WHERE active.content_type = ?
`).get(type) as {
      active_rank_generation_id: number | null;
      previous_complete_rank_generation_id: number | null;
      active_story_generation_id: number | null;
      active_taste_generation_id: number | null;
      shuffle_epoch: number;
      updated_at: number;
      model_version: string | null;
      status: string | null;
      published_at: number | null;
    } | undefined;
    const activeReady = Boolean(
      active?.active_rank_generation_id
      && active.model_version === VOD_STORY_FRONTIER_MODEL_VERSION
      && active.status
      && ['bootstrap', 'complete'].includes(active.status),
    );
    const authorized = activeReady ? activeServeAuthorizedStoryGraphGeneration(type) : null;
    const authorizationEvaluation = authorized
      ? storyGraphOfflineEvaluation(type, authorized.authorization_rank_generation_id)
      : null;
    const servingDecision = authorizationEvaluation
      ? storyGraphServingDecision(authorizationEvaluation)
      : { serve_eligible: false, basis: 'blocked' as const, blockers: ['no_active_authorization'] };
    const publicRankGenerationId = mode === 'serve' && authorized
      ? authorized.active_rank_generation_id
      : null;
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
      theoretical_probability_floor: (row?.eligible_count ?? 0) > 0
        ? DEEP_WEIGHTED_EXPLORATION_FRACTION / row!.eligible_count
        : 0,
      retained_history_depth: active?.active_rank_generation_id
        ? Number((db.prepare(`
SELECT COUNT(*) AS count FROM vod_cached_slates
WHERE rank_generation_id = ? AND content_type = ? AND rendered_at IS NOT NULL
`).get(active.active_rank_generation_id, type) as { count: number }).count)
        : 0,
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
      serving_pointer: {
        active_ready: activeReady,
        active_rank_generation_id: active?.active_rank_generation_id ?? null,
        previous_complete_rank_generation_id: active?.previous_complete_rank_generation_id ?? null,
        active_story_generation_id: active?.active_story_generation_id ?? null,
        active_taste_generation_id: active?.active_taste_generation_id ?? null,
        active_model_version: active?.model_version ?? null,
        active_status: active?.status ?? null,
        active_published_at: active?.published_at ?? null,
        shuffle_epoch: active?.shuffle_epoch ?? null,
        updated_at: active?.updated_at ?? null,
        promotion_rank_generation_id: authorized?.authorization_rank_generation_id ?? null,
        promotion_eligible: authorizationEvaluation?.promotion_eligible === true,
        serve_eligible: servingDecision.serve_eligible,
        serve_basis: servingDecision.basis,
        serve_blockers: servingDecision.blockers,
        public_rank_generation_id: publicRankGenerationId,
        public_shuffle_epoch: publicRankGenerationId === null ? null : active?.shuffle_epoch ?? null,
      },
    };
  });
  return {
    algorithm: DEEP_WEIGHTED_ALGORITHM_VERSION,
    exploration_fraction: DEEP_WEIGHTED_EXPLORATION_FRACTION,
    dynamic_dealer_mode: true,
    retained_history_limit: DYNAMIC_SLATE_HISTORY_DEPTH,
    previous_slate_exclusion: 'four_slates',
    model_version: VOD_STORY_FRONTIER_MODEL_VERSION,
    profile_mode: vodContentProfileMode(),
    frontier: storyDnaFrontierDiagnostics(),
    tmdb: tmdbMetadataStatus(),
    schema_version: STORY_DNA_SCHEMA_VERSION,
    ontology_version: STORY_DNA_ONTOLOGY_VERSION,
    teacher_configuration_revision: storyDnaTeacherConfiguration().revision,
    mode_ready: domains.every((domain) => domain.serving_pointer.active_ready),
    public_ready: domains.every((domain) => domain.serving_pointer.public_rank_generation_id !== null),
    domains,
  };
}
