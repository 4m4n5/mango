import { createHash } from 'node:crypto';
import {
  libraryDbPath,
  listProfileLibraryFeedback,
  listMeaningfullyWatchedLibraryItemIdsPage,
  listSavedLibraryItemIdsPage,
  listWatchHistory,
} from '../library/db.js';
import { loadYoutubeConfig } from './config.js';
import {
  getYoutubeItem,
  getYoutubeState,
  latestYoutubeV2Generation,
  latestYoutubeV2GenerationRecord,
  latestYoutubeV2TakeoutImport,
  listYoutubeV2CandidateProvenance,
  listYoutubeV2ImportedHistory,
  listYoutubeV2ImportedHistoryIdsPage,
  listYoutubeV2Subscriptions,
  publishYoutubeV2Generation,
  setYoutubeState,
  YOUTUBE_V2_SERVING_POLICY_VERSION,
  youtubeDbPath,
  youtubeV2CandidateProvenanceSummary,
  type YoutubeV2CandidateProvenance,
  type YoutubeV2Generation,
  type YoutubeV2GenerationItemInput,
  type YoutubeV2Provenance,
  type YoutubeV2ScoreBreakdown,
  type YoutubeV2ServeProvenance,
} from './db.js';
import { YOUTUBE_RAIL_LIMIT, YOUTUBE_V2_DISPLAY_ORDER } from './constants.js';
import {
  embeddingRelationFactor,
  maxTasteSimilarity,
  tasteEmbeddingsFromAnchors,
  youtubeEmbeddingDiagnostics,
  youtubeEmbeddingsEnabled,
  youtubeSimilarityMode,
} from './embeddings.js';
import {
  channelAffinityFactor,
  channelAffinityMap,
  channelPenaltyFactor,
  householdChannelPenaltyEvents,
  householdWatchAnchors as loadHouseholdWatchAnchors,
  rewatchScore,
  TAKEOUT_STRENGTH,
  topAffinityChannels,
  WATCH_HALF_LIFE_DAYS,
  WATCH_PER_VIDEO_STRENGTH_CAP,
  youtubeCreatorKey,
  youtubeScoringVariant,
  type YoutubeChannelPenaltyEvent,
  type YoutubeScoringVariant,
  type YoutubeWatchAnchor,
} from './taste.js';
import type {
  YoutubeItem,
  YoutubeRail,
  YoutubeRailItem,
  YoutubeRefreshStatus,
} from './types.js';

export const YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION = 'youtube-household-v3.0';
export const YOUTUBE_V2_CANDIDATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const YOUTUBE_V2_WATCH_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const YOUTUBE_V2_LIVE_TTL_MS = 15 * 60 * 1000;
export const YOUTUBE_V2_MORE_LIKE_MIN_SEEDS = 8;
export const YOUTUBE_V2_MORE_LIKE_MAX_SEEDS = 10;
export const YOUTUBE_V2_MORE_LIKE_QUERY_SIZE = 50;
export const YOUTUBE_V2_RESERVE_LIMIT = 512;
export const YOUTUBE_V2_MORE_LIKE_TARGET = YOUTUBE_V2_RESERVE_LIMIT;
export const YOUTUBE_V2_DISCOVERY_MAX_SEEDS = 32;
export const YOUTUBE_V2_C_TIER_LIMIT = 64;
const V2_PROVENANCE_LIMIT = 50_000;
const V2_WATCH_LIMIT = 5_000;
const V2_EXCLUSION_PAGE_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const V2_RESERVE_RAIL_IDS = [
  'for_you', 'beyond', 'more_like', 'new_from_subscriptions', 'frequently_watched', 'live_now',
] as const;

export type YoutubeRecommendationsV2Mode = 'off' | 'shadow' | 'serve';

export function youtubeRecommendationsV2Mode(
  raw = process.env.MANGO_YOUTUBE_RECS_V2,
): YoutubeRecommendationsV2Mode {
  const normalized = raw?.trim().toLowerCase();
  return normalized === 'shadow' || normalized === 'serve' ? normalized : 'off';
}

/**
 * The service result and served-slate tokens retain their recommendation owner
 * (Household in v2 serve). The public HTTP envelope instead echoes the active
 * personalization owner and revision that fenced the request. Keeping these
 * authorities separate lets YouTube serve Household recommendations without
 * taking over VOD profile/mood UI.
 */
export function youtubePublicPersonalizationPayload<T extends {
  profile_id: string;
  personalization_updated_at: number;
}>(
  payload: T,
  personalization: { active_profile_id: string; updated_at: number },
): T {
  return {
    ...payload,
    profile_id: personalization.active_profile_id,
    personalization_updated_at: personalization.updated_at,
  };
}

export type YoutubeV2SourceStaleState = {
  stale: boolean;
  reason: string | null;
  at: number | null;
  [key: string]: unknown;
};

export function youtubeV2SourceStaleState(): YoutubeV2SourceStaleState {
  const raw = getYoutubeState<Record<string, unknown> | null>('youtube_v2_source_stale', null);
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawReason = typeof row.reason === 'string' ? row.reason : null;
  return {
    ...row,
    stale: row.stale === true,
    reason: rawReason && YOUTUBE_SOURCE_STALE_REASONS.has(rawReason) ? rawReason : null,
    at: typeof row.at === 'number' && Number.isFinite(row.at) && row.at >= 0
      ? Math.floor(row.at)
      : null,
  };
}

type WatchAnchor = YoutubeWatchAnchor;

type YoutubeV2ScoringContext = {
  variant: YoutubeScoringVariant;
  affinity: Map<string, number>;
  penaltyEvents: YoutubeChannelPenaltyEvent[];
  tasteEmbeddings: Float32Array[];
  simMode: 'lexical' | 'embedding' | 'blend';
};

export type YoutubeV2TopicSeed = {
  kind: 'history' | 'subscription';
  item: YoutubeItem;
  provenance_ref: string;
  source_generation: string;
};

type RankedCandidate = {
  item: YoutubeItem;
  rows: YoutubeV2CandidateProvenance[];
  history_affinity: number;
  subscription_affinity: number;
  score: number;
  score_breakdown: YoutubeV2ScoreBreakdown;
};

export type YoutubeV2QualityTier = 'A' | 'B' | 'C' | 'rejected';

type YoutubeDiagnosticErrorCategory =
  | 'auth'
  | 'deadline'
  | 'network'
  | 'not_found'
  | 'partial'
  | 'provider'
  | 'publication'
  | 'quota'
  | 'validation'
  | 'unknown';

const YOUTUBE_REFRESH_PHASES = new Set([
  'subscriptions',
  'v2_subscription_acquisition',
  'v2_history_metadata',
  'v2_history_acquisition',
  'v2_live_acquisition',
  'v2_publish',
  'v2_embeddings',
]);
const YOUTUBE_SOURCE_STALE_REASONS = new Set([
  'not_connected',
  'oauth_disconnected',
  'oauth_subscription_refresh_failed',
  'oauth_unavailable',
  'subscription_acquisition_partial',
  'subscription_snapshot_pending_publish',
  'discovery_acquisition_failed',
  'live_acquisition_failed',
  'publication_failed',
]);

function diagnosticRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function diagnosticCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function diagnosticTimestamp(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
}

function diagnosticBoolean(value: unknown): boolean {
  return value === true;
}

function diagnosticEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback = 'unknown',
): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function diagnosticOpaqueRef(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function diagnosticOpaqueRefs(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.flatMap((value) => {
    const ref = diagnosticOpaqueRef(value);
    return ref ? [ref] : [];
  }))].sort();
}

/**
 * Reduce arbitrary provider/operator errors to a fixed vocabulary before they
 * cross the localhost diagnostics boundary. Provider messages can echo query,
 * URL, credential, channel, or filename material and must remain DB-local.
 */
export function youtubeDiagnosticErrorCategory(value: unknown): YoutubeDiagnosticErrorCategory | null {
  const record = diagnosticRecord(value);
  const raw = typeof value === 'string'
    ? value
    : typeof record.error === 'string'
      ? record.error
      : '';
  const normalized = raw.toLowerCase();
  if (!normalized) return null;
  if (/oauth|auth(?:orization|entication)?|credential|token|forbidden|unauthori[sz]ed|\b401\b|\b403\b/.test(normalized)) {
    return 'auth';
  }
  if (/quota|rate.?limit|\b429\b/.test(normalized)) return 'quota';
  if (/deadline|timed? ?out|timeout|abort/.test(normalized)) return 'deadline';
  if (/not.?found|\b404\b|deleted|terminated/.test(normalized)) return 'not_found';
  if (/partial|incomplete/.test(normalized)) return 'partial';
  if (/publish|generation/.test(normalized)) return 'publication';
  if (/invalid|requires?|missing|malformed|unsupported/.test(normalized)) return 'validation';
  if (/network|fetch|socket|econn|dns|transport/.test(normalized)) return 'network';
  if (/youtube|provider|\bapi\b|\bhttp\b|upstream/.test(normalized)) return 'provider';
  return 'unknown';
}

function youtubeDiagnosticRefreshReason(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const reason = value.toLowerCase();
  if (/nightly|scheduled|maintenance/.test(reason)) return 'nightly';
  if (/oauth|auth|connected/.test(reason)) return 'oauth';
  if (/takeout|import/.test(reason)) return 'takeout';
  if (/subscription/.test(reason)) return 'subscription';
  if (/history|watch|local|signal/.test(reason)) return 'local_signal';
  if (/manual|operator|trigger|refresh/.test(reason)) return 'triggered';
  return 'other';
}

function youtubeDiagnosticPhaseResults(value: unknown): Array<{
  phase: string;
  ok: boolean;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number;
  error_category?: YoutubeDiagnosticErrorCategory;
}> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((entry) => {
    const row = diagnosticRecord(entry);
    const errorCategory = youtubeDiagnosticErrorCategory(row.error);
    return {
      phase: diagnosticEnum(row.phase, YOUTUBE_REFRESH_PHASES),
      ok: row.ok === true,
      started_at: diagnosticTimestamp(row.started_at),
      ended_at: diagnosticTimestamp(row.ended_at),
      duration_ms: diagnosticCount(row.duration_ms),
      ...(errorCategory ? { error_category: errorCategory } : {}),
    };
  });
}

/** Privacy-safe, shape-stable operational projection for `/youtube/state`. */
export function youtubeRefreshDiagnostics(refresh: YoutubeRefreshStatus): Record<string, unknown> {
  return {
    last_refresh_at: diagnosticTimestamp(refresh.last_refresh_at),
    last_success_at: diagnosticTimestamp(refresh.last_success_at),
    last_error: youtubeDiagnosticErrorCategory(refresh.last_error),
    last_reason: youtubeDiagnosticRefreshReason(refresh.last_reason),
    phase_results: youtubeDiagnosticPhaseResults(refresh.phase_results),
    quota_used_today: diagnosticCount(refresh.quota_used_today),
    search_calls_today: diagnosticCount(refresh.search_calls_today),
    api_calls_today: diagnosticCount(refresh.api_calls_today),
    quota_reset_day: /^\d{4}-\d{2}-\d{2}$/.test(refresh.quota_reset_day)
      ? refresh.quota_reset_day
      : 'unknown',
    quota_budget: diagnosticCount(refresh.quota_budget),
    interactive_reserve: diagnosticCount(refresh.interactive_reserve),
    search_call_budget: diagnosticCount(refresh.search_call_budget),
    interactive_search_call_reserve: diagnosticCount(refresh.interactive_search_call_reserve),
    background_remaining: diagnosticCount(refresh.background_remaining),
    interactive_remaining: diagnosticCount(refresh.interactive_remaining),
    background_search_calls_remaining: diagnosticCount(refresh.background_search_calls_remaining),
    interactive_search_calls_remaining: diagnosticCount(refresh.interactive_search_calls_remaining),
  };
}

export function youtubeV2QualityTier(quality: number): YoutubeV2QualityTier {
  if (quality >= 0.65) return 'A';
  if (quality >= 0.38) return 'B';
  if (quality >= 0.20) return 'C';
  return 'rejected';
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

function creatorKey(item: YoutubeItem): string {
  return item.channel_id?.trim() || normalizedText(item.channel_title) || `video:${item.id}`;
}

function isShort(item: YoutubeItem): boolean {
  // The API cache does not carry aspect ratio. YouTube's current Shorts rule
  // includes square/vertical uploads up to three minutes, so fail closed on
  // duration to guarantee Shorts never reach a couch recommendation rail.
  return (item.duration_sec !== null && item.duration_sec <= 180)
    || /(^|\s)#shorts?\b/i.test(`${item.title} ${item.description ?? ''}`);
}

function isLive(item: YoutubeItem): boolean {
  return item.live_status === 'live';
}

function isLiveLike(item: YoutubeItem): boolean {
  return item.live_status === 'live' || item.live_status === 'upcoming';
}

function householdWatchAnchors(
  at = Date.now(),
  options: { watchUntil?: number; includeLocal?: boolean } = {},
): WatchAnchor[] {
  return loadHouseholdWatchAnchors({
    at,
    watchUntil: options.watchUntil,
    includeLocal: options.includeLocal,
  });
}

function scoringContextFor(
  watches: readonly WatchAnchor[],
  at: number,
  variant: YoutubeScoringVariant,
): YoutubeV2ScoringContext {
  const embeddingsOn = variant === 'v3-embed'
    || (variant !== 'legacy' && youtubeEmbeddingsEnabled() && youtubeSimilarityMode() !== 'lexical');
  return {
    variant,
    affinity: channelAffinityMap(watches),
    penaltyEvents: variant === 'legacy' ? [] : householdChannelPenaltyEvents(at),
    tasteEmbeddings: embeddingsOn ? tasteEmbeddingsFromAnchors(watches) : [],
    simMode: variant === 'v3-embed'
      ? (youtubeSimilarityMode() === 'lexical' ? 'blend' : youtubeSimilarityMode())
      : youtubeSimilarityMode(),
  };
}

function recentHouseholdHistoryIds(at = Date.now()): Set<string> {
  const ids = new Set<string>();
  const watchedSince = Math.max(0, at - YOUTUBE_V2_WATCH_COOLDOWN_MS);
  let afterItemKey = '';
  while (true) {
    const page = listMeaningfullyWatchedLibraryItemIdsPage({
      type: 'youtube_video',
      profile_id: 'household',
      household_blend: false,
      watched_since: watchedSince,
      after_item_key: afterItemKey,
      limit: V2_EXCLUSION_PAGE_SIZE,
    });
    page.forEach((row) => ids.add(row.id));
    if (page.length < V2_EXCLUSION_PAGE_SIZE) break;
    const next = page.at(-1)!.item_key;
    if (next <= afterItemKey) break;
    afterItemKey = next;
  }
  let afterVideoId = '';
  while (true) {
    const page = listYoutubeV2ImportedHistoryIdsPage({
      after_video_id: afterVideoId,
      watched_since: watchedSince,
      limit: V2_EXCLUSION_PAGE_SIZE,
    });
    page.forEach((id) => ids.add(id));
    if (page.length < V2_EXCLUSION_PAGE_SIZE) break;
    const next = page.at(-1)!;
    if (next <= afterVideoId) break;
    afterVideoId = next;
  }
  return ids;
}

function householdSavedIds(): Set<string> {
  const ids = new Set<string>();
  let afterItemKey = '';
  while (true) {
    const page = listSavedLibraryItemIdsPage({
      type: 'youtube_video',
      profile_id: 'household',
      household_blend: false,
      after_item_key: afterItemKey,
      limit: V2_EXCLUSION_PAGE_SIZE,
    });
    page.forEach((row) => ids.add(row.id));
    if (page.length < V2_EXCLUSION_PAGE_SIZE) break;
    const next = page.at(-1)!.item_key;
    if (next <= afterItemKey) break;
    afterItemKey = next;
  }
  return ids;
}

function householdBlockedIds(): Set<string> {
  return new Set(listProfileLibraryFeedback('not_interested', undefined, {
    profile_id: 'household',
    household_blend: false,
  })
    .filter((row) => row.type === 'youtube_video')
    .map((row) => row.id));
}

type YoutubeV2ExactExclusionSnapshot = {
  db_path: string;
  watch_cooldown_cutoff_at: number;
  watched: ReadonlySet<string>;
  saved: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
  all: ReadonlySet<string>;
  built_at: number;
};

let exactExclusionSnapshot: YoutubeV2ExactExclusionSnapshot | null = null;
let exactExclusionBuildCount = 0;
let exactExclusionInvalidationCount = 0;

type YoutubeV2HistorySnapshot = {
  library_db_path: string;
  youtube_db_path: string;
  items: ReadonlyArray<YoutubeRailItem>;
  built_at: number;
};

let historySnapshot: YoutubeV2HistorySnapshot | null = null;
let historySnapshotBuildCount = 0;

function loadYoutubeV2ExactExclusions(
  force = false,
  at = Date.now(),
): YoutubeV2ExactExclusionSnapshot {
  const dbPath = libraryDbPath();
  if (!force && exactExclusionSnapshot?.db_path === dbPath) return exactExclusionSnapshot;
  const watchCooldownCutoffAt = Math.max(0, at - YOUTUBE_V2_WATCH_COOLDOWN_MS);
  const watched = recentHouseholdHistoryIds(at);
  const saved = householdSavedIds();
  const blocked = householdBlockedIds();
  exactExclusionSnapshot = {
    db_path: dbPath,
    watch_cooldown_cutoff_at: watchCooldownCutoffAt,
    watched,
    saved,
    blocked,
    all: new Set([...watched, ...saved, ...blocked]),
    built_at: Date.now(),
  };
  exactExclusionBuildCount += 1;
  return exactExclusionSnapshot;
}

/**
 * Exact exclusions can span thousands of durable Takeout rows. Home and X read
 * this revision-fenced snapshot instead of paging the multi-gigabyte library
 * database on every cached slate advance. Every relevant source mutation must
 * invalidate before the next couch read; generation rebuilds force a refresh.
 */
export function invalidateYoutubeV2ExactExclusions(): void {
  exactExclusionSnapshot = null;
  exactExclusionInvalidationCount += 1;
}

export function primeYoutubeV2ExactExclusions(): void {
  loadYoutubeV2ExactExclusions();
}

export function youtubeV2ExactExclusionCacheDiagnostics(): Record<string, unknown> {
  const snapshot = exactExclusionSnapshot;
  return {
    ready: snapshot !== null && snapshot.db_path === libraryDbPath(),
    watched_count: snapshot?.watched.size ?? 0,
    watch_cooldown_days: YOUTUBE_V2_WATCH_COOLDOWN_MS / DAY_MS,
    watch_cooldown_cutoff_at: snapshot?.watch_cooldown_cutoff_at ?? null,
    saved_count: snapshot?.saved.size ?? 0,
    blocked_count: snapshot?.blocked.size ?? 0,
    total_count: snapshot?.all.size ?? 0,
    built_at: snapshot?.built_at ?? null,
    build_count: exactExclusionBuildCount,
    invalidation_count: exactExclusionInvalidationCount,
    history_ready: historySnapshot !== null
      && historySnapshot.library_db_path === libraryDbPath()
      && historySnapshot.youtube_db_path === youtubeDbPath(),
    history_count: historySnapshot?.items.length ?? 0,
    history_built_at: historySnapshot?.built_at ?? null,
    history_build_count: historySnapshotBuildCount,
  };
}

export function youtubeV2ExactExcludedIds(): Set<string> {
  return new Set(loadYoutubeV2ExactExclusions().all);
}

function authoritativeSubscriptions(): ReturnType<typeof listYoutubeV2Subscriptions> {
  return listYoutubeV2Subscriptions().filter((row) => row.source === 'oauth');
}

function cachedOrStub(anchor: WatchAnchor): YoutubeItem {
  return getYoutubeItem('video', anchor.id) ?? {
    id: anchor.id,
    kind: 'video',
    title: anchor.title,
    subtitle: anchor.channel_title || 'YouTube',
    description: null,
    thumbnail: null,
    channel_id: anchor.channel_id,
    channel_title: anchor.channel_title,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: anchor.watched_at,
  };
}

function pacificDay(at: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(at));
}

type PersistedTopicSeed = {
  day: string;
  kind: YoutubeV2TopicSeed['kind'];
  provenance_ref: string;
  item_id: string;
  source_generation: string;
  selected_at: number;
};

type PersistedMoreLikeSeedSet = {
  day: string;
  seeds: PersistedTopicSeed[];
  selected_at: number;
};

export function weightedDailyHistorySeedId(
  candidates: ReadonlyArray<{ id: string; weight: number }>,
  day: string,
): string | null {
  const eligible = candidates
    .filter((candidate) => candidate.id.trim() && Number.isFinite(candidate.weight) && candidate.weight > 0)
    .map((candidate) => ({ id: candidate.id, weight: candidate.weight }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (eligible.length === 0) return null;
  const total = eligible.reduce((sum, candidate) => sum + candidate.weight, 0);
  let needle = (stableHash(`youtube-v2:history-weighted:${day}:${eligible.map((row) => row.id).join(',')}`)
    / 0x1_0000_0000) * total;
  for (const candidate of eligible) {
    needle -= candidate.weight;
    if (needle <= 0) return candidate.id;
  }
  return eligible.at(-1)!.id;
}

function historyTopicSeed(watches: WatchAnchor[], at: number): YoutubeV2TopicSeed | null {
  const recent = watches.slice(0, 20);
  if (recent.length === 0) return null;
  const day = pacificDay(at);
  const persisted = getYoutubeState<PersistedTopicSeed | null>('youtube_v2_daily_topic_seed', null);
  const retained = persisted?.day === day && persisted.kind === 'history'
    ? recent.find((watch) => watch.id === persisted.item_id)
    : null;
  const selectedId = retained?.id ?? weightedDailyHistorySeedId(
    recent.map((watch) => ({ id: watch.id, weight: watch.decayed_strength })),
    day,
  );
  const selected = retained ?? recent.find((watch) => watch.id === selectedId) ?? recent[0]!;
  const sourceGeneration = createHash('sha256')
    .update(`history:${selected.id}:${selected.watched_at}:${selected.source}`)
    .digest('hex');
  if (!retained || persisted?.source_generation !== sourceGeneration) {
    setYoutubeState('youtube_v2_daily_topic_seed', {
      day,
      kind: 'history',
      provenance_ref: selected.id,
      item_id: selected.id,
      source_generation: sourceGeneration,
      selected_at: at,
    } satisfies PersistedTopicSeed);
  }
  return {
    kind: 'history',
    item: cachedOrStub(selected),
    provenance_ref: selected.id,
    source_generation: sourceGeneration,
  };
}

function subscriptionTopicSeed(
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  provenance: YoutubeV2CandidateProvenance[],
  at: number,
): YoutubeV2TopicSeed | null {
  if (subscriptions.length === 0) return null;
  const ordered = [...subscriptions].sort((left, right) => left.channel_key.localeCompare(right.channel_key));
  const day = pacificDay(at);
  const persisted = getYoutubeState<PersistedTopicSeed | null>('youtube_v2_daily_topic_seed', null);
  const retained = persisted?.day === day && persisted.kind === 'subscription'
    ? ordered.find((subscription) => `subscription:${subscription.channel_key}` === persisted.provenance_ref)
    : null;
  const selected = retained ?? ordered[
    stableHash(`youtube-v2:subscription:${day}:${ordered.map((row) => row.channel_key).join(',')}`) % ordered.length
  ]!;
  const provenanceRef = `subscription:${selected.channel_key}`;
  const uploads = provenance
    .filter((row) => row.provenance === 'subscription_upload')
    .filter((row) => row.provenance_ref === selected.channel_key || row.provenance_ref === selected.channel_id)
    .sort((left, right) => right.acquired_at - left.acquired_at || left.item.id.localeCompare(right.item.id));
  const retainedUpload = persisted?.day === day
    && persisted.kind === 'subscription'
    && persisted.provenance_ref === provenanceRef
    ? uploads.find((row) => row.item.id === persisted.item_id)
    : null;
  const upload = retainedUpload ?? uploads[0] ?? null;
  const item: YoutubeItem = upload?.item ?? {
    id: provenanceRef,
    kind: 'video',
    title: selected.channel_title,
    subtitle: selected.channel_title,
    description: null,
    thumbnail: null,
    channel_id: selected.channel_id,
    channel_title: selected.channel_title,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: selected.imported_at,
  };
  const sourceGeneration = createHash('sha256')
    .update(`subscription:${selected.source_generation}:${selected.channel_key}:${item.id}`)
    .digest('hex');
  if (!retained || persisted?.item_id !== item.id || persisted?.source_generation !== sourceGeneration) {
    setYoutubeState('youtube_v2_daily_topic_seed', {
      day,
      kind: 'subscription',
      provenance_ref: provenanceRef,
      item_id: item.id,
      source_generation: sourceGeneration,
      selected_at: at,
    } satisfies PersistedTopicSeed);
  }
  return {
    kind: 'subscription',
    item,
    provenance_ref: provenanceRef,
    source_generation: sourceGeneration,
  };
}

function topicSeedFromSources(
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  provenance: YoutubeV2CandidateProvenance[],
  at: number,
): YoutubeV2TopicSeed | null {
  return historyTopicSeed(watches, at) ?? subscriptionTopicSeed(subscriptions, provenance, at);
}

export function youtubeV2TopicSeed(at = Date.now()): YoutubeV2TopicSeed | null {
  return topicSeedFromSources(
    householdWatchAnchors(at),
    authoritativeSubscriptions(),
    listYoutubeV2CandidateProvenance({ at, limit: V2_PROVENANCE_LIMIT }),
    at,
  );
}

/** Daily-stable weighted sampling without replacement for acquisition trials. */
export function youtubeV2MoreLikeSeeds(limit = 20, at = Date.now()): YoutubeV2TopicSeed[] {
  const max = Math.max(1, Math.min(20, Math.floor(limit)));
  const day = pacificDay(at);
  const watches = householdWatchAnchors(at).slice(0, 20);
  const ranked = watches
    .map((watch) => {
      const unit = Math.max(
        Number.EPSILON,
        stableHash(`youtube-v2:more-like:${day}:${watch.id}:${watch.watched_at}`) / 0x1_0000_0000,
      );
      return {
        watch,
        race: -Math.log(unit) / Math.max(Number.EPSILON, watch.decayed_strength),
      };
    })
    .sort((left, right) => left.race - right.race
      || left.watch.id.localeCompare(right.watch.id));
  const selected: typeof ranked = [];
  const channelCounts = new Map<string, number>();
  for (const candidate of ranked) {
    const channel = candidate.watch.channel_id
      || normalizedText(candidate.watch.channel_title)
      || `video:${candidate.watch.id}`;
    if ((channelCounts.get(channel) ?? 0) >= 2) continue;
    selected.push(candidate);
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    if (selected.length >= max) break;
  }
  if (selected.length < max) {
    for (const candidate of ranked) {
      if (selected.some((entry) => entry.watch.id === candidate.watch.id)) continue;
      selected.push(candidate);
      if (selected.length >= max) break;
    }
  }
  return selected
    .map(({ watch }) => ({
      kind: 'history' as const,
      item: cachedOrStub(watch),
      provenance_ref: watch.id,
      source_generation: createHash('sha256')
        .update(`history:${watch.id}:${watch.watched_at}:${watch.source}`)
        .digest('hex'),
    }));
}

export function persistYoutubeV2MoreLikeSeeds(
  seeds: readonly YoutubeV2TopicSeed[],
  at = Date.now(),
): void {
  const unique = seeds
    .filter((seed, index, all) => all.findIndex((entry) => (
      entry.kind === seed.kind && entry.provenance_ref === seed.provenance_ref
    )) === index)
    .slice(0, YOUTUBE_V2_MORE_LIKE_MAX_SEEDS);
  const persistedSeeds = unique.map((seed): PersistedTopicSeed => ({
    day: pacificDay(at),
    kind: seed.kind,
    provenance_ref: seed.provenance_ref,
    item_id: seed.item.id,
    source_generation: seed.source_generation,
    selected_at: at,
  }));
  setYoutubeState('youtube_v2_daily_more_like_seed_set', {
    day: pacificDay(at),
    seeds: persistedSeeds,
    selected_at: at,
  } satisfies PersistedMoreLikeSeedSet);
  if (persistedSeeds[0]) {
    setYoutubeState('youtube_v2_daily_topic_seed', persistedSeeds[0]);
  }
}

function moreLikeSeedsFromSources(
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  provenance: YoutubeV2CandidateProvenance[],
  at: number,
): YoutubeV2TopicSeed[] {
  const day = pacificDay(at);
  const persisted = getYoutubeState<PersistedMoreLikeSeedSet | null>(
    'youtube_v2_daily_more_like_seed_set',
    null,
  );
  if (persisted?.day === day) {
    const watchById = new Map(watches.map((watch) => [watch.id, watch] as const));
    const retained = persisted.seeds.flatMap((seed): YoutubeV2TopicSeed[] => {
      if (seed.kind !== 'history') return [];
      const watch = watchById.get(seed.item_id);
      if (!watch) return [];
      return [{
        kind: 'history',
        item: cachedOrStub(watch),
        provenance_ref: watch.id,
        source_generation: createHash('sha256')
          .update(`history:${watch.id}:${watch.watched_at}:${watch.source}`)
          .digest('hex'),
      }];
    });
    if (retained.length > 0) return retained;
  }
  const fallback = topicSeedFromSources(watches, subscriptions, provenance, at);
  return fallback ? [fallback] : [];
}

/** Diverse auditable seeds for Beyond acquisition; More Like still owns the daily seed above. */
export function youtubeV2DiscoverySeeds(limit = 8, at = Date.now()): YoutubeV2TopicSeed[] {
  const max = Math.max(1, Math.min(YOUTUBE_V2_DISCOVERY_MAX_SEEDS, Math.floor(limit)));
  const watches = householdWatchAnchors(at).slice(0, 20);
  const subscriptions = authoritativeSubscriptions();
  const provenance = listYoutubeV2CandidateProvenance({ at, limit: V2_PROVENANCE_LIMIT });
  const primary = topicSeedFromSources(watches, subscriptions, provenance, at);
  const history: YoutubeV2TopicSeed[] = [];
  const seenHistoryCreators = new Set<string>();
  for (const watch of [...watches].sort((left, right) => (
    right.decayed_strength - left.decayed_strength
    || right.watched_at - left.watched_at
    || left.id.localeCompare(right.id)
  ))) {
    const creator = watch.channel_id || normalizedText(watch.channel_title) || watch.id;
    if (seenHistoryCreators.has(creator)) continue;
    seenHistoryCreators.add(creator);
    history.push({
      kind: 'history',
      item: cachedOrStub(watch),
      provenance_ref: watch.id,
      source_generation: createHash('sha256')
        .update(`history:${watch.id}:${watch.watched_at}:${watch.source}`)
        .digest('hex'),
    });
  }
  const subscription: YoutubeV2TopicSeed[] = [...subscriptions]
    .sort((left, right) => (
      stableHash(`youtube-v2:beyond:${pacificDay(at)}:${left.channel_key}`)
        - stableHash(`youtube-v2:beyond:${pacificDay(at)}:${right.channel_key}`)
      || left.channel_key.localeCompare(right.channel_key)
    ))
    .map((row) => {
      const upload = provenance
        .filter((entry) => entry.provenance === 'subscription_upload')
        .filter((entry) => entry.provenance_ref === row.channel_key || entry.provenance_ref === row.channel_id)
        .sort((left, right) => right.acquired_at - left.acquired_at || left.item.id.localeCompare(right.item.id))[0];
      const item = upload?.item ?? {
        id: `subscription:${row.channel_key}`,
        kind: 'video' as const,
        title: row.channel_title,
        subtitle: row.channel_title,
        description: null,
        thumbnail: null,
        channel_id: row.channel_id,
        channel_title: row.channel_title,
        published_at: null,
        duration_sec: null,
        live_status: 'none' as const,
        playlist_id: null,
        updated_at: row.imported_at,
      };
      return {
        kind: 'subscription' as const,
        item,
        provenance_ref: `subscription:${row.channel_key}`,
        source_generation: createHash('sha256')
          .update(`subscription:${row.source_generation}:${row.channel_key}:${item.id}`)
          .digest('hex'),
      };
    });
  const interleaved: YoutubeV2TopicSeed[] = [];
  for (let index = 0; index < Math.max(history.length, subscription.length); index += 1) {
    if (history[index]) interleaved.push(history[index]!);
    if (subscription[index]) interleaved.push(subscription[index]!);
  }
  const output: YoutubeV2TopicSeed[] = [];
  const seen = new Set<string>();
  for (const seed of [primary, ...interleaved]) {
    if (!seed || seen.has(seed.provenance_ref)) continue;
    seen.add(seed.provenance_ref);
    output.push(seed);
    if (output.length >= max) break;
  }
  return output;
}

export function isResolvedYoutubeHistoryItem(item: YoutubeItem | null): item is YoutubeItem {
  return Boolean(
    item
    && item.kind === 'video'
    && item.id.trim()
    && item.title.trim()
    && item.thumbnail?.trim()
    && item.channel_id?.trim(),
  );
}

export function youtubeV2HistoryItems(
  limit = 60,
  profileId = 'household',
): YoutubeRailItem[] {
  type HistoryEntry = { item: YoutubeItem; watched_at: number };
  const merged = new Map<string, HistoryEntry>();
  for (const row of listWatchHistory({
    type: 'youtube_video',
    profile_id: profileId,
    household_blend: false,
    limit: V2_WATCH_LIMIT,
  })) {
    const item = getYoutubeItem('video', row.id);
    if (!isResolvedYoutubeHistoryItem(item)) continue;
    const current = merged.get(row.id);
    if (!current || row.watched_at > current.watched_at) {
      merged.set(row.id, { item, watched_at: row.watched_at });
    }
  }
  // Takeout is a Household bootstrap. Personal profiles retain only their
  // exact Mango-local launches when recommendation mode is off.
  if (profileId === 'household') {
    for (const row of listYoutubeV2ImportedHistory(V2_WATCH_LIMIT)) {
      const item = getYoutubeItem('video', row.video_id);
      if (!isResolvedYoutubeHistoryItem(item)) continue;
      const current = merged.get(row.video_id);
      if (!current || row.watched_at > current.watched_at) {
        merged.set(row.video_id, { item, watched_at: row.watched_at });
      }
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.watched_at - left.watched_at || left.item.id.localeCompare(right.item.id))
    .slice(0, Math.max(1, Math.min(V2_WATCH_LIMIT, Math.floor(limit))))
    .map(({ item }, index) => ({ ...item, score: 1 - index * 0.001, reason: null }));
}

function loadYoutubeV2HistorySnapshot(force = false): YoutubeV2HistorySnapshot {
  const libraryPath = libraryDbPath();
  const youtubePath = youtubeDbPath();
  if (!force
    && historySnapshot?.library_db_path === libraryPath
    && historySnapshot.youtube_db_path === youtubePath) {
    return historySnapshot;
  }
  historySnapshot = {
    library_db_path: libraryPath,
    youtube_db_path: youtubePath,
    items: youtubeV2HistoryItems(V2_WATCH_LIMIT, 'household'),
    built_at: Date.now(),
  };
  historySnapshotBuildCount += 1;
  return historySnapshot;
}

export function primeYoutubeV2HistoryItems(): void {
  loadYoutubeV2HistorySnapshot();
}

export function invalidateYoutubeV2HistoryItems(): void {
  historySnapshot = null;
}

export function youtubeV2CachedHistoryItems(
  limit = 60,
  profileId = 'household',
): YoutubeRailItem[] {
  if (profileId !== 'household') return youtubeV2HistoryItems(limit, profileId);
  const bounded = Math.max(1, Math.min(V2_WATCH_LIMIT, Math.floor(limit)));
  return loadYoutubeV2HistorySnapshot().items.slice(0, bounded).map((item) => ({ ...item }));
}

export function selectYoutubeHistoryRail(
  items: readonly YoutubeRailItem[],
  input: { generation: number | null; shuffle_epoch: number; limit?: number },
): YoutubeRailItem[] {
  const limit = Math.max(1, input.limit ?? YOUTUBE_RAIL_LIMIT);
  return youtubeV2WeightedShuffle(items, {
    generation: input.generation ?? 0,
    shuffle_epoch: input.shuffle_epoch,
    rail_id: 'history',
  }).slice(0, limit);
}

function stableSourceHash(
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  provenance: YoutubeV2CandidateProvenance[],
  watchedIds: ReadonlySet<string>,
  savedIds: ReadonlySet<string>,
  blockedIds: ReadonlySet<string>,
  topicSeeds: readonly YoutubeV2TopicSeed[],
  at: number,
  variant: YoutubeScoringVariant = 'v3',
): string {
  const digest = createHash('sha256');
  digest.update(YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION);
  digest.update(`\nvariant:${variant}`);
  for (const row of [...watches].sort((left, right) => left.id.localeCompare(right.id))) {
    digest.update(`\nw:${row.id}:${row.watched_at}:${row.base_strength}:${row.source}`);
  }
  for (const row of [...subscriptions].sort((left, right) => left.channel_key.localeCompare(right.channel_key))) {
    digest.update(`\ns:${row.channel_key}:${row.channel_id ?? ''}:${row.source_generation}`);
  }
  for (const row of [...provenance].sort((left, right) => (
    left.item.id.localeCompare(right.item.id)
    || left.provenance.localeCompare(right.provenance)
    || left.provenance_ref.localeCompare(right.provenance_ref)
    || left.source_generation.localeCompare(right.source_generation)
  ))) {
    digest.update(`\np:${row.item.id}:${row.provenance}:${row.provenance_ref}:${row.source_generation}:${row.expires_at}:${row.relation_type ?? ''}:${row.source_rank ?? ''}`);
  }
  digest.update(`\nday:${pacificDay(at)}`);
  for (const id of [...watchedIds].sort()) digest.update(`\nx:watched:${id}`);
  for (const id of [...savedIds].sort()) digest.update(`\nx:saved:${id}`);
  for (const id of [...blockedIds].sort()) digest.update(`\nx:blocked:${id}`);
  for (const topicSeed of topicSeeds) {
    digest.update(`\nseed:${pacificDay(at)}:${topicSeed.kind}:${topicSeed.provenance_ref}:${topicSeed.item.id}:${topicSeed.source_generation}`);
  }
  return digest.digest('hex');
}

function matchingSubscriptions(
  item: YoutubeItem,
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
): ReturnType<typeof listYoutubeV2Subscriptions> {
  const channelName = normalizedText(item.channel_title);
  return subscriptions.filter((row) => (
    Boolean(item.channel_id && row.channel_id && item.channel_id === row.channel_id)
    || Boolean(channelName && channelName === normalizedText(row.channel_title))
  ));
}

function subscriptionForTopicRef(
  provenanceRef: string,
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
): ReturnType<typeof listYoutubeV2Subscriptions>[number] | null {
  if (!provenanceRef.startsWith('subscription:')) return null;
  const key = provenanceRef.slice('subscription:'.length);
  if (!key) return null;
  return subscriptions.find((row) => row.channel_key === key || row.channel_id === key) ?? null;
}

function inferredRelationType(row: YoutubeV2CandidateProvenance): YoutubeV2CandidateProvenance['relation_type'] {
  if (row.relation_type) return row.relation_type;
  if (row.provenance === 'subscription_upload'
    || row.provenance === 'subscription_live'
    || row.provenance === 'history_channel') return 'direct';
  if (row.source_generation.startsWith('more_like:')) return 'same_topic';
  if (row.source_generation.startsWith('beyond:')) return 'wildcard';
  return null;
}

function provenanceRelationFactor(row: YoutubeV2CandidateProvenance): number {
  switch (inferredRelationType(row)) {
    case 'direct':
    case 'same_topic':
      return 1;
    case 'deeper_dive':
      return 0.85;
    case 'wildcard':
      return 0.55;
    default:
      return 0.35;
  }
}

function provenanceRankFactor(row: YoutubeV2CandidateProvenance): number {
  if (row.source_rank === null || row.source_rank === undefined || !Number.isFinite(row.source_rank)) {
    return 0.75;
  }
  return 1 - 0.45 * Math.min(49, Math.max(0, Math.floor(row.source_rank))) / 49;
}

function subscriptionFreshnessFactor(item: YoutubeItem, subscriptionBacked: boolean, at: number): number {
  if (!subscriptionBacked || isLive(item)) return 1;
  const publishedAt = publishedTimestamp(item);
  if (publishedAt <= 0) return 0.35;
  const ageDays = Math.max(0, (at - publishedAt) / DAY_MS);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.9;
  if (ageDays <= 90) return 0.75;
  if (ageDays <= 365) return 0.55;
  return 0.35;
}

function provenanceRowQuality(
  row: YoutubeV2CandidateProvenance,
  anchorById: ReadonlyMap<string, WatchAnchor>,
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  at: number,
  scoring: YoutubeV2ScoringContext,
): YoutubeV2ScoreBreakdown {
  const subscriptionBacked = row.provenance.startsWith('subscription_')
    || Boolean(subscriptionForTopicRef(row.provenance_ref, subscriptions));
  const itemKey = youtubeCreatorKey(row.item);
  const channelStrength = scoring.affinity.get(itemKey) ?? 0;
  const seedStrength = anchorById.get(row.provenance_ref)?.decayed_strength ?? 0;
  const affinity = channelAffinityFactor({
    subscriptionBacked,
    channelStrength,
    seedStrength,
    variant: scoring.variant,
  });
  const relation = provenanceRelationFactor(row);
  const embeddingSim = scoring.tasteEmbeddings.length > 0
    ? maxTasteSimilarity(row.item, scoring.tasteEmbeddings)
    : 0;
  let relationFactor = relation;
  if (scoring.tasteEmbeddings.length > 0 && scoring.simMode !== 'lexical') {
    const embedFactor = embeddingRelationFactor(embeddingSim);
    relationFactor = scoring.simMode === 'embedding'
      ? embedFactor
      : (relation + embedFactor) / 2;
  }
  const rank = provenanceRankFactor(row);
  const freshness = subscriptionFreshnessFactor(row.item, subscriptionBacked, at);
  const penalty = channelPenaltyFactor(itemKey, scoring.penaltyEvents, at, scoring.variant);
  const quality = relationFactor * rank * affinity * freshness * penalty;
  return {
    relation: relationFactor,
    rank,
    affinity,
    freshness,
    penalty,
    embedding_sim: embeddingSim,
    quality,
  };
}

function candidateQuality(
  rows: YoutubeV2CandidateProvenance[],
  anchorById: ReadonlyMap<string, WatchAnchor>,
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  at: number,
  scoring: YoutubeV2ScoringContext,
): YoutubeV2ScoreBreakdown {
  if (rows.length === 0) {
    return {
      relation: 0, rank: 0, affinity: 0, freshness: 0, penalty: 1, embedding_sim: 0, quality: 0,
    };
  }
  const parts = rows.map((row) => provenanceRowQuality(row, anchorById, subscriptions, at, scoring));
  const best = parts.reduce((winner, candidate) => (
    candidate.quality > winner.quality ? candidate : winner
  ));
  const independentReferences = new Set(rows.map((row) => {
    const subscription = row.provenance.startsWith('subscription_')
      ? subscriptions.find((candidate) => (
          candidate.channel_key === row.provenance_ref || candidate.channel_id === row.provenance_ref
        )) ?? null
      : subscriptionForTopicRef(row.provenance_ref, subscriptions);
    if (subscription) {
      return `subscription:${subscription.channel_id || subscription.channel_key}`;
    }
    // A single watched seed can support the same result through both channel
    // and topic acquisition. That is one source of evidence, not two votes.
    return `history:${row.provenance_ref.trim()}`;
  })).size;
  const quality = Math.min(1, Math.max(0, best.quality + Math.min(0.12, 0.03 * Math.max(0, independentReferences - 1))));
  return { ...best, quality };
}

export type YoutubeV2CandidateQualityEvaluator = {
  quality(rows: readonly YoutubeV2CandidateProvenance[]): number;
  eligible(rows: readonly YoutubeV2CandidateProvenance[]): YoutubeV2CandidateProvenance[];
};

/**
 * Snapshot the same evidence used by generation publication so acquisition can
 * reject weak search tails before they ever enter youtube_items/provenance.
 * The evaluator deliberately has no impression or serving-state input: quality
 * is a source/evidence property, while every X press remains a pure cached draw.
 */
export function createYoutubeV2CandidateQualityEvaluator(
  at = Date.now(),
): YoutubeV2CandidateQualityEvaluator {
  const variant = youtubeScoringVariant();
  const anchors = householdWatchAnchors(at, { includeLocal: variant !== 'legacy' });
  const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor] as const));
  const subscriptions = authoritativeSubscriptions();
  const scoring = scoringContextFor(anchors, at, variant);
  const quality = (rows: readonly YoutubeV2CandidateProvenance[]): number => (
    candidateQuality([...rows], anchorById, subscriptions, at, scoring).quality
  );
  return {
    quality,
    eligible(rows) {
      const grouped = new Map<string, YoutubeV2CandidateProvenance[]>();
      for (const row of rows) {
        const group = grouped.get(row.item.id) ?? [];
        group.push(row);
        grouped.set(row.item.id, group);
      }
      const accepted: YoutubeV2CandidateProvenance[] = [];
      for (const group of grouped.values()) {
        if (youtubeV2QualityTier(quality(group)) !== 'rejected') accepted.push(...group);
      }
      return accepted;
    },
  };
}

function provenanceFor(
  candidate: RankedCandidate,
  allowed: readonly YoutubeV2Provenance[],
  anchorById: ReadonlyMap<string, WatchAnchor>,
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  at: number,
  scoring: YoutubeV2ScoringContext,
): YoutubeV2CandidateProvenance | null {
  return candidate.rows
    .filter((row) => allowed.includes(row.provenance))
    .sort((left, right) => {
      const leftWeight = provenanceRowQuality(left, anchorById, subscriptions, at, scoring).quality;
      const rightWeight = provenanceRowQuality(right, anchorById, subscriptions, at, scoring).quality;
      return rightWeight - leftWeight
        || (left.source_rank ?? Number.MAX_SAFE_INTEGER) - (right.source_rank ?? Number.MAX_SAFE_INTEGER)
        || left.provenance_ref.localeCompare(right.provenance_ref);
    })[0] ?? null;
}

function rankCandidates(
  provenance: YoutubeV2CandidateProvenance[],
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  excludedIds: Set<string>,
  at: number,
  scoring: YoutubeV2ScoringContext,
): RankedCandidate[] {
  const anchorById = new Map(watches.map((watch) => [watch.id, watch] as const));
  const grouped = new Map<string, YoutubeV2CandidateProvenance[]>();
  for (const row of provenance) {
    const item = row.item;
    if (item.kind !== 'video' || excludedIds.has(item.id) || isShort(item)) continue;
    if (row.provenance === 'subscription_live') {
      if (!isLive(item)) continue;
    } else if (isLiveLike(item)) {
      continue;
    }
    if (row.provenance.startsWith('subscription_')) {
      const ref = normalizedText(row.provenance_ref);
      const matches = matchingSubscriptions(item, subscriptions);
      if (!matches.some((subscription) => (
        subscription.channel_key === row.provenance_ref
        || subscription.channel_id === row.provenance_ref
        || normalizedText(subscription.channel_title) === ref
      ))) continue;
    } else if (row.provenance === 'history_topic' && row.provenance_ref.startsWith('subscription:')) {
      if (!subscriptionForTopicRef(row.provenance_ref, subscriptions)) continue;
    } else {
      const anchor = anchorById.get(row.provenance_ref);
      if (!anchor) continue;
      if (row.provenance === 'history_channel') {
        const sameId = Boolean(anchor.channel_id && item.channel_id && anchor.channel_id === item.channel_id);
        const sameName = Boolean(
          anchor.channel_title
          && item.channel_title
          && normalizedText(anchor.channel_title) === normalizedText(item.channel_title),
        );
        if ((anchor.channel_id || anchor.channel_title) && !sameId && !sameName) continue;
      }
    }
    const rows = grouped.get(item.id) ?? [];
    rows.push(row);
    grouped.set(item.id, rows);
  }

  const scoreRows = (rows: YoutubeV2CandidateProvenance[]): RankedCandidate => {
    const item = rows[0]!.item;
    const historyRefs = new Set(rows
      .filter((row) => row.provenance.startsWith('history_') && !row.provenance_ref.startsWith('subscription:'))
      .map((row) => row.provenance_ref));
    const historyMassValue = [...historyRefs]
      .reduce((sum, ref) => sum + (anchorById.get(ref)?.decayed_strength ?? 0), 0);
    const historyAffinity = Math.min(WATCH_PER_VIDEO_STRENGTH_CAP, historyMassValue);
    const subscriptionAffinity = rows.some((row) => (
      row.provenance.startsWith('subscription_')
      || (row.provenance === 'history_topic' && Boolean(subscriptionForTopicRef(row.provenance_ref, subscriptions)))
    )) ? 1 : 0;
    const breakdown = candidateQuality(rows, anchorById, subscriptions, at, scoring);
    return {
      item,
      rows,
      history_affinity: historyAffinity,
      subscription_affinity: subscriptionAffinity,
      score: breakdown.quality,
      score_breakdown: breakdown,
    };
  };
  return [...grouped.values()].map(scoreRows)
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));
}

function prioritizeCreatorDiversity(candidates: RankedCandidate[]): RankedCandidate[] {
  const first: RankedCandidate[] = [];
  const rest: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const creator = creatorKey(candidate.item);
    if (seen.has(creator)) rest.push(candidate);
    else {
      seen.add(creator);
      first.push(candidate);
    }
  }
  return [...first, ...rest];
}

function publishedTimestamp(item: YoutubeItem): number {
  const timestamp = item.published_at ? Date.parse(item.published_at) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function generationInputs(
  provenance: YoutubeV2CandidateProvenance[],
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  excludedIds: Set<string>,
  hardExcludedIds: ReadonlySet<string>,
  topicSeeds: readonly YoutubeV2TopicSeed[],
  at: number,
  scoring: YoutubeV2ScoringContext,
): YoutubeV2GenerationItemInput[] {
  const anchorById = new Map(watches.map((watch) => [watch.id, watch] as const));
  const subscribedChannels = new Set(subscriptions.flatMap((row) => row.channel_id ? [row.channel_id] : []));
  const subscribedNames = new Set(subscriptions.map((row) => normalizedText(row.channel_title)).filter(Boolean));
  const candidates = rankCandidates(provenance, watches, subscriptions, excludedIds, at, scoring);

  // Recompute a lane-local score after provenance filtering. Otherwise a row
  // acquired for Beyond could inflate a More Like item (or vice versa) even
  // though that row is not valid provenance for the lane being published.
  const scoreWithRows = (
    candidate: RankedCandidate,
    rows: YoutubeV2CandidateProvenance[],
  ): RankedCandidate => {
    const historyRefs = new Set(rows
      .filter((row) => row.provenance.startsWith('history_') && !row.provenance_ref.startsWith('subscription:'))
      .map((row) => row.provenance_ref));
    const historyAffinity = Math.min(WATCH_PER_VIDEO_STRENGTH_CAP, [...historyRefs]
      .reduce((sum, ref) => sum + (anchorById.get(ref)?.decayed_strength ?? 0), 0));
    const subscriptionAffinity = rows.some((row) => (
      row.provenance.startsWith('subscription_')
      || (row.provenance === 'history_topic' && Boolean(subscriptionForTopicRef(row.provenance_ref, subscriptions)))
    )) ? 1 : 0;
    const breakdown = candidateQuality(rows, anchorById, subscriptions, at, scoring);
    return {
      ...candidate,
      rows,
      history_affinity: historyAffinity,
      subscription_affinity: subscriptionAffinity,
      score: breakdown.quality,
      score_breakdown: breakdown,
    };
  };

  const forYou = candidates.filter((candidate) => !isLiveLike(candidate.item));
  const fromSubscriptions = prioritizeCreatorDiversity(candidates.filter((candidate) => (
    !isLiveLike(candidate.item)
    && candidate.rows.some((row) => row.provenance === 'subscription_upload')
  )).sort((left, right) => (
    publishedTimestamp(right.item) - publishedTimestamp(left.item)
    || Math.max(...right.rows.map((row) => row.acquired_at))
      - Math.max(...left.rows.map((row) => row.acquired_at))
    || left.item.id.localeCompare(right.item.id)
  )));
  const live = prioritizeCreatorDiversity(candidates.filter((candidate) => (
    isLive(candidate.item)
    && candidate.rows.some((row) => row.provenance === 'subscription_live')
  )));
  const topicSeedRefs = new Set(topicSeeds.map((seed) => seed.provenance_ref));
  const subscriptionSeedKeys = new Set(topicSeeds
    .filter((seed) => seed.kind === 'subscription')
    .flatMap((seed) => [seed.provenance_ref.slice('subscription:'.length), seed.item.channel_id || ''])
    .filter(Boolean));
  const rowMatchesMoreLikeSeed = (row: YoutubeV2CandidateProvenance): boolean => (
    !row.source_generation.startsWith('beyond:')
    && ((row.provenance.startsWith('history_') && topicSeedRefs.has(row.provenance_ref))
      || (row.provenance === 'subscription_upload' && subscriptionSeedKeys.has(row.provenance_ref)))
  );
  const moreLike = topicSeeds.length > 0
    ? prioritizeCreatorDiversity(candidates.filter((candidate) => {
        if (isLiveLike(candidate.item)) return false;
        return candidate.rows.some(rowMatchesMoreLikeSeed);
      }))
    : [];
  const beyond = prioritizeCreatorDiversity(candidates.filter((candidate) => {
    if (isLiveLike(candidate.item)) return false;
    if (!candidate.rows.some((row) => (
      row.provenance === 'history_topic' && !row.source_generation.startsWith('more_like:')
    ))) return false;
    if (candidate.item.channel_id && subscribedChannels.has(candidate.item.channel_id)) return false;
    const channelName = normalizedText(candidate.item.channel_title);
    return !channelName || !subscribedNames.has(channelName);
  }));

  const output: YoutubeV2GenerationItemInput[] = [];
  const addRail = (
    railId: YoutubeV2GenerationItemInput['rail_id'],
    rows: RankedCandidate[],
    allowed: readonly YoutubeV2Provenance[],
    contextId = '',
  ) => {
    const eligible = rows
      .map((candidate) => scoreWithRows(
        candidate,
        candidate.rows.filter((row) => allowed.includes(row.provenance)),
      ))
      .filter((candidate) => candidate.rows.length > 0)
      .filter((candidate) => youtubeV2QualityTier(candidate.score) !== 'rejected')
      .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));
    const strong = eligible
      .filter((candidate) => youtubeV2QualityTier(candidate.score) !== 'C')
      .slice(0, YOUTUBE_V2_RESERVE_LIMIT);
    const exploratory = strong.length >= YOUTUBE_V2_RESERVE_LIMIT
      ? []
      : eligible
        .filter((candidate) => youtubeV2QualityTier(candidate.score) === 'C')
        .slice(0, Math.min(YOUTUBE_V2_C_TIER_LIMIT, YOUTUBE_V2_RESERVE_LIMIT - strong.length));
    for (const candidate of [...strong, ...exploratory]) {
      const source = provenanceFor(candidate, allowed, anchorById, subscriptions, at, scoring);
      if (!source) continue;
      output.push({
        rail_id: railId,
        item: candidate.item,
        score: candidate.score,
        reason: `youtube_v2:${source.provenance}`,
        provenance: source.provenance,
        provenance_ref: source.provenance_ref,
        source_expires_at: source.expires_at,
        context_id: contextId,
        score_breakdown: candidate.score_breakdown,
      });
    }
  };
  const beyondForLane = prioritizeCreatorDiversity(beyond.map((candidate) => scoreWithRows(
    candidate,
    candidate.rows.filter((row) => !row.source_generation.startsWith('more_like:')),
  )).sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id)));
  const directMoreLike = (candidate: RankedCandidate): boolean => candidate.rows.some((row) => (
    (row.provenance === 'history_channel' && topicSeedRefs.has(row.provenance_ref))
    || (row.provenance === 'subscription_upload' && subscriptionSeedKeys.has(row.provenance_ref))
  ));
  const allMoreLikeForLane = prioritizeCreatorDiversity(moreLike.map((candidate) => scoreWithRows(
    candidate,
    candidate.rows.filter(rowMatchesMoreLikeSeed),
  )).sort((left, right) => (
    Number(directMoreLike(right)) - Number(directMoreLike(left))
    || right.score - left.score
    || left.item.id.localeCompare(right.item.id)
  )));
  const thematicMoreLike = allMoreLikeForLane.filter((candidate) => candidate.rows.some((row) => (
    row.provenance === 'history_topic' && row.source_generation.startsWith('more_like:')
  )));
  const exactChannelMoreLike = allMoreLikeForLane.filter(directMoreLike);
  const subscriptionOnlyMoreLike = topicSeeds.length > 0
    && topicSeeds.every((seed) => seed.kind === 'subscription');
  const moreLikeForLane = subscriptionOnlyMoreLike
    ? allMoreLikeForLane
    : thematicMoreLike.length >= YOUTUBE_RAIL_LIMIT
      ? thematicMoreLike
      : thematicMoreLike.length > 0 && allMoreLikeForLane.length >= YOUTUBE_RAIL_LIMIT
        ? allMoreLikeForLane
        : exactChannelMoreLike.length >= YOUTUBE_RAIL_LIMIT
        ? exactChannelMoreLike
        : allMoreLikeForLane;
  const singleTopicSeed = topicSeeds.length === 1 ? topicSeeds[0]! : null;
  const moreLikeContext = moreLikeForLane === exactChannelMoreLike && singleTopicSeed
    ? `more_from:${singleTopicSeed.item.channel_title || singleTopicSeed.item.channel_id || 'channel'}`
    : topicSeeds.length > 1
      ? `multi_history:${createHash('sha256').update(topicSeeds.map((seed) => seed.provenance_ref).join('\n')).digest('hex')}`
      : singleTopicSeed?.provenance_ref ?? '';
  addRail(
    'more_like',
    moreLikeForLane,
    subscriptionOnlyMoreLike
      ? ['subscription_upload', 'history_topic']
      : ['history_channel', 'history_topic'],
    moreLikeContext,
  );
  addRail('beyond', beyondForLane, ['history_topic']);
  addRail('new_from_subscriptions', fromSubscriptions, ['subscription_upload']);
  addRail('live_now', live, ['subscription_live']);
  addRail('for_you', forYou, ['history_channel', 'history_topic', 'subscription_upload']);

  const watchedLifetime = new Set(watches.map((watch) => watch.id));
  const topChannels = new Set(topAffinityChannels(scoring.affinity, 8));
  const rewatchItems: YoutubeV2GenerationItemInput[] = [];
  for (const watch of watches) {
    if (watch.event_times.length < 2) continue;
    const item = cachedOrStub(watch);
    if (isShort(item) || isLiveLike(item) || hardExcludedIds.has(item.id)) continue;
    const score = rewatchScore(watch, at);
    if (score <= 0) continue;
    const channelKey = youtubeCreatorKey(item);
    const penalty = channelPenaltyFactor(channelKey, scoring.penaltyEvents, at, scoring.variant);
    const quality = Math.min(1, Math.max(0, score * penalty));
    if (youtubeV2QualityTier(quality) === 'rejected') continue;
    rewatchItems.push({
      rail_id: 'frequently_watched',
      item,
      score: quality,
      reason: 'youtube_v2:rewatch',
      provenance: 'rewatch',
      provenance_ref: watch.id,
      source_expires_at: at + YOUTUBE_V2_CANDIDATE_TTL_MS,
      context_id: 'rewatch',
      score_breakdown: {
        relation: 1,
        rank: 1,
        affinity: channelAffinityFactor({
          subscriptionBacked: Boolean(item.channel_id && subscribedChannels.has(item.channel_id)),
          channelStrength: scoring.affinity.get(channelKey) ?? watch.decayed_strength,
          seedStrength: watch.decayed_strength,
          variant: scoring.variant,
        }),
        freshness: 1,
        penalty,
        embedding_sim: 0,
        quality,
      },
    });
  }
  const frequentChannel = candidates.filter((candidate) => {
    if (isLiveLike(candidate.item) || isShort(candidate.item)) return false;
    if (watchedLifetime.has(candidate.item.id) || excludedIds.has(candidate.item.id)) return false;
    const key = youtubeCreatorKey(candidate.item);
    if (!topChannels.has(key)) return false;
    return candidate.rows.some((row) => (
      row.provenance === 'subscription_upload' || row.provenance === 'history_channel'
    ));
  }).sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));
  const regulars: YoutubeV2GenerationItemInput[] = [
    ...rewatchItems.sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id)),
    ...frequentChannel.map((candidate) => {
      const source = candidate.rows.find((row) => (
        row.provenance === 'subscription_upload' || row.provenance === 'history_channel'
      )) ?? candidate.rows[0]!;
      return {
        rail_id: 'frequently_watched' as const,
        item: candidate.item,
        score: candidate.score,
        reason: 'youtube_v2:frequent_channel',
        provenance: 'frequent_channel' as const,
        provenance_ref: youtubeCreatorKey(candidate.item) || source.provenance_ref,
        source_expires_at: source.expires_at,
        context_id: 'frequent_channel',
        score_breakdown: candidate.score_breakdown,
      };
    }),
  ];
  const seenRegulars = new Set<string>();
  for (const entry of regulars) {
    if (seenRegulars.has(entry.item.id)) continue;
    seenRegulars.add(entry.item.id);
    output.push(entry);
    if (seenRegulars.size >= YOUTUBE_V2_RESERVE_LIMIT) break;
  }
  return output;
}

export function rebuildYoutubeV2Generation(options: {
  force?: boolean;
  at?: number;
  watchUntil?: number;
  scoringVariant?: YoutubeScoringVariant;
} = {}): YoutubeV2Generation | null {
  const at = options.at ?? Date.now();
  const variant = options.scoringVariant ?? youtubeScoringVariant();
  const watches = householdWatchAnchors(at, {
    watchUntil: options.watchUntil,
    includeLocal: variant !== 'legacy',
  });
  const subscriptions = authoritativeSubscriptions();
  const provenance = listYoutubeV2CandidateProvenance({ at, limit: V2_PROVENANCE_LIMIT });
  const exclusions = loadYoutubeV2ExactExclusions(true, at);
  // History is chronological utility state, so publish its resolved snapshot
  // at the same source/metadata boundary as the recommendation generation.
  loadYoutubeV2HistorySnapshot(true);
  const watchedIds = exclusions.watched;
  const savedIds = exclusions.saved;
  const blockedIds = exclusions.blocked;
  const topicSeeds = moreLikeSeedsFromSources(watches, subscriptions, provenance, at);
  const scoring = scoringContextFor(watches, at, variant);
  const sourceHash = stableSourceHash(
    watches,
    subscriptions,
    provenance,
    watchedIds,
    savedIds,
    blockedIds,
    topicSeeds,
    at,
    variant,
  );
  const latestRecord = latestYoutubeV2GenerationRecord();
  if (!options.force
    && latestRecord?.source_hash === sourceHash
    && latestRecord.model_version === YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION) {
    return latestRecord.status === 'ready' ? latestYoutubeV2Generation() : null;
  }
  const hardExcludedIds = new Set([...savedIds, ...blockedIds]);
  const excludedIds = new Set([...watchedIds, ...hardExcludedIds]);
  const candidates = (watches.length === 0 && subscriptions.length === 0)
    ? []
    : generationInputs(
      provenance, watches, subscriptions, excludedIds, hardExcludedIds, topicSeeds, at, scoring,
    );
  const generation = publishYoutubeV2Generation({
    model_version: YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
    source_hash: sourceHash,
    watch_count: watches.length,
    subscription_count: subscriptions.length,
    items: candidates,
    generated_at: at,
  });
  setYoutubeState('youtube_v2_last_generation', {
    generation,
    status: candidates.length > 0 ? 'ready' : 'empty',
    watch_count: watches.length,
    subscription_count: subscriptions.length,
    active_provenance_count: provenance.length,
    candidate_count: candidates.length,
    generated_at: at,
  });
  return latestYoutubeV2Generation();
}

function stableHash(value: string): number {
  return createHash('sha256').update(value).digest().readUInt32BE(0);
}

function stableUniform(value: string): number {
  const digest = createHash('sha256').update(value).digest();
  // Six bytes fit exactly inside JavaScript's integer precision. The half-step
  // keeps the deterministic sample strictly inside (0, 1), which makes the
  // exponential-race transform finite for every candidate.
  return (digest.readUIntBE(0, 6) + 0.5) / 2 ** 48;
}

type WeightedCandidate<T> = {
  item: T;
  tier: Exclude<YoutubeV2QualityTier, 'rejected'>;
  percentile: number;
  weight: number;
};

function weightedCandidates<T extends { id: string; score: number }>(items: readonly T[]): WeightedCandidate<T>[] {
  const accepted = items.filter((item) => youtubeV2QualityTier(item.score) !== 'rejected');
  const output: WeightedCandidate<T>[] = [];
  for (const tier of ['A', 'B', 'C'] as const) {
    const members = accepted
      .filter((item) => youtubeV2QualityTier(item.score) === tier)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const multiplier = tier === 'A' ? 1 : tier === 'B' ? 0.55 : 0.25;
    for (let start = 0; start < members.length;) {
      let end = start + 1;
      while (end < members.length && members[end]!.score === members[start]!.score) end += 1;
      const averageRank = (start + end - 1) / 2;
      const percentile = members.length === 1 ? 0.5 : 1 - averageRank / (members.length - 1);
      const weight = multiplier * (0.75 + 0.5 * percentile);
      for (let index = start; index < end; index += 1) {
        output.push({ item: members[index]!, tier, percentile, weight });
      }
      start = end;
    }
  }
  return output;
}

function weightedOrder<T extends { id: string; score: number }>(
  items: readonly T[],
  seed: string,
): T[] {
  return weightedCandidates(items)
    .map((candidate) => ({
      ...candidate,
      race: -Math.log(stableUniform(`${seed}:${candidate.item.id}`)) / candidate.weight,
    }))
    .sort((left, right) => left.race - right.race || left.item.id.localeCompare(right.item.id))
    .map((candidate) => candidate.item);
}

export function youtubeV2WeightedShuffle<T extends { id: string; score: number }>(
  items: readonly T[],
  input: {
    generation: number;
    shuffle_epoch: number;
    rail_id: string;
    subpool?: string;
  },
): T[] {
  return weightedOrder(items, [
    YOUTUBE_V2_SERVING_POLICY_VERSION,
    input.generation,
    Math.max(0, Math.floor(input.shuffle_epoch)),
    input.rail_id,
    input.subpool ?? 'all',
  ].join(':'));
}

export function youtubeV2WeightedPoolDiagnostics<T extends { id: string; score: number }>(items: readonly T[]): {
  quality_tiers: { A: number; B: number; C: number; rejected: number };
  expected_selection_share: { A: number; B: number; C: number };
  effective_pool_size: number;
  expected_adjacent_overlap: number;
  top_quartile_sampling_share: number;
  bottom_quartile_sampling_share: number;
  minimum_sampling_weight: number;
} {
  const candidates = weightedCandidates(items);
  const sum = candidates.reduce((total, candidate) => total + candidate.weight, 0);
  const squared = candidates.reduce((total, candidate) => total + candidate.weight ** 2, 0);
  const effectivePoolSize = squared > 0 ? sum ** 2 / squared : 0;
  const samplingShare = (tier: 'A' | 'B' | 'C') => sum > 0
    ? candidates.filter((candidate) => candidate.tier === tier)
      .reduce((total, candidate) => total + candidate.weight, 0) / sum
    : 0;
  const byQuality = [...candidates].sort((left, right) => (
    right.item.score - left.item.score || left.item.id.localeCompare(right.item.id)
  ));
  const quartileSize = Math.ceil(byQuality.length / 4);
  const shareFor = (entries: typeof byQuality) => sum > 0
    ? entries.reduce((total, candidate) => total + candidate.weight, 0) / sum
    : 0;
  return {
    quality_tiers: {
      A: candidates.filter((candidate) => candidate.tier === 'A').length,
      B: candidates.filter((candidate) => candidate.tier === 'B').length,
      C: candidates.filter((candidate) => candidate.tier === 'C').length,
      rejected: items.length - candidates.length,
    },
    expected_selection_share: {
      A: Number(samplingShare('A').toFixed(4)),
      B: Number(samplingShare('B').toFixed(4)),
      C: Number(samplingShare('C').toFixed(4)),
    },
    effective_pool_size: Number(effectivePoolSize.toFixed(3)),
    expected_adjacent_overlap: effectivePoolSize > 0
      ? Number((YOUTUBE_RAIL_LIMIT ** 2 / effectivePoolSize).toFixed(4))
      : 0,
    top_quartile_sampling_share: Number(shareFor(byQuality.slice(0, quartileSize)).toFixed(4)),
    bottom_quartile_sampling_share: Number(shareFor(
      quartileSize > 0 ? byQuality.slice(-quartileSize) : [],
    ).toFixed(4)),
    minimum_sampling_weight: Number((candidates.length > 0
      ? Math.min(...candidates.map((candidate) => candidate.weight))
      : 0).toFixed(4)),
  };
}

const V2_LABELS: Record<string, string> = {
  for_you: 'For You',
  beyond: 'Beyond Your Subscriptions',
  more_like: 'More Like',
  new_from_subscriptions: 'From Your Subscriptions',
  frequently_watched: 'Your regulars',
  live_now: 'Live Now',
};
const V2_SUBSCRIPTION_MORE_LABEL = 'More from channels you follow';

function selectWithCreatorCap(
  pool: YoutubeRailItem[],
  seen: ReadonlySet<string>,
  limit: number,
  creatorCap: number,
  relaxCap: boolean,
): YoutubeRailItem[] {
  const eligible = pool.filter((item) => !seen.has(item.id));
  const select = (cap: number): YoutubeRailItem[] => {
    const selected: YoutubeRailItem[] = [];
    const creators = new Map<string, number>();
    for (const item of eligible) {
      const creator = creatorKey(item);
      if ((creators.get(creator) ?? 0) >= cap) continue;
      selected.push(item);
      creators.set(creator, (creators.get(creator) ?? 0) + 1);
      if (selected.length >= limit) break;
    }
    return selected;
  };
  const strict = select(creatorCap);
  if (strict.length >= limit || !relaxCap) return strict;
  let best = strict;
  for (let cap = creatorCap + 1; cap <= limit; cap += 1) {
    const relaxed = select(cap);
    if (relaxed.length > best.length) best = relaxed;
    if (relaxed.length >= limit) return relaxed;
  }
  return best;
}

function selectRegularsSlate(
  pool: PortfolioItem[],
  seen: ReadonlySet<string>,
  limit: number,
  creatorCap: number,
  relaxCap: boolean,
): YoutubeRailItem[] {
  const eligible = pool.filter((item) => !seen.has(item.id));
  const select = (cap: number): YoutubeRailItem[] => {
    const selected: YoutubeRailItem[] = [];
    const selectedIds = new Set<string>();
    const creators = new Map<string, number>();
    const add = (item: PortfolioItem | undefined): void => {
      if (!item || selectedIds.has(item.id) || selected.length >= limit) return;
      const creator = creatorKey(item);
      if ((creators.get(creator) ?? 0) >= cap) return;
      selected.push(item);
      selectedIds.add(item.id);
      creators.set(creator, (creators.get(creator) ?? 0) + 1);
    };
    add(eligible.find((item) => item.provenance === 'rewatch'));
    add(eligible.find((item) => item.provenance === 'frequent_channel'));
    for (const item of eligible) {
      add(item);
      if (selected.length >= limit) break;
    }
    return selected;
  };
  const strict = select(creatorCap);
  if (strict.length >= limit || !relaxCap) return strict;
  let best = strict;
  for (let cap = creatorCap + 1; cap <= limit; cap += 1) {
    const relaxed = select(cap);
    if (relaxed.length > best.length) best = relaxed;
    if (relaxed.length >= limit) return relaxed;
  }
  return best;
}

type PortfolioItem = YoutubeRailItem & {
  provenance?: YoutubeV2ServeProvenance;
  provenance_ref?: string;
  context_id?: string;
};

function selectRecommendationPortfolio(
  pool: PortfolioItem[],
  seen: ReadonlySet<string>,
  limit: number,
  options: {
    creator_cap: number;
    seed_cap: number;
    require_source_mix: boolean;
  },
): YoutubeRailItem[] {
  const eligible = pool.filter((item) => !seen.has(item.id));
  const source = (item: PortfolioItem): 'history' | 'subscription' | 'regular' | 'other' => (
    item.provenance === 'rewatch' || item.provenance === 'frequent_channel' ? 'regular'
      : item.provenance?.startsWith('history_') ? 'history'
      : item.provenance?.startsWith('subscription_') ? 'subscription'
        : 'other'
  );
  const attempt = (creatorCap: number, seedCap: number): YoutubeRailItem[] => {
    const selected: PortfolioItem[] = [];
    const selectedIds = new Set<string>();
    const creators = new Map<string, number>();
    const seeds = new Map<string, number>();
    const add = (item: PortfolioItem): boolean => {
      if (selectedIds.has(item.id)) return false;
      const creator = creatorKey(item);
      const seed = item.provenance_ref || `item:${item.id}`;
      if ((creators.get(creator) ?? 0) >= creatorCap) return false;
      if ((seeds.get(seed) ?? 0) >= seedCap) return false;
      selected.push(item);
      selectedIds.add(item.id);
      creators.set(creator, (creators.get(creator) ?? 0) + 1);
      seeds.set(seed, (seeds.get(seed) ?? 0) + 1);
      return true;
    };
    if (options.require_source_mix) {
      const availableSources = new Set(eligible.map(source));
      if (availableSources.has('history') && availableSources.has('subscription')) {
        add(eligible.find((item) => source(item) === 'history')!);
        add(eligible.find((item) => source(item) === 'subscription')!);
      }
    }
    for (const item of eligible) {
      add(item);
      if (selected.length >= limit) break;
    }
    return selected.slice(0, limit);
  };
  let best: YoutubeRailItem[] = [];
  for (let seedCap = options.seed_cap; seedCap <= limit; seedCap += 1) {
    for (let creatorCap = options.creator_cap; creatorCap <= limit; creatorCap += 1) {
      const selected = attempt(creatorCap, seedCap);
      if (selected.length > best.length) best = selected;
      if (selected.length >= limit) return selected;
    }
  }
  return best;
}

function generationEntryIsCurrentlyEligible(
  entry: NonNullable<ReturnType<typeof latestYoutubeV2Generation>>['items'][number],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  preservePublishedSubscriptionSnapshot: boolean,
): boolean {
  if (entry.kind !== 'video' || isShort(entry)) return false;
  if (entry.rail_id === 'live_now') {
    if (entry.provenance !== 'subscription_live' || !isLive(entry)) return false;
  } else if (isLiveLike(entry)) {
    return false;
  }
  if (entry.provenance === 'subscription_upload' || entry.provenance === 'subscription_live') {
    if (preservePublishedSubscriptionSnapshot && entry.rail_id !== 'live_now') return true;
    const matches = matchingSubscriptions(entry, subscriptions);
    return matches.some((subscription) => (
      subscription.channel_key === entry.provenance_ref
      || subscription.channel_id === entry.provenance_ref
    ));
  }
  if (entry.provenance === 'history_topic' && entry.provenance_ref.startsWith('subscription:')) {
    if (preservePublishedSubscriptionSnapshot) return true;
    return subscriptionForTopicRef(entry.provenance_ref, subscriptions) !== null;
  }
  if (entry.provenance === 'rewatch' || entry.provenance === 'frequent_channel') {
    return !isLiveLike(entry);
  }
  return true;
}

export function youtubeV2RecommendationRailsFromSnapshot(input: {
  generation: YoutubeV2Generation;
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>;
  source_stale: YoutubeV2SourceStaleState;
  serving_at: number;
  shuffle_epoch: number;
  blocked_ids?: ReadonlySet<string>;
  reserved_ids?: ReadonlySet<string>;
}): YoutubeRail[] {
  const generation = input.generation;
  const subscriptions = input.subscriptions;
  const sourceStale = input.source_stale;
  // Subscription enumeration is authoritative only for the generation that is
  // published from it. While a refresh is pending or has failed, keep serving
  // the previous generation against its own membership snapshot. Live remains
  // dynamically fenced by current membership and its short verification TTL.
  const preservePublishedSubscriptionSnapshot = sourceStale.stale;
  const blocked = new Set(input.blocked_ids ?? []);
  const exclusions = loadYoutubeV2ExactExclusions();
  const hardBlocked = new Set([...exclusions.saved, ...exclusions.blocked]);
  const seen = new Set(input.reserved_ids ?? []);
  const servingAt = input.serving_at;
  const stale = generation.generated_at < servingAt - loadYoutubeConfig().stale_after_ms
    || sourceStale.stale;
  const selected = new Map<string, YoutubeRail>();
  // Allocate direct-source semantics before discovery so a subscription upload
  // cannot be consumed by a fallback More Like row before its own rail. Display
  // order is applied separately below.
  const allocationOrder = [
    { id: 'live_now', cap: 1, relax: true, live: true },
    { id: 'new_from_subscriptions', cap: 1, relax: true, live: false },
    { id: 'frequently_watched', cap: 2, relax: true, live: false },
    { id: 'more_like', cap: 1, relax: true, live: false },
    { id: 'beyond', cap: 1, relax: false, live: false },
    { id: 'for_you', cap: 2, relax: false, live: false },
  ] as const;
  for (const spec of allocationOrder) {
    const entries = generation.items
      .filter((entry) => (
        entry.rail_id === spec.id
        && (entry.source_expires_at > servingAt
          // OAuth/source loss keeps a visibly stale, non-live last-good couch
          // snapshot. Live can never outlive its verification window.
          || (sourceStale.stale && entry.rail_id !== 'live_now'))
        && !(entry.provenance === 'rewatch'
          ? hardBlocked.has(entry.id)
          : blocked.has(entry.id))
        && generationEntryIsCurrentlyEligible(
          entry,
          subscriptions,
          preservePublishedSubscriptionSnapshot,
        )
      ));
    let pool: PortfolioItem[] = entries
      .map((entry): PortfolioItem => ({ ...entry, score: entry.score, reason: entry.reason }));
    const weightedShuffle = <T extends { id: string; score: number }>(items: readonly T[], subpool: string) => (
      youtubeV2WeightedShuffle(items, {
        generation: generation.generation,
        shuffle_epoch: input.shuffle_epoch,
        rail_id: spec.id,
        subpool,
      })
    );
    if (spec.id === 'more_like') {
      const subscriptionFallback = entries.some((entry) => entry.context_id.startsWith('subscription:'));
      const sameChannelEntries = entries.filter((entry) => subscriptionFallback
        ? entry.provenance === 'subscription_upload'
        : entry.provenance === 'history_channel');
      const thematicEntries = entries.filter((entry) => entry.provenance === 'history_topic');
      const sameChannel = weightedShuffle(sameChannelEntries, 'channel')
        .map((entry): YoutubeRailItem => ({ ...entry, score: entry.score, reason: entry.reason }));
      const thematic = weightedShuffle(thematicEntries, 'topic')
        .map((entry): YoutubeRailItem => ({ ...entry, score: entry.score, reason: entry.reason }));
      const unreservedSameChannel = sameChannel.filter((item) => !seen.has(item.id));
      pool = unreservedSameChannel.length > 0
        ? [unreservedSameChannel[0]!, ...thematic, ...unreservedSameChannel.slice(1)]
        : thematic;
    } else {
      pool = weightedShuffle(pool, 'all');
    }
    const limit = spec.live ? Math.min(YOUTUBE_RAIL_LIMIT, pool.length) : YOUTUBE_RAIL_LIMIT;
    const items = spec.id === 'for_you'
      ? selectRecommendationPortfolio(pool, seen, limit, {
          creator_cap: 2,
          seed_cap: 2,
          require_source_mix: true,
        })
      : spec.id === 'beyond'
        ? selectRecommendationPortfolio(pool, seen, limit, {
            creator_cap: 1,
            seed_cap: 2,
            require_source_mix: false,
          })
        : spec.id === 'more_like' && entries.some((entry) => entry.context_id.startsWith('multi_history:'))
          ? selectRecommendationPortfolio(pool, seen, limit, {
              creator_cap: 1,
              seed_cap: 1,
              require_source_mix: false,
            })
        : spec.id === 'frequently_watched'
          ? selectRegularsSlate(pool, seen, limit, spec.cap, spec.relax)
        : selectWithCreatorCap(pool, seen, limit, spec.cap, spec.relax);
    if ((!spec.live && items.length !== YOUTUBE_RAIL_LIMIT) || (spec.live && items.length === 0)) continue;
    items.forEach((item) => seen.add(item.id));
    selected.set(spec.id, {
      rail_id: spec.id,
      label: spec.id === 'more_like' && entries.some((entry) => entry.context_id.startsWith('more_from:'))
        ? `More from ${entries.find((entry) => entry.context_id.startsWith('more_from:'))!
          .context_id.slice('more_from:'.length)}`
        : spec.id === 'more_like' && entries.some((entry) => entry.context_id.startsWith('subscription:'))
          ? V2_SUBSCRIPTION_MORE_LABEL
          : V2_LABELS[spec.id],
      items,
      reserve_items: pool,
      candidate_context_id: generation.items.find((entry) => entry.rail_id === spec.id)?.context_id ?? '',
      cached: true,
      stale,
    });
  }
  return YOUTUBE_V2_DISPLAY_ORDER
    .map((railId) => selected.get(railId))
    .filter((rail): rail is YoutubeRail => Boolean(rail));
}

export function youtubeV2RecommendationRails(input: {
  shuffle_epoch: number;
  blocked_ids?: ReadonlySet<string>;
  reserved_ids?: ReadonlySet<string>;
}): YoutubeRail[] {
  const generation = latestYoutubeV2Generation();
  if (!generation) return [];
  const blocked = youtubeV2ExactExcludedIds();
  input.blocked_ids?.forEach((id) => blocked.add(id));
  return youtubeV2RecommendationRailsFromSnapshot({
    generation,
    subscriptions: authoritativeSubscriptions(),
    source_stale: youtubeV2SourceStaleState(),
    serving_at: Date.now(),
    shuffle_epoch: input.shuffle_epoch,
    blocked_ids: blocked,
    reserved_ids: input.reserved_ids,
  });
}

const YOUTUBE_ACQUISITION_SKIPS = new Set([
  'api_key_not_configured',
  'no_history_or_subscription_seed',
  'not_nightly',
]);
const YOUTUBE_ACQUISITION_STOP_REASONS = new Set([
  'target_reached',
  'wall_limit',
  'search_budget',
  'low_yield',
  'source_exhausted',
]);
const YOUTUBE_MORE_LIKE_STATUSES = new Set([
  'thematic',
  'hybrid',
  'exact_channel',
  'not_applicable',
]);
const YOUTUBE_SUBSCRIPTION_REFRESH_DEPTHS = new Set(['bounded', 'deep', 'full']);
const YOUTUBE_TAKEOUT_FORMATS = new Set(['json', 'html', 'zip', 'mixed', 'unknown']);
const YOUTUBE_TAKEOUT_STATUSES = new Set(['success', 'partial', 'failed', 'noop']);
const YOUTUBE_TOPIC_SEED_KINDS = new Set(['history', 'subscription']);
const FUNNEL_COUNT_FIELDS = [
  'returned',
  'live_rejected',
  'shorts_rejected',
  'low_signal',
  'exact_excluded',
  'relation_rejected',
  'quality_rejected',
  'duplicate',
  'persisted',
  'generation_eligible',
  'rail_allocated',
] as const;

function diagnosticOptionalEnum(value: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function diagnosticDay(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function diagnosticErrorCategoryCounts(values: unknown[]): Record<YoutubeDiagnosticErrorCategory, number> {
  const counts: Record<YoutubeDiagnosticErrorCategory, number> = {
    auth: 0,
    deadline: 0,
    network: 0,
    not_found: 0,
    partial: 0,
    provider: 0,
    publication: 0,
    quota: 0,
    validation: 0,
    unknown: 0,
  };
  for (const value of values) {
    const category = youtubeDiagnosticErrorCategory(value);
    if (category) counts[category] += 1;
  }
  return counts;
}

function youtubeV2TakeoutDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  const warnings = Array.isArray(row.warnings) ? row.warnings : [];
  const errors = Array.isArray(row.errors) ? row.errors : [];
  return {
    format: diagnosticEnum(row.format, YOUTUBE_TAKEOUT_FORMATS),
    status: diagnosticEnum(row.status, YOUTUBE_TAKEOUT_STATUSES),
    history_count: diagnosticCount(row.history_count),
    subscription_count: diagnosticCount(row.subscription_count),
    warning_count: warnings.length,
    error_count: errors.length,
    error_categories: diagnosticErrorCategoryCounts(errors),
    imported_at: diagnosticTimestamp(row.imported_at),
  };
}

function youtubeV2DailyTopicSeedDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  return {
    day: diagnosticDay(row.day),
    kind: diagnosticEnum(row.kind, YOUTUBE_TOPIC_SEED_KINDS),
    seed_ref: diagnosticOpaqueRef(row.provenance_ref),
    selected_at: diagnosticTimestamp(row.selected_at),
  };
}

function youtubeV2DailyMoreLikeSeedSetDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  const seeds = Array.isArray(row.seeds) ? row.seeds.map(diagnosticRecord) : [];
  return {
    day: diagnosticDay(row.day),
    seed_count: seeds.length,
    seed_refs: diagnosticOpaqueRefs(seeds.map((seed) => seed.provenance_ref)),
    selected_at: diagnosticTimestamp(row.selected_at),
  };
}

function youtubeV2SubscriptionAcquisitionDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  return {
    stale: diagnosticBoolean(row.stale),
    reason: diagnosticOptionalEnum(row.reason, YOUTUBE_SOURCE_STALE_REASONS),
    skipped: diagnosticOptionalEnum(row.skipped, YOUTUBE_ACQUISITION_SKIPS),
    channels_queried: diagnosticCount(row.channels_queried),
    authoritative_channels: diagnosticCount(row.authoritative_channels),
    authoritative_subscription_count: diagnosticCount(row.authoritative_subscription_count),
    coverage_complete: diagnosticBoolean(row.coverage_complete),
    coverage_remaining: diagnosticCount(row.coverage_remaining),
    unavailable_channels: diagnosticCount(row.unavailable_channels),
    batches: diagnosticCount(row.batches),
    refresh_depth: diagnosticOptionalEnum(row.refresh_depth, YOUTUBE_SUBSCRIPTION_REFRESH_DEPTHS),
    channel_cap: diagnosticCount(row.channel_cap),
    videos_per_channel: diagnosticCount(row.videos_per_channel),
    candidates_acquired: diagnosticCount(row.candidates_acquired),
    candidates_quality_rejected: diagnosticCount(row.candidates_quality_rejected),
    partial: diagnosticBoolean(row.partial),
    error_category: youtubeDiagnosticErrorCategory(row.error),
    acquired_at: diagnosticTimestamp(row.acquired_at),
    at: diagnosticTimestamp(row.at),
  };
}

function youtubeV2HistoryMetadataDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  return {
    attempted: diagnosticCount(row.attempted),
    resolved: diagnosticCount(row.resolved),
    unresolved: diagnosticCount(row.unresolved),
    skipped: diagnosticOptionalEnum(row.skipped, YOUTUBE_ACQUISITION_SKIPS),
    at: diagnosticTimestamp(row.at),
  };
}

function youtubeV2HistoryAcquisitionDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  const queryBudget = diagnosticRecord(row.query_budget);
  const funnels = Array.isArray(row.funnels) ? row.funnels.map(diagnosticRecord) : [];
  const funnelTotals = Object.fromEntries(FUNNEL_COUNT_FIELDS.map((field) => [
    field,
    funnels.reduce((sum, funnel) => sum + diagnosticCount(funnel[field]), 0),
  ]));
  const distinctSeedCount = Array.isArray(row.distinct_seed_refs)
    ? new Set(diagnosticOpaqueRefs(row.distinct_seed_refs)).size
    : 0;
  return {
    skipped: diagnosticOptionalEnum(row.skipped, YOUTUBE_ACQUISITION_SKIPS),
    queries_attempted: diagnosticCount(row.queries_attempted),
    search_calls_attempted: diagnosticCount(row.search_calls_attempted),
    query_budget: {
      more_like: diagnosticCount(queryBudget.more_like),
      beyond: diagnosticCount(queryBudget.beyond),
      total: diagnosticCount(queryBudget.total),
    },
    more_like_queries: diagnosticCount(row.more_like_queries),
    more_like_search_calls: diagnosticCount(row.more_like_search_calls),
    more_like_channel_fallbacks: diagnosticCount(row.more_like_channel_fallbacks),
    beyond_queries: diagnosticCount(row.beyond_queries),
    beyond_unique_candidates: diagnosticCount(row.beyond_unique_candidates),
    more_like_status: diagnosticOptionalEnum(row.more_like_status, YOUTUBE_MORE_LIKE_STATUSES),
    more_like_min_seeds: diagnosticCount(row.more_like_min_seeds),
    more_like_attempted_seeds: diagnosticCount(row.more_like_attempted_seeds),
    more_like_contributing_seeds: diagnosticCount(row.more_like_contributing_seeds),
    more_like_candidate_count: diagnosticCount(row.more_like_candidate_count),
    more_like_target: diagnosticCount(row.more_like_target),
    more_like_target_reached: diagnosticBoolean(row.more_like_target_reached),
    funnel_count: funnels.length,
    funnel_totals: funnelTotals,
    funnel_error_categories: diagnosticErrorCategoryCounts(funnels.map((funnel) => funnel.error)),
    distinct_seed_count: distinctSeedCount,
    query_failures: diagnosticCount(row.query_failures),
    candidates_acquired: diagnosticCount(row.candidates_acquired),
    unique_candidates_acquired: diagnosticCount(row.unique_candidates_acquired),
    low_yield_streak: diagnosticCount(row.low_yield_streak),
    low_yield_stop_after: diagnosticCount(row.low_yield_stop_after),
    low_yield_min_new: diagnosticCount(row.low_yield_min_new),
    stop_reason: diagnosticOptionalEnum(row.stop_reason, YOUTUBE_ACQUISITION_STOP_REASONS),
    wall_limit_ms: diagnosticCount(row.wall_limit_ms),
    duration_ms: diagnosticCount(row.duration_ms),
    acquired_at: diagnosticTimestamp(row.acquired_at),
    expires_at: diagnosticTimestamp(row.expires_at),
  };
}

function youtubeV2MoreLikeDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  const refs = Array.isArray(row.seed_refs)
    ? row.seed_refs
    : row.seed_ref ? [row.seed_ref] : [];
  return {
    status: diagnosticEnum(row.status, YOUTUBE_MORE_LIKE_STATUSES),
    seed_refs: diagnosticOpaqueRefs(refs),
    attempted_seed_count: diagnosticCount(row.attempted_seed_count),
    contributing_seed_count: diagnosticCount(row.contributing_seed_count),
    candidate_count: diagnosticCount(row.candidate_count),
    target: diagnosticCount(row.target),
    target_reached: diagnosticBoolean(row.target_reached),
    at: diagnosticTimestamp(row.at),
  };
}

function youtubeV2LiveAcquisitionDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  return {
    skipped: diagnosticOptionalEnum(row.skipped, YOUTUBE_ACQUISITION_SKIPS),
    channels_probed: diagnosticCount(row.channels_probed),
    query_cap: diagnosticCount(row.query_cap),
    query_failures: diagnosticCount(row.query_failures),
    candidates_acquired: diagnosticCount(row.candidates_acquired),
    acquired_at: diagnosticTimestamp(row.acquired_at),
    expires_at: diagnosticTimestamp(row.expires_at),
  };
}

function youtubeV2SourceStaleDiagnostics(value: unknown): Record<string, unknown> {
  const row = diagnosticRecord(value);
  return {
    stale: diagnosticBoolean(row.stale),
    reason: diagnosticOptionalEnum(row.reason, YOUTUBE_SOURCE_STALE_REASONS),
    error_category: youtubeDiagnosticErrorCategory(row.error),
    at: diagnosticTimestamp(row.at),
    authoritative_subscription_count: diagnosticCount(row.authoritative_subscription_count),
  };
}

function youtubeV2LastErrorDiagnostics(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  const row = diagnosticRecord(value);
  return {
    category: youtubeDiagnosticErrorCategory(value),
    at: diagnosticTimestamp(row.at),
  };
}

export function youtubeV2Diagnostics(): Record<string, unknown> {
  const generation = latestYoutubeV2GenerationRecord();
  const sourceStale = youtubeV2SourceStaleState();
  const ready = generation?.status === 'ready' ? latestYoutubeV2Generation() : null;
  const subscriptions = authoritativeSubscriptions();
  const activeProvenance = listYoutubeV2CandidateProvenance({ limit: V2_PROVENANCE_LIMIT });
  const takeout = latestYoutubeV2TakeoutImport();
  const reserveDepths = Object.fromEntries(V2_RESERVE_RAIL_IDS.map((railId) => (
    [railId, ready?.items.filter((item) => item.rail_id === railId).length ?? 0]
  )));
  const poolQuality = Object.fromEntries(V2_RESERVE_RAIL_IDS.map((railId) => {
    const items = ready?.items.filter((item) => item.rail_id === railId) ?? [];
    return [railId, {
      ...youtubeV2WeightedPoolDiagnostics(items),
      creator_count: new Set(items.map((item) => creatorKey(item))).size,
      seed_count: new Set(items.map((item) => item.provenance_ref)).size,
    }];
  }));
  const watches = householdWatchAnchors();
  const localWatches = watches.filter((watch) => watch.source === 'local' || watch.source === 'mixed');
  const takeoutWatches = watches.filter((watch) => watch.source === 'takeout' || watch.source === 'mixed');
  const affinity = channelAffinityMap(watches);
  const scoreExplanations = (ready?.items ?? []).slice(0, 12).map((item) => ({
    rail_id: item.rail_id,
    item_ref: diagnosticOpaqueRef(item.id),
    provenance: item.provenance,
    ...(item.score_breakdown ?? {}),
  }));
  return {
    mode: youtubeRecommendationsV2Mode(),
    model_version: YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
    status: sourceStale.stale && generation?.status === 'ready' ? 'stale' : generation?.status ?? 'setup',
    setup_required: !generation || generation.status === 'empty',
    generation: generation?.generation ?? null,
    generated_at: generation?.generated_at ?? null,
    candidate_count: generation?.candidate_count ?? 0,
    reserve_depths: reserveDepths,
    pool_quality: poolQuality,
    sampling: {
      policy: YOUTUBE_V2_SERVING_POLICY_VERSION,
      independent_epoch_draws: true,
      without_replacement_scope: 'visible_slate',
      impression_aware: false,
      recent_slate_state: false,
    },
    sources: {
      meaningful_history: watches.length,
      mango_history: localWatches.length,
      takeout_history: takeoutWatches.length,
      mixed_history: watches.filter((watch) => watch.source === 'mixed').length,
      subscriptions: subscriptions.length,
      recommendation_history_policy: 'takeout_and_local_meaningful',
      mango_local_usage: 'taste_cooldown_history_and_coalesced_acquisition',
      channel_affinity_count: affinity.size,
    },
    quality_policy: {
      history_affinity_floor: 0.6,
      history_affinity_ceiling: 1,
      history_strength_at_ceiling: WATCH_PER_VIDEO_STRENGTH_CAP,
      subscription_affinity_floor: 0.75,
      subscription_affinity_ceiling: 1,
      watch_half_life_days: WATCH_HALF_LIFE_DAYS,
      takeout_strength: TAKEOUT_STRENGTH,
      local_watch_strength: TAKEOUT_STRENGTH,
      channel_penalty: { per_event: 0.6, half_life_days: 60, floor: 0.25 },
      relation_factors: {
        direct: 1,
        same_topic: 1,
        deeper_dive: 0.85,
        wildcard: 0.55,
        unknown: 0.35,
      },
      rank_factor: { best: 1, position_49: 0.55, legacy: 0.75 },
      subscription_recency_factors: {
        days_7: 1,
        days_30: 0.9,
        days_90: 0.75,
        days_365: 0.55,
        older_or_unknown: 0.35,
      },
      independent_support_boost: { per_additional_ref: 0.03, cap: 0.12 },
      tiers: { A_min: 0.65, B_min: 0.38, C_min: 0.20 },
      c_candidates_per_rail: YOUTUBE_V2_C_TIER_LIMIT,
    },
    provenance: youtubeV2CandidateProvenanceSummary(),
    expiry_ms: {
      candidate: YOUTUBE_V2_CANDIDATE_TTL_MS,
      live: YOUTUBE_V2_LIVE_TTL_MS,
    },
    caps: {
      reserve_per_rail: YOUTUBE_V2_RESERVE_LIMIT,
      beyond_creator_per_row: 1,
      subscriptions_creator_per_row: 1,
      for_you_creator_per_row: 2,
      for_you_seed_per_row: 2,
      beyond_seed_per_row: 2,
      more_like_seed_per_row: 1,
      more_like_min_seeds: YOUTUBE_V2_MORE_LIKE_MIN_SEEDS,
      more_like_max_seeds: YOUTUBE_V2_MORE_LIKE_MAX_SEEDS,
      more_like_target: YOUTUBE_V2_MORE_LIKE_TARGET,
      more_like_query_size: YOUTUBE_V2_MORE_LIKE_QUERY_SIZE,
      frequently_watched_subpool_target: 2,
    },
    embeddings: youtubeEmbeddingDiagnostics(),
    score_explanations: scoreExplanations,
    daily_topic_seed: youtubeV2DailyTopicSeedDiagnostics(
      getYoutubeState<unknown>('youtube_v2_daily_topic_seed', null),
    ),
    daily_more_like_seed_set: youtubeV2DailyMoreLikeSeedSetDiagnostics(
      getYoutubeState<unknown>('youtube_v2_daily_more_like_seed_set', null),
    ),
    revisions: {
      published_generation: generation?.generation ?? null,
      published_source_ref: diagnosticOpaqueRef(generation?.source_hash),
      subscription_generation_refs: diagnosticOpaqueRefs(
        subscriptions.map((row) => row.source_generation),
      ),
      candidate_generation_refs: diagnosticOpaqueRefs(
        activeProvenance.map((row) => row.source_generation),
      ),
    },
    latest_takeout_import: youtubeV2TakeoutDiagnostics(takeout),
    exact_exclusion_cache: youtubeV2ExactExclusionCacheDiagnostics(),
    subscription_acquisition: youtubeV2SubscriptionAcquisitionDiagnostics(
      getYoutubeState<unknown>('youtube_v2_subscription_acquisition', null),
    ),
    history_metadata: youtubeV2HistoryMetadataDiagnostics(
      getYoutubeState<unknown>('youtube_v2_history_metadata', null),
    ),
    history_acquisition: youtubeV2HistoryAcquisitionDiagnostics(
      getYoutubeState<unknown>('youtube_v2_history_acquisition', null),
    ),
    more_like_status: youtubeV2MoreLikeDiagnostics(
      getYoutubeState<unknown>('youtube_v2_more_like_status', {
        status: reserveDepths.more_like >= YOUTUBE_RAIL_LIMIT ? 'thematic' : 'not_applicable',
      }),
    ),
    live_acquisition: youtubeV2LiveAcquisitionDiagnostics(
      getYoutubeState<unknown>('youtube_v2_live_acquisition', null),
    ),
    phase_results: youtubeDiagnosticPhaseResults(
      getYoutubeState<unknown>('last_phase_results', []),
    ),
    source_stale: youtubeV2SourceStaleDiagnostics(sourceStale),
    last_error: youtubeV2LastErrorDiagnostics(
      getYoutubeState<unknown>('youtube_v2_last_error', null),
    ),
  };
}
