import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  enrichStreamMetadata,
  debridServiceId,
  filterAndRankStreams,
  hasCacheableStream,
  loadFilterConfig,
  mergeFilterConfig,
  parseRuntimeMinutes,
  streamPassesIntegrity,
  type StreamFilterMeta,
  type StreamFilterOverrides,
  type StreamFilterContext,
} from './stream-filters.js';
import {
  enrichStreams,
  expandObligationFloor,
  expandPlayLadder,
  isVerifiedDisplayStep,
  OBLIGATION_FLOOR_STEP,
  selectDisplayStreamCandidates,
} from './play-ladder.js';
import {
  enabledBrowsableRails,
  enabledBrowsableRailsForTab,
  loadRailConfig,
  railSourceSummary,
  type BrowsableRail,
  type CatalogTab,
  type RailConfig,
} from './rails.js';

export type PlayableRail = BrowsableRail | AiCatalogRail;
import {
  allocateVodExploreSession,
  allocateTabRailSessions,
  getOrCreateRailSession,
  getPlayabilityStatus,
  getTitlesPlayabilityBulk,
  listRailPoolMissingDisplay,
  patchRailPoolDisplay,
  pickRailRelatedFromPool,
  prepareVodBrowseReservoirV3,
  persistVodTabDealV3,
  readVodTabDealV3,
  type PlayabilityStatus,
  type RailSessionPoolItem,
  type RailSessionSnapshot,
  enqueuePlayabilityTrigger,
} from './playability/db.js';
import {
  AddonCatalogListSource,
  CompositeListSource,
  type ListSource,
  type ResolvedCatalogSource,
} from './playability/list-source.js';
import { schedulePlayabilityTopUp } from './playability/top-up-scheduler.js';
import { effectivePoolTarget } from './playability/pool-growth.js';
import {
  loadRailCurationOverrides,
  shouldSkipTitleFilter,
} from './playability/rail-overrides.js';
import { normalizeSeriesVerifyId, seriesBareId } from './playability/ids.js';
import { titleKey } from './playability/session-select.js';
import {
  CatalogError,
  couchSafeCatalogMessage,
  isAddonRateLimitMessage,
  isBlockedCatalogMeta,
  isRateLimitedStreamUrl,
} from './catalog-errors.js';
import { classifyPlayError } from './play-error-classify.js';
import { capToPlayBudgetMs, remainingPlayBudgetMs } from './play-deadline.js';
import {
  recordProviderFanout,
  recordResolverContributionSnapshot,
  recordResolverProviderOutcome,
  recordResolveMetric,
  resolveMetricsSnapshot,
  resolverProviderCategory,
  resolverProviderCategoryCounts,
  type ResolverContributionRequestClass,
  type ResolverDebridCategory,
  type ResolverIndexerCategory,
} from './resolve-metrics.js';
import { streamFlightBehaviorKey, streamFlightKey } from './stream-flight.js';
import { resolvePosterFromMeta, metahubPosterUrl, normalizePosterUrl } from './poster.js';
import { emitPlaybackTelemetry } from './playback-telemetry.js';
import { CONTINUE_RAIL_ID } from './progress/config.js';
import { getWatchProgressForTitle, listContinueItems } from './progress/db.js';
import {
  activeViewerProfileId,
  getPersonalizationState,
  LIBRARY_SAVED_RAIL_ID,
  listLatestEpisodeWatchProgress,
  listSavedLibraryItems,
  type SavedLibraryItem,
} from './library/db.js';
import { loadForYouRail } from './recommendations/service.js';
import {
  householdVodDiscoveryExclusions,
  loadStoryGraphRelatedTitles,
  loadVodBrowseAffinitySnapshot,
  type VodBrowseAffinitySnapshot,
} from './recommendations/story-graph-service.js';
import {
  recencyWeight,
  vodBrowseV3Mode,
  weightedDeal,
} from './recommendations/vod-browse-v3.js';
import { vodRecommendationsV2Mode } from './recommendations/v2-mode.js';
import {
  PersonalizationChangedDuringRequestError,
  personalizationScopedCacheKey,
  runPersonalizationCoherentRequest,
  samePersonalizationSnapshot,
  type PersonalizationSnapshot,
  type StagedPersonalizationResult,
} from './personalization-coherence.js';
import { assertExpectedPersonalization } from './personalization-request.js';
import {
  assembleSeriesEpisodes,
  applyEpisodePlayability,
  episodeStreamRoleForId,
  type SeriesEpisodesResponse,
} from './episodes.js';
import { mergeCatalogMetaPieces, type VideoLayer } from './meta-merge.js';
import {
  bonusIndexerProbeIds,
  dedupeStreamsByUrl,
  listEpisodeCrossProbeIds,
  parseSeriesEpisodeId,
  parsedSeasonRole,
  pickBonusStreamsFromCandidates,
  pickMainEpisodeStreams,
  type BonusStreamMatchTier,
  type ParsedSeriesEpisodeId,
} from './bonus-stream-resolve.js';
import {
  isMediaFusionAddon,
  loadMediaFusionManifestUrl,
  MEDIAFUSION_SUPPLEMENT_BUDGET_MS,
  mediaFusionStreamUrl,
  mergeUniqueStreams,
  shouldSkipThinSupplementAfterPrimaryTimeout,
  shouldSupplementThinStreams,
} from './thin-stream-supplement.js';
import { loadAiCatalogRails } from './ai-catalogs/store.js';
import { AiCatalogListSource } from './ai-catalogs/list-source.js';
import type { AiCatalogRail } from './ai-catalogs/types.js';
import {
  channelSubtitle,
  fetchLiveCatalogChannels,
  findLiveAddonManifestUrl,
  finalizeLiveRailListing,
  incompleteLiveCatalogSources,
  loadLiveRailConfig,
  partitionChannelsBySportRails,
  type LiveChannelMeta,
  type LiveRailConfig,
  type LiveSportRail,
} from './live-rails.js';
import {
  verifyLiveChannelCandidates,
  type VerifiedLiveChannel,
  isBlockedLiveChannel,
  resolvePlayableLiveStreamUrl,
} from './live-stream-verify.js';
import {
  readLiveRailsDiskCache,
  readLiveRailsDiskCacheSync,
  writeLiveRailsDiskCache,
  liveRailsDiskCacheFresh,
  liveRailsDiskCacheNonEmpty,
  liveRailsDiskCacheSummary,
  liveRailsBackgroundRefreshDecision,
  readLiveRailsRefreshStatusSync,
  writeLiveRailsRefreshStatus,
} from './live-rails-cache.js';
import { applyLiveAiCatalogRails, liveAiOperatorSummary } from './live/ai-catalog-rails.js';
import {
  readLiveChannelHealthRegistrySync,
  recordLiveChannelHealth,
  queryLiveChannelHealthRecord,
  summarizeLiveChannelHealth,
  type LiveChannelHealthStatus,
} from './live/health.js';
import { canonicalLiveChannelKey } from './live/qualification.js';
import { compareLiveChannelsByQuality } from './live/quality-rank.js';
import { liveSearchValidationDecision } from './live/search-validation-policy.js';
import {
  isArea69ChannelId,
  listArea69TaggedChannels,
  parseArea69StreamId,
  resolveArea69Streams,
} from './live/area69.js';
import { probeLiveUrl } from './mpv.js';
import { isPlaybackActiveForTriggerConsumer } from './playability/trigger-consumer.js';
import {
  liveSearchValidationDiagnostics,
  type LiveSearchEntry,
} from './voice/live-search.js';

const LIVE_TAB_CACHE_TTL_MS = 5 * 60 * 1000;
const LIVE_BACKGROUND_REFRESH_POLL_MS = 60 * 1000;
const LIVE_BACKGROUND_REFRESH_MIN_ATTEMPT_MS = 5 * 60 * 1000;

function liveCatalogCacheTtlMs(config: LiveRailConfig): number {
  const configured = (config.cache_ttl_sec ?? 600) * 1000;
  return Math.max(configured, LIVE_TAB_CACHE_TTL_MS);
}

type TaggedLiveChannel = LiveChannelMeta & {
  source_manifest: string;
  source_addon: string;
  source_label?: string;
  source_catalog_type: string;
  stream_url?: string;
};

export type ResolveStreamOptions = {
  seriesCrossProbeLimit?: number;
  zeroStreamRetryAttempts?: number;
  zeroStreamRetryDelayMs?: number;
  /** user = couch play / detail stream list; background = verify/grow/drift */
  requestClass?: 'user' | 'background';
  /** Absolute POST /play deadline shared by every nested resolve stage. */
  deadlineAtMs?: number;
  /** Join/read existing user work only; never start a new provider fan-out. */
  existingOnly?: boolean;
  /** Trusted launcher/catalog identity retained when optional meta misses its budget. */
  identityHint?: {
    title?: string;
    year?: string | number;
  };
};

function seriesCrossProbeLimit(options?: ResolveStreamOptions): number {
  const raw = options?.seriesCrossProbeLimit;
  if (raw === undefined || !Number.isFinite(raw)) {
    // Default off — clicking an episode must only resolve that episode id.
    return 0;
  }
  return Math.max(0, Math.min(24, Math.floor(raw)));
}

export const SAVED_RAIL_ID = LIBRARY_SAVED_RAIL_ID;

export { CatalogError } from './catalog-errors.js';

type AddonExport = {
  name?: string;
  manifestUrl?: string;
  transportUrl?: string;
  url?: string;
  manifest?: { name?: string };
};

type NormalizedAddonExport = {
  name: string;
  manifestUrl: string;
};

export type CatalogCoreCreateOptions = {
  exportPath?: string;
  purpose?: 'default' | 'playability_vod';
};

type ManifestResource = string | { name?: string; types?: string[] };

export type Manifest = {
  name?: string;
  version?: string;
  resources?: ManifestResource[];
  catalogs?: Array<{ id?: string; type?: string; name?: string }>;
  types?: string[];
};

export type Meta = {
  id: string;
  type: string;
  name?: string;
  year?: number | string;
  poster?: string;
  [key: string]: unknown;
};

export type Stream = {
  url: string;
  title?: string;
  quality?: string;
  source: string;
  [key: string]: unknown;
};

/** Map resolver evidence to fixed health buckets; never retain the evidence itself. */
export function resolverIndexerCategoryForStream(stream: Stream): ResolverIndexerCategory {
  const indexer = typeof stream.indexer === 'string' ? stream.indexer : '';
  const evidence = `${stream.source} ${indexer}`.toLowerCase();
  if (evidence.includes('torrentio')) return 'torrentio';
  if (evidence.includes('mediafusion')) return 'mediafusion';
  if (evidence.includes('comet')) return 'comet';
  return 'other';
}

export function resolverDebridCategoryForStream(stream: Stream): ResolverDebridCategory {
  switch (debridServiceId(stream)) {
    case 'torbox': return 'torbox';
    case 'realdebrid': return 'realdebrid';
    default: return 'other';
  }
}

function recordResolverContributions(
  requestClass: ResolverContributionRequestClass,
  streams: Stream[],
): void {
  recordResolverContributionSnapshot(
    requestClass,
    streams.map((stream) => {
      const enriched = enrichStreamMetadata(stream);
      return {
        indexer: resolverIndexerCategoryForStream(enriched),
        debrid: resolverDebridCategoryForStream(enriched),
      };
    }),
  );
}

export type RailSummary = {
  id: string;
  label: string;
  tab: CatalogTab;
  type: BrowsableRail['type'] | 'ai_catalog';
  content_type: string;
  sources: Array<{ addon: string; catalog: string; weight: number }>;
  /** Seed-only Live AI slots merge into a target rail; they are not empty VOD rails. */
  seed_count?: number;
  merge_target?: string;
};

export type RailItem = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  poster: string;
  year?: number | string;
  description?: string;
  source: string;
  progress?: {
    play_id: string;
    position_sec: number;
    duration_sec: number;
    progress_pct: number;
  };
};

export type RailItemsResponse = {
  rail_id: string;
  label: string;
  items: RailItem[];
  resolve_ms: number;
  skipped: number;
  cached?: boolean;
  playability: {
    displayed: number;
    verified_pool: number;
    pending: number;
    low_water: boolean;
    session_id: string;
  };
};

export type TabRailItemsResponse = {
  tab: CatalogTab;
  rails: RailItemsResponse[];
  resolve_ms: number;
  cached?: boolean;
  stale?: boolean;
};

export type ProfileOwnedTabRailItemsResponse = TabRailItemsResponse & {
  profile_id: string;
  personalization_updated_at: number;
};

export function mergeUserStateRails(
  discoveryRails: RailItemsResponse[],
  continueRail: RailItemsResponse,
  savedRail: RailItemsResponse,
  options: {
    forYouRail?: RailItemsResponse | null;
    exploreRail?: RailItemsResponse | null;
  } = {},
): RailItemsResponse[] {
  const visibleRails = discoveryRails.filter((rail) => rail.items.length > 0);
  const prefix: RailItemsResponse[] = [];
  if (continueRail.items.length > 0) {
    prefix.push(continueRail);
  }
  if (savedRail.items.length > 0) {
    prefix.push(savedRail);
  }
  if (options.forYouRail && options.forYouRail.items.length > 0) {
    prefix.push(options.forYouRail);
  }
  if (options.exploreRail && options.exploreRail.items.length > 0) {
    prefix.push(options.exploreRail);
  }
  return [...prefix, ...visibleRails];
}

export type VodRecommendationTab = 'movies' | 'series';

export class RecommendationTabRevisionFence {
  private readonly revisions: Record<VodRecommendationTab, number> = { movies: 0, series: 0 };

  capture(tab: VodRecommendationTab): number {
    return this.revisions[tab];
  }

  bump(tab: VodRecommendationTab): number {
    this.revisions[tab] += 1;
    return this.revisions[tab];
  }

  isCurrent(tab: VodRecommendationTab, revision: number): boolean {
    return this.revisions[tab] === revision;
  }
}

export function catalogTabLoadPolicy(
  reshuffle: boolean,
  sessionAgeMs: number,
  maxSessionAgeMs: number,
): { rotatePlayabilitySession: boolean; warmMetadata: boolean } {
  return {
    rotatePlayabilitySession: !reshuffle
      && maxSessionAgeMs > 0
      && sessionAgeMs >= maxSessionAgeMs,
    warmMetadata: !reshuffle,
  };
}

export type VodDiscoveryShufflePolicy = {
  forceCuratedReshuffle: boolean;
  stableRatio?: number;
  cachedOnly: boolean;
};

/**
 * X deals a fresh, tab-scoped VOD presentation from already-published pools.
 * A ratio of 1 exhausts titles not shown recently before relaxing to repeats.
 * Provider lookup stays out of the input path; low-water repair remains an
 * asynchronous maintenance concern.
 */
export function vodDiscoveryShufflePolicy(
  tab: CatalogTab,
  reshuffle: boolean,
): VodDiscoveryShufflePolicy {
  const active = reshuffle && (tab === 'movies' || tab === 'series');
  return {
    forceCuratedReshuffle: active,
    ...(active ? { stableRatio: 1 } : {}),
    cachedOnly: active,
  };
}

export function vodUtilityProfileId(
  tab: CatalogTab,
  activeProfileId: string,
  mode = vodRecommendationsV2Mode(),
): string {
  return mode !== 'off' && (tab === 'movies' || tab === 'series')
    ? 'household'
    : activeProfileId;
}

export function vodUtilityHouseholdBlend(
  tab: CatalogTab,
  profileId: string,
  mode = vodRecommendationsV2Mode(),
): boolean {
  return !(
    mode !== 'off'
    && (tab === 'movies' || tab === 'series')
    && profileId === 'household'
  );
}

type Addon = {
  name: string;
  manifestUrl: string;
  manifest: Manifest;
};

export type ResolveNoteKind = 'addon_error' | 'skip' | 'infra' | 'annotation';

export type ResolveNote = {
  kind: ResolveNoteKind;
  message: string;
};

type RawStreamResolution = {
  streams: Stream[];
  notes: ResolveNote[];
  resolveMs: number;
  cached: boolean;
};

function resolveNote(kind: ResolveNoteKind, message: string): ResolveNote {
  return { kind, message };
}

function resolveNoteMessages(notes: ResolveNote[]): string[] {
  return notes.map((note) => note.message);
}

/** Addon fetch failures that should trip infra / rate-limit backoff. */
function isInfraAddonMessage(message: string): boolean {
  if (classifyPlayError(message) === 'rate_limited') return true;
  return /timeout|abort|HTTP 5\d\d|fetch failed|ECONN|socket/i.test(message);
}

type CoreStatus = {
  version: string;
  ready: boolean;
};

const require = createRequire(import.meta.url);
const DEFAULT_EXPORT_PATH = '/etc/mango/stremio-export.json';
const REQUEST_TIMEOUT_MS = Number(process.env.MANGO_CATALOG_REQUEST_TIMEOUT_MS || 20000);
/** Bound before stremio-core shims replace global fetch — addon HTTP must stay native. */
const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);
const META_CACHE_TTL_MS = Number(process.env.MANGO_META_CACHE_TTL_MS || 10 * 60 * 1000);
const META_RATE_LIMIT_BACKOFF_MS = Number(process.env.MANGO_META_RATE_LIMIT_BACKOFF_MS || 5 * 60 * 1000);
const STREAM_CACHE_TTL_MS = Number(process.env.MANGO_STREAM_CACHE_TTL_MS || 10 * 60 * 1000);
const STREAM_NEGATIVE_CACHE_MS = Number(process.env.MANGO_STREAM_NEGATIVE_CACHE_MS || 90 * 1000);
const RAIL_ITEMS_CACHE_TTL_MS = Number(process.env.MANGO_RAIL_ITEMS_CACHE_TTL_MS || 45 * 60 * 1000);
// Age-based backstop for browse-session rotation. The primary daily refresh is the
// nightly post-grow reshuffle (~03:00); this only fires if a grow is skipped so the
// home never goes stale for more than ~a day. Set just above the 24h grow cadence so
// it does NOT double-rotate on top of the nightly reshuffle. 0 disables age-based rotation
// (manual shuffle / restart / play-failure still rotate).
const PLAYABILITY_SESSION_MAX_AGE_MS = Number(
  process.env.MANGO_PLAYABILITY_SESSION_MAX_AGE_MS || 26 * 60 * 60 * 1000,
);
const RAIL_META_CONCURRENCY = Number(process.env.MANGO_RAIL_META_CONCURRENCY || 6);
const RAIL_META_STAGGER_MS = Number(process.env.MANGO_RAIL_META_STAGGER_MS || 0);
const META_WARM_CONCURRENCY = boundedInt(
  process.env.MANGO_META_WARM_CONCURRENCY,
  4,
  1,
  8,
);
const META_WARM_ENABLED = process.env.MANGO_META_WARM_DISABLE !== '1'
  && process.env.NODE_ENV !== 'test';
/** Background verify/grow stream addon budget (default 12s). */
const STREAM_RESOLVE_BUDGET_MS = Number(process.env.MANGO_STREAM_RESOLVE_BUDGET_MS || 12000);
/** Couch automatic-play provider budget — popular titles often need ~18–25s. */
const STREAM_RESOLVE_BUDGET_USER_MS = Number(
  process.env.MANGO_STREAM_RESOLVE_BUDGET_USER_MS || 30000,
);

/** Addon fetch timeout for this resolve class (1A). */
export function streamResolveBudgetMs(requestClass?: 'user' | 'background'): number {
  if (requestClass === 'user') {
    return STREAM_RESOLVE_BUDGET_USER_MS;
  }
  return STREAM_RESOLVE_BUDGET_MS;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

/**
 * Automatic VOD Play can absorb the observed empty -> empty -> success provider
 * sequence inside one B press. The raw loop classifies eligibility so confirmed
 * 429/timeout/5xx/permanent errors are never blindly retried. Grow may override
 * these knobs explicitly; stream-list/live/picker work does not inherit them.
 */
const STREAM_ZERO_RETRY_ATTEMPTS = boundedInt(
  process.env.MANGO_STREAM_ZERO_RETRY_ATTEMPTS,
  2,
  0,
  3,
);
const STREAM_ZERO_RETRY_DELAY_MS = boundedInt(
  process.env.MANGO_STREAM_ZERO_RETRY_DELAY_MS,
  1200,
  0,
  10000,
);
const STREAM_ZERO_RETRY_MIN_FETCH_BUDGET_MS = 500;
const STREAM_LIST_RESOLVE_BUDGET_MS = boundedInt(
  process.env.MANGO_STREAM_LIST_RESOLVE_BUDGET_MS,
  14000,
  1000,
  30000,
);

export type StreamResolvePurpose = 'auto_play' | 'stream_list' | 'live' | 'picker_refresh';

export function streamResolveRetryPolicy(
  type: string,
  purpose: StreamResolvePurpose,
): { attempts: number; delay_ms: number } {
  if (purpose !== 'auto_play' || (type !== 'movie' && type !== 'series')) {
    return { attempts: 0, delay_ms: 0 };
  }
  return {
    attempts: STREAM_ZERO_RETRY_ATTEMPTS,
    delay_ms: STREAM_ZERO_RETRY_DELAY_MS,
  };
}
/** After a stream-addon 429 / rate-limit placeholder, skip re-hitting AIO for this long.
 *  Background verify/grow always respect this. Couch respects a shorter soft window (below). */
const STREAM_RATE_LIMIT_BACKOFF_MS = Number(
  process.env.MANGO_STREAM_RATE_LIMIT_BACKOFF_MS || 90 * 1000,
);
/** Couch soft backoff for confirmed rate-limit only (D3B). Miss still bypasses. */
const STREAM_USER_RATE_LIMIT_BACKOFF_MS = Number(
  process.env.MANGO_STREAM_USER_RATE_LIMIT_BACKOFF_MS || 20 * 1000,
);
/** Couch play never scrapes sibling episodes for title-fallback (Torrentio 429s).
 *  Season-0 bonus still always runs bonusIndexerProbeIds (S0→S{N} same-episode alias). */
const STREAM_SERIES_CROSS_PROBE_LIMIT = boundedInt(
  process.env.MANGO_STREAM_SERIES_CROSS_PROBE_LIMIT,
  0,
  0,
  24,
);
const STREAM_META_CONTEXT_TIMEOUT_MS = boundedInt(
  process.env.MANGO_STREAM_META_CONTEXT_TIMEOUT_MS,
  1200,
  0,
  REQUEST_TIMEOUT_MS,
);

function couchResolveOptions(options: ResolveStreamOptions = {}): ResolveStreamOptions {
  return {
    seriesCrossProbeLimit: STREAM_SERIES_CROSS_PROBE_LIMIT,
    ...options,
  };
}

async function optionalWithBudget<T>(work: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  if (timeoutMs <= 0) {
    return work.catch(() => undefined);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapInBatches<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  betweenBatchesMs = 0,
): Promise<R[]> {
  const results: R[] = [];
  const limit = Math.max(1, concurrency);
  for (let offset = 0; offset < items.length; offset += limit) {
    const batch = items.slice(offset, offset + limit);
    const batchResults = await Promise.all(
      batch.map((item, index) => mapper(item, offset + index)),
    );
    results.push(...batchResults);
    if (betweenBatchesMs > 0 && offset + limit < items.length) {
      await delay(betweenBatchesMs);
    }
  }
  return results;
}

function normalizeAddons(data: unknown): NormalizedAddonExport[] {
  const root = data as { addons?: AddonExport[] | { addons?: AddonExport[] } };
  const raw = Array.isArray(root?.addons)
    ? root.addons
    : Array.isArray(root?.addons?.addons)
      ? root.addons.addons
      : [];

  return raw
    .map((addon) => {
      const manifest = typeof addon.manifest === 'object' && addon.manifest !== null ? addon.manifest : {};
      const manifestUrl = addon.manifestUrl || addon.transportUrl || addon.url;
      if (!manifestUrl) return null;
      const name = addon.name || manifest.name || new URL(manifestUrl).hostname;
      return { name: String(name), manifestUrl: String(manifestUrl) };
    })
    .filter((addon): addon is NormalizedAddonExport => addon !== null);
}

function liveAddonNames(config: LiveRailConfig | null): Set<string> {
  const names = new Set<string>();
  if (!config) {
    return names;
  }
  for (const source of config.sources) {
    names.add(normalizeAddonName(source.addon));
  }
  return names;
}

function looksLikeLiveAddon(addon: NormalizedAddonExport, liveNames: ReadonlySet<string>): boolean {
  const normalized = normalizeAddonName(addon.name);
  if (liveNames.has(normalized)) {
    return true;
  }
  if (/^mango live\b|nexotv|iptv/i.test(addon.name)) {
    return true;
  }
  try {
    const url = new URL(addon.manifestUrl);
    const port = Number(url.port);
    if (Number.isInteger(port) && port >= 7000 && port <= 7009) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function filterVodAddonExports(
  addons: NormalizedAddonExport[],
  liveConfig: LiveRailConfig | null,
): NormalizedAddonExport[] {
  const liveNames = liveAddonNames(liveConfig);
  return addons.filter((addon) => !looksLikeLiveAddon(addon, liveNames));
}

function manifestLoadError(addon: NormalizedAddonExport, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`manifest boot failed for ${addon.name}: ${message}`);
}

function isPlayabilityVodCriticalAddon(addonName: string): boolean {
  const normalized = normalizeAddonName(addonName);
  return normalized === 'cinemeta'
    || normalized === 'aiostreams'
    || normalized === 'aiometadata';
}

async function fetchJson(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await nativeFetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const rawBody = await response.text();
    if (!response.ok) {
      let detail = rawBody.trim().slice(0, 200);
      try {
        const parsed = JSON.parse(rawBody) as { error?: unknown; message?: unknown };
        if (typeof parsed.error === 'string') detail = parsed.error;
        else if (typeof parsed.message === 'string') detail = parsed.message;
      } catch {
        // keep text snippet
      }
      const message = detail || `HTTP ${response.status}`;
      if (response.status === 429 || isAddonRateLimitMessage(message)) {
        throw new CatalogError(503, message, undefined, {
          couchMessage: couchSafeCatalogMessage(message),
        });
      }
      throw new Error(message);
    }
    return rawBody ? JSON.parse(rawBody) as unknown : {};
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function supportsResource(manifest: Manifest, resourceName: string, type: string): boolean {
  const resources = manifest.resources || [];
  if (resources.length === 0) return false;

  return resources.some((resource) => {
    if (typeof resource === 'string') {
      return resource === resourceName;
    }
    if (resource.name !== resourceName) {
      return false;
    }
    return !Array.isArray(resource.types) || resource.types.length === 0 || resource.types.includes(type);
  });
}

/** Strip a trailing Stremio `.json` suffix so resourceUrl never builds `id.json.json`. */
export function normalizeResourceId(id: string): string {
  return id.replace(/\.json$/i, '');
}

function resourceUrl(addon: Addon, resource: string, type: string, id: string): string {
  const encodedType = encodeURIComponent(type);
  const encodedId = encodeURIComponent(normalizeResourceId(id));
  const url = new URL(addon.manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/${resource}/${encodedType}/${encodedId}.json`;
  url.hash = '';
  return url.toString();
}

/** Cinemeta exposes search via catalog/top/search= — not the Stremio search resource. */
function catalogSearchUrl(addon: Addon, type: string, query: string): string {
  const encodedType = encodeURIComponent(type);
  const encodedQuery = encodeURIComponent(query);
  const url = new URL(addon.manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/catalog/${encodedType}/top/search=${encodedQuery}.json`;
  url.hash = '';
  return url.toString();
}

function normalizeAddonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\|\s*/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaYear(meta: Meta): number | string | undefined {
  if (meta.year !== undefined) return meta.year;
  const released = typeof meta.released === 'string' ? meta.released : '';
  const releaseInfo = typeof meta.releaseInfo === 'string' ? meta.releaseInfo : '';
  const match = `${released} ${releaseInfo}`.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}

function identityYear(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const match = String(value).match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function metaCountry(meta: Meta): string | undefined {
  for (const value of [meta.country, meta.countries, meta.originCountry]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const countries = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
      if (countries.length > 0) return countries.join(', ');
    }
  }
  return undefined;
}

function metaEpisodeTitle(meta: Meta, episodeId: string): string | undefined {
  if (!Array.isArray(meta.videos)) return undefined;
  const episode = meta.videos.find((candidate) => (
    candidate && typeof candidate === 'object'
    && (candidate as { id?: unknown }).id === episodeId
  )) as { title?: unknown; name?: unknown } | undefined;
  for (const value of [episode?.title, episode?.name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function installCoreNodeShims(): void {
  const realFetch = globalThis.fetch;
  const globals = globalThis as Record<string, unknown>;
  globals.self = globalThis;
  globals.document = { baseURI: 'file:///' };
  globals.navigator ??= { language: 'en-US' };
  globals.WorkerGlobalScope ??= Object;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('http://127.0.0.1:11470/')) {
      const path = new URL(url).pathname;
      const body = path === '/device-info'
        ? { os: 'linux', arch: process.arch, shell: 'mango-catalog-service' }
        : path === '/network-info'
          ? { available: true }
          : path === '/casting'
            ? { devices: [] }
            : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  };

  const store = new Map<string, string>();
  globals.get_location_hash = async () => '';
  globals.local_storage_get_item = async (key: string) => store.get(key) ?? null;
  globals.local_storage_set_item = async (key: string, value: string) => {
    store.set(key, value);
    return null;
  };
  globals.local_storage_remove_item = async (key: string) => {
    store.delete(key);
    return null;
  };
}

async function bootStremioCore(): Promise<CoreStatus> {
  installCoreNodeShims();
  const packageJsonPath = require.resolve('@stremio/stremio-core-web/package.json');
  const wasmPath = require.resolve('@stremio/stremio-core-web/stremio_core_web_bg.wasm');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };
  const core = require('@stremio/stremio-core-web') as {
    default: (arg: { module_or_path: Buffer }) => Promise<unknown>;
    initialize_runtime: (emit: (event: unknown) => void) => Promise<unknown>;
  };

  await core.default({ module_or_path: await readFile(wasmPath) });
  await core.initialize_runtime(() => undefined);
  return { version: packageJson.version, ready: true };
}

export type StreamErrorPlaceholderCategory =
  | 'rate_limited'
  | 'cancelled'
  | 'garbage'
  | 'permanent'
  | 'transient'
  | 'no_stream'
  | 'unknown';

const STREAM_ERROR_MARKER_RE =
  /\[❌\]|\[x\]|search failed|stream not found|no streams|error:|being downloaded|downloading to debrid|download pending|rate\s*limit/i;
const STREAM_ERROR_TRANSIENT_RE =
  /timeout|timed out|fetch failed|ECONN|ENOTFOUND|socket|HTTP 5\d\d|temporar(?:y|ily)|upstream|being downloaded|downloading to debrid|download pending|preparing|queued/i;
const STREAM_ERROR_PERMANENT_RE =
  /unauthori[sz]ed|forbidden|invalid\s+(?:api\s*)?(?:key|token|credential)|missing\s+(?:api\s*)?(?:key|token|credential)|not configured|configuration (?:error|invalid)|account (?:required|disabled|expired)|subscription (?:required|expired)/i;

function streamErrorEvidence(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const record = value as Record<string, unknown>;
  return ['title', 'name', 'description', 'url', 'externalUrl']
    .map((key) => typeof record[key] === 'string' ? record[key] : '')
    .join(' ');
}

/** Classify error-placeholder evidence without retaining or returning its text. */
export function streamErrorPlaceholderCategory(
  value: unknown | unknown[],
): StreamErrorPlaceholderCategory | null {
  const values = Array.isArray(value) ? value : [value];
  const text = values.map(streamErrorEvidence).join(' ');
  if (!STREAM_ERROR_MARKER_RE.test(text)) return null;
  const base = classifyPlayError(text);
  if (base === 'rate_limited') return 'rate_limited';
  if (base === 'cancelled') return 'cancelled';
  if (base === 'garbage') return 'garbage';
  // Permanent provider/account drift must outrank generic network words in a
  // verbose diagnostic, otherwise the same invalid request would be repeated.
  if (STREAM_ERROR_PERMANENT_RE.test(text)) return 'permanent';
  // Check explicit transient evidence before no_stream so a combined
  // "fetch failed: no streams" diagnostic remains a provider failure.
  if (STREAM_ERROR_TRANSIENT_RE.test(text) || base === 'transient') return 'transient';
  if (base === 'no_stream') return 'no_stream';
  return 'unknown';
}

function safeErrorPlaceholder(
  category: StreamErrorPlaceholderCategory,
  source: string,
): Stream {
  const description = category === 'rate_limited'
    ? 'rate limit exceeded'
    : category === 'cancelled'
      ? 'play cancelled'
      : category === 'garbage'
        ? 'debrid_status_clip'
        : category === 'transient'
          ? 'upstream fetch failed'
          : category === 'no_stream'
            ? 'no streams found'
            : category === 'permanent'
              ? 'provider configuration unavailable'
              : 'provider error';
  const marker = category === 'rate_limited' ? 'rate-limit-exceeded' : category;
  return {
    url: `https://example.invalid/mango-stream-error/${marker}`,
    title: '[❌] Stream provider',
    name: '[❌] Stream provider',
    description,
    source,
  };
}

export function normalizeStream(stream: unknown, source: string): Stream | null {
  if (typeof stream !== 'object' || stream === null) return null;
  const raw = stream as Record<string, unknown>;
  const errorCategory = streamErrorPlaceholderCategory(raw);
  if (errorCategory) return safeErrorPlaceholder(errorCategory, source);
  const url = typeof raw.url === 'string' ? raw.url : typeof raw.externalUrl === 'string' ? raw.externalUrl : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return enrichStreamMetadata({
    ...raw,
    url,
    title: typeof raw.title === 'string' ? raw.title : typeof raw.name === 'string' ? raw.name : undefined,
    quality: typeof raw.quality === 'string' ? raw.quality : undefined,
    source,
  });
}

function emptyStreamFilterMeta(config: ReturnType<typeof mergeFilterConfig>): StreamFilterMeta {
  return {
    applied: config,
    total: 0,
    kept: 0,
    play_ladder_step: 'preview',
    play_ladder_preview: true,
    stages: { raw: 0, integrity_safe: 0, main: 0, last_resort: 0, obligation_floor: 0 },
    excluded: {
      uncached_debrid: 0,
      unknown_cache_debrid: 0,
      above_max_quality: 0,
      remux: 0,
      error_stream: 0,
      title_mismatch: 0,
      series_pack_for_movie: 0,
      language_mismatch: 0,
    },
  };
}

export function displayStreamTelemetry(
  streams: Stream[],
  config: ReturnType<typeof mergeFilterConfig>,
  context: StreamFilterContext,
): Pick<StreamFilterMeta, 'excluded' | 'stages'> {
  const diagnostic = filterAndRankStreams(streams, config, context, {
    hard_language: config.hard_language,
    preferred_language: config.preferred_language,
    min_quality: config.request_overrides.min_quality,
  });
  const ladderOptions = {
    strict_unknown_cache: config.strict_unknown_cache,
    preferred_quality: config.preferred_quality,
    preferred_hdr_tags: config.preferred_hdr_tags,
    preferred_video_codecs: config.preferred_video_codecs,
    hard_language: config.hard_language,
    preferred_language: config.preferred_language,
    min_quality: config.request_overrides.min_quality,
    max_quality: config.request_overrides.max_quality,
    exclude_remux: config.request_overrides.exclude_remux,
    include_uncached: config.include_uncached,
    max_candidates: Math.max(1, streams.length),
  };
  const main = expandPlayLadder(streams, config.main_ladder, context, ladderOptions);
  const lastResort = expandPlayLadder(streams, config.last_resort_ladder, context, ladderOptions);
  const floor = expandObligationFloor(streams, context, {
    maxCandidates: Math.max(1, streams.length),
    hard_language: config.hard_language,
    preferred_language: config.preferred_language,
    min_quality: config.request_overrides.min_quality,
    max_quality: config.request_overrides.max_quality,
    exclude_remux: config.request_overrides.exclude_remux,
  });
  return {
    excluded: diagnostic.meta.excluded,
    stages: {
      raw: streams.length,
      integrity_safe: streams.filter((stream) => streamPassesIntegrity(stream, context)).length,
      main: main.length,
      last_resort: lastResort.length,
      obligation_floor: floor.length,
    },
  };
}

function streamResolveInfoOnly(error: string): boolean {
  return /^zero streams after \d+ attempts?$/i.test(error.trim());
}

const LEGACY_STREAM_RESOLVE_INFRA_RE =
  /rate[-\s]*limit|too many requests|HTTP\s*429|\b429\b[^\n]{0,40}(?:too many|rate|request|limit)|(?:too many|rate[-\s]*limit)[^\n]{0,40}\b429\b|timeout|abort|HTTP 5\d\d|fetch failed|ECONN|socket|public-rate-limit|rate-limit-exceeded/i;

/**
 * True when resolve notes indicate addon/infra failure (rate-limit, 5xx, timeout)
 * rather than clean title exhaustion. Accepts legacy string[] for transition/tests.
 * Used for couch "timed out / unavailable" errors — NOT for rate-limit backoff (2A).
 */
export function hasStreamResolveInfrastructureErrors(
  notes: ResolveNote[] | string[],
): boolean {
  if (notes.length === 0) return false;
  if (typeof notes[0] === 'string') {
    return (notes as string[]).some((error) => {
      if (streamResolveInfoOnly(error)) return false;
      return LEGACY_STREAM_RESOLVE_INFRA_RE.test(error);
    });
  }
  return (notes as ResolveNote[]).some((note) => {
    if (note.kind === 'infra') return true;
    if (note.kind === 'addon_error' && isInfraAddonMessage(note.message)) return true;
    return false;
  });
}

/**
 * Confirmed rate-limit only — timeouts/5xx must not trip busy soft-backoff (2A).
 */
export function hasStreamResolveRateLimitErrors(
  notes: ResolveNote[] | string[],
): boolean {
  if (notes.length === 0) return false;
  if (typeof notes[0] === 'string') {
    return (notes as string[]).some((error) => classifyPlayError(error) === 'rate_limited');
  }
  return (notes as ResolveNote[]).some((note) => {
    if (note.kind !== 'infra' && note.kind !== 'addon_error') {
      return false;
    }
    return classifyPlayError(note.message) === 'rate_limited';
  });
}

function streamResolveCouchMessage(notes: ResolveNote[]): string {
  return couchSafeCatalogMessage(resolveNoteMessages(notes).join('; ') || 'stream resolve failed');
}

export function streamsAreOnlyErrorPlaceholders(streams: Stream[]): boolean {
  return streams.length > 0 && !hasCacheableStream(streams);
}

export type StreamResolveRetryReason = 'clean_empty' | 'transient_placeholder';

/**
 * Only provider results that can plausibly be a temporary aggregate miss are
 * eligible for a confirmation pass. Transport/HTTP failures arrive as notes
 * and are deliberately terminal here; their caller-facing classification is
 * already more useful than another immediate request.
 */
export function streamResolveRetryReason(
  streams: Stream[],
  notes: ResolveNote[],
): StreamResolveRetryReason | null {
  if (notes.length > 0) return null;
  if (streams.length === 0) return 'clean_empty';
  if (!streamsAreOnlyErrorPlaceholders(streams)) return null;

  return streamErrorPlaceholderCategory(streams) === 'transient'
    ? 'transient_placeholder'
    : null;
}

export function hasStreamResolveRetryBudget(
  deadlineAtMs: number | undefined,
  retryDelayMs: number,
  nowMs = Date.now(),
): boolean {
  if (deadlineAtMs === undefined) return true;
  return deadlineAtMs - nowMs > retryDelayMs + STREAM_ZERO_RETRY_MIN_FETCH_BUDGET_MS;
}

export function errorPlaceholderCouchMessage(streams: Stream[]): string {
  const category = streamErrorPlaceholderCategory(streams);
  if (category === 'rate_limited') return couchSafeCatalogMessage('HTTP 429');
  if (category === 'no_stream') return 'no streams found for this title';
  // Error rows are evidence that one or more configured providers failed, not
  // proof that this exact title has no releases. Keep raw diagnostics private
  // while giving the viewer an honest transient-state message.
  return couchSafeCatalogMessage('stream provider unavailable');
}

export class CatalogCore {
  private readonly metaCache = new Map<string, { meta?: Meta; expiresAt: number; blocked?: boolean }>();
  private readonly streamCache = new Map<string, {
    streams: Stream[];
    notes: ResolveNote[];
    resolveMs: number;
    expiresAt: number;
  }>();
  /**
   * Short TTL after empty / error-only stream resolves — dampens tap-to-retry storms.
   * Value is expiry ms; reason distinguishes miss vs rate-limit for couch messaging.
   */
  private readonly streamNegativeCache = new Map<string, {
    until: number;
    userUntil: number;
    reason: 'miss' | 'rate_limited';
  }>();
  /**
   * Single-flight guard: coalesces concurrent identical stream resolves (same
   * type:id) into one in-flight AIO fan-out. Without this, overlapping callers
   * (detail /stream + /play, play → drift-verify → inline-reverify, rapid
   * episode taps, grow + couch on the same title) each miss the not-yet-written
   * cache and independently hit Torrentio, producing request bursts.
   */
  private readonly streamInFlight = new Map<string, {
    baseKey: string;
    behaviorKey: string;
    requestClass: 'user' | 'background';
    promise: Promise<RawStreamResolution>;
  }>();
  /** Prevent invalidated in-flight resolves from repopulating stale cache state. */
  private readonly streamInvalidationGeneration = new Map<string, number>();
  private readonly railItemsCache = new Map<string, {
    payload: RailItemsResponse;
    expiresAt: number;
  }>();
  private readonly tabRailItemsCache = new Map<string, {
    tab: CatalogTab;
    profileId: string;
    personalizationUpdatedAt: number;
    payload: TabRailItemsResponse;
    expiresAt: number;
  }>();
  private readonly recommendationRevisionFence = new RecommendationTabRevisionFence();
  private readonly vodBrowseAffinityCache = new Map<VodRecommendationTab, VodBrowseAffinitySnapshot>();
  private readonly vodBrowseShadowBuilds = new Map<VodRecommendationTab, Promise<void>>();
  private liveTabRailItemsCache: {
    payload: TabRailItemsResponse;
    expiresAt: number;
  } | null = null;
  private liveTabRailItemsInFlight: Promise<TabRailItemsResponse> | null = null;
  private liveBackgroundRefreshStarted = false;
  private liveLastRebuildError: string | null = null;
  private liveChannelCatalogCache: {
    channels: TaggedLiveChannel[];
    sourceCounts: Record<string, number>;
    failedSources: string[];
    expiresAt: number;
  } | null = null;
  private liveCatalogSourceStatus: {
    source_counts: Record<string, number>;
    failed_sources: string[];
    checked_at: number;
  } | null = null;
  private playabilitySessionId = process.env.MANGO_PLAYABILITY_SESSION_ID || randomUUID();
  private playabilitySessionStartedAt = Date.now();
  private aiCatalogRails: AiCatalogRail[] = [];

  private constructor(
    private readonly coreStatus: CoreStatus,
    private readonly addons: Addon[],
    private readonly filterConfig: Awaited<ReturnType<typeof loadFilterConfig>>,
    private readonly railConfig: RailConfig | null,
    private readonly railConfigError: Error | null,
    private readonly liveRailConfig: LiveRailConfig | null,
    private readonly liveRailConfigError: Error | null,
    private readonly addonExports: NormalizedAddonExport[],
  ) {}

  static async create(
    exportPathOrOptions: string | CatalogCoreCreateOptions = process.env.MANGO_STREMIO_EXPORT || DEFAULT_EXPORT_PATH,
  ): Promise<CatalogCore> {
    const options: CatalogCoreCreateOptions = typeof exportPathOrOptions === 'string'
      ? { exportPath: exportPathOrOptions }
      : exportPathOrOptions;
    const exportPath = options.exportPath || process.env.MANGO_STREMIO_EXPORT || DEFAULT_EXPORT_PATH;
    const purpose = options.purpose || (
      process.env.MANGO_CATALOG_PURPOSE === 'playability_vod'
      || process.env.MANGO_PLAYABILITY_VOD_ONLY === '1'
        ? 'playability_vod'
        : 'default'
    );
    const [coreStatus, exportData, filterConfig, railConfigResult, liveRailConfigResult, aiCatalogRails] = await Promise.all([
      bootStremioCore(),
      readFile(exportPath, 'utf8').then((raw) => JSON.parse(raw) as unknown),
      loadFilterConfig(),
      loadRailConfig()
        .then((config) => ({ config, error: null }))
        .catch((error: unknown) => ({
          config: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })),
      loadLiveRailConfig()
        .then((config) => ({ config, error: null }))
        .catch((error: unknown) => ({
          config: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })),
      loadAiCatalogRails().catch((error: unknown) => {
        console.warn(
          `ai catalogs load failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }),
    ]);
    const exported = purpose === 'playability_vod'
      ? filterVodAddonExports(normalizeAddons(exportData), liveRailConfigResult.config)
      : normalizeAddons(exportData);
    if (exported.length === 0) {
      throw new CatalogError(500, `${exportPath} has no addon manifest URLs`);
    }

    const addons: Addon[] = [];
    const manifestFailures: string[] = [];
    for (const addon of exported) {
      try {
        const manifest = await fetchJson(addon.manifestUrl) as Manifest;
        addons.push({
          name: manifest.name || addon.name,
          manifestUrl: addon.manifestUrl,
          manifest,
        });
      } catch (error) {
        const wrapped = manifestLoadError(addon, error);
        if (purpose === 'playability_vod' && isPlayabilityVodCriticalAddon(addon.name)) {
          throw wrapped;
        }
        manifestFailures.push(wrapped.message);
        console.warn(`catalog-service warning: ${wrapped.message}`);
      }
    }
    if (addons.length === 0) {
      const suffix = manifestFailures.length > 0
        ? `; manifest failures: ${manifestFailures.join(' | ')}`
        : '';
      throw new CatalogError(500, `${exportPath} loaded zero addon manifests${suffix}`);
    }
    return new CatalogCore(
      coreStatus,
      addons,
      filterConfig,
      railConfigResult.config,
      railConfigResult.error,
      liveRailConfigResult.config,
      liveRailConfigResult.error,
      exported,
    ).withAiCatalogRails(aiCatalogRails);
  }

  private withAiCatalogRails(rails: AiCatalogRail[]): this {
    this.aiCatalogRails = rails;
    return this;
  }

  async reloadAiCatalogRails(): Promise<void> {
    this.aiCatalogRails = await loadAiCatalogRails().catch((error: unknown) => {
      console.warn(
        `ai catalogs reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    });
    this.clearRailItemsCache();
  }

  invalidateLiveTabRailCache(): void {
    this.liveTabRailItemsCache = null;
  }

  /** Poll cheap cache metadata; rebuild stale Live rails off-couch at a bounded cadence. */
  startLiveRailsBackgroundRefresh(): void {
    if (this.liveBackgroundRefreshStarted) return;
    this.liveBackgroundRefreshStarted = true;
    const pollMs = Math.max(
      10_000,
      Number(process.env.MANGO_LIVE_BACKGROUND_REFRESH_POLL_MS || LIVE_BACKGROUND_REFRESH_POLL_MS),
    );
    const tick = (): void => {
      void this.refreshLiveRailsInBackground().catch((error) => {
        console.warn(`live rails background refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    };
    const initial = setTimeout(tick, 2_000);
    initial.unref();
    const timer = setInterval(tick, Number.isFinite(pollMs) ? pollMs : LIVE_BACKGROUND_REFRESH_POLL_MS);
    timer.unref();
  }

  private async refreshLiveRailsInBackground(): Promise<void> {
    const now = Date.now();
    const diskCache = readLiveRailsDiskCacheSync();
    const memoryFresh = (this.liveTabRailItemsCache?.expiresAt ?? 0) > now;
    const status = readLiveRailsRefreshStatusSync();
    const minAttemptIntervalMs = Math.max(
      30_000,
      Number(
        process.env.MANGO_LIVE_BACKGROUND_REFRESH_MIN_ATTEMPT_MS
        || LIVE_BACKGROUND_REFRESH_MIN_ATTEMPT_MS,
      ),
    );
    const decision = liveRailsBackgroundRefreshDecision({
      configReady: this.liveRailConfigError === null && this.liveRailConfig !== null,
      cacheFresh: memoryFresh || liveRailsDiskCacheFresh(diskCache),
      playbackActive: isPlaybackActiveForTriggerConsumer(),
      inFlight: this.liveTabRailItemsInFlight !== null,
      lastAttemptAt: status.last_attempt_at,
      now,
      minAttemptIntervalMs: Number.isFinite(minAttemptIntervalMs)
        ? minAttemptIntervalMs
        : LIVE_BACKGROUND_REFRESH_MIN_ATTEMPT_MS,
    });
    if (!decision.refresh) return;
    await this.liveTabRailItems();
  }

  /** Clear one title's positive/negative stream state and stale flight handles. */
  invalidateStreams(type: string, id: string): { positive: number; negative: number; flights: number } {
    const normalized = normalizeSeriesVerifyId(type, id);
    const keys = new Set([`${type}:${id}`, `${type}:${normalized}`]);
    let positive = 0;
    let negative = 0;
    let flights = 0;
    for (const key of keys) {
      this.streamInvalidationGeneration.set(
        key,
        (this.streamInvalidationGeneration.get(key) ?? 0) + 1,
      );
      if (this.streamCache.delete(key)) positive += 1;
      if (this.streamNegativeCache.delete(key)) negative += 1;
    }
    for (const [flightKey, flight] of this.streamInFlight) {
      if (keys.has(flight.baseKey)) {
        this.streamInFlight.delete(flightKey);
        flights += 1;
      }
    }
    const result = { positive, negative, flights };
    emitPlaybackTelemetry('stream_cache_invalidate', {
      content_type: type,
      positive_entries: positive,
      negative_entries: negative,
      flight_entries: flights,
    });
    return result;
  }

  /** AI live rails are slot-driven — merge on every response so cache hits stay current. */
  private async withLiveAiCatalogRails(
    payload: TabRailItemsResponse,
    extra: { cached?: boolean; stale?: boolean } = {},
  ): Promise<TabRailItemsResponse> {
    const merged = await applyLiveAiCatalogRails(payload);
    return { ...merged, ...extra };
  }

  health(): Record<string, unknown> {
    const liveDiskCache = readLiveRailsDiskCacheSync();
    const liveCache = liveRailsDiskCacheSummary(liveDiskCache);
    const liveRefresh = readLiveRailsRefreshStatusSync();
    const liveConfigReady = this.liveRailConfigError === null && this.liveRailConfig !== null;
    const liveCacheFresh = liveCache.fresh || (this.liveTabRailItemsCache?.expiresAt ?? 0) > Date.now();
    const liveMemoryCacheNonEmpty = Boolean(
      this.liveTabRailItemsCache?.payload.rails.some((rail) => rail.items.length > 0),
    );
    const liveStaleFallbackAvailable = liveCache.non_empty || liveMemoryCacheNonEmpty;
    const liveServingStale = liveConfigReady && !liveCacheFresh && liveStaleFallbackAvailable;
    const liveHealth = summarizeLiveChannelHealth(
      readLiveChannelHealthRegistrySync(),
      this.liveSearchFreshnessHorizonMs(),
    );
    const qualified = Object.values(liveCache.rail_counts)
      .reduce((count, items) => count + items, 0);
    return {
      ok: true,
      core: this.coreStatus.ready ? 'ready' : 'not_ready',
      core_version: this.coreStatus.version,
      addons: this.addons.length,
      addon_names: this.addons.map((addon) => addon.name),
      configured_stream_providers: resolverProviderCategoryCounts(
        this.addons
          .filter((addon) => ['movie', 'series', 'tv'].some(
            (type) => supportsResource(addon.manifest, 'stream', type),
          ))
          .map((addon) => addon.name),
      ),
      resolver: resolveMetricsSnapshot(),
      rails: this.railConfig ? enabledBrowsableRails(this.railConfig).length + this.aiCatalogRails.length : this.aiCatalogRails.length,
      ai_catalogs: this.aiCatalogRails.length,
      rails_ready: this.railConfigError === null,
      live_rails: this.liveRailConfig ? this.liveRailConfig.rails.length : 0,
      live_ready: liveConfigReady,
      live: {
        ready: liveConfigReady,
        config_ready: liveConfigReady,
        cache_fresh: liveCacheFresh,
        serving_stale: liveServingStale,
        config_error: this.liveRailConfigError?.message ?? null,
        sources: this.liveRailConfig?.sources.map((source) => ({
          addon: source.addon,
          catalog: source.catalog,
          pages: source.pages,
        })) ?? [],
        source_status: this.liveCatalogSourceStatus ?? {
          source_counts: {},
          failed_sources: [],
          checked_at: null,
        },
        cache: liveCache,
        search_health: {
          qualified,
          ...liveHealth,
          ...liveSearchValidationDiagnostics(),
        },
        stale_fallback_available: liveStaleFallbackAvailable,
        last_rebuild_attempt_at: liveRefresh.last_attempt_at,
        last_rebuild_success_at: liveRefresh.last_success_at,
        last_rebuild_error: liveRefresh.last_error ?? this.liveLastRebuildError,
      },
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  rails(tab?: CatalogTab): { rails: RailSummary[]; tab?: CatalogTab } {
    if (tab === 'live') {
      const config = this.requireLiveRailConfig();
      return {
        tab: 'live',
        rails: config.rails.map((rail) => ({
          id: rail.id,
          label: rail.label,
          tab: 'live' as const,
          type: 'addon_catalog' as const,
          content_type: config.catalog_type,
          sources: [{ addon: config.addon, catalog: config.catalog, weight: 1 }],
        })),
      };
    }
    const yamlRails = enabledBrowsableRailsForTab(this.requireRailConfig(), tab);
    const aiRails = tab
      ? this.aiCatalogRails.filter((rail) => rail.tab === tab)
      : this.aiCatalogRails;
    const rails = [...aiRails, ...yamlRails];
    return {
      ...(tab ? { tab } : {}),
      rails: rails.map((rail) => ({
        id: rail.id,
        label: rail.label,
        tab: rail.tab,
        type: rail.type,
        content_type: rail.content_type,
        sources: rail.type === 'ai_catalog'
          ? rail.sources
          : railSourceSummary(rail),
        ...(rail.type === 'ai_catalog' && rail.tab === 'live'
          ? liveAiOperatorSummary(rail.id, rail.seed_titles.length)
          : {}),
      })),
    };
  }

  browsableRails(): PlayableRail[] {
    return [...this.aiCatalogRails, ...enabledBrowsableRails(this.requireRailConfig())];
  }

  /**
   * VOD grow probes via TorBox/AIOStreams; live (IPTV) and youtube tabs have their
   * own verify paths and no VOD catalog sources. Excluding them here keeps the
   * nightly grow from aborting on `listSourceForRail` 503 for sourceless ai_catalog
   * rails (e.g. ai-cricket-channels).
   */
  growableRails(): PlayableRail[] {
    return this.browsableRails().filter(
      (rail) => rail.tab !== 'live' && rail.tab !== 'youtube',
    );
  }

  private browsableRailsForTab(tab: CatalogTab): PlayableRail[] {
    const ai = this.aiCatalogRails.filter((rail) => rail.tab === tab);
    return [...ai, ...enabledBrowsableRailsForTab(this.requireRailConfig(), tab)];
  }

  browsableRail(railId: string): PlayableRail {
    const ai = this.aiCatalogRails.find((candidate) => candidate.id === railId);
    if (ai) {
      return ai;
    }
    const rail = enabledBrowsableRails(this.requireRailConfig()).find((candidate) => candidate.id === railId);
    if (!rail) {
      throw new CatalogError(404, `unknown rail: ${railId}`);
    }
    return rail;
  }

  private catalogNameFor(addon: Addon, contentType: string, catalog: string): string | undefined {
    const match = (addon.manifest.catalogs || []).find((candidate) => (
      candidate.id === catalog
      && (!candidate.type || candidate.type === contentType)
    ));
    return typeof match?.name === 'string' && match.name.trim() !== ''
      ? match.name.trim()
      : undefined;
  }

  private resolveCatalogSource(
    railId: string,
    contentType: string,
    source: { addon: string; catalog: string; weight: number },
  ): ResolvedCatalogSource | null {
    const addon = this.maybeFindAddonByName(source.addon);
    if (!addon) {
      console.warn(`rail source skipped rail=${railId} addon=${source.addon}: manifest unavailable`);
      return null;
    }
    const sourceName = this.catalogNameFor(addon, contentType, source.catalog);
    return {
      ...source,
      manifestUrl: addon.manifestUrl,
      sourceLabel: sourceName
        ? `${source.addon}/${source.catalog} · ${sourceName}`
        : `${source.addon}/${source.catalog}`,
      sourceName,
    };
  }

  listSourceForRail(railId: string): ListSource {
    const rail = this.browsableRail(railId);
    if (rail.type === 'ai_catalog') {
      const sources = rail.sources.flatMap((source) => {
        const resolved = this.resolveCatalogSource(rail.id, rail.content_type, source);
        return resolved ? [resolved] : [];
      });
      if (sources.length === 0) {
        throw new CatalogError(503, `rail has no available catalog sources: ${rail.id}`);
      }
      return new AiCatalogListSource({
        sourceId: rail.id,
        contentType: rail.content_type,
        seedTitles: rail.seed_titles,
        sources,
        llmHints: rail.llm_hints,
      });
    }
    if (rail.type === 'addon_catalog') {
      const addon = this.findAddonByName(rail.addon);
      return AddonCatalogListSource.fromRail(rail, addon.manifestUrl);
    }
    const sources = rail.sources.flatMap((source) => {
      const resolved = this.resolveCatalogSource(rail.id, rail.content_type, source);
      return resolved ? [resolved] : [];
    });
    if (sources.length === 0) {
      throw new CatalogError(503, `rail has no available catalog sources: ${rail.id}`);
    }
    return new CompositeListSource(rail.id, rail.content_type, sources);
  }

  async playabilityStatus(): Promise<PlayabilityStatus> {
    const rails = this.browsableRails();
    const railIds = rails.map((rail) => rail.id);
    return getPlayabilityStatus(railIds);
  }

  /** New session id — reshuffle rails from latest verified pool (no indexer). */
  reshufflePlayabilitySession(): string {
    this.playabilitySessionId = randomUUID();
    this.playabilitySessionStartedAt = Date.now();
    this.railItemsCache.clear();
    this.tabRailItemsCache.clear();
    this.liveTabRailItemsCache = null;
    return this.playabilitySessionId;
  }

  currentPlayabilitySessionId(): string {
    return this.playabilitySessionId;
  }

  private clearTabRailItemsCacheForTab(tab: CatalogTab): void {
    for (const [key, entry] of this.tabRailItemsCache) {
      if (entry.tab === tab) this.tabRailItemsCache.delete(key);
    }
  }

  /** Invalidate only one VOD recommendation hand, leaving curated/user rails intact. */
  invalidateRecommendationTab(tab: VodRecommendationTab): void {
    this.recommendationRevisionFence.bump(tab);
    this.vodBrowseAffinityCache.delete(tab);
    this.clearTabRailItemsCacheForTab(tab);
  }

  scheduleVodBrowseReservoirRefresh(tab: VodRecommendationTab): void {
    if (vodBrowseV3Mode() === 'off') return;
    const affinity = loadVodBrowseAffinitySnapshot(tab);
    this.vodBrowseAffinityCache.set(tab, affinity);
    const rails = this.browsableRailsForTab(tab);
    void prepareVodBrowseReservoirV3({
      tab,
      rails: rails.map((rail) => ({
        railId: rail.id,
        displayLimit: Math.min(9, rail.playability.display_limit),
        minDisplay: 6,
        playability: rail.playability,
      })),
      affinityRevision: affinity.revision,
      affinityByKey: affinity.values,
    }).catch((error) => {
      console.warn(`Browse v3 ${tab} reservoir retained last-good: ${
        error instanceof Error ? error.message : String(error)
      }`);
    });
  }

  clearRailItemsCache(railId?: string): void {
    if (railId) {
      this.railItemsCache.delete(railId);
      try {
        const rail = this.browsableRail(railId);
        this.clearTabRailItemsCacheForTab(rail.tab);
      } catch {
        // unknown rail — tab cache left intact
      }
      return;
    }
    this.railItemsCache.clear();
    this.tabRailItemsCache.clear();
    this.liveTabRailItemsCache = null;
    this.liveChannelCatalogCache = null;
  }

  /** Pre-build movies + series tab caches so first couch browse is warm. */
  async warmBrowseTabs(): Promise<void> {
    void this.backfillRailPoolDisplaySnapshots()
      .then((patched) => {
        if (patched > 0) {
          console.log(`catalog-service rail_pool display backfill: ${patched} row(s)`);
        }
      })
      .catch((error) => {
        console.warn(
          `rail_pool display backfill failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    const tabs: CatalogTab[] = ['movies', 'series'];
    await Promise.all(tabs.map(async (tab) => {
      try {
        await this.tabRailItems(tab);
      } catch (error) {
        console.warn(
          `browse warm ${tab} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }));
  }

  /** One-shot meta fetch for legacy pool rows missing title/poster snapshots. */
  async backfillRailPoolDisplaySnapshots(limit = 120): Promise<number> {
    const missing = await listRailPoolMissingDisplay(limit);
    if (missing.length === 0) {
      return 0;
    }

    let updated = 0;
    await mapInBatches(
      missing,
      RAIL_META_CONCURRENCY,
      async (row) => {
        try {
          const meta = await this.metaCached(row.type, row.id);
          if (isBlockedCatalogMeta(meta)) {
            return;
          }
          const title = (typeof meta.name === 'string' && meta.name.trim() !== '' ? meta.name : null)
            || (typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title : null);
          const poster = resolvePosterFromMeta(meta);
          if (!title || !poster) {
            return;
          }
          const year = metaYear(meta);
          await patchRailPoolDisplay(row.rail_id, row.type, row.id, {
            title,
            poster_url: poster,
            year: year != null ? String(year) : null,
          });
          updated += 1;
        } catch {
          // skip rows that fail meta lookup
        }
      },
      RAIL_META_STAGGER_MS,
    );
    return updated;
  }

  private requireLiveRailConfig(): LiveRailConfig {
    if (this.liveRailConfig) {
      return this.liveRailConfig;
    }
    const reason = this.liveRailConfigError?.message || 'catalog-live yaml not loaded';
    throw new CatalogError(503, `live rails unavailable: ${reason}`);
  }

  private livePlayabilityStub(displayed: number): RailItemsResponse['playability'] {
    return {
      displayed,
      verified_pool: displayed,
      pending: 0,
      low_water: false,
      session_id: 'live',
    };
  }

  private liveChannelToRailItem(channel: VerifiedLiveChannel): RailItem {
    const sourceLabel = channel.source_label || channel.source_addon;
    const subtitle = channelSubtitle(channel);
    return {
      id: channel.id,
      type: 'tv',
      title: channel.name,
      subtitle: sourceLabel ? `${sourceLabel} · ${subtitle}` : subtitle,
      poster: channel.poster || '',
      description: channel.description || channel.releaseInfo,
      source: channel.source_addon,
    };
  }

  private async fetchTaggedLiveChannels(
    config: LiveRailConfig,
  ): Promise<TaggedLiveChannel[]> {
    return (await this.fetchTaggedLiveChannelSnapshot(config)).channels;
  }

  private manifestUrlForAddonName(name: string): string {
    const manifestUrl = findLiveAddonManifestUrl(name, [...this.addons, ...this.addonExports]);
    if (manifestUrl) return manifestUrl;
    throw new CatalogError(502, `addon export not found: ${name}`);
  }

  private async fetchTaggedLiveChannelSnapshot(
    config: LiveRailConfig,
  ): Promise<{
    channels: TaggedLiveChannel[];
    sourceCounts: Record<string, number>;
    failedSources: string[];
  }> {
    const ttlMs = liveCatalogCacheTtlMs(config);
    const cached = this.liveChannelCatalogCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const tagged: TaggedLiveChannel[] = [];
    const sourceCounts: Record<string, number> = {};
    const failedSources: string[] = [];
    for (const source of config.sources) {
      try {
        const manifestUrl = this.manifestUrlForAddonName(source.addon);
        const channels = await fetchLiveCatalogChannels(manifestUrl, source, fetchJson);
        if (channels.length === 0) {
          throw new Error('catalog returned zero channels');
        }
        sourceCounts[source.addon] = channels.length;
        for (const channel of channels) {
          tagged.push({
            ...channel,
            source_manifest: manifestUrl,
            source_addon: source.addon,
            source_label: source.label,
            source_catalog_type: source.catalog_type,
          });
        }
      } catch (error) {
        failedSources.push(source.addon);
        console.warn(
          `live catalog source unavailable addon=${source.addon}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const seenIds = new Set(tagged.map((channel) => channel.id));
    for (const channel of await listArea69TaggedChannels()) {
      if (seenIds.has(channel.id)) {
        continue;
      }
      seenIds.add(channel.id);
      tagged.push(channel);
    }
    const snapshot = {
      channels: tagged,
      sourceCounts,
      failedSources,
      // A partial pool remains useful for Search and direct playback, but it
      // must retry quickly and must never become a fresh Home generation.
      expiresAt: Date.now() + (failedSources.length > 0 ? Math.min(ttlMs, 60_000) : ttlMs),
    };
    this.liveChannelCatalogCache = snapshot;
    this.liveCatalogSourceStatus = {
      source_counts: { ...sourceCounts },
      failed_sources: [...failedSources],
      checked_at: Date.now(),
    };
    return snapshot;
  }

  private orderLiveCandidates(
    candidates: TaggedLiveChannel[],
    config: LiveRailConfig,
  ): TaggedLiveChannel[] {
    const order = new Map(config.sources.map((source, index) => [source.addon, index]));
    return [...candidates].sort((left, right) => {
      const leftOrder = order.get(left.source_addon) ?? 99;
      const rightOrder = order.get(right.source_addon) ?? 99;
      return leftOrder - rightOrder;
    });
  }

  private finalizeLiveRailChannels<T extends LiveChannelMeta & {
    source_addon: string;
    source_label?: string;
  }>(
    channels: T[],
    rail: LiveSportRail,
  ): VerifiedLiveChannel[] {
    return finalizeLiveRailListing(channels, rail).map((channel) => ({
      ...channel,
      source_addon: channel.source_addon,
      source_label: channel.source_label,
    }));
  }

  private async verifyRailChannels(
    rail: LiveSportRail,
    candidates: TaggedLiveChannel[],
    config: LiveRailConfig,
  ): Promise<VerifiedLiveChannel[]> {
    const ordered = rail.source_fill?.length
      ? candidates
      : this.orderLiveCandidates(candidates, config);
    if (!config.verify_streams || ordered.length === 0) {
      return this.finalizeLiveRailChannels(ordered, rail);
    }

    const bySource = new Map<string, TaggedLiveChannel[]>();
    for (const channel of ordered) {
      const bucket = bySource.get(channel.source_addon) || [];
      bucket.push(channel);
      bySource.set(channel.source_addon, bucket);
    }

    const verified: VerifiedLiveChannel[] = [];
    for (const source of config.sources) {
      if (verified.length >= rail.limit) {
        break;
      }
      const pool = bySource.get(source.addon) || [];
      if (pool.length === 0) {
        continue;
      }
      const manifestUrl = this.manifestUrlForAddonName(source.addon);
      const next = await verifyLiveChannelCandidates(
        manifestUrl,
        source.catalog_type,
        source.addon,
        source.label,
        pool,
        Math.min(rail.limit - verified.length, config.verify_max_per_rail),
        fetchJson,
        {
          poolMultiplier: config.verify_pool_multiplier,
          delayMs: config.verify_delay_ms,
        },
      );
      verified.push(...next);
    }
    if (verified.length > 0) {
      return this.finalizeLiveRailChannels(verified, rail);
    }
    // NexoTV rate limits stream resolves — still surface free legal channels for browse.
    const freeFallback = ordered
      .filter((channel) => channel.source_label === 'free' && !isBlockedLiveChannel(channel))
      .slice(0, rail.limit)
      .map((channel) => ({
        ...channel,
        source_addon: channel.source_addon,
        source_label: channel.source_label,
      }));
    return freeFallback;
  }

  private async buildLiveRailItemsResponse(
    rail: LiveSportRail,
    channels: VerifiedLiveChannel[],
    started: number,
  ): Promise<RailItemsResponse> {
    const items = channels.map((channel) => this.liveChannelToRailItem(channel));
    return {
      rail_id: rail.id,
      label: rail.label,
      items,
      resolve_ms: Date.now() - started,
      skipped: 0,
      playability: this.livePlayabilityStub(items.length),
    };
  }

  async listLiveChannelsForVoiceSearch(): Promise<LiveChannelMeta[]> {
    if (!this.liveRailConfig) {
      return [];
    }
    try {
      return await this.fetchTaggedLiveChannels(this.liveRailConfig);
    } catch {
      return [];
    }
  }

  /** Search proof uses the existing Live catalog/cache horizon; it owns no TTL default. */
  liveSearchFreshnessHorizonMs(): number {
    return this.liveRailConfig
      ? liveCatalogCacheTtlMs(this.liveRailConfig)
      : LIVE_TAB_CACHE_TTL_MS;
  }

  private async resolveTaggedLiveChannel(
    channel: TaggedLiveChannel,
    timeoutMs: number,
  ): Promise<Stream[]> {
    let streams: Stream[] = [];
    if (isArea69ChannelId(channel.id)) {
      const streamId = parseArea69StreamId(channel.id);
      streams = streamId ? await resolveArea69Streams(streamId) : [];
    } else {
      const url = typeof channel.stream_url === 'string' && channel.stream_url.trim()
        ? channel.stream_url
        : await resolvePlayableLiveStreamUrl(
          channel.source_manifest,
          channel.source_catalog_type,
          channel.id,
          fetchJson,
          timeoutMs,
        );
      if (url) {
        streams = [{
          url,
          title: channel.name || channel.title || channel.id,
          source: channel.source_addon,
        }];
      }
    }
    return streams.map((stream) => ({
      ...stream,
      live_channel_id: channel.id,
      live_channel_source: channel.source_addon,
    }));
  }

  /** Resolve one logical Live item into its quality-ordered canonical variant ladder. */
  async resolveLiveForPlay(
    id: string,
    title: string | undefined,
    deadlineAtMs: number,
  ): Promise<{
    streams: Stream[];
    resolve_ms: number;
    cached: boolean;
    errors?: string[];
  }> {
    const started = Date.now();
    let tagged: TaggedLiveChannel[] = [];
    try {
      tagged = this.liveRailConfig
        ? await this.fetchTaggedLiveChannels(this.liveRailConfig)
        : [];
    } catch {
      // Direct IDs remain playable when a browse catalog is temporarily down.
      tagged = [];
    }
    const selected = tagged.find((channel) => channel.id === id);
    if (!selected) {
      const fallback = await this.resolveForPlay('tv', id, {}, {
        requestClass: 'user',
        deadlineAtMs,
        identityHint: { title },
      });
      return {
        ...fallback,
        streams: fallback.streams.map((stream) => ({
          ...stream,
          live_channel_id: id,
          live_channel_source: isArea69ChannelId(id)
            ? 'mango Live TV'
            : stream.source,
        })),
      };
    }

    const canonical = canonicalLiveChannelKey(selected);
    const registry = readLiveChannelHealthRegistrySync();
    const healthRank = (channel: TaggedLiveChannel): number => {
      const status = queryLiveChannelHealthRecord(
        registry,
        channel.source_addon,
        channel.id,
        this.liveSearchFreshnessHorizonMs(),
      ).status;
      return status === 'verified' ? 2 : status === 'unknown' ? 1 : 0;
    };
    const variants = tagged
      .filter((channel) => canonicalLiveChannelKey(channel) === canonical)
      .map((channel, index) => ({ channel, index }))
      .sort((left, right) => (
        compareLiveChannelsByQuality(left.channel, right.channel)
        || healthRank(right.channel) - healthRank(left.channel)
        || left.index - right.index
      ))
      .map(({ channel }) => channel);
    const streams: Stream[] = [];
    const errors: string[] = [];
    const seenUrls = new Set<string>();
    for (const variant of variants) {
      const remainingMs = remainingPlayBudgetMs(deadlineAtMs);
      if (remainingMs <= 0) break;
      try {
        for (const stream of await this.resolveTaggedLiveChannel(variant, remainingMs)) {
          if (!seenUrls.has(stream.url)) {
            seenUrls.add(stream.url);
            streams.push(stream);
          }
        }
      } catch (error) {
        errors.push(`${variant.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      streams,
      resolve_ms: Date.now() - started,
      cached: false,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  async recordLiveSearchOutcome(
    source: string,
    channelId: string,
    status: LiveChannelHealthStatus,
    reason?: string,
  ): Promise<void> {
    try {
      await recordLiveChannelHealth({ source, channelId, status, reason });
    } catch {
      // Operator-owned health state improves future ranking but must never
      // turn a successful couch playback into a request failure.
      console.warn('live health persistence failed');
    }
  }

  /** Headless playback-start validation for at most the candidates chosen by Live search. */
  async validateLiveSearchEntry(entry: LiveSearchEntry): Promise<boolean> {
    // A background mpv probe must never contend with foreground playback;
    // this is additionally required for AREA69's single-connection account.
    if (!liveSearchValidationDecision(
      entry.meta.id,
      isPlaybackActiveForTriggerConsumer(),
    ).allowed) {
      return false;
    }
    const tagged = this.liveRailConfig
      ? await this.fetchTaggedLiveChannels(this.liveRailConfig)
      : [];
    const channel = tagged.find((candidate) => candidate.id === entry.meta.id);
    if (!channel) return false;
    const timeoutMs = Number(process.env.MANGO_LIVE_PROBE_TIMEOUT_MS ?? 10_000);
    const source = channel.source_addon;
    try {
      const streams = await this.resolveTaggedLiveChannel(channel, timeoutMs);
      if (streams.length === 0) {
        await this.recordLiveSearchOutcome(source, channel.id, 'failed', 'resolve returned no stream');
        return false;
      }
      await probeLiveUrl(streams[0].url, timeoutMs);
      await this.recordLiveSearchOutcome(source, channel.id, 'verified');
      return true;
    } catch (error) {
      await this.recordLiveSearchOutcome(
        source,
        channel.id,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  async liveTabRailItems(_options: { reshuffle?: boolean } = {}): Promise<TabRailItemsResponse> {
    const cached = this.liveTabRailItemsCache;
    if (cached && cached.expiresAt > Date.now()) {
      return this.withLiveAiCatalogRails(cached.payload, { cached: true });
    }

    const diskCache = await readLiveRailsDiskCache();
    const diskPayload = diskCache?.payload as TabRailItemsResponse | undefined;
    if (liveRailsDiskCacheFresh(diskCache)) {
      const payload = diskPayload as TabRailItemsResponse;
      this.liveTabRailItemsCache = {
        payload,
        expiresAt: diskCache.expires_at,
      };
      return this.withLiveAiCatalogRails(payload, { cached: true });
    }

    if (this.liveTabRailItemsInFlight) {
      return this.liveTabRailItemsInFlight;
    }
    const inFlight = this.rebuildLiveTabRailItems(diskCache, diskPayload);
    this.liveTabRailItemsInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (this.liveTabRailItemsInFlight === inFlight) {
        this.liveTabRailItemsInFlight = null;
      }
    }
  }

  private async rebuildLiveTabRailItems(
    diskCache: Awaited<ReturnType<typeof readLiveRailsDiskCache>>,
    diskPayload: TabRailItemsResponse | undefined,
  ): Promise<TabRailItemsResponse> {
    const started = Date.now();
    const previousRefresh = readLiveRailsRefreshStatusSync();
    await writeLiveRailsRefreshStatus({
      last_attempt_at: started,
      last_success_at: previousRefresh.last_success_at,
      last_error: previousRefresh.last_error,
    }).catch(() => undefined);
    let config: LiveRailConfig;
    let responses: RailItemsResponse[] = [];
    try {
      config = this.requireLiveRailConfig();
      const snapshot = await this.fetchTaggedLiveChannelSnapshot(config);
      const incompleteSources = incompleteLiveCatalogSources(
        config.sources,
        snapshot.sourceCounts,
        snapshot.failedSources,
      );
      if (incompleteSources.length > 0) {
        throw new CatalogError(
          503,
          `live catalog incomplete: ${incompleteSources.join(', ')}`,
        );
      }
      const byRail = partitionChannelsBySportRails(snapshot.channels, config.rails);

      for (const rail of config.rails) {
        const matched = (byRail.get(rail.id) || []) as TaggedLiveChannel[];
        if (matched.length === 0) {
          continue;
        }
        const verified = await this.verifyRailChannels(rail, matched, config);
        if (verified.length === 0) {
          continue;
        }
        responses.push(await this.buildLiveRailItemsResponse(rail, verified, started));
      }
    } catch (error) {
      this.liveLastRebuildError = error instanceof Error ? error.message : String(error);
      await writeLiveRailsRefreshStatus({
        last_attempt_at: started,
        last_success_at: previousRefresh.last_success_at,
        last_error: this.liveLastRebuildError,
      }).catch(() => undefined);
      const fallback = this.liveTabRailItemsCache?.payload
        || (diskPayload && liveRailsDiskCacheNonEmpty(diskCache) ? diskPayload : null);
      if (fallback && fallback.rails.length > 0) {
        return this.withLiveAiCatalogRails(fallback, { cached: true, stale: true });
      }
      throw error;
    }

    const savedRail = await this.buildSavedRail('live');
    if (savedRail.items.length > 0) {
      responses.unshift(savedRail);
    }

    if (responses.length === 0) {
      const staleMemory = this.liveTabRailItemsCache?.payload;
      const fallback = staleMemory
        || (diskPayload && liveRailsDiskCacheNonEmpty(diskCache) ? diskPayload : null);
      if (fallback && fallback.rails.length > 0) {
        this.liveLastRebuildError = 'live rebuild returned no non-empty rails';
        await writeLiveRailsRefreshStatus({
          last_attempt_at: started,
          last_success_at: previousRefresh.last_success_at,
          last_error: this.liveLastRebuildError,
        }).catch(() => undefined);
        return this.withLiveAiCatalogRails(fallback, { cached: true, stale: true });
      }
      this.liveTabRailItemsCache = null;
      this.liveLastRebuildError = 'live rebuild returned no non-empty rails';
      await writeLiveRailsRefreshStatus({
        last_attempt_at: started,
        last_success_at: previousRefresh.last_success_at,
        last_error: this.liveLastRebuildError,
      }).catch(() => undefined);
      return this.withLiveAiCatalogRails(
        { tab: 'live', rails: [], resolve_ms: Date.now() - started },
      );
    }

    const payload: TabRailItemsResponse = {
      tab: 'live',
      rails: responses,
      resolve_ms: Date.now() - started,
    };
    const expiresAt = Date.now() + liveCatalogCacheTtlMs(config);
    this.liveTabRailItemsCache = { payload, expiresAt };
    await writeLiveRailsDiskCache(
      { ...payload, tab: 'live' },
      Math.ceil((expiresAt - Date.now()) / 1000),
    ).catch(() => undefined);
    this.liveLastRebuildError = null;
    await writeLiveRailsRefreshStatus({
      last_attempt_at: started,
      last_success_at: Date.now(),
      last_error: null,
    }).catch(() => undefined);
    return this.withLiveAiCatalogRails(payload);
  }

  private siblingRailIds(rail: PlayableRail): string[] {
    return this.browsableRailsForTab(rail.tab)
      .map((entry) => entry.id)
      .filter((id) => id !== rail.id);
  }

  private async buildSavedRail(
    tab: CatalogTab,
    profileId = activeViewerProfileId(),
    options: {
      cachedOnly?: boolean;
      shuffleSeed?: string;
      excludeKeys?: ReadonlySet<string>;
    } = {},
  ): Promise<RailItemsResponse> {
    const started = Date.now();
    const savedItems = listSavedLibraryItems(tab, undefined, {
      profile_id: profileId,
      household_blend: vodUtilityHouseholdBlend(tab, profileId),
    }).filter((item) => !options.excludeKeys?.has(titleKey(item.type, item.id)));
    const selectedSavedItems = options.shuffleSeed
      ? weightedDeal(
        savedItems.map((item) => ({
          ...item,
          weight: recencyWeight(item.saved_at, 180, started),
        })),
        Math.min(9, savedItems.length),
        `${options.shuffleSeed}:saved`,
      )
      : savedItems;
    const items = await mapInBatches(
      selectedSavedItems,
      RAIL_META_CONCURRENCY,
      async (item) => this.resolveSavedRailItem(item, options),
      RAIL_META_STAGGER_MS,
    );

    return {
      rail_id: SAVED_RAIL_ID,
      label: 'Saved',
      items,
      resolve_ms: Date.now() - started,
      skipped: 0,
      playability: {
        displayed: items.length,
        verified_pool: items.length,
        pending: 0,
        low_water: false,
        session_id: this.playabilitySessionId,
      },
    };
  }

  private async buildContinueRail(
    tab: CatalogTab,
    profileId = activeViewerProfileId(),
    options: { shuffleSeed?: string } = {},
  ): Promise<RailItemsResponse> {
    const started = Date.now();
    const candidates = listContinueItems(tab, undefined, { profile_id: profileId });
    const selected = options.shuffleSeed
      ? weightedDeal(
        candidates.map((candidate) => ({
          ...candidate,
          weight: recencyWeight(candidate.activity_at, 30, started),
        })),
        Math.min(9, candidates.length),
        `${options.shuffleSeed}:continue`,
      )
      : candidates;
    const items = selected.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      title: candidate.title,
      subtitle: candidate.subtitle,
      poster: normalizePosterUrl(candidate.poster) ?? metahubPosterUrl(candidate.id) ?? '',
      year: undefined,
      description: candidate.description,
      source: candidate.source,
      progress: candidate.progress,
    } satisfies RailItem));

    return {
      rail_id: CONTINUE_RAIL_ID,
      label: 'continue watching',
      items,
      resolve_ms: Date.now() - started,
      skipped: 0,
      playability: {
        displayed: items.length,
        verified_pool: items.length,
        pending: 0,
        low_water: false,
        session_id: this.playabilitySessionId,
      },
    };
  }

  async continueRailItems(
    tab: CatalogTab,
    expected?: PersonalizationSnapshot,
  ): Promise<RailItemsResponse & {
    profile_id: string;
    personalization_updated_at: number;
  }> {
    const personalization = getPersonalizationState();
    if (expected && !samePersonalizationSnapshot(personalization, expected)) {
      throw new CatalogError(409, 'profile changed before Continue loaded', undefined, {
        couchMessage: 'profile changed — refreshing',
      });
    }
    const utilityProfileId = vodUtilityProfileId(tab, personalization.active_profile_id);
    const rail = await this.buildContinueRail(tab, utilityProfileId);
    if (!samePersonalizationSnapshot(personalization, getPersonalizationState())) {
      throw new CatalogError(409, 'profile changed while Continue loaded', undefined, {
        couchMessage: 'profile changed — refreshing',
      });
    }
    return {
      ...rail,
      profile_id: utilityProfileId,
      personalization_updated_at: personalization.updated_at,
    };
  }

  private async buildRailItemsResponse(
    rail: PlayableRail,
    session: RailSessionSnapshot,
    started: number,
    options: { cachedOnly?: boolean; suppressRepair?: boolean } = {},
  ): Promise<RailItemsResponse> {
    const poolSnapshotItems = session.items.every(
      (item) => this.railItemFromPoolSnapshot(item) !== null,
    );
    const items = poolSnapshotItems || options.cachedOnly
      ? session.items
        .map((item) => this.railItemFromPoolSnapshot(item))
        .filter((item): item is RailItem => item !== null)
      : (await mapInBatches(
        session.items,
        RAIL_META_CONCURRENCY,
        (item) => this.resolveVerifiedRailItem(item),
        RAIL_META_STAGGER_MS,
      )).filter((item): item is RailItem => item !== null);
    const pending = Math.max(0, rail.playability.min_display - items.length);
    const lowWater = items.length < rail.playability.min_display;
    const poolTarget = effectivePoolTarget(rail.playability, session.verified_pool);
    if (lowWater && !options.suppressRepair) {
      void enqueuePlayabilityTrigger({
        trigger_type: 'display_low',
        rail_id: rail.id,
        reason: `displayed=${items.length} min=${rail.playability.min_display}`,
      }).catch(() => undefined);
      schedulePlayabilityTopUp(rail.id);
    } else if (!options.suppressRepair && session.verified_pool < poolTarget * 0.5) {
      void enqueuePlayabilityTrigger({
        trigger_type: 'pool_low',
        rail_id: rail.id,
        reason: `pool=${session.verified_pool} target=${poolTarget}`,
      }).catch(() => undefined);
      schedulePlayabilityTopUp(rail.id);
    }
    return {
      rail_id: rail.id,
      label: rail.label,
      items,
      resolve_ms: Date.now() - started,
      skipped: session.items.length - items.length,
      playability: {
        displayed: items.length,
        verified_pool: session.verified_pool,
        pending,
        low_water: lowWater,
        session_id: session.session_id,
      },
    };
  }

  private buildExploreRailResponse(
    session: RailSessionSnapshot,
    started: number,
  ): RailItemsResponse {
    const items = session.items
      .map((item) => this.railItemFromPoolSnapshot(item))
      .filter((item): item is RailItem => item !== null);
    return {
      rail_id: session.rail_id,
      label: 'Explore',
      items,
      resolve_ms: Date.now() - started,
      skipped: session.items.length - items.length,
      playability: {
        displayed: items.length,
        verified_pool: session.verified_pool,
        pending: Math.max(0, 6 - items.length),
        low_water: items.length < 6,
        session_id: session.session_id,
      },
    };
  }

  private warmMetaCacheForRailItems(items: Array<{ type: string; id: string }>): void {
    if (!META_WARM_ENABLED) {
      return;
    }
    const seen = new Set<string>();
    const warmTargets = items.filter((item) => {
      if (item.type !== 'movie' && item.type !== 'series') {
        return false;
      }
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (warmTargets.length === 0) {
      return;
    }
    void mapInBatches(
      warmTargets,
      META_WARM_CONCURRENCY,
      async (item) => {
        await this.metaCached(item.type, item.id).catch(() => undefined);
      },
    ).catch(() => undefined);
  }

  private async vodBrowseStoredDealUsable(
    tab: VodRecommendationTab,
    payload: TabRailItemsResponse,
    profileId: string,
  ): Promise<boolean> {
    if (payload.tab !== tab || payload.rails.length === 0) return false;
    const seen = new Set<string>();
    const exclusions = householdVodDiscoveryExclusions(tab);
    const currentSaved = new Set(listSavedLibraryItems(tab, undefined, {
      profile_id: profileId,
      household_blend: vodUtilityHouseholdBlend(tab, profileId),
    }).map((item) => titleKey(item.type, item.id)));
    const currentContinue = new Set(listContinueItems(tab, undefined, {
      profile_id: profileId,
    }).map((item) => titleKey(item.type, item.id)));
    const dealableSaved = new Set([...currentSaved].filter((key) => !currentContinue.has(key)));
    const savedRail = payload.rails.find((rail) => rail.rail_id === SAVED_RAIL_ID);
    const continueRail = payload.rails.find((rail) => rail.rail_id === CONTINUE_RAIL_ID);
    if ((savedRail?.items.length ?? 0) !== Math.min(9, dealableSaved.size)) return false;
    if ((continueRail?.items.length ?? 0) !== Math.min(9, currentContinue.size)) return false;
    const discovery: Array<{ type: string; id: string }> = [];
    for (const rail of payload.rails) {
      for (const item of rail.items) {
        const key = titleKey(item.type, item.id);
        if (seen.has(key)) return false;
        seen.add(key);
        if (rail.rail_id === SAVED_RAIL_ID) {
          if (!dealableSaved.has(key)) return false;
          continue;
        }
        if (rail.rail_id === CONTINUE_RAIL_ID) {
          if (!currentContinue.has(key)) return false;
          continue;
        }
        if (exclusions.has(key)) return false;
        discovery.push({ type: item.type, id: item.id });
      }
    }
    const states = await getTitlesPlayabilityBulk(discovery);
    return discovery.every((item) => states.get(titleKey(item.type, item.id))?.status === 'verified');
  }

  private async stageVodBrowseV3(
    tab: VodRecommendationTab,
    reshuffle: boolean,
    personalization: PersonalizationSnapshot,
    recommendationRevision: number | null,
    cacheKey: string,
    cachedTab: typeof this.tabRailItemsCache extends Map<string, infer V> ? V | undefined : never,
    started: number,
    options: {
      publishCache?: boolean;
      forYouOverride?: RailItemsResponse | null;
    } = {},
  ): Promise<StagedPersonalizationResult<TabRailItemsResponse>> {
    let affinity = this.vodBrowseAffinityCache.get(tab);
    if (!affinity) {
      affinity = loadVodBrowseAffinitySnapshot(tab);
      this.vodBrowseAffinityCache.set(tab, affinity);
    }
    const rails = this.browsableRailsForTab(tab);
    if (vodBrowseV3Mode() === 'shadow') {
      await prepareVodBrowseReservoirV3({
        tab,
        rails: rails.map((rail) => ({
          railId: rail.id,
          displayLimit: Math.min(9, rail.playability.display_limit),
          minDisplay: 6,
          playability: rail.playability,
        })),
        affinityRevision: affinity.revision,
        affinityByKey: affinity.values,
      });
    }
    const stored = await readVodTabDealV3(tab);
    if (!reshuffle && stored) {
      try {
        const payload = JSON.parse(stored.payload_json) as TabRailItemsResponse;
        const utilityProfileId = vodUtilityProfileId(tab, personalization.active_profile_id);
        if (await this.vodBrowseStoredDealUsable(tab, payload, utilityProfileId)) {
          const expiresAt = Date.now() + RAIL_ITEMS_CACHE_TTL_MS;
          return {
            value: { ...payload, cached: true },
            commit: () => {
              if (options.publishCache === false) return;
              this.tabRailItemsCache.set(cacheKey, {
                tab,
                profileId: personalization.active_profile_id,
                personalizationUpdatedAt: personalization.updated_at,
                payload,
                expiresAt,
              });
            },
          };
        }
      } catch {
        // A corrupt derived deal is replaceable. Historical rows remain intact.
      }
    }

    const nextEpoch = (stored?.deal_epoch ?? -1) + 1;
    const dealSeed = `${tab}:deal:${nextEpoch}`;
    const sessionId = `${this.playabilitySessionId}:v3:${tab}:${nextEpoch}`;
    const utilityProfileId = vodUtilityProfileId(tab, personalization.active_profile_id);
    try {
      const continueRail = await this.buildContinueRail(tab, utilityProfileId, {
        shuffleSeed: dealSeed,
      });
      const continueKeys = new Set(continueRail.items.map((item) => titleKey(item.type, item.id)));
      const savedRail = await this.buildSavedRail(tab, utilityProfileId, {
        cachedOnly: true,
        shuffleSeed: dealSeed,
        excludeKeys: continueKeys,
      });
      const utilityKeys = new Set([
        ...continueKeys,
        ...savedRail.items.map((item) => titleKey(item.type, item.id)),
      ]);
      const forYouRail = options.forYouOverride !== undefined
        ? options.forYouOverride
        : await loadForYouRail(tab, {
          reshuffle: reshuffle || stored !== null,
          profileId: personalization.active_profile_id,
          personalizationUpdatedAt: personalization.updated_at,
          excludeKeys: utilityKeys,
        });
      const occupied = new Set<string>();
      for (const rail of [continueRail, savedRail, forYouRail].filter(Boolean) as RailItemsResponse[]) {
        rail.items.forEach((item) => occupied.add(titleKey(item.type, item.id)));
      }
      const exclusions = householdVodDiscoveryExclusions(tab);
      const sessions = await allocateTabRailSessions({
        sessionId,
        rails: rails.map((rail) => ({
          railId: rail.id,
          displayLimit: Math.min(9, rail.playability.display_limit),
          minDisplay: 6,
          playability: rail.playability,
        })),
        forceReshuffle: true,
        stableRatio: 0,
        browseV3: true,
        browseV3Tab: tab,
        seed: dealSeed,
        excludedKeys: exclusions,
        initiallyOccupiedKeys: occupied,
        affinityByKey: affinity.values,
      });
      const specialized: RailItemsResponse[] = [];
      for (const rail of rails) {
        const session = sessions.get(rail.id);
        if (!session) continue;
        const response = await this.buildRailItemsResponse(rail, session, started, {
          cachedOnly: true,
          suppressRepair: true,
        });
        const aiCatalog = rail.type === 'ai_catalog';
        if ((aiCatalog && response.items.length > 0) || response.items.length >= 6) {
          specialized.push(response);
          response.items.forEach((item) => occupied.add(titleKey(item.type, item.id)));
        }
      }
      const exploreSession = await allocateVodExploreSession({
        tab,
        sessionId,
        displayLimit: 9,
        seed: `${dealSeed}:explore`,
        excludedKeys: exclusions,
        occupiedKeys: occupied,
        affinityByKey: affinity.values,
      });
      const exploreRail = this.buildExploreRailResponse(exploreSession, started);
      if (exploreRail.items.length < 6) {
        throw new CatalogError(503, `Explore could deal only ${exploreRail.items.length} verified titles`, undefined, {
          couchMessage: 'Shuffle is keeping the previous complete page',
        });
      }
      const visibleRails = mergeUserStateRails(specialized, continueRail, savedRail, {
        forYouRail,
        exploreRail,
      });
      const allKeys = visibleRails.flatMap((rail) => rail.items.map((item) => titleKey(item.type, item.id)));
      if (new Set(allKeys).size !== allKeys.length) {
        throw new CatalogError(503, 'VOD tab deal contains duplicate titles', undefined, {
          couchMessage: 'Shuffle is keeping the previous complete page',
        });
      }
      const discoveryItems = visibleRails
        .filter((rail) => rail.rail_id !== CONTINUE_RAIL_ID && rail.rail_id !== SAVED_RAIL_ID)
        .flatMap((rail) => rail.items.map((item) => ({ type: item.type, id: item.id })));
      const currentPlayability = await getTitlesPlayabilityBulk(discoveryItems);
      if (discoveryItems.some((item) => (
        currentPlayability.get(titleKey(item.type, item.id))?.status !== 'verified'
      ))) {
        throw new CatalogError(503, 'VOD tab deal selected a title whose playability changed', undefined, {
          couchMessage: 'Shuffle is keeping the previous complete page',
        });
      }
      const payload: TabRailItemsResponse = {
        tab,
        rails: visibleRails,
        resolve_ms: Date.now() - started,
      };
      const expiresAt = Date.now() + RAIL_ITEMS_CACHE_TTL_MS;
      return {
        value: payload,
        commit: async () => {
          if (recommendationRevision !== null
            && !this.recommendationRevisionFence.isCurrent(tab, recommendationRevision)) {
            throw new Error('recommendation inputs changed before VOD tab deal commit');
          }
          try {
            await persistVodTabDealV3({
              tab,
              session_id: sessionId,
              recommendation_revision: recommendationRevision,
              payload_json: JSON.stringify(payload),
              expected_previous_epoch: stored?.deal_epoch ?? null,
            });
          } catch (error) {
            throw new CatalogError(409, `VOD tab deal commit rejected: ${
              error instanceof Error ? error.message : String(error)
            }`, undefined, {
              couchMessage: 'Shuffle changed concurrently — try again',
            });
          }
          if (options.publishCache !== false) {
            for (const response of specialized) {
              this.railItemsCache.set(response.rail_id, { payload: response, expiresAt });
            }
            this.tabRailItemsCache.set(cacheKey, {
              tab,
              profileId: personalization.active_profile_id,
              personalizationUpdatedAt: personalization.updated_at,
              payload,
              expiresAt,
            });
          }
        },
        rollback: () => this.tabRailItemsCache.delete(cacheKey),
      };
    } catch (error) {
      if (!reshuffle && cachedTab) {
        const utilityProfileId = vodUtilityProfileId(tab, personalization.active_profile_id);
        if (await this.vodBrowseStoredDealUsable(tab, cachedTab.payload, utilityProfileId)) {
          return { value: { ...cachedTab.payload, cached: true } };
        }
      }
      throw error;
    }
  }

  private scheduleVodBrowseV3Shadow(input: {
    tab: VodRecommendationTab;
    reshuffle: boolean;
    personalization: PersonalizationSnapshot;
    recommendationRevision: number | null;
    cacheKey: string;
    forYouRail: RailItemsResponse | null;
  }): void {
    if (this.vodBrowseShadowBuilds.has(input.tab)) return;
    let running: Promise<void>;
    running = new Promise<void>((resolve) => {
      setImmediate(() => {
        void this.stageVodBrowseV3(
          input.tab,
          input.reshuffle,
          input.personalization,
          input.recommendationRevision,
          `${input.cacheKey}\u0000browse-v3-shadow`,
          undefined,
          Date.now(),
          { publishCache: false, forYouOverride: input.forYouRail },
        ).then((staged) => staged.commit?.()).catch((error) => {
          console.warn(`Browse v3 shadow deal retained visible v2 page: ${
            error instanceof Error ? error.message : String(error)
          }`);
        }).finally(resolve);
      });
    }).finally(() => {
      if (this.vodBrowseShadowBuilds.get(input.tab) === running) {
        this.vodBrowseShadowBuilds.delete(input.tab);
      }
    });
    this.vodBrowseShadowBuilds.set(input.tab, running);
  }

  private async stageTabRailItems(
    tab: CatalogTab,
    reshuffle: boolean,
    personalization: PersonalizationSnapshot,
    recommendationRevision: number | null,
  ): Promise<StagedPersonalizationResult<TabRailItemsResponse>> {
    const cacheKey = `${personalizationScopedCacheKey(tab, personalization)}\u0000recommendation:${
      recommendationRevision ?? 'none'
    }`;
    const now = Date.now();
    for (const [key, entry] of this.tabRailItemsCache) {
      if (entry.expiresAt <= now) this.tabRailItemsCache.delete(key);
    }
    const cachedTab = this.tabRailItemsCache.get(cacheKey);
    if (
      !reshuffle
      && cachedTab
      && cachedTab.expiresAt > now
      && cachedTab.profileId === personalization.active_profile_id
      && cachedTab.personalizationUpdatedAt === personalization.updated_at
      && cachedTab.payload.rails.every((rail) => rail.playability?.low_water !== true)
    ) {
      return { value: { ...cachedTab.payload, cached: true } };
    }

    const started = Date.now();
    if ((tab === 'movies' || tab === 'series') && vodBrowseV3Mode() === 'serve') {
      return this.stageVodBrowseV3(
        tab,
        reshuffle,
        personalization,
        recommendationRevision,
        cacheKey,
        cachedTab,
        started,
      );
    }
    const rails = this.browsableRailsForTab(tab);
    const shufflePolicy = vodDiscoveryShufflePolicy(tab, reshuffle);
    const cachedUtilityRail = (railId: string): RailItemsResponse | null => (
      shufflePolicy.cachedOnly
        ? cachedTab?.payload.rails.find((rail) => rail.rail_id === railId) ?? null
        : null
    );
    const sessions = await allocateTabRailSessions({
      sessionId: this.playabilitySessionId,
      rails: rails.map((rail) => ({
        railId: rail.id,
        displayLimit: rail.playability.display_limit,
        minDisplay: rail.playability.min_display,
        playability: rail.playability,
      })),
      // Manual VOD shuffle is tab-scoped: every category rail gets a fresh
      // deal, while utility rails are rebuilt in their chronological order.
      forceReshuffle: shufflePolicy.forceCuratedReshuffle,
      stableRatio: shufflePolicy.stableRatio,
    });

    const [railResponses, continueRail, savedRail] = await Promise.all([
      Promise.all(
        rails.map(async (rail) => {
          const session = sessions.get(rail.id);
          if (!session) return null;
          return this.buildRailItemsResponse(rail, session, Date.now(), {
            cachedOnly: shufflePolicy.cachedOnly,
          });
        }),
      ),
      cachedUtilityRail(CONTINUE_RAIL_ID) ?? this.buildContinueRail(
        tab,
        vodUtilityProfileId(tab, personalization.active_profile_id),
      ),
      cachedUtilityRail(SAVED_RAIL_ID) ?? this.buildSavedRail(
        tab,
        vodUtilityProfileId(tab, personalization.active_profile_id),
        { cachedOnly: shufflePolicy.cachedOnly },
      ),
    ]);

    const responses = railResponses.filter((rail): rail is RailItemsResponse => rail !== null);
    const forYouRail = tab === 'movies' || tab === 'series'
      ? await loadForYouRail(tab, {
        reshuffle,
        profileId: personalization.active_profile_id,
        personalizationUpdatedAt: personalization.updated_at,
      })
      : null;
    const visibleRails = mergeUserStateRails(responses, continueRail, savedRail, {
      forYouRail,
    });
    const payload: TabRailItemsResponse = {
      tab,
      rails: visibleRails,
      resolve_ms: Date.now() - started,
    };
    const expiresAt = Date.now() + RAIL_ITEMS_CACHE_TTL_MS;
    return {
      value: payload,
      commit: async () => {
        if (recommendationRevision !== null
          && !this.recommendationRevisionFence.isCurrent(tab as VodRecommendationTab, recommendationRevision)) {
          return;
        }
        for (const response of responses) {
          this.railItemsCache.set(response.rail_id, { payload: response, expiresAt });
        }
        this.tabRailItemsCache.set(cacheKey, {
          tab,
          profileId: personalization.active_profile_id,
          personalizationUpdatedAt: personalization.updated_at,
          payload,
          expiresAt,
        });
        if ((tab === 'movies' || tab === 'series') && vodBrowseV3Mode() === 'shadow') {
          this.scheduleVodBrowseV3Shadow({
            tab,
            reshuffle,
            personalization,
            recommendationRevision,
            cacheKey,
            forYouRail,
          });
        }
      },
      rollback: () => this.tabRailItemsCache.delete(cacheKey),
    };
  }

  async tabRailItems(
    tab: CatalogTab,
    options: {
      reshuffle?: boolean;
      expectedPersonalization?: PersonalizationSnapshot | null;
    } = {},
  ): Promise<TabRailItemsResponse | ProfileOwnedTabRailItemsResponse> {
    if (tab === 'live') return this.liveTabRailItems();
    assertExpectedPersonalization(
      options.expectedPersonalization,
      getPersonalizationState(),
      'before catalog rails loaded',
    );
    const reshuffle = Boolean(options.reshuffle);
    const loadPolicy = catalogTabLoadPolicy(
      reshuffle,
      Date.now() - this.playabilitySessionStartedAt,
      PLAYABILITY_SESSION_MAX_AGE_MS,
    );
    if (loadPolicy.rotatePlayabilitySession) {
      // Session has aged past a day — rotate so the home re-picks from the pool
      // (new titles surface). Uses the normal stable ratio, not the aggressive
      // manual-shuffle ratio, so the daily refresh stays gentle.
      this.reshufflePlayabilitySession();
    }

    try {
      let result: { value: TabRailItemsResponse; snapshot: PersonalizationSnapshot } | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const recommendationRevision = tab === 'movies' || tab === 'series'
          ? this.recommendationRevisionFence.capture(tab)
          : null;
        result = await runPersonalizationCoherentRequest({
          readSnapshot: getPersonalizationState,
          build: (personalization) => {
            assertExpectedPersonalization(
              options.expectedPersonalization,
              personalization,
              'while catalog rails loaded',
            );
            return this.stageTabRailItems(tab, reshuffle, personalization, recommendationRevision);
          },
        });
        if (recommendationRevision === null
          || this.recommendationRevisionFence.isCurrent(tab as VodRecommendationTab, recommendationRevision)) {
          break;
        }
        result = null;
      }
      if (!result) throw new CatalogError(409, 'recommendation inputs changed while catalog rails were loading');
      const { value, snapshot } = result;
      if (loadPolicy.warmMetadata) {
        this.warmMetaCacheForRailItems(
          value.rails.flatMap((rail) => rail.items.map((item) => ({
            type: item.type,
            id: item.id,
          }))),
        );
      }
      assertExpectedPersonalization(
        options.expectedPersonalization,
        snapshot,
        'while catalog rails loaded',
      );
      return {
        ...value,
        profile_id: snapshot.active_profile_id,
        personalization_updated_at: snapshot.updated_at,
      };
    } catch (error) {
      if (error instanceof PersonalizationChangedDuringRequestError) {
        throw new CatalogError(409, 'profile changed while catalog rails were loading', undefined, {
          couchMessage: 'profile changed — refreshing',
        });
      }
      throw error;
    }
  }

  async railItems(railId: string): Promise<RailItemsResponse> {
    const cachedRail = this.railItemsCache.get(railId);
    if (
      cachedRail
      && cachedRail.expiresAt > Date.now()
      && cachedRail.payload.playability?.low_water !== true
    ) {
      return { ...cachedRail.payload, cached: true };
    }

    const started = Date.now();
    const rail = this.browsableRail(railId);
    const session = await getOrCreateRailSession({
      railId: rail.id,
      sessionId: this.playabilitySessionId,
      displayLimit: rail.playability.display_limit,
      playability: rail.playability,
      siblingRailIds: this.siblingRailIds(rail),
    });
    const payload = await this.buildRailItemsResponse(rail, session, started);
    this.railItemsCache.set(railId, {
      payload,
      expiresAt: Date.now() + RAIL_ITEMS_CACHE_TTL_MS,
    });
    if (payload.items.length === 0) {
      return {
        ...payload,
        items: [],
      };
    }
    return payload;
  }

  async railRelated(
    railId: string,
    exclude: Array<{ type: string; id: string }>,
    limit = 8,
  ): Promise<RailItemsResponse> {
    const rail = this.browsableRail(railId);
    const excludeKeys = new Set(exclude.map((item) => titleKey(item.type, item.id)));
    const poolRows = await pickRailRelatedFromPool(railId, excludeKeys, limit);
    const items: RailItem[] = poolRows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title || row.id,
      subtitle: row.year ? String(row.year) : row.type,
      poster: row.poster_url || '',
      year: row.year ?? undefined,
      source: row.best_source || '',
    }));
    return {
      rail_id: rail.id,
      label: rail.label,
      items,
      resolve_ms: 0,
      skipped: 0,
      playability: {
        displayed: items.length,
        verified_pool: poolRows.length,
        pending: 0,
        low_water: false,
        session_id: '',
      },
    };
  }

  async contentRelated(
    type: string,
    id: string,
    railId: string | null,
    exclude: Array<{ type: string; id: string }>,
    limit = 8,
  ): Promise<RailItemsResponse> {
    if ((type === 'movie' || type === 'series') && vodBrowseV3Mode() === 'serve') {
      const tab: VodRecommendationTab = type === 'series' ? 'series' : 'movies';
      const rows = await loadStoryGraphRelatedTitles({
        tab,
        content_id: id,
        exclude_keys: new Set(exclude.map((item) => titleKey(item.type, item.id))),
        limit,
      });
      const items: RailItem[] = rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        subtitle: row.year ?? row.type,
        poster: row.poster,
        year: row.year ?? undefined,
        source: row.source,
      }));
      return {
        rail_id: `related-${type}-${id}`,
        label: 'Related Titles',
        items,
        resolve_ms: 0,
        skipped: 0,
        playability: {
          displayed: items.length,
          verified_pool: items.length,
          pending: 0,
          low_water: false,
          session_id: '',
        },
      };
    }
    if (railId) return this.railRelated(railId, exclude, limit);
    return {
      rail_id: `related-${type}-${id}`,
      label: 'Related Titles',
      items: [],
      resolve_ms: 0,
      skipped: 0,
      playability: {
        displayed: 0,
        verified_pool: 0,
        pending: 0,
        low_water: false,
        session_id: '',
      },
    };
  }

  async meta(type: string, id: string): Promise<Meta> {
    const errors: string[] = [];
    let merged: Meta | null = null;
    const videoLayers: VideoLayer[] = [];
    for (const addon of this.metaAddonsInOrder()) {
      if (!supportsResource(addon.manifest, 'meta', type)) continue;
      try {
        const result = await fetchJson(resourceUrl(addon, 'meta', type, id)) as { meta?: Meta };
        const piece = result.meta;
        if (!piece?.id || isBlockedCatalogMeta(piece)) {
          continue;
        }
        merged = mergeCatalogMetaPieces(merged, piece, addon.name, videoLayers);
      } catch (error) {
        errors.push(`${addon.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (merged && !isBlockedCatalogMeta(merged)) {
      return merged;
    }
    throw new CatalogError(502, `meta not resolved for ${type}/${id}${errors.length ? ` (${errors.join('; ')})` : ''}`);
  }

  /** Cinemeta/addon catalog search — used for out-of-library voice lookups. */
  async searchMeta(type: string, query: string): Promise<Meta[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [];
    }
    const results: Meta[] = [];
    const seen = new Set<string>();
    for (const addon of this.metaAddonsInOrder()) {
      const hasSearch = supportsResource(addon.manifest, 'search', type);
      const hasCatalogSearch =
        !hasSearch
        && normalizeAddonName(addon.name) === 'cinemeta'
        && supportsResource(addon.manifest, 'catalog', type);
      if (!hasSearch && !hasCatalogSearch) {
        continue;
      }
      try {
        const fetchUrl = hasSearch
          ? resourceUrl(addon, 'search', type, trimmed)
          : catalogSearchUrl(addon, type, trimmed);
        const result = await fetchJson(fetchUrl) as { metas?: Meta[] };
        for (const meta of result.metas ?? []) {
          if (!meta?.id || isBlockedCatalogMeta(meta)) {
            continue;
          }
          const key = `${type}:${meta.id}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          results.push(Object.assign({}, meta, { source: addon.name }) as Meta);
        }
        if (results.length > 0) {
          break;
        }
      } catch {
        // try next meta addon
      }
    }
    return results;
  }

  async seriesEpisodes(bareId: string): Promise<SeriesEpisodesResponse> {
    const profileId = activeViewerProfileId();
    const trimmed = bareId.trim();
    const normalizedBare = seriesBareId(trimmed);
    if (!normalizedBare || normalizedBare.toLowerCase() !== trimmed.toLowerCase()) {
      throw new CatalogError(400, 'GET /series/:id/episodes requires bare imdb series id');
    }
    const meta = await this.metaCached('series', normalizedBare);
    const saved = getWatchProgressForTitle('series', normalizedBare, {
      profile_id: profileId,
    });
    const episodeProgress = new Map(
      listLatestEpisodeWatchProgress(normalizedBare, { profile_id: profileId }).map((row) => [
        row.play_id,
        {
          position_sec: row.position_sec,
          duration_sec: row.duration_sec,
          progress_pct: row.progress_pct,
        },
      ]),
    );
    const response = await assembleSeriesEpisodes(normalizedBare, meta, saved, episodeProgress);
    const keys = response.seasons.flatMap((block) => block.episodes.map((row) => ({
      type: 'series',
      id: row.id,
    })));
    if (keys.length > 0) {
      const playability = await getTitlesPlayabilityBulk(keys);
      applyEpisodePlayability(response.seasons, playability);
    }
    return response;
  }

  private async buildStreamFilterContext(
    type: string,
    id: string,
    identityHint?: ResolveStreamOptions['identityHint'],
  ): Promise<StreamFilterContext> {
    const hintedTitle = typeof identityHint?.title === 'string' && identityHint.title.trim()
      ? identityHint.title.trim()
      : undefined;
    let filterContext: StreamFilterContext = {
      contentType: type,
      metaId: id,
      metaTitle: hintedTitle,
      metaYear: identityYear(identityHint?.year),
    };
    if (type === 'series') {
      filterContext.episodeRole = parsedSeasonRole(id);
    }
    try {
      // Episode ids (tt…:S:E) must resolve series meta by bare imdb id so title
      // integrity always has metaTitle on couch episode play (fix 4).
      const metaLookupId = type === 'series' ? (seriesBareId(id) ?? id) : id;
      const meta = await optionalWithBudget(
        this.metaCached(type === 'series' ? 'series' : type, metaLookupId),
        STREAM_META_CONTEXT_TIMEOUT_MS,
      );
      if (meta) {
        filterContext = {
          ...filterContext,
          contentType: type,
          metaId: id,
          metaTitle: typeof meta.name === 'string'
            ? meta.name
            : typeof meta.title === 'string'
              ? meta.title
              : filterContext.metaTitle,
          metaYear: identityYear(metaYear(meta)) ?? filterContext.metaYear,
          metaCountry: metaCountry(meta),
          episodeTitle: type === 'series' ? metaEpisodeTitle(meta, id) : undefined,
          metaRuntimeMinutes: parseRuntimeMinutes(meta.runtime)
            ?? parseRuntimeMinutes(meta.runtimeMinutes)
            ?? undefined,
        };
      }
    } catch {
      // Retain launcher/catalog identity hints when optional meta is unavailable.
    }
    const curation = await loadRailCurationOverrides();
    if (shouldSkipTitleFilter(type, id, curation)) {
      filterContext.skipTitleFilter = true;
    }
    return filterContext;
  }

  /** Raw addon streams + merged couch config for play-ladder orchestration. */
  async resolveForPlay(
    type: string,
    id: string,
    overrides: StreamFilterOverrides = {},
    options: ResolveStreamOptions = {},
  ): Promise<{
    streams: Stream[];
    resolve_ms: number;
    cached: boolean;
    filters: ReturnType<typeof mergeFilterConfig>;
    filterContext: StreamFilterContext;
    errors?: string[];
  }> {
    if (options.deadlineAtMs !== undefined && remainingPlayBudgetMs(options.deadlineAtMs) <= 0) {
      throw new CatalogError(504, 'play deadline exceeded', undefined, {
        couchMessage: 'playback took too long — try again',
      });
    }
    const streamId = normalizeSeriesVerifyId(type, id);
    const retryPolicy = streamResolveRetryPolicy(type, 'auto_play');
    const resolveOptions = couchResolveOptions({
      zeroStreamRetryAttempts: retryPolicy.attempts,
      zeroStreamRetryDelayMs: retryPolicy.delay_ms,
      ...options,
    });
    const [raw, filterContext] = await Promise.all([
      this.resolveRawStreams(type, streamId, resolveOptions),
      this.buildStreamFilterContext(type, id, options.identityHint),
    ]);
    if (options.deadlineAtMs !== undefined && remainingPlayBudgetMs(options.deadlineAtMs) <= 0) {
      throw new CatalogError(504, 'play deadline exceeded', undefined, {
        couchMessage: 'playback took too long — try again',
      });
    }
    if (raw.streams.length === 0) {
      if (hasStreamResolveInfrastructureErrors(raw.notes)) {
        const errorMessages = resolveNoteMessages(raw.notes);
        throw new CatalogError(
          502,
          `stream resolve failed for ${type}/${streamId}${errorMessages.length ? ` (${errorMessages.join('; ')})` : ''}`,
          { errors: errorMessages, resolve_ms: raw.resolveMs },
          { couchMessage: streamResolveCouchMessage(raw.notes) },
        );
      }
      throw new CatalogError(
        502,
        'no_playable_stream',
        {
          attempts: [],
          candidates: 0,
          errors: resolveNoteMessages(raw.notes),
          resolve_ms: raw.resolveMs,
        },
        { couchMessage: 'no streams found for this title' },
      );
    }
    const enriched = enrichStreams(raw.streams);
    if (streamsAreOnlyErrorPlaceholders(enriched)) {
      throw new CatalogError(
        502,
        `stream resolve returned only addon error streams for ${type}/${streamId}`,
        { errors: resolveNoteMessages(raw.notes), resolve_ms: raw.resolveMs },
        { couchMessage: errorPlaceholderCouchMessage(enriched) },
      );
    }
    return {
      streams: enriched,
      resolve_ms: raw.cached ? 0 : raw.resolveMs,
      cached: raw.cached,
      filters: mergeFilterConfig(this.filterConfig, overrides),
      filterContext,
      errors: raw.notes.length > 0 ? resolveNoteMessages(raw.notes) : undefined,
    };
  }

  async streams(
    type: string,
    id: string,
    overrides: StreamFilterOverrides = {},
    options: Pick<ResolveStreamOptions, 'existingOnly' | 'identityHint'> = {},
  ): Promise<{
    streams: Stream[];
    resolve_ms: number;
    cached: boolean;
    filters: StreamFilterMeta;
    errors?: string[];
  }> {
    const streamId = normalizeSeriesVerifyId(type, id);
    const retryPolicy = streamResolveRetryPolicy(type, 'stream_list');
    const [raw, filterContext] = await Promise.all([
      this.resolveRawStreams(type, streamId, couchResolveOptions({
        zeroStreamRetryAttempts: retryPolicy.attempts,
        zeroStreamRetryDelayMs: retryPolicy.delay_ms,
        requestClass: 'user',
        deadlineAtMs: Date.now() + STREAM_LIST_RESOLVE_BUDGET_MS,
        existingOnly: options.existingOnly,
      })),
      this.buildStreamFilterContext(type, id, options.identityHint),
    ]);
    const config = mergeFilterConfig(this.filterConfig, overrides);

    if (raw.streams.length === 0) {
      if (hasStreamResolveInfrastructureErrors(raw.notes)) {
        const errorMessages = resolveNoteMessages(raw.notes);
        throw new CatalogError(
          502,
          `stream resolve failed for ${type}/${streamId}${errorMessages.length ? ` (${errorMessages.join('; ')})` : ''}`,
          { errors: errorMessages, resolve_ms: raw.resolveMs },
          { couchMessage: streamResolveCouchMessage(raw.notes) },
        );
      }
      return {
        streams: [],
        resolve_ms: raw.cached ? 0 : raw.resolveMs,
        cached: raw.cached,
        filters: emptyStreamFilterMeta(config),
        errors: raw.notes.length > 0 ? resolveNoteMessages(raw.notes) : undefined,
      };
    }

    const enriched = enrichStreams(raw.streams);
    const telemetry = displayStreamTelemetry(enriched, config, filterContext);
    const { candidates, source } = selectDisplayStreamCandidates(
      enriched,
      config.play_ladder,
      filterContext,
      {
        strict_unknown_cache: config.strict_unknown_cache,
        preferred_quality: config.preferred_quality,
        preferred_hdr_tags: config.preferred_hdr_tags,
        preferred_video_codecs: config.preferred_video_codecs,
        hard_language: config.hard_language,
        preferred_language: config.preferred_language,
        min_quality: config.request_overrides.min_quality,
        max_quality: config.request_overrides.max_quality,
        exclude_remux: config.request_overrides.exclude_remux,
        max_candidates: config.stream_display_limit,
        include_uncached: config.include_uncached,
        main_ladder: config.main_ladder,
        last_resort_ladder: config.last_resort_ladder,
      },
    );

    if (candidates.length === 0) {
      if (streamsAreOnlyErrorPlaceholders(enriched)) {
        throw new CatalogError(
          502,
          `stream resolve returned only addon error streams for ${type}/${streamId}`,
          { errors: resolveNoteMessages(raw.notes), resolve_ms: raw.resolveMs },
          { couchMessage: errorPlaceholderCouchMessage(enriched) },
        );
      }
      return {
        streams: [],
        resolve_ms: raw.cached ? 0 : raw.resolveMs,
        cached: raw.cached,
        filters: {
          ...emptyStreamFilterMeta(config),
          total: raw.streams.length,
          kept: 0,
          ...telemetry,
        },
        errors: raw.notes.length > 0 ? resolveNoteMessages(raw.notes) : undefined,
      };
    }

    const fromFloor = source === 'obligation_floor' || source === 'last_resort';
    const streams = candidates.map((candidate) => {
      const unverified = fromFloor || !isVerifiedDisplayStep(candidate.ladder_step);
      return {
        ...candidate.stream,
        ladder_step: candidate.ladder_step,
        // Side-list: floor + play-only steps render as "unverified".
        ...(unverified
          ? {
            unverified: true,
            play_ladder_step: source === 'obligation_floor' ? OBLIGATION_FLOOR_STEP : candidate.ladder_step,
          }
          : {}),
      };
    });
    const meta: StreamFilterMeta = {
      applied: config,
      total: raw.streams.length,
      kept: candidates.length,
      play_ladder_step: source === 'obligation_floor' ? OBLIGATION_FLOOR_STEP : 'preview',
      play_ladder_preview: !fromFloor,
      obligation_floor_preview: fromFloor || undefined,
      ...telemetry,
    };

    return {
      streams,
      resolve_ms: raw.cached ? 0 : raw.resolveMs,
      cached: raw.cached,
      filters: meta,
      errors: raw.notes.length > 0 ? resolveNoteMessages(raw.notes) : undefined,
    };
  }

  private requireRailConfig(): RailConfig {
    if (this.railConfig) {
      return this.railConfig;
    }
    const reason = this.railConfigError?.message || 'catalog yaml not loaded';
    throw new CatalogError(503, `catalog rails unavailable: ${reason}`);
  }

  private findAddonByName(name: string): Addon {
    const exact = this.maybeFindAddonByName(name);
    if (exact) {
      return exact;
    }
    throw new CatalogError(
      502,
      `addon not found: ${name}; available: ${this.addons.map((addon) => addon.name).join(', ')}`,
    );
  }

  private maybeFindAddonByName(name: string): Addon | null {
    const exact = this.addons.find((addon) => addon.name === name);
    if (exact) {
      return exact;
    }
    const normalized = normalizeAddonName(name);
    const fuzzy = this.addons.find((addon) => normalizeAddonName(addon.name) === normalized);
    if (fuzzy) {
      return fuzzy;
    }
    return null;
  }

  private metaAddonsInOrder(): Addon[] {
    return [...this.addons].sort((left, right) => {
      const leftCinemeta = normalizeAddonName(left.name) === 'cinemeta';
      const rightCinemeta = normalizeAddonName(right.name) === 'cinemeta';
      if (leftCinemeta === rightCinemeta) return 0;
      return leftCinemeta ? -1 : 1;
    });
  }

  private cacheMetaRateLimit(key: string): void {
    this.metaCache.set(key, {
      blocked: true,
      expiresAt: Date.now() + META_RATE_LIMIT_BACKOFF_MS,
    });
  }

  async metaCached(type: string, id: string): Promise<Meta> {
    const key = `${type}:${id}`;
    const cached = this.metaCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.blocked) {
        throw new CatalogError(503, 'meta rate limited', undefined, {
          couchMessage: couchSafeCatalogMessage('rate limit exceeded'),
        });
      }
      return cached.meta as Meta;
    }
    try {
      const meta = await this.meta(type, id);
      if (isBlockedCatalogMeta(meta)) {
        this.cacheMetaRateLimit(key);
        throw new CatalogError(503, 'meta rate limited', undefined, {
          couchMessage: couchSafeCatalogMessage('rate limit exceeded'),
        });
      }
      this.metaCache.set(key, { meta, expiresAt: Date.now() + META_CACHE_TTL_MS });
      return meta;
    } catch (error) {
      if (
        error instanceof CatalogError
        && (error.status === 503 || isAddonRateLimitMessage(error.message))
      ) {
        this.cacheMetaRateLimit(key);
      }
      throw error;
    }
  }

  private async resolveRawStreams(
    type: string,
    id: string,
    options: ResolveStreamOptions = {},
  ): Promise<RawStreamResolution> {
    const primary = await this.rawStreams(type, id, options);
    if (type !== 'series') {
      return primary;
    }

    const parsed = parseSeriesEpisodeId(id);
    if (!parsed) {
      return primary;
    }

    const role = await this.episodeStreamRoleFromMeta(parsed.bare, id);
    if (role === 'bonus') {
      return this.resolveBonusRoleEpisodeStreams(id, parsed, primary, options);
    }

    return this.resolveMainRoleEpisodeStreams(id, parsed, primary, options);
  }

  private async episodeStreamRoleFromMeta(
    bareId: string,
    episodeId: string,
  ): Promise<'main' | 'bonus'> {
    try {
      const meta = await this.metaCached('series', bareId);
      const videos = Array.isArray(meta.videos) ? meta.videos : [];
      return episodeStreamRoleForId(videos, episodeId);
    } catch {
      return parsedSeasonRole(episodeId);
    }
  }

  private async resolveMainRoleEpisodeStreams(
    episodeId: string,
    parsed: ParsedSeriesEpisodeId,
    primary: RawStreamResolution,
    options: ResolveStreamOptions,
  ): Promise<RawStreamResolution> {
    let streams = pickMainEpisodeStreams(primary.streams, parsed.season, parsed.episode);
    let resolveMs = primary.resolveMs;
    const notes = [...primary.notes];
    let usedCrossProbe = false;

    const crossProbeLimit = seriesCrossProbeLimit(options);
    if (streams.length === 0 && crossProbeLimit > 0) {
      const probed = await this.resolveMainEpisodeCrossProbe(episodeId, parsed, crossProbeLimit, options);
      usedCrossProbe = true;
      resolveMs += probed.resolveMs;
      notes.push(...probed.notes);
      streams = probed.streams;
    }

    if (streams.length === 0 && primary.streams.length > 0) {
      notes.push(resolveNote('annotation', 'main partition empty — keeping indexer pool (mislabel fallback)'));
      return {
        streams: primary.streams,
        notes,
        resolveMs,
        cached: primary.cached,
      };
    }

    if (streams.length === 0) {
      return { streams: [], notes, resolveMs, cached: primary.cached };
    }

    return {
      streams,
      notes,
      resolveMs,
      cached: usedCrossProbe ? false : primary.cached,
    };
  }

  private async resolveMainEpisodeCrossProbe(
    episodeId: string,
    parsed: ParsedSeriesEpisodeId,
    limit = 24,
    options: ResolveStreamOptions = {},
  ): Promise<RawStreamResolution> {
    const notes: ResolveNote[] = [];
    let resolveMs = 0;
    const probeIds = await this.episodeCrossProbeIds(parsed.bare, episodeId, parsed, limit);
    const collected: Stream[] = [];
    for (const probeId of probeIds) {
      if (probeId === episodeId) {
        continue;
      }
      recordResolveMetric('alias_probes');
      emitPlaybackTelemetry('resolve_alias_probe', {
        resolve_request_class: options.requestClass ?? 'background',
        alias_probe_count: 1,
      });
      const probe = await this.rawStreams('series', probeId, options);
      resolveMs += probe.resolveMs;
      notes.push(...probe.notes, resolveNote('annotation', `main cross-probe ${probeId}`));
      collected.push(
        ...pickMainEpisodeStreams(probe.streams, parsed.season, parsed.episode, {
          requireEpisodeLabel: true,
        }),
      );
      if (collected.length >= 2) {
        break;
      }
    }
    return {
      streams: dedupeStreamsByUrl(collected),
      notes,
      resolveMs,
      cached: false,
    };
  }

  private async resolveBonusRoleEpisodeStreams(
    episodeId: string,
    parsed: ParsedSeriesEpisodeId,
    primary: RawStreamResolution,
    options: ResolveStreamOptions,
  ): Promise<RawStreamResolution> {
    if (parsed.season === 0 && primary.streams.length === 0) {
      const fallback = await this.resolveBonusEpisodeStreams(episodeId, parsed, options);
      if (fallback.streams.length === 0) {
        return primary;
      }

      const key = `series:${episodeId}`;
      const notes = [...primary.notes, ...fallback.notes];
      if (hasCacheableStream(fallback.streams)) {
        this.streamNegativeCache.delete(key);
        this.streamCache.set(key, {
          streams: fallback.streams,
          notes,
          resolveMs: primary.resolveMs + fallback.resolveMs,
          expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
        });
      }

      return {
        streams: fallback.streams,
        notes,
        resolveMs: primary.resolveMs + fallback.resolveMs,
        cached: false,
      };
    }

    const episodeTitle = await this.episodeTitleFromMeta(parsed.bare, episodeId);
    let streams = pickBonusStreamsFromCandidates(
      primary.streams,
      parsed.episode,
      episodeTitle,
    );
    let resolveMs = primary.resolveMs;
    const notes = [...primary.notes];
    let usedFallback = false;

    if (streams.length === 0) {
      const fallback = await this.resolveBonusEpisodeStreams(episodeId, parsed, options);
      usedFallback = true;
      resolveMs += fallback.resolveMs;
      notes.push(...fallback.notes);
      streams = fallback.streams;
    }

    if (streams.length === 0) {
      if (primary.streams.length === 0) {
        return primary;
      }
      notes.push(resolveNote('annotation', 'bonus partition empty'));
      return { streams: [], notes, resolveMs, cached: primary.cached };
    }

    return {
      streams,
      notes,
      resolveMs,
      cached: usedFallback ? false : primary.cached,
    };
  }

  private async resolveBonusEpisodeStreams(
    episodeId: string,
    parsed: ParsedSeriesEpisodeId,
    options: ResolveStreamOptions,
  ): Promise<RawStreamResolution> {
    const notes: ResolveNote[] = [];
    let resolveMs = 0;
    const videos = await this.episodeVideosFromMeta(parsed.bare);
    const episodeTitle = await this.episodeTitleFromMeta(parsed.bare, episodeId);
    const crossProbeLimit = seriesCrossProbeLimit(options);
    let probesUsed = 0;

    // Documented S0→S{N} same-episode indexer alias (bonusIndexerProbeIds). Always
    // allow these few probes on couch — they are not the broad sibling scrape that
    // MANGO_STREAM_SERIES_CROSS_PROBE_LIMIT=0 was meant to stop (Torrentio 429s).
    const aliasIds = bonusIndexerProbeIds(episodeId, videos);
    for (const probeId of aliasIds) {
      probesUsed += 1;
      recordResolveMetric('alias_probes');
      emitPlaybackTelemetry('resolve_alias_probe', {
        resolve_request_class: options.requestClass ?? 'background',
        alias_probe_count: 1,
      });
      const probe = await this.rawStreams('series', probeId, options);
      resolveMs += probe.resolveMs;
      notes.push(...probe.notes, resolveNote('annotation', `bonus indexer probe ${probeId}`));
      const aliasStreams = pickBonusStreamsFromCandidates(
        probe.streams,
        parsed.episode,
        episodeTitle,
        'strict',
      );
      if (aliasStreams.length > 0) {
        return {
          streams: aliasStreams,
          notes,
          resolveMs,
          cached: false,
        };
      }
    }

    // Broad title-fallback sibling scrape stays gated (default 0 on couch).
    if (crossProbeLimit <= 0) {
      if (aliasIds.length === 0) {
        notes.push(resolveNote('annotation', 'bonus indexer alias unavailable'));
      }
      return { streams: [], notes, resolveMs, cached: false };
    }

    if (!episodeTitle) {
      notes.push(resolveNote('annotation', 'bonus title fallback: episode title unavailable'));
      return { streams: [], notes, resolveMs, cached: false };
    }

    const probeIds = await this.episodeCrossProbeIds(parsed.bare, episodeId, parsed, crossProbeLimit);
    const tiers: BonusStreamMatchTier[] = ['strict', 'relaxed'];
    for (const tier of tiers) {
      const collected: Stream[] = [];
      for (const probeId of probeIds) {
        if (probesUsed >= crossProbeLimit + aliasIds.length) {
          break;
        }
        probesUsed += 1;
        recordResolveMetric('alias_probes');
        emitPlaybackTelemetry('resolve_alias_probe', {
          resolve_request_class: options.requestClass ?? 'background',
          alias_probe_count: 1,
        });
        const probe = await this.rawStreams('series', probeId, options);
        resolveMs += probe.resolveMs;
        notes.push(...probe.notes, resolveNote('annotation', `bonus ${tier} probe ${probeId}`));
        collected.push(
          ...pickBonusStreamsFromCandidates(probe.streams, parsed.episode, episodeTitle, tier),
        );
        if (collected.length >= 2) {
          break;
        }
      }
      const streams = dedupeStreamsByUrl(collected);
      if (streams.length > 0) {
        return { streams, notes, resolveMs, cached: false };
      }
    }

    return { streams: [], notes, resolveMs, cached: false };
  }

  private async episodeVideosFromMeta(
    bareId: string,
  ): Promise<Array<{ id?: string; season?: number; episode?: number }>> {
    try {
      const meta = await this.metaCached('series', bareId);
      return Array.isArray(meta.videos) ? meta.videos : [];
    } catch {
      return [];
    }
  }

  private async episodeTitleFromMeta(bareId: string, episodeId: string): Promise<string | null> {
    try {
      const meta = await this.metaCached('series', bareId);
      const videos = Array.isArray(meta.videos) ? meta.videos : [];
      for (const video of videos) {
        if (video.id !== episodeId) {
          continue;
        }
        if (typeof video.title === 'string' && video.title.trim()) {
          return video.title.trim();
        }
        if (typeof video.name === 'string' && video.name.trim()) {
          return video.name.trim();
        }
      }
    } catch {
      // meta unavailable — title fallback skipped
    }
    return null;
  }

  private async episodeCrossProbeIds(
    bareId: string,
    excludeId: string,
    target: ParsedSeriesEpisodeId,
    limit = 24,
  ): Promise<string[]> {
    const videos = await this.episodeVideosFromMeta(bareId);
    return listEpisodeCrossProbeIds(bareId, videos, target, excludeId, limit);
  }

  private async rawStreams(
    type: string,
    id: string,
    options: ResolveStreamOptions = {},
  ): Promise<RawStreamResolution> {
    const key = `${type}:${id}`;
    const cached = this.streamCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      recordResolverContributions(options.requestClass ?? 'background', cached.streams);
      return {
        streams: cached.streams,
        notes: cached.notes,
        resolveMs: cached.resolveMs,
        cached: true,
      };
    }

    if (options.existingOnly) {
      const requestClass = options.requestClass ?? 'background';
      const flightKey = streamFlightKey(key, options);
      const inflight = this.streamInFlight.get(flightKey);
      if (inflight) {
        // Detail-pane timeout recovery must reuse the provider work already in
        // progress. It is intentionally not allowed to create another fan-out.
        recordResolveMetric(requestClass === 'user' ? 'flight_join_user' : 'flight_join_background');
        emitPlaybackTelemetry('resolve_flight', {
          resolve_request_class: requestClass,
          flight_result: 'join_equivalent',
        });
        return inflight.promise;
      }
      return {
        streams: [],
        notes: [resolveNote('skip', 'stream resolve unavailable from existing work')],
        resolveMs: 0,
        cached: true,
      };
    }

    const negative = this.streamNegativeCache.get(key);
    if (negative && negative.until > Date.now()) {
      // user = couch play / detail: bypass miss; soft-respect confirmed rate_limit (D3B)
      if (options.requestClass === 'user') {
        if (negative.reason === 'rate_limited' && negative.userUntil > Date.now()) {
          return {
            streams: [],
            notes: [resolveNote('infra', 'stream resolve skipped — recent rate-limit (retry shortly)')],
            resolveMs: 0,
            cached: true,
          };
        }
        this.streamNegativeCache.delete(key);
      } else {
        const skipNote = negative.reason === 'rate_limited'
          ? resolveNote('infra', 'stream resolve skipped — recent rate-limit (retry shortly)')
          : resolveNote('skip', 'stream resolve skipped — recent miss (retry shortly)');
        return {
          streams: [],
          notes: [skipNote],
          resolveMs: 0,
          cached: true,
        };
      }
    }
    if (negative && negative.until <= Date.now()) {
      this.streamNegativeCache.delete(key);
    }

    const requestClass = options.requestClass ?? 'background';
    const behaviorKey = streamFlightBehaviorKey(options);
    const flightKey = streamFlightKey(key, options);
    const inflight = this.streamInFlight.get(flightKey);
    if (inflight) {
      // A concurrent identical resolve is already running — join it rather than
      // firing a second AIO fan-out for the same title in the same window.
      recordResolveMetric(requestClass === 'user' ? 'flight_join_user' : 'flight_join_background');
      emitPlaybackTelemetry('resolve_flight', {
        resolve_request_class: requestClass,
        flight_result: 'join_equivalent',
      });
      return inflight.promise;
    }
    if (requestClass === 'user' && [...this.streamInFlight.values()].some(
      (flight) => flight.baseKey === key && flight.requestClass === 'background',
    )) {
      recordResolveMetric('foreground_bypass_background');
      emitPlaybackTelemetry('resolve_flight', {
        resolve_request_class: requestClass,
        flight_result: 'foreground_bypass_background',
      });
    }
    if (requestClass === 'background') {
      const foreground = [...this.streamInFlight.values()].find(
        (flight) => flight.baseKey === key
          && flight.requestClass === 'user',
      );
      if (foreground) {
        if (foreground.behaviorKey === behaviorKey) {
          recordResolveMetric('flight_join_background');
          emitPlaybackTelemetry('resolve_flight', {
            resolve_request_class: requestClass,
            flight_result: 'background_join_foreground',
          });
          return foreground.promise;
        }
        // A maintenance resolve may need different retries/cross-probes, so it
        // cannot inherit the couch result blindly. Wait until the user flight
        // releases provider capacity, then re-enter with the background's own
        // behavior and deadline. A cacheable couch result will satisfy that
        // re-entry without another fan-out; an empty/transient result may retry
        // only after the couch request is finished.
        recordResolveMetric('background_defer_foreground');
        emitPlaybackTelemetry('resolve_flight', {
          resolve_request_class: requestClass,
          flight_result: 'background_defer_foreground',
        });
        await foreground.promise.catch(() => undefined);
        return this.rawStreams(type, id, options);
      }
    }
    const generation = this.streamInvalidationGeneration.get(key) ?? 0;
    let resolve: Promise<RawStreamResolution>;
    resolve = this.performRawStreamResolve(type, id, key, options, generation)
      .finally(() => {
        if (this.streamInFlight.get(flightKey)?.promise === resolve) {
          this.streamInFlight.delete(flightKey);
        }
      });
    this.streamInFlight.set(flightKey, { baseKey: key, behaviorKey, requestClass, promise: resolve });
    return resolve;
  }

  private async performRawStreamResolve(
    type: string,
    id: string,
    key: string,
    options: ResolveStreamOptions,
    generation: number,
  ): Promise<RawStreamResolution> {
    const cacheStillCurrent = (): boolean => (
      (this.streamInvalidationGeneration.get(key) ?? 0) === generation
    );
    if (type === 'tv' && isArea69ChannelId(id)) {
      const streamId = parseArea69StreamId(id);
      if (!streamId) {
        return {
          streams: [],
          notes: [resolveNote('addon_error', 'area69 stream resolve failed: invalid channel id')],
          resolveMs: 0,
          cached: false,
        };
      }
      const started = Date.now();
      const streams = await resolveArea69Streams(streamId);
      const resolveMs = Date.now() - started;
      const notes = streams.length > 0
        ? []
        : [resolveNote('addon_error', 'area69 stream resolve failed: missing credentials or stream unavailable')];
      if (hasCacheableStream(streams) && cacheStillCurrent()) {
        this.streamCache.set(key, {
          streams,
          notes,
          resolveMs,
          expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
        });
      }
      return { streams, notes, resolveMs, cached: false };
    }

    const retryAttempts = boundedInt(options.zeroStreamRetryAttempts, 0, 0, 3);
    const retryDelayMs = boundedInt(options.zeroStreamRetryDelayMs, 0, 0, 10000);
    const overallStarted = Date.now();
    let streams: Stream[] = [];
    let notes: ResolveNote[] = [];
    let retryFallbackStreams: Stream[] = [];
    let retriesPerformed = 0;
    let invalidated = false;

    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      if (!cacheStillCurrent()) {
        invalidated = true;
        break;
      }
      // Live/IPTV addons advertise `stream` but must not join movie/series fan-out —
      // their 429/empty responses race AIOStreams and leave couch titles with zero rows.
      const liveNames = liveAddonNames(this.liveRailConfig);
      const streamAddons = this.addons.filter((addon) => {
        if (!supportsResource(addon.manifest, 'stream', type)) return false;
        if (type !== 'tv' && looksLikeLiveAddon(
          { name: addon.name, manifestUrl: addon.manifestUrl },
          liveNames,
        )) {
          return false;
        }
        return true;
      });
      const fanoutStarted = Date.now();
      const settled = await Promise.allSettled(
        streamAddons.map((addon) => {
          const addonStarted = Date.now();
          const category = resolverProviderCategory(addon.name);
          return this.fetchAddonStreams(addon, type, id, options).then(
            (result) => {
              recordResolverProviderOutcome(
                category,
                result.streams.length > 0 ? 'success' : 'empty',
                result.streams.length,
                Date.now() - addonStarted,
              );
              return result;
            },
            (error) => {
              recordResolverProviderOutcome(category, 'error', 0, Date.now() - addonStarted);
              throw error;
            },
          );
        }),
      );
      const fanoutMs = Date.now() - fanoutStarted;
      recordProviderFanout(streamAddons.length, fanoutMs);
      emitPlaybackTelemetry('provider_fanout', {
        resolve_request_class: options.requestClass ?? 'background',
        provider_fanout_count: streamAddons.length,
        provider_fanout_ms: fanoutMs,
        retry_attempt: attempt,
      });

      streams = [];
      notes = [];
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          streams.push(...result.value.streams);
        } else {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          notes.push(resolveNote('addon_error', message));
        }
      }
      const retryReason = streamResolveRetryReason(streams, notes);
      if (
        retryReason === null
        || attempt >= retryAttempts
        || !hasStreamResolveRetryBudget(options.deadlineAtMs, retryDelayMs)
      ) {
        break;
      }
      if (retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
      if (!cacheStillCurrent()) {
        invalidated = true;
        streams = [];
        notes = [resolveNote('skip', 'stream resolve invalidated')];
        break;
      }
      if (!hasStreamResolveRetryBudget(options.deadlineAtMs, 0)) {
        break;
      }
      if (retryReason === 'transient_placeholder') {
        retryFallbackStreams = streams;
      }
      retriesPerformed += 1;
      recordResolveMetric('stream_resolve_retries');
      emitPlaybackTelemetry('stream_resolve_retry', {
        resolve_request_class: options.requestClass ?? 'background',
        retry_attempt: attempt + 1,
        retry_reason: retryReason,
      });
    }

    if (streams.length === 0 && retryFallbackStreams.length > 0) {
      streams = retryFallbackStreams;
    }

    if (invalidated || !cacheStillCurrent()) {
      return {
        streams: [],
        notes: notes.length > 0 ? notes : [resolveNote('skip', 'stream resolve invalidated')],
        resolveMs: Date.now() - overallStarted,
        cached: false,
      };
    }

    const supplemented = await this.supplementThinStreams(type, id, streams, notes, options);
    streams = supplemented.streams;
    notes = supplemented.notes;
    // Record the final user-visible pool, including an optional direct
    // MediaFusion supplement rather than only the pre-supplement AIO result.
    recordResolverContributions(options.requestClass ?? 'background', streams);

    const resolveMs = Date.now() - overallStarted;
    if (retriesPerformed > 0 && hasCacheableStream(streams)) {
      recordResolveMetric('stream_resolve_retry_recoveries');
      notes = [
        ...notes,
        resolveNote('annotation', `stream resolve recovered after ${retriesPerformed + 1} attempts`),
      ];
    } else if (retriesPerformed > 0) {
      recordResolveMetric('stream_resolve_retry_exhaustions');
      notes = [
        ...notes,
        resolveNote('annotation', `zero streams after ${retriesPerformed + 1} attempts`),
      ];
    }
    if (streams.length > 0 && hasCacheableStream(streams) && cacheStillCurrent()) {
      this.streamNegativeCache.delete(key);
      this.streamCache.set(key, {
        streams,
        notes,
        resolveMs,
        expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
      });
    } else if (streams.length > 0 && cacheStillCurrent()) {
      // Confirmed rate-limit only → busy backoff. Timeouts/5xx → miss (user retries immediately).
      const rateLimited = hasStreamResolveRateLimitErrors(notes)
        || streamErrorPlaceholderCategory(streams) === 'rate_limited'
        || streams.some((stream) => isRateLimitedStreamUrl(stream.url || ''));
      if (rateLimited) recordResolveMetric('rate_limit_classifications');
      const now = Date.now();
      this.streamNegativeCache.set(key, {
        until: now + (rateLimited ? STREAM_RATE_LIMIT_BACKOFF_MS : STREAM_NEGATIVE_CACHE_MS),
        userUntil: now + (rateLimited ? STREAM_USER_RATE_LIMIT_BACKOFF_MS : 0),
        reason: rateLimited ? 'rate_limited' : 'miss',
      });
    } else if (cacheStillCurrent()) {
      // True empty. Rate-limit → busy backoff; timeout/infra → miss so couch can retry now.
      const rateLimited = hasStreamResolveRateLimitErrors(notes);
      if (rateLimited) recordResolveMetric('rate_limit_classifications');
      const now = Date.now();
      this.streamNegativeCache.set(key, {
        until: now + (rateLimited ? STREAM_RATE_LIMIT_BACKOFF_MS : STREAM_NEGATIVE_CACHE_MS),
        userUntil: now + (rateLimited ? STREAM_USER_RATE_LIMIT_BACKOFF_MS : 0),
        reason: rateLimited ? 'rate_limited' : 'miss',
      });
    }
    return { streams, notes, resolveMs, cached: false };
  }

  /**
   * When AIO leaves ≤1 cacheable stream, optionally merge MediaFusion direct
   * (Pi-local share URL). Skipped when MediaFusion is already a catalog addon.
   */
  private async supplementThinStreams(
    type: string,
    id: string,
    streams: Stream[],
    notes: ResolveNote[],
    options: ResolveStreamOptions = {},
  ): Promise<{ streams: Stream[]; notes: ResolveNote[] }> {
    const hasDirectMediaFusion = this.addons.some((addon) => (
      isMediaFusionAddon(addon.name, addon.manifestUrl)
    ));
    if (!shouldSupplementThinStreams(streams, { hasDirectMediaFusion })) {
      return { streams, notes };
    }
    // 3A: primary hard-timeout + empty → skip MF (no extra ~8s dead wait).
    if (shouldSkipThinSupplementAfterPrimaryTimeout(streams, notes)) {
      return {
        streams,
        notes: [
          ...notes,
          resolveNote('annotation', 'mediafusion thin-supplement skipped — primary timed out'),
        ],
      };
    }
    const manifestUrl = await loadMediaFusionManifestUrl();
    if (!manifestUrl) {
      return { streams, notes };
    }
    let supplementStarted = 0;
    try {
      const supplementBudget = options.deadlineAtMs === undefined
        ? MEDIAFUSION_SUPPLEMENT_BUDGET_MS
        : capToPlayBudgetMs(MEDIAFUSION_SUPPLEMENT_BUDGET_MS, options.deadlineAtMs);
      if (supplementBudget <= 0) {
        return {
          streams,
          notes: [...notes, resolveNote('annotation', 'mediafusion thin-supplement skipped — play deadline exhausted')],
        };
      }
      supplementStarted = Date.now();
      const result = await fetchJson(
        mediaFusionStreamUrl(manifestUrl, type, id),
        supplementBudget,
      ) as { streams?: unknown[] };
      const extra: Stream[] = [];
      for (const stream of result.streams || []) {
        const normalized = normalizeStream(stream, 'MediaFusion');
        if (normalized) extra.push(normalized);
      }
      if (extra.length === 0) {
        recordResolverProviderOutcome(
          'mediafusion',
          'empty',
          0,
          Date.now() - supplementStarted,
        );
        return { streams, notes };
      }
      recordResolverProviderOutcome(
        'mediafusion',
        'success',
        extra.length,
        Date.now() - supplementStarted,
      );
      return {
        streams: mergeUniqueStreams(streams, extra),
        notes: [...notes, resolveNote('annotation', `mediafusion thin-supplement +${extra.length}`)],
      };
    } catch (error) {
      recordResolverProviderOutcome(
        'mediafusion',
        'error',
        0,
        supplementStarted > 0 ? Date.now() - supplementStarted : 0,
      );
      return {
        streams,
        notes: [
          ...notes,
          resolveNote(
            'addon_error',
            `mediafusion thin-supplement: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ],
      };
    }
  }

  private async fetchAddonStreams(
    addon: Addon,
    type: string,
    id: string,
    options: ResolveStreamOptions = {},
  ): Promise<{ streams: Stream[] }> {
    try {
      const classBudget = streamResolveBudgetMs(options.requestClass);
      const fetchBudget = options.deadlineAtMs === undefined
        ? classBudget
        : capToPlayBudgetMs(classBudget, options.deadlineAtMs);
      if (fetchBudget <= 0) {
        throw new Error('play deadline exceeded');
      }
      const result = await fetchJson(
        resourceUrl(addon, 'stream', type, id),
        fetchBudget,
      ) as { streams?: unknown[] };
      const streams: Stream[] = [];
      for (const stream of result.streams || []) {
        const normalized = normalizeStream(stream, addon.name);
        if (normalized) streams.push(normalized);
      }
      return { streams };
    } catch (error) {
      throw new Error(`${addon.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async resolveSavedRailItem(
    item: SavedLibraryItem,
    options: { cachedOnly?: boolean } = {},
  ): Promise<RailItem> {
    const title = item.title?.trim();
    const poster = normalizePosterUrl(item.poster) ?? metahubPosterUrl(item.id);
    if (title && poster) {
      return {
        id: item.id,
        type: item.type,
        title,
        subtitle: item.year ?? item.type,
        poster,
        year: item.year ?? undefined,
        description: item.description ?? undefined,
        source: 'saved',
      };
    }

    if (options.cachedOnly) {
      return {
        id: item.id,
        type: item.type,
        title: title || item.id,
        subtitle: item.year ?? item.type,
        poster: poster || '',
        year: item.year ?? undefined,
        description: item.description ?? undefined,
        source: 'saved',
      };
    }

    try {
      const meta = await this.metaCached(item.type, item.id);
      if (isBlockedCatalogMeta(meta)) {
        throw new Error('blocked meta');
      }
      const resolvedPoster = resolvePosterFromMeta(meta) || poster || '';
      const resolvedTitle = (typeof meta.name === 'string' && meta.name.trim() !== '' ? meta.name : null)
        || (typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title : null)
        || title
        || item.id;
      const year = metaYear(meta);
      return {
        id: item.id,
        type: item.type,
        title: resolvedTitle,
        subtitle: year ? String(year) : item.type,
        poster: resolvedPoster,
        year,
        description: typeof meta.description === 'string' ? meta.description : undefined,
        source: 'saved',
      };
    } catch {
      return {
        id: item.id,
        type: item.type,
        title: title || item.id,
        subtitle: item.year ?? item.type,
        poster: poster || '',
        year: item.year ?? undefined,
        description: item.description ?? undefined,
        source: 'saved',
      };
    }
  }

  private async resolveVerifiedRailItem(item: RailSessionPoolItem): Promise<RailItem | null> {
    const fromPool = this.railItemFromPoolSnapshot(item);
    if (fromPool) {
      return fromPool;
    }

    try {
      const meta = await this.metaCached(item.type, item.id);
      if (isBlockedCatalogMeta(meta)) {
        return null;
      }
      const poster = resolvePosterFromMeta(meta);
      if (!poster) {
        return null;
      }
      const year = metaYear(meta);
      const title = meta.name || item.id;
      await patchRailPoolDisplay(item.rail_id, item.type, item.id, {
        title: typeof title === 'string' ? title : String(title),
        poster_url: poster,
        year: year != null ? String(year) : null,
      }).catch(() => undefined);
      return {
        id: meta.id || item.id,
        type: meta.type || item.type,
        title: typeof title === 'string' ? title : String(title),
        subtitle: year ? String(year) : item.type,
        poster,
        year,
        description: typeof meta.description === 'string' ? meta.description : undefined,
        source: item.best_source || 'verified',
      };
    } catch (error) {
      console.warn(
        `verified rail item skipped rail=${item.rail_id} id=${item.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private railItemFromPoolSnapshot(item: RailSessionPoolItem): RailItem | null {
    const title = item.title?.trim();
    const poster = normalizePosterUrl(item.poster_url) ?? metahubPosterUrl(item.id, 'medium');
    if (!title) {
      return null;
    }
    const year = item.year?.trim() || undefined;
    return {
      id: item.id,
      type: item.type,
      title,
      subtitle: year || item.type,
      poster: poster || '',
      year,
      source: item.best_source || 'verified',
    };
  }

}
