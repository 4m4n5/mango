import { createHash } from 'node:crypto';
import { CatalogError } from '../catalog-errors.js';
import { playUrl } from '../mpv.js';
import { assertPlayEpoch, bumpPlayEpoch } from '../play-cancel.js';
import { startWatchSessionFromPlay } from '../progress/watcher.js';
import {
  activeViewerProfileId,
  appendProfileRecommendationEvent,
  clearLibraryFeedbackForSource,
  clearProfileRecommendationEvents,
  clearWatchHistoryForSource,
  getLibraryState,
  getPersonalizationState,
  getSearchPreferences,
  listProfileLibraryFeedback,
  listProfileRecommendationEvents,
  listProfileRecommendationSignals,
  listSavedLibraryItems,
  listUniqueWatchHistory,
  listWatchHistory,
  listViewerProfiles,
  recordLibraryWatch,
  setLibraryFeedback,
  type LibraryItemInput,
  type PersonalizationState,
} from '../library/db.js';
import { deleteAiCatalogSlot, loadAiCatalogSlots, slotsForTab } from '../ai-catalogs/store.js';
import { YoutubeApiClient, type YoutubeChannelStats } from './api.js';
import { clearYoutubeAuth, pollYoutubeDeviceAuth, startYoutubeDeviceAuth, youtubeAccessToken, youtubeAuthSummary } from './auth.js';
import { loadYoutubeConfig, type YoutubeConfig } from './config.js';
import {
  getYoutubeItem,
  getYoutubeSearchCache,
  getYoutubeState,
  initYoutubeDb,
  clearYoutubeProfileCandidateStates,
  listAllYoutubeV2CandidateIds,
  listBecauseYouWatchedCandidates,
  listFreshFindCandidates,
  listForYouCandidates,
  listLiveNowCandidates,
  listPopularCandidates,
  listYoutubeProfileCandidateStates,
  listYoutubeItems,
  listYoutubeRailItems,
  listYoutubeV2ImportedHistory,
  listYoutubeV2Subscriptions,
  latestYoutubeV2GenerationRecord,
  pruneBecauseYouWatchedCandidates,
  pruneFreshFindCandidates,
  pruneLiveNowCandidates,
  prunePopularCandidates,
  replaceYoutubeV2Subscriptions,
  clearYoutubePersonalizationReservoirs,
  deleteYoutubeState,
  replaceForYouCandidates,
  replaceYoutubeRailItems,
  recordYoutubeImpressions,
  searchCachedYoutubeItems,
  setYoutubeState,
  putYoutubeSearchCache,
  upsertBecauseYouWatchedCandidates,
  upsertFreshFindCandidates,
  upsertLiveNowCandidates,
  upsertPopularCandidates,
  upsertYoutubeV2CandidateProvenance,
  upsertYoutubeItems,
  youtubeV2ServingEpoch,
  youtubeCacheSummary,
  youtubeRefreshStatus,
  type YoutubeBecauseYouWatchedCandidate,
  type YoutubeFreshFindCandidate,
  type YoutubeForYouCandidate,
  type YoutubeLiveNowCandidate,
  type YoutubePopularCandidate,
  type YoutubeProfileCandidateState,
} from './db.js';
import { resolveYoutubePlayback, shouldRefreshYoutubeTransport } from './playback.js';
import { readProfileSync } from '../companion/profile.js';
import type {
  YoutubeItem,
  YoutubeItemKind,
  YoutubeRail,
  YoutubeRailItem,
  YoutubeRefreshPhaseResult,
  YoutubeSearchGroups,
} from './types.js';
import { buildYoutubeAiCatalogRails, youtubeAiCatalogPoolItems } from './ai-catalog-rails.js';
import { YOUTUBE_RAIL_LIMIT } from './constants.js';
import type { PersonalizationSnapshot } from '../personalization-coherence.js';
import { assertExpectedPersonalization } from '../personalization-request.js';
import {
  YOUTUBE_V2_CANDIDATE_TTL_MS,
  YOUTUBE_V2_LIVE_TTL_MS,
  rebuildYoutubeV2Generation,
  youtubePlayStartUsesLegacyAcquisition,
  youtubeRecommendationsV2Mode,
  youtubeV2Diagnostics,
  youtubeV2DiscoverySeeds,
  youtubeV2HistoryItems,
  youtubeV2RecommendationRails,
  youtubeV2SourceStaleState,
  youtubeV2TopicSeed,
  type YoutubeV2TopicSeed,
} from './v2.js';

export {
  importYoutubeTakeout,
  importYoutubeTakeoutFile,
  importYoutubeTakeoutStream,
  parseYoutubeTakeout,
  parseYoutubeTakeoutFile,
} from './takeout.js';
export {
  youtubePublicPersonalizationPayload,
  youtubeRecommendationsV2Mode,
} from './v2.js';

const YOUTUBE_SOURCE = 'youtube';
const YOUTUBE_TAB = 'youtube';
const YOUTUBE_VIDEO_TYPE = 'youtube_video';
const YOUTUBE_RAIL_POOL_LIMIT = 60;
// TTL for the assembled /youtube/rails discovery payload (For You / New From
// Subscriptions / Fresh Finds / Because You Watched / Live Now / Popular).
// Shorter than movies/series because YouTube rails also carry user-state
// (Not-Interested). Saved/History rails are excluded from this cache and
// assembled fresh on every request so save/unsave/watch is reflected
// immediately. The cache is invalidated on not-interested, save/unsave, play,
// and after a refresh completes.
const YOUTUBE_RAILS_CACHE_TTL_MS = Number(
  process.env.MANGO_YOUTUBE_RAILS_CACHE_TTL_MS || 60_000,
);
const SUBSCRIPTION_CHANNEL_SCAN_LIMIT = 50;
// `YoutubeApiClient.subscriptions` paginates until either this bound or the
// provider's nextPageToken ends. V2 treats only a complete OAuth read as the
// authoritative replacement, so use the practical integer ceiling.
const V2_SUBSCRIPTION_CHANNEL_SCAN_LIMIT = Number.MAX_SAFE_INTEGER;
const SUBSCRIPTION_CHANNELS_PER_REFRESH = 24;
const SUBSCRIPTION_ACTIVE_CHANNELS_PER_REFRESH = 12;
const SUBSCRIPTION_VIDEOS_PER_CHANNEL = 8;

export function youtubeV2AcquisitionQueryBudget(reason: string): {
  more_like: number;
  beyond: number;
  total: number;
} {
  const nightly = /(?:nightly|scheduled|maintenance)/i.test(reason);
  const moreLike = nightly ? 4 : 3;
  const beyond = nightly ? 8 : 2;
  return { more_like: moreLike, beyond, total: moreLike + beyond };
}
const SUBSCRIPTION_RAIL_POOL_LIMIT = 160;
const FOR_YOU_RESERVOIR_TARGET = 1000;
// Internal acquisition provenance for the legacy v4 reservoir. This is never
// rendered as a couch rail; it prevents v2-only cache writes from changing the
// v4 baseline while shadow mode runs both builders.
const LEGACY_FOR_YOU_DISCOVERY_RAIL_ID = '__legacy_for_you_discovery';
const FOR_YOU_EXPOSURE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const FOR_YOU_SEARCH_HISTORY_LIMIT = 20;
const HOUSEHOLD_CHANNEL_TASTE_BUDGET = 2;
const HOUSEHOLD_TOKEN_TASTE_BUDGET = 3;
const HOUSEHOLD_SEARCH_TASTE_BUDGET = 0.5;
const SECONDARY_SCRIPT_MIN_SHARE = 0.2;
const SECONDARY_SCRIPT_MIN_EVIDENCE_ITEMS = 2;
const SECONDARY_SCRIPT_MIN_CANDIDATES = 2;
const FRESH_FIND_POOL_TARGET = 300;
const FRESH_FIND_SEARCH_BUDGET = 24;
const FRESH_FIND_MIN_DURATION_SEC = 8 * 60;
const FRESH_FIND_EXPOSURE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const BECAUSE_YOU_WATCHED_POOL_TARGET = 240;
const BECAUSE_YOU_WATCHED_SEARCH_BUDGET = 6;
const BECAUSE_YOU_WATCHED_MIN_DURATION_SEC = 8 * 60;
const BECAUSE_YOU_WATCHED_EXPOSURE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_NOW_POOL_TARGET = 120;
const LIVE_NOW_SEARCH_BUDGET = 12;
const LIVE_NOW_SUBSCRIPTION_SEARCH_LIMIT = 4;
const LIVE_NOW_TTL_MS = 2 * 60 * 60 * 1000;
const LIVE_NOW_REFRESH_STALE_MS = 90 * 60 * 1000;
const LIVE_NOW_OPPORTUNISTIC_THROTTLE_MS = 15 * 60 * 1000;
const LIVE_NOW_EXPOSURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const POPULAR_POOL_TARGET = 300;
const POPULAR_FETCH_LIMIT = 24;
const POPULAR_EXPOSURE_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const FRESH_FIND_BUCKET_QUOTAS: Record<FreshFindBucket, number> = {
  taste_adjacent: 1,
  quality_fresh: 1,
  emerging_creator: 1,
  zeitgeist_light: 1,
  wildcard: 1,
};
const BECAUSE_YOU_WATCHED_RELATION_QUOTAS: Record<BecauseYouWatchedRelation, number> = {
  same_channel: 1,
  same_topic: 1,
  deeper_dive: 1,
  wildcard: 1,
};
const LIVE_NOW_LANE_QUOTAS: Record<LiveNowLane, number> = {
  subscription_live: 1,
  news_events: 1,
  sports: 1,
  music_performance: 1,
  gaming: 1,
  culture_talks: 1,
  wildcard: 1,
};
const TITLE_TOKEN_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'live',
  'official',
  'video',
  'episode',
  'full',
]);

const YOUTUBE_MOOD_TOKENS: Record<string, readonly string[]> = {
  cozy: ['cozy', 'gentle', 'warm', 'comfort', 'wholesome'],
  laugh: ['comedy', 'funny', 'witty', 'satire', 'standup'],
  thrilling: ['thriller', 'action', 'suspense', 'adventure', 'fast'],
  deep: ['documentary', 'thoughtful', 'analysis', 'history', 'science'],
  family: ['family', 'animation', 'wholesome', 'adventure', 'allages'],
};

const RAIL_LABELS: Record<string, string> = {
  saved: 'Saved',
  history: 'History',
  for_you: 'For you',
  new_from_subscriptions: 'From your subscriptions',
  fresh_finds: 'Fresh finds',
  because_you_watched: 'Because you watched',
  live_now: 'Live now',
  popular: 'Trending for you',
};

type RefreshResult = {
  ok: boolean;
  refresh: ReturnType<typeof youtubeRefreshStatus>;
  phases?: YoutubeRefreshPhaseResult[];
  error?: string;
};

type YoutubeAuthStartResult = Awaited<ReturnType<typeof startYoutubeDeviceAuth>>;
type YoutubeAuthPollResult = Awaited<ReturnType<typeof pollYoutubeDeviceAuth>>;

export type YoutubeCompanionStatus = {
  api_key_configured: boolean;
  oauth_configured: boolean;
  authenticated: boolean;
  needs_attention: boolean;
};

export type YoutubeCompanionAuthStart = {
  session_id: string;
  user_code: string;
  verification_url: string;
  verification_url_complete?: string;
  interval_sec: number;
};

export type YoutubeCompanionAuthPoll = {
  status: YoutubeAuthPollResult['status'];
  interval_sec?: number;
};

export type YoutubeCompanionAuthDisconnect = {
  ok: true;
};

export function youtubeCompanionAuthStartResponse(
  started: YoutubeAuthStartResult,
): YoutubeCompanionAuthStart {
  return {
    session_id: started.session_id,
    user_code: started.user_code,
    verification_url: started.verification_url,
    ...(started.verification_url_complete
      ? { verification_url_complete: started.verification_url_complete }
      : {}),
    interval_sec: started.interval_sec,
  };
}

export function youtubeCompanionAuthPollResponse(
  poll: YoutubeAuthPollResult,
): YoutubeCompanionAuthPoll {
  return {
    status: poll.status,
    ...(typeof poll.interval_sec === 'number' ? { interval_sec: poll.interval_sec } : {}),
  };
}

type YoutubeRailsOptions = {
  reshuffle?: boolean;
  slateSequence?: number;
  profileId?: string;
  seedContext?: string;
  expectedPersonalization?: PersonalizationSnapshot | null;
};

type PublicYoutubeRail = {
  rail_id: string;
  label: string;
  cached: boolean;
  stale: boolean;
  // Optional internal fields keep the return type source-compatible with
  // older callers while publicYoutubeRails deliberately omits them at runtime.
  items: Array<YoutubeItem & { score?: number; reason?: string | null }>;
};

type YoutubeAttributionContext = {
  source_revision: number;
  context_id: string;
};

type YoutubeRailsResponse = {
  ok: true;
  tab: typeof YOUTUBE_TAB;
  profile_id: string;
  personalization_updated_at: number;
  rails: PublicYoutubeRail[];
  slate_sequence: number;
  recommendations_status?: 'ready' | 'empty' | 'setup' | 'stale';
  setup_required?: boolean;
  stale_reason?: string | null;
  /** Server-only metadata. The HTTP route strips this before serialization. */
  attribution_contexts: Record<string, YoutubeAttributionContext>;
};

export function resolveYoutubeImpressionSourceRevision(
  submittedSequence: number,
  servedRails: ReadonlyArray<{ source_revision: number }>,
): number {
  if (!Number.isInteger(submittedSequence) || submittedSequence < 0 || servedRails.length === 0) {
    throw new Error('invalid YouTube impression source revision');
  }
  const authoritative = servedRails[0]!.source_revision;
  if (!Number.isInteger(authoritative) || authoritative < 0) {
    throw new Error('invalid served YouTube source revision');
  }
  if (servedRails.some((rail) => rail.source_revision !== authoritative)) {
    throw new Error('served YouTube source revisions do not match');
  }
  if (submittedSequence !== authoritative) {
    throw new Error('submitted YouTube slate sequence does not match its served source revision');
  }
  return authoritative;
}

type YoutubePersonalizationContext = {
  state: PersonalizationState;
  profileId: string;
  tasteProfile: TasteProfile;
};

type ForYouLane = 'familiar' | 'discovery' | 'wildcard';
type ForYouSource = 'history' | 'saved' | 'subscription' | 'discovery' | 'popular' | 'wildcard';
type YoutubeScriptBucket =
  | 'latin'
  | 'devanagari'
  | 'arabic'
  | 'cyrillic'
  | 'cjk'
  | 'hangul'
  | 'hebrew'
  | 'thai'
  | 'bengali'
  | 'tamil'
  | 'telugu'
  | 'gujarati'
  | 'gurmukhi'
  | 'malayalam'
  | 'kannada';
type FreshFindBucket = 'quality_fresh' | 'taste_adjacent' | 'emerging_creator' | 'zeitgeist_light' | 'wildcard';
type BecauseYouWatchedRelation = 'same_channel' | 'same_topic' | 'deeper_dive' | 'wildcard';
type LiveNowLane = 'subscription_live' | 'news_events' | 'sports' | 'music_performance' | 'gaming' | 'culture_talks' | 'wildcard';
type YoutubeRefreshPhase =
  | 'popular'
  | 'subscriptions'
  | 'fresh_finds'
  | 'live_now'
  | 'because_you_watched'
  | 'for_you_discovery'
  | 'for_you_reservoir'
  | 'v2_subscription_acquisition'
  | 'v2_history_metadata'
  | 'v2_history_acquisition'
  | 'v2_live_acquisition'
  | 'v2_publish';

type RecentYoutubeSearch = {
  query: string;
  searched_at: number;
};

type RecentWatchedYoutubeItem = {
  item: YoutubeItem;
  watched_at: number;
};

type TasteProfile = {
  watchedIds: Set<string>;
  savedIds: Set<string>;
  positiveChannels: Map<string, number>;
  positiveTokens: Map<string, number>;
  negativeIds: Set<string>;
  negativeChannels: Map<string, number>;
  negativeTokens: Map<string, number>;
  recentSearches: RecentYoutubeSearch[];
  scriptPreferences: Map<YoutubeScriptBucket, {
    share: number;
    evidenceItems: number;
  }>;
};

function emptyTasteProfile(): TasteProfile {
  return {
    watchedIds: new Set(),
    savedIds: new Set(),
    positiveChannels: new Map(),
    positiveTokens: new Map(),
    negativeIds: new Set(),
    negativeChannels: new Map(),
    negativeTokens: new Map(),
    recentSearches: [],
    scriptPreferences: new Map(),
  };
}

type PositiveTasteContribution = {
  profileId: string;
  watchedIds: Set<string>;
  savedIds: Set<string>;
  positiveChannels: Map<string, number>;
  durableTokens: Map<string, number>;
  searchTokens: Map<string, number>;
  scriptItems: Map<YoutubeScriptBucket, Map<string, number>>;
};

// Ten four-card slates contain exactly 28 close, 8 adjacent, and 4 surprise
// slots. This preserves the locked 70/20/10 mix without fractional cards or
// request-time randomness.
const FOR_YOU_SLATE_PATTERNS: Array<Record<ForYouLane, number>> = [
  { familiar: 3, discovery: 1, wildcard: 0 },
  { familiar: 3, discovery: 1, wildcard: 0 },
  { familiar: 2, discovery: 1, wildcard: 1 },
  { familiar: 3, discovery: 1, wildcard: 0 },
  { familiar: 3, discovery: 0, wildcard: 1 },
  { familiar: 3, discovery: 1, wildcard: 0 },
  { familiar: 3, discovery: 1, wildcard: 0 },
  { familiar: 2, discovery: 1, wildcard: 1 },
  { familiar: 3, discovery: 1, wildcard: 0 },
  { familiar: 3, discovery: 0, wildcard: 1 },
];

function rotated<T>(items: readonly T[], sequence = 0): T[] {
  if (items.length === 0) return [];
  const offset = Math.abs(Math.trunc(sequence)) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function fillThinSlate<T extends { id: string }>(selected: T[], candidates: T[]): T[] {
  if (selected.length >= YOUTUBE_RAIL_LIMIT) return selected.slice(0, YOUTUBE_RAIL_LIMIT);
  const output = [...selected];
  const used = new Set(output.map((item) => item.id));
  for (const candidate of candidates) {
    if (used.has(candidate.id)) continue;
    output.push(candidate);
    used.add(candidate.id);
    if (output.length >= YOUTUBE_RAIL_LIMIT) break;
  }
  return output;
}

type ScoredForYouCandidate = YoutubeForYouCandidate & {
  score: number;
  score_breakdown: Record<string, number | string>;
};

type ProfileCandidateCounters = Pick<
  YoutubeProfileCandidateState,
  'last_recommended_at' | 'exposure_count' | 'ignore_count' | 'quick_stop_count'
>;

function profileCandidateStateById(
  railId: string,
  contextId = '',
  profileId = activeViewerProfileId(),
): Map<string, ProfileCandidateCounters> {
  return new Map(listYoutubeProfileCandidateStates({
    profile_id: profileId,
    rail_id: railId,
    context_id: contextId,
  }).map((state) => [state.id, state]));
}

function withProfileCandidateState<
  T extends { id: string } & ProfileCandidateCounters,
>(candidate: T, states: Map<string, ProfileCandidateCounters>): T {
  const state = states.get(candidate.id);
  return {
    ...candidate,
    last_recommended_at: state?.last_recommended_at ?? null,
    exposure_count: state?.exposure_count ?? 0,
    ignore_count: state?.ignore_count ?? 0,
    quick_stop_count: state?.quick_stop_count ?? 0,
  };
}

type ScoredFreshFindCandidate = YoutubeFreshFindCandidate & {
  score: number;
  score_breakdown: Record<string, number | string>;
};

type ScoredLiveNowCandidate = YoutubeLiveNowCandidate & {
  score: number;
  score_breakdown: Record<string, number | string>;
};

type ScoredPopularCandidate = YoutubePopularCandidate & {
  score: number;
  score_breakdown: Record<string, number | string>;
};

type LiveNowQuerySpec = {
  source_lane: LiveNowLane;
  query: string;
  order: 'date' | 'relevance' | 'viewCount';
  limit: number;
  source_weight: number;
  channelId?: string;
};

type PopularCategorySpec = {
  category_id: string;
  category_label: string;
  fetch_limit: number;
  source_weight: number;
};

type PopularQuerySpec = PopularCategorySpec & {
  source_region: string;
};

let liveNowRefreshInFlight: Promise<void> | null = null;
let youtubeRefreshTail: Promise<void> = Promise.resolve();

function serializeYoutubeRefresh<T>(task: () => Promise<T>): Promise<T> {
  const run = youtubeRefreshTail.catch(() => undefined).then(task);
  youtubeRefreshTail = run.then(() => undefined, () => undefined);
  return run;
}

type ScoredBecauseYouWatchedCandidate = YoutubeBecauseYouWatchedCandidate & {
  score: number;
  relation_type: BecauseYouWatchedRelation;
  score_breakdown: Record<string, number | string>;
};

type FreshFindQuerySpec = {
  query: string;
  source_bucket: FreshFindBucket;
  order: 'date' | 'relevance' | 'viewCount';
  limit: number;
  publishedAfterDays?: number;
  videoDuration?: 'medium' | 'long';
  videoDefinition?: 'high';
  topicId?: string;
};

type BecauseYouWatchedQuerySpec = {
  query: string;
  relation_type: BecauseYouWatchedRelation;
  order: 'date' | 'relevance' | 'viewCount';
  limit: number;
  channelId?: string;
  publishedAfterDays?: number;
  videoDuration?: 'medium' | 'long';
};

type FreshFindEligibilityOptions = {
  allowRecentExposure: boolean;
  allowSavedOrSubscribed: boolean;
  allowShortDuration: boolean;
};

type BecauseYouWatchedEligibilityOptions = {
  allowRecentExposure: boolean;
  allowSaved: boolean;
  allowShortDuration: boolean;
};

type PopularEligibilityOptions = {
  allowRecentExposure: boolean;
  allowSavedOrSubscribed: boolean;
};

const BASE_FRESH_FIND_QUERY_SPECS: FreshFindQuerySpec[] = [
  { query: 'documentary essay', source_bucket: 'quality_fresh', order: 'date', limit: 8, publishedAfterDays: 45, videoDuration: 'long', videoDefinition: 'high', topicId: '/m/01k8wb' },
  { query: 'technology deep dive', source_bucket: 'quality_fresh', order: 'date', limit: 8, publishedAfterDays: 60, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/07c1v' },
  { query: 'science explained', source_bucket: 'quality_fresh', order: 'relevance', limit: 8, publishedAfterDays: 90, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/01k8wb' },
  { query: 'film video essay', source_bucket: 'quality_fresh', order: 'date', limit: 8, publishedAfterDays: 90, videoDuration: 'long', videoDefinition: 'high', topicId: '/m/02vxn' },
  { query: 'food travel culture', source_bucket: 'quality_fresh', order: 'date', limit: 8, publishedAfterDays: 90, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/02wbm' },
  { query: 'longform interview', source_bucket: 'quality_fresh', order: 'relevance', limit: 8, publishedAfterDays: 120, videoDuration: 'long', videoDefinition: 'high' },
  { query: 'standup comedy storytelling', source_bucket: 'quality_fresh', order: 'date', limit: 8, publishedAfterDays: 90, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/09kqc' },
  { query: 'live music performance -live', source_bucket: 'quality_fresh', order: 'date', limit: 8, publishedAfterDays: 120, videoDuration: 'long', videoDefinition: 'high', topicId: '/m/04rlf' },
  { query: 'independent documentary', source_bucket: 'emerging_creator', order: 'date', limit: 8, publishedAfterDays: 45, videoDuration: 'medium', videoDefinition: 'high' },
  { query: 'small channel science explained', source_bucket: 'emerging_creator', order: 'date', limit: 8, publishedAfterDays: 60, videoDuration: 'medium', videoDefinition: 'high' },
  { query: 'independent filmmaker essay', source_bucket: 'emerging_creator', order: 'date', limit: 8, publishedAfterDays: 90, videoDuration: 'medium', videoDefinition: 'high' },
  { query: 'new creator travel story', source_bucket: 'emerging_creator', order: 'date', limit: 8, publishedAfterDays: 60, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/07bxq' },
  { query: 'technology news explained', source_bucket: 'zeitgeist_light', order: 'date', limit: 8, publishedAfterDays: 21, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/07c1v' },
  { query: 'movie trailer analysis', source_bucket: 'zeitgeist_light', order: 'date', limit: 8, publishedAfterDays: 30, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/02vxn' },
  { query: 'cricket analysis', source_bucket: 'zeitgeist_light', order: 'date', limit: 8, publishedAfterDays: 21, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/09xp_' },
  { query: 'india culture explained', source_bucket: 'zeitgeist_light', order: 'date', limit: 8, publishedAfterDays: 45, videoDuration: 'medium', videoDefinition: 'high' },
  { query: 'unexpected history documentary', source_bucket: 'wildcard', order: 'relevance', limit: 8, publishedAfterDays: 180, videoDuration: 'long', videoDefinition: 'high', topicId: '/m/01k8wb' },
  { query: 'creative engineering project', source_bucket: 'wildcard', order: 'relevance', limit: 8, publishedAfterDays: 180, videoDuration: 'medium', videoDefinition: 'high', topicId: '/m/03glg' },
];

const POPULAR_CATEGORY_SPECS: PopularCategorySpec[] = [
  { category_id: '0', category_label: 'all', fetch_limit: 36, source_weight: 1.2 },
  { category_id: '24', category_label: 'entertainment', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 1.05 },
  { category_id: '10', category_label: 'music', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 1 },
  { category_id: '20', category_label: 'gaming', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 0.95 },
  { category_id: '17', category_label: 'sports', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 0.95 },
  { category_id: '27', category_label: 'education', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 0.95 },
  { category_id: '23', category_label: 'comedy', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 0.95 },
  { category_id: '19', category_label: 'travel_culture', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 0.9 },
  { category_id: '28', category_label: 'science_tech', fetch_limit: POPULAR_FETCH_LIMIT, source_weight: 0.9 },
];

const POPULAR_CATEGORY_QUOTAS = new Map<string, number>([
  ['all', 2],
  ['entertainment', 1],
  ['music', 1],
  ['gaming', 1],
  ['sports', 1],
  ['education', 1],
  ['comedy', 1],
  ['travel_culture', 1],
  ['science_tech', 1],
]);

function nowMs(): number {
  return Date.now();
}

function itemType(kind: YoutubeItemKind): string {
  if (kind === 'video') return YOUTUBE_VIDEO_TYPE;
  if (kind === 'channel') return 'youtube_channel';
  return 'youtube_playlist';
}

function itemToLibraryInput(item: YoutubeItem): LibraryItemInput {
  return {
    source: YOUTUBE_SOURCE,
    type: itemType(item.kind),
    id: item.id,
    title: item.title,
    poster: item.thumbnail,
    description: item.description,
    tab: YOUTUBE_TAB,
  };
}

function libraryItemToYoutube(item: {
  type: string;
  id: string;
  title: string | null;
  poster?: string | null;
  description?: string | null;
}): YoutubeRailItem | null {
  if (item.type !== YOUTUBE_VIDEO_TYPE) {
    return null;
  }
  const cached = getYoutubeItem('video', item.id);
  const base: YoutubeItem = cached || {
    id: item.id,
    kind: 'video',
    title: item.title || item.id,
    subtitle: 'YouTube',
    description: item.description || null,
    thumbnail: item.poster || null,
    channel_id: null,
    channel_title: null,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: nowMs(),
  };
  return {
    ...base,
    score: 1,
    reason: null,
  };
}

function notInterestedIds(profileId = activeViewerProfileId()): Set<string> {
  return new Set(
    listProfileLibraryFeedback('not_interested', YOUTUBE_SOURCE, {
      profile_id: profileId,
      household_blend: profileId === 'household',
    })
      .filter((row) => row.type === YOUTUBE_VIDEO_TYPE)
      .map((row) => row.id),
  );
}

function filterNotInterested<T extends YoutubeItem>(items: T[], profileId = activeViewerProfileId()): T[] {
  const blocked = notInterestedIds(profileId);
  return items.filter((item) => item.kind !== 'video' || !blocked.has(item.id));
}

function uniqueVideos(items: YoutubeItem[]): YoutubeItem[] {
  const seen = new Set<string>();
  const output: YoutubeItem[] = [];
  for (const item of items) {
    if (item.kind !== 'video' || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function isLiveVideo(item: YoutubeItem): boolean {
  return item.live_status === 'live';
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function recommendationSeed(options: YoutubeRailsOptions, context: string): string {
  return [
    options.profileId || 'household',
    Math.max(0, Math.trunc(options.slateSequence ?? 0)),
    options.seedContext || '',
    context,
  ].join(':');
}

function deterministicUnit(seed: string): number {
  return stableHash(seed) / 0x1_0000_0000;
}

function deterministicShuffle<T>(
  items: readonly T[],
  seed: string,
  itemKey: (item: T, index: number) => string = (_item, index) => String(index),
): T[] {
  return [...items]
    .map((item, index) => ({ item, index, hash: stableHash(`${seed}:${itemKey(item, index)}`) }))
    .sort((left, right) => left.hash - right.hash || left.index - right.index)
    .map(({ item }) => item);
}

function deterministicWeightedPick<T extends { id: string }>(
  candidates: T[],
  weight: (candidate: T) => number,
  options: YoutubeRailsOptions,
  context: string,
): T | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  if (total <= 0) return candidates[0] || null;
  const evidenceKey = candidates.map((candidate) => candidate.id).join(',');
  let cursor = deterministicUnit(`${recommendationSeed(options, context)}:${evidenceKey}`) * total;
  for (const candidate of candidates) {
    cursor -= Math.max(0, weight(candidate));
    if (cursor <= 0) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function compareScoreThenId(
  left: { score: number; id?: string; item?: { id: string } },
  right: { score: number; id?: string; item?: { id: string } },
): number {
  return right.score - left.score
    || (left.id ?? left.item?.id ?? '').localeCompare(right.id ?? right.item?.id ?? '');
}

type TitleRef = { type: string; id: string };

function titleRefKey(ref: TitleRef): string {
  return `${ref.type}:${ref.id}`;
}

function youtubeContentType(item: YoutubeItem): string {
  if (item.kind === 'channel') {
    return 'youtube_channel';
  }
  if (item.kind === 'playlist') {
    return 'youtube_playlist';
  }
  return 'youtube_video';
}

async function listYoutubeRailPoolItems(railId: string): Promise<YoutubeRailItem[]> {
  const poolLimit = railId === 'new_from_subscriptions' ? SUBSCRIPTION_RAIL_POOL_LIMIT : YOUTUBE_RAIL_POOL_LIMIT;
  if (railId === 'for_you') {
    return listForYouCandidates(poolLimit);
  }
  if (railId === 'fresh_finds') {
    return listFreshFindCandidates(poolLimit);
  }
  if (railId === 'live_now') {
    return listLiveNowCandidates(poolLimit);
  }
  if (railId === 'popular') {
    return listPopularCandidates(poolLimit);
  }
  if (railId.startsWith('ai-')) {
    return youtubeAiCatalogPoolItems(railId);
  }
  return listYoutubeRailItems(railId, poolLimit);
}

function publishedOrUpdatedMs(item: YoutubeItem): number {
  const published = item.published_at ? Date.parse(item.published_at) : Number.NaN;
  return Number.isFinite(published) ? published : item.updated_at;
}

export function youtubeTitleTokens(title: string): Set<string> {
  return new Set(
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => Array.from(token).length >= 2 && !TITLE_TOKEN_STOPWORDS.has(token)),
  );
}

const YOUTUBE_TITLE_SCRIPT_PATTERNS: ReadonlyArray<{
  bucket: YoutubeScriptBucket;
  patterns: readonly RegExp[];
}> = [
  { bucket: 'devanagari', patterns: [/\p{Script=Devanagari}/u] },
  { bucket: 'arabic', patterns: [/\p{Script=Arabic}/u] },
  { bucket: 'cyrillic', patterns: [/\p{Script=Cyrillic}/u] },
  {
    bucket: 'cjk',
    patterns: [/\p{Script=Han}/u, /\p{Script=Hiragana}/u, /\p{Script=Katakana}/u],
  },
  { bucket: 'hangul', patterns: [/\p{Script=Hangul}/u] },
  { bucket: 'hebrew', patterns: [/\p{Script=Hebrew}/u] },
  { bucket: 'thai', patterns: [/\p{Script=Thai}/u] },
  { bucket: 'bengali', patterns: [/\p{Script=Bengali}/u] },
  { bucket: 'tamil', patterns: [/\p{Script=Tamil}/u] },
  { bucket: 'telugu', patterns: [/\p{Script=Telugu}/u] },
  { bucket: 'gujarati', patterns: [/\p{Script=Gujarati}/u] },
  { bucket: 'gurmukhi', patterns: [/\p{Script=Gurmukhi}/u] },
  { bucket: 'malayalam', patterns: [/\p{Script=Malayalam}/u] },
  { bucket: 'kannada', patterns: [/\p{Script=Kannada}/u] },
  { bucket: 'latin', patterns: [/\p{Script=Latin}/u] },
];

/**
 * Returns only a conservative Unicode script family inferred from title text.
 * It deliberately does not claim a language: mixed or weakly identified
 * titles return null instead of fabricating locale metadata.
 */
export function youtubeTitleScriptBucket(title: string): YoutubeScriptBucket | null {
  const counts = new Map<YoutubeScriptBucket, number>();
  let recognizedLetters = 0;
  for (const character of Array.from(title.normalize('NFKC'))) {
    if (!/\p{L}/u.test(character)) continue;
    const match = YOUTUBE_TITLE_SCRIPT_PATTERNS.find(({ patterns }) => (
      patterns.some((pattern) => pattern.test(character))
    ));
    if (!match) continue;
    counts.set(match.bucket, (counts.get(match.bucket) ?? 0) + 1);
    recognizedLetters += 1;
  }
  const dominant = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  if (!dominant || recognizedLetters < 2 || dominant[1] / recognizedLetters < 0.6) return null;
  return dominant[0];
}

function titleTokens(item: YoutubeItem | { title?: string | null }): Set<string> {
  return youtubeTitleTokens(item.title || '');
}

function tokenOverlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

function recentWatchedYoutubeRecords(profileId: string, limit = 6): RecentWatchedYoutubeItem[] {
  const output: RecentWatchedYoutubeItem[] = [];
  for (const row of listUniqueWatchHistory({
    source: YOUTUBE_SOURCE,
    type: YOUTUBE_VIDEO_TYPE,
    profile_id: profileId,
    household_blend: profileId === 'household',
    limit: Math.max(50, limit * 12),
  })) {
    const cached = getYoutubeItem('video', row.id) || {
      id: row.id,
      kind: 'video' as const,
      title: row.title || row.id,
      subtitle: 'YouTube',
      description: null,
      thumbnail: row.poster || null,
      channel_id: null,
      channel_title: null,
      published_at: null,
      duration_sec: null,
      live_status: 'none' as const,
      playlist_id: null,
      updated_at: row.watched_at,
    };
    if (!isLiveVideo(cached)) {
      output.push({ item: cached, watched_at: row.watched_at });
    }
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function recencyScore(item: YoutubeItem, at = nowMs()): number {
  const published = item.published_at ? Date.parse(item.published_at) : item.updated_at;
  if (!Number.isFinite(published)) {
    return 0;
  }
  const ageDays = Math.max(0, (at - published) / 86_400_000);
  return Math.max(0, 1 - ageDays / 180);
}

function isShortLikeVideo(item: YoutubeItem): boolean {
  if (item.duration_sec !== null && item.duration_sec <= 60) return true;
  return /(^|\s)#shorts?\b/i.test(`${item.title} ${item.description || ''}`);
}

function addWeight(map: Map<string, number>, key: string | null | undefined, weight: number): void {
  const normalized = key?.trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) ?? 0) + weight);
}

function addTokenWeights(map: Map<string, number>, item: YoutubeItem | { title?: string | null }, weight: number): void {
  for (const token of titleTokens(item)) {
    addWeight(map, token, weight);
  }
}

function recentYoutubeSearches(profileId = activeViewerProfileId()): RecentYoutubeSearch[] {
  const eventSearches = listProfileRecommendationEvents({
    profile_id: profileId,
    domain: 'youtube',
    event_types: ['search'],
    household_blend: true,
    limit: 100,
  }).map((event) => ({
    query: event.title || event.item_id,
    searched_at: event.occurred_at,
  }));
  const legacySearches = profileId === 'household'
    ? getYoutubeState<RecentYoutubeSearch[]>('recent_searches', [])
      .filter((entry) => typeof entry.query === 'string' && Number.isFinite(entry.searched_at))
    : [];
  const seen = new Set<string>();
  return [...eventSearches, ...legacySearches]
    .sort((left, right) => right.searched_at - left.searched_at)
    .filter((entry) => {
      const key = entry.query.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, FOR_YOU_SEARCH_HISTORY_LIMIT);
}

function recordRecentYoutubeSearch(query: string): void {
  const normalized = query.trim();
  if (!normalized) return;
  appendProfileRecommendationEvent({
    domain: 'youtube',
    event_type: 'search',
    item_type: 'query',
    item_id: normalized.toLowerCase(),
    title: normalized,
    strength: 0.15,
  });
  if (activeViewerProfileId() !== 'household') return;
  const deduped = recentYoutubeSearches().filter(
    (entry) => entry.query.toLowerCase() !== normalized.toLowerCase(),
  );
  setYoutubeState('recent_searches', [
    { query: normalized, searched_at: nowMs() },
    ...deduped,
  ].slice(0, FOR_YOU_SEARCH_HISTORY_LIMIT));
}

function createPositiveTasteContribution(profileId: string): PositiveTasteContribution {
  return {
    profileId,
    watchedIds: new Set(),
    savedIds: new Set(),
    positiveChannels: new Map(),
    durableTokens: new Map(),
    searchTokens: new Map(),
    scriptItems: new Map(),
  };
}

function mapWeightTotal(map: Map<string, number>): number {
  return [...map.values()].reduce((sum, weight) => (
    Number.isFinite(weight) && weight > 0 ? sum + weight : sum
  ), 0);
}

function mergeWeightMap(target: Map<string, number>, source: Map<string, number>, scale = 1): void {
  for (const [key, weight] of source) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    addWeight(target, key, weight * scale);
  }
}

/** Equal total budget per contributing viewer; activity volume only shapes that viewer's internal mix. */
function mergeEqualBudget(
  target: Map<string, number>,
  sources: Array<Map<string, number>>,
  totalBudget: number,
): void {
  const eligible = sources
    .map((source) => ({ source, total: mapWeightTotal(source) }))
    .filter((entry) => entry.total > 0);
  if (eligible.length === 0 || totalBudget <= 0) return;
  const perViewerBudget = totalBudget / eligible.length;
  for (const { source, total } of eligible) {
    mergeWeightMap(target, source, perViewerBudget / total);
  }
}

function safePositiveItem(
  id: string,
  title?: string | null,
): { item: YoutubeItem | { title: string } | null; cached: YoutubeItem | null } {
  const cached = getYoutubeItem('video', id);
  if (cached) return { item: cached, cached };
  const safeTitle = title?.trim() || '';
  if (!safeTitle || safeTitle.toLowerCase() === id.trim().toLowerCase()) {
    return { item: null, cached: null };
  }
  return { item: { title: safeTitle }, cached: null };
}

function notePositiveScriptEvidence(
  contribution: PositiveTasteContribution,
  id: string,
  cached: YoutubeItem | null,
  weight: number,
): void {
  if (!cached || weight <= 0) return;
  const bucket = youtubeTitleScriptBucket(cached.title);
  if (!bucket) return;
  let items = contribution.scriptItems.get(bucket);
  if (!items) {
    items = new Map();
    contribution.scriptItems.set(bucket, items);
  }
  items.set(id, Math.max(items.get(id) ?? 0, weight));
}

function addYoutubePositiveState(
  contribution: PositiveTasteContribution,
  input: {
    id: string;
    title?: string | null;
    watched?: boolean;
    saved?: boolean;
    confidence: number;
  },
): void {
  const watched = Boolean(input.watched) && !contribution.watchedIds.has(input.id);
  const saved = Boolean(input.saved) && !contribution.savedIds.has(input.id);
  if (!watched && !saved) return;
  const { item, cached } = safePositiveItem(input.id, input.title);
  if (watched) contribution.watchedIds.add(input.id);
  if (saved) contribution.savedIds.add(input.id);
  if (!item) return;
  const confidence = Math.max(0.01, Math.min(1, input.confidence));
  if (watched) {
    if ('channel_id' in item) {
      addWeight(contribution.positiveChannels, item.channel_id || item.channel_title, confidence);
    }
    addTokenWeights(contribution.durableTokens, item, confidence * 0.75);
  }
  if (saved) {
    if ('channel_id' in item) {
      addWeight(contribution.positiveChannels, item.channel_id || item.channel_title, confidence * 1.5);
    }
    addTokenWeights(contribution.durableTokens, item, confidence * 1.25);
  }
  notePositiveScriptEvidence(
    contribution,
    input.id,
    cached,
    confidence * ((watched ? 0.75 : 0) + (saved ? 1.25 : 0)),
  );
}

function positiveSignalConfidence(
  signal: ReturnType<typeof listProfileRecommendationSignals>[number],
  fallback: number,
): number {
  if (signal.last_positive_at <= 0) return fallback;
  const ageDays = Math.max(0, (nowMs() - signal.last_positive_at) / 86_400_000);
  const dualHorizon = 0.65 * Math.exp(-ageDays / 14) + 0.35 * Math.exp(-ageDays / 180);
  return Math.max(0.05, Math.min(1, Math.max(fallback, signal.strongest_positive) * dualHorizon));
}

function buildPositiveTasteContribution(profileId: string): PositiveTasteContribution {
  const contribution = createPositiveTasteContribution(profileId);
  const signals = listProfileRecommendationSignals({
    profile_id: profileId,
    domain: 'youtube',
    household_blend: false,
    limit: 5_000,
  }).filter((signal) => signal.item_type === YOUTUBE_VIDEO_TYPE);
  const signalById = new Map(signals.map((signal) => [signal.item_id, signal] as const));
  for (const signal of signals) {
    // Exact dislikes remain a Household union veto and do not simultaneously
    // contribute positive semantic or language evidence.
    if (signal.not_interested || (!signal.watched && !signal.saved)) {
      if (signal.watched) contribution.watchedIds.add(signal.item_id);
      if (signal.saved) contribution.savedIds.add(signal.item_id);
      continue;
    }
    addYoutubePositiveState(contribution, {
      id: signal.item_id,
      title: signal.title,
      watched: signal.watched,
      saved: signal.saved,
      confidence: positiveSignalConfidence(signal, signal.saved ? 0.8 : 0.05),
    });
  }

  // Backward-compatible fallback for histories that predate recommendation
  // events. Profile ownership remains explicit, so Household fairness is not
  // inferred from whichever viewer happens to be active.
  for (const row of listUniqueWatchHistory({
    source: YOUTUBE_SOURCE,
    type: YOUTUBE_VIDEO_TYPE,
    profile_id: profileId,
    household_blend: false,
    limit: 500,
  })) {
    if (signalById.get(row.id)?.not_interested) continue;
    addYoutubePositiveState(contribution, {
      id: row.id,
      title: row.title,
      watched: true,
      confidence: signalById.has(row.id)
        ? positiveSignalConfidence(signalById.get(row.id)!, 0.05)
        : 0.05,
    });
  }

  const seenSearches = new Set<string>();
  for (const event of listProfileRecommendationEvents({
    profile_id: profileId,
    domain: 'youtube',
    event_types: ['search'],
    household_blend: false,
    limit: 100,
  })) {
    const query = (event.title || '').trim();
    const key = query.toLowerCase();
    if (!query || seenSearches.has(key)) continue;
    seenSearches.add(key);
    const ageDays = Math.max(0, (nowMs() - event.occurred_at) / 86_400_000);
    const weight = Math.max(0, 1 - ageDays / 7);
    if (weight > 0) addTokenWeights(contribution.searchTokens, { title: query }, weight * 0.5);
  }
  // VOD Fire/Water ratings intentionally do not feed YouTube taste — domains stay disjoint.
  return contribution;
}

function mergeScriptPreferences(
  contributions: PositiveTasteContribution[],
  equalViewerWeight: boolean,
): Map<YoutubeScriptBucket, { share: number; evidenceItems: number }> {
  const eligible = contributions.map((contribution) => {
    const weights = new Map<YoutubeScriptBucket, number>();
    for (const [bucket, items] of contribution.scriptItems) {
      weights.set(bucket, [...items.values()].reduce((sum, weight) => sum + weight, 0));
    }
    return {
      contribution,
      weights,
      total: [...weights.values()].reduce((sum, weight) => sum + weight, 0),
    };
  }).filter((entry) => entry.total > 0);
  if (eligible.length === 0) return new Map();
  const mergedWeights = new Map<YoutubeScriptBucket, number>();
  const evidence = new Map<YoutubeScriptBucket, Set<string>>();
  for (const entry of eligible) {
    const viewerScale = equalViewerWeight ? 1 / eligible.length : 1;
    for (const [bucket, weight] of entry.weights) {
      mergedWeights.set(bucket, (mergedWeights.get(bucket) ?? 0) + (weight / entry.total) * viewerScale);
      let ids = evidence.get(bucket);
      if (!ids) {
        ids = new Set();
        evidence.set(bucket, ids);
      }
      for (const id of entry.contribution.scriptItems.get(bucket)?.keys() ?? []) ids.add(id);
    }
  }
  const total = [...mergedWeights.values()].reduce((sum, weight) => sum + weight, 0);
  return new Map([...mergedWeights.entries()].map(([bucket, weight]) => [bucket, {
    share: total > 0 ? weight / total : 0,
    evidenceItems: evidence.get(bucket)?.size ?? 0,
  }]));
}

function buildTasteProfile(personalization = getPersonalizationState()): TasteProfile {
  const profileId = personalization.active_profile_id;
  const household = profileId === 'household';
  const contributorIds = household
    ? listViewerProfiles().map((viewer) => viewer.profile_id)
    : [profileId];
  const contributions = contributorIds.map(buildPositiveTasteContribution);
  const contributionById = new Map(contributions.map((contribution) => [contribution.profileId, contribution]));
  const activeContribution = contributionById.get(profileId) ?? createPositiveTasteContribution(profileId);
  if (!contributionById.has(profileId)) contributions.push(activeContribution);

  // Existing saved rows without an event belong to the active profile's
  // fallback contribution. In Household this is the legacy Household bucket,
  // never an invented personal owner.
  for (const row of listSavedLibraryItems(YOUTUBE_TAB, 200, {
    profile_id: profileId,
    household_blend: household,
  })) {
    if (row.source !== YOUTUBE_SOURCE || row.type !== YOUTUBE_VIDEO_TYPE) continue;
    if (contributions.some((contribution) => contribution.savedIds.has(row.id))) continue;
    addYoutubePositiveState(activeContribution, {
      id: row.id,
      title: row.title,
      saved: true,
      confidence: 0.8,
    });
  }

  let companion: ReturnType<typeof readProfileSync> | null = null;
  if (household) {
    companion = readProfileSync();
    for (const love of companion.taste.loves) {
      addTokenWeights(activeContribution.durableTokens, { title: love }, 1);
    }
    for (const ref of companion.taste.title_loves) {
      if (ref.type !== YOUTUBE_VIDEO_TYPE) continue;
      addYoutubePositiveState(activeContribution, {
        id: ref.id,
        title: ref.title,
        saved: true,
        confidence: 1,
      });
    }
    for (const note of (companion.session_notes ?? []).slice(-3)) {
      addTokenWeights(activeContribution.searchTokens, { title: note }, 0.4);
    }
    for (const entry of getYoutubeState<RecentYoutubeSearch[]>('recent_searches', [])) {
      if (typeof entry.query !== 'string' || !Number.isFinite(entry.searched_at)) continue;
      const ageDays = Math.max(0, (nowMs() - entry.searched_at) / 86_400_000);
      const weight = Math.max(0, 1 - ageDays / 7);
      if (weight > 0) addTokenWeights(activeContribution.searchTokens, { title: entry.query }, weight * 0.5);
    }
  }

  const profile: TasteProfile = {
    watchedIds: new Set(contributions.flatMap((contribution) => [...contribution.watchedIds])),
    savedIds: new Set(contributions.flatMap((contribution) => [...contribution.savedIds])),
    positiveChannels: new Map(),
    positiveTokens: new Map(),
    negativeIds: new Set(),
    negativeChannels: new Map(),
    negativeTokens: new Map(),
    recentSearches: recentYoutubeSearches(profileId),
    scriptPreferences: mergeScriptPreferences(contributions, household),
  };

  if (household) {
    mergeEqualBudget(
      profile.positiveChannels,
      contributions.map((contribution) => contribution.positiveChannels),
      HOUSEHOLD_CHANNEL_TASTE_BUDGET,
    );
    mergeEqualBudget(
      profile.positiveTokens,
      contributions.map((contribution) => contribution.durableTokens),
      HOUSEHOLD_TOKEN_TASTE_BUDGET,
    );
    mergeEqualBudget(
      profile.positiveTokens,
      contributions.map((contribution) => contribution.searchTokens),
      HOUSEHOLD_SEARCH_TASTE_BUDGET,
    );
  } else {
    mergeWeightMap(profile.positiveChannels, activeContribution.positiveChannels);
    mergeWeightMap(profile.positiveTokens, activeContribution.durableTokens);
    mergeWeightMap(profile.positiveTokens, activeContribution.searchTokens);
  }

  // Mood is an explicit, session-scoped intent. It nudges the current request
  // without becoming permanent profile history or consuming a viewer budget.
  const mood = personalization.mood?.trim().toLowerCase() || '';
  for (const token of YOUTUBE_MOOD_TOKENS[mood] ?? []) {
    addWeight(profile.positiveTokens, token, 1.1);
  }

  if (companion) {
    for (const avoid of companion.taste.avoids) {
      addTokenWeights(profile.negativeTokens, { title: avoid }, 1);
    }
    for (const ref of companion.taste.title_avoids) {
      if (ref.type !== YOUTUBE_VIDEO_TYPE) continue;
      profile.negativeIds.add(ref.id);
      const item = getYoutubeItem('video', ref.id);
      if (item) {
        addWeight(profile.negativeChannels, item.channel_id || item.channel_title, 1);
        addTokenWeights(profile.negativeTokens, item, 1);
      } else if (ref.title) {
        addTokenWeights(profile.negativeTokens, { title: ref.title }, 1);
      }
    }
  }

  // Household receives the exact union of current dislikes. Semantic weights
  // remain reversible and decayed; Undo removes both the veto and contribution.
  for (const row of listProfileLibraryFeedback('not_interested', YOUTUBE_SOURCE, {
    profile_id: profileId,
    household_blend: household,
  })) {
    if (row.type !== YOUTUBE_VIDEO_TYPE) continue;
    profile.negativeIds.add(row.id);
    const item = getYoutubeItem('video', row.id) || { title: row.title || '' };
    const semanticDecay = youtubeFeedbackSemanticDecay(row.updated_at);
    if ('channel_id' in item) {
      addWeight(profile.negativeChannels, item.channel_id || item.channel_title, semanticDecay);
    }
    addTokenWeights(profile.negativeTokens, item, 0.8 * semanticDecay);
  }
  return profile;
}

function captureYoutubePersonalization(): YoutubePersonalizationContext {
  const state = getPersonalizationState();
  return {
    state,
    profileId: state.active_profile_id,
    tasteProfile: buildTasteProfile(state),
  };
}

function isSameYoutubePersonalization(context: YoutubePersonalizationContext): boolean {
  const current = getPersonalizationState();
  return current.active_profile_id === context.state.active_profile_id
    && current.updated_at === context.state.updated_at
    && current.mood === context.state.mood
    && current.mood_expires_at === context.state.mood_expires_at;
}

export function youtubeFeedbackSemanticDecay(updatedAt: number, at = nowMs()): number {
  const ageDays = Math.max(0, (at - updatedAt) / 86_400_000);
  return Math.max(
    0.05,
    0.7 * Math.exp(-ageDays / 30) + 0.3 * Math.exp(-ageDays / 365),
  );
}

function selectSubscriptionRefreshChannels(subscriptions: YoutubeItem[]): {
  channels: YoutubeItem[];
  nextCursor: number;
} {
  if (subscriptions.length === 0) {
    return { channels: [], nextCursor: 0 };
  }
  const currentCursor = getYoutubeState<number>('subscription_refresh_cursor', 0);
  const active = subscriptions.slice(0, Math.min(SUBSCRIPTION_ACTIVE_CHANNELS_PER_REFRESH, subscriptions.length));
  const rotationSource = subscriptions.length > active.length
    ? subscriptions.slice(active.length)
    : subscriptions;
  const cursor = rotationSource.length > 0
    ? Math.max(0, currentCursor) % rotationSource.length
    : 0;
  const rotated = [
    ...rotationSource.slice(cursor),
    ...rotationSource.slice(0, cursor),
  ];
  const seen = new Set<string>();
  const channels: YoutubeItem[] = [];
  for (const channel of [...active, ...rotated]) {
    if (seen.has(channel.id)) {
      continue;
    }
    seen.add(channel.id);
    channels.push(channel);
    if (channels.length >= SUBSCRIPTION_CHANNELS_PER_REFRESH) {
      break;
    }
  }
  const rotationStep = Math.max(1, SUBSCRIPTION_CHANNELS_PER_REFRESH - active.length);
  const nextCursor = rotationSource.length > 0
    ? (cursor + rotationStep) % rotationSource.length
    : 0;
  return { channels, nextCursor };
}

function subscriptionEligibleItems<T extends YoutubeItem>(items: T[], profile: TasteProfile): T[] {
  return items
    .filter((item) => item.kind === 'video')
    .filter((item) => !profile.negativeIds.has(item.id))
    .filter((item) => !profile.watchedIds.has(item.id))
    .filter((item) => !isLiveVideo(item))
    .filter((item) => !isShortLikeVideo(item));
}

function sortSubscriptionItems(items: YoutubeItem[]): YoutubeItem[] {
  return [...items].sort((a, b) => {
    const publishedDelta = publishedOrUpdatedMs(b) - publishedOrUpdatedMs(a);
    if (publishedDelta !== 0) {
      return publishedDelta;
    }
    return a.id.localeCompare(b.id);
  });
}

function selectDiverseByChannel<T extends YoutubeItem>(items: T[], limit: number, maxPerChannel: number): T[] {
  const selected: T[] = [];
  const channelCounts = new Map<string, number>();
  for (const item of items) {
    const channel = item.channel_id || item.channel_title || item.id;
    const count = channelCounts.get(channel) ?? 0;
    if (count >= maxPerChannel) {
      continue;
    }
    selected.push(item);
    channelCounts.set(channel, count + 1);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

function subscriptionRail(options: YoutubeRailsOptions = {}, tasteProfile?: TasteProfile): YoutubeRail {
  const refresh = youtubeRefreshStatus();
  const profile = tasteProfile ?? buildTasteProfile();
  const candidates = subscriptionEligibleItems(
    listYoutubeRailItems('new_from_subscriptions', SUBSCRIPTION_RAIL_POOL_LIMIT),
    profile,
  );
  const withoutSaved = candidates.filter((item) => !profile.savedIds.has(item.id));
  const pool = withoutSaved.length >= YOUTUBE_RAIL_LIMIT ? withoutSaved : candidates;
  const ordered = options.reshuffle
    ? deterministicShuffle(pool, recommendationSeed(options, 'subscriptions'), (item) => item.id)
    : pool;
  let items = selectDiverseByChannel(ordered, YOUTUBE_RAIL_LIMIT, 1);
  if (items.length < YOUTUBE_RAIL_LIMIT) {
    items = selectDiverseByChannel(ordered, YOUTUBE_RAIL_LIMIT, 2);
  }
  items = fillThinSlate(items, ordered);
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  return {
    rail_id: 'new_from_subscriptions',
    label: RAIL_LABELS.new_from_subscriptions,
    items,
    reserve_items: ordered,
    cached: items.length > 0,
    stale,
  };
}

function weightedTokenScore(tokens: Set<string>, weights: Map<string, number>, cap: number): number {
  let score = 0;
  for (const token of tokens) {
    score += weights.get(token) ?? 0;
  }
  return Math.min(cap, score);
}

function channelAffinity(item: YoutubeItem, profile: TasteProfile): number {
  const channel = item.channel_id || item.channel_title || '';
  return channel ? Math.min(2, profile.positiveChannels.get(channel) ?? 0) : 0;
}

function tokenAffinity(item: YoutubeItem, profile: TasteProfile): number {
  return weightedTokenScore(titleTokens(item), profile.positiveTokens, 3);
}

function negativeSimilarity(item: YoutubeItem, profile: TasteProfile): number {
  const channel = item.channel_id || item.channel_title || '';
  const channelPenalty = channel ? Math.min(1.5, profile.negativeChannels.get(channel) ?? 0) : 0;
  return channelPenalty + weightedTokenScore(titleTokens(item), profile.negativeTokens, 1.5);
}

function durationFitScore(item: YoutubeItem): number {
  const duration = item.duration_sec;
  if (duration === null || duration <= 0) return 0.45;
  const minutes = duration / 60;
  if (minutes >= 8 && minutes <= 45) return 1;
  if (minutes > 45 && minutes <= 90) return 0.65;
  if (minutes >= 2 && minutes < 8) return 0.35;
  return 0.2;
}

function metadataQualityScore(item: YoutubeItem): number {
  let score = 0;
  if (item.thumbnail) score += 0.3;
  if (item.description) score += 0.2;
  if (item.duration_sec !== null) score += 0.3;
  if (item.channel_id || item.channel_title) score += 0.2;
  return score;
}

function isLowSignalYoutubeRecommendation(item: YoutubeItem): boolean {
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  return [
    /\b(admit card|answer key|cut[ -]?off|exam result|exam notification|sarkari|vacancy)\b/,
    /\b(ssc|neet|jee|upsc|mts)\b.*\b(result|cut[ -]?off|answer key)\b/,
    /\b(result|cut[ -]?off|answer key)\b.*\b(ssc|neet|jee|upsc|mts)\b/,
  ].some((pattern) => pattern.test(text));
}

function isLowSignalFreshFind(item: YoutubeItem): boolean {
  return isLowSignalYoutubeRecommendation(item);
}

function isFreshFindDurationEligible(item: YoutubeItem, allowShortDuration: boolean): boolean {
  if (allowShortDuration) return true;
  if (item.duration_sec === null || item.duration_sec <= 0) return true;
  return item.duration_sec >= FRESH_FIND_MIN_DURATION_SEC;
}

function topicCluster(item: YoutubeItem): string {
  const tokens = [...titleTokens(item)].slice(0, 2);
  if (tokens.length > 0) return tokens.join(':');
  return item.channel_id || item.channel_title || item.id;
}

function sourceWeight(source: ForYouSource): number {
  if (source === 'saved') return 1.2;
  if (source === 'history') return 1.05;
  if (source === 'subscription') return 0.45;
  if (source === 'discovery') return 0.35;
  if (source === 'popular') return 0.12;
  return 0.08;
}

function forYouSourceHints(): Map<string, ForYouSource> {
  const hints = new Map<string, ForYouSource>();
  for (const item of listYoutubeRailItems('popular', FOR_YOU_RESERVOIR_TARGET)) {
    hints.set(item.id, 'popular');
  }
  for (const item of listYoutubeRailItems('fresh_finds', FOR_YOU_RESERVOIR_TARGET)) {
    hints.set(item.id, 'discovery');
  }
  for (const item of listYoutubeRailItems('new_from_subscriptions', FOR_YOU_RESERVOIR_TARGET)) {
    hints.set(item.id, 'subscription');
  }
  for (const item of listYoutubeRailItems(LEGACY_FOR_YOU_DISCOVERY_RAIL_ID, FOR_YOU_RESERVOIR_TARGET)) {
    hints.set(item.id, 'discovery');
  }
  return hints;
}

function chooseForYouSource(item: YoutubeItem, profile: TasteProfile, hints: Map<string, ForYouSource>): ForYouSource {
  if (profile.savedIds.has(item.id)) return 'saved';
  const affinity = channelAffinity(item, profile) + tokenAffinity(item, profile);
  if (affinity >= 0.75) return 'history';
  const hinted = hints.get(item.id);
  if (hinted) return hinted;
  if (affinity >= 0.25) return 'discovery';
  return 'wildcard';
}

function chooseForYouLane(item: YoutubeItem, source: ForYouSource, profile: TasteProfile): ForYouLane {
  if (source === 'saved' || source === 'history' || source === 'subscription') {
    return 'familiar';
  }
  if (source === 'discovery') {
    return 'discovery';
  }
  const affinity = channelAffinity(item, profile) + tokenAffinity(item, profile);
  if (source === 'popular' && affinity < 0.25) return 'wildcard';
  return affinity >= 0.25 ? 'discovery' : 'wildcard';
}

function scoreForYouItem(
  item: YoutubeItem,
  source: ForYouSource,
  profile: TasteProfile,
  stats: Pick<YoutubeForYouCandidate, 'exposure_count' | 'ignore_count' | 'quick_stop_count'> = {
    exposure_count: 0,
    ignore_count: 0,
    quick_stop_count: 0,
  },
  scoredAt = nowMs(),
): { score: number; breakdown: Record<string, number | string> } {
  const channel = channelAffinity(item, profile) * 0.45;
  const topic = tokenAffinity(item, profile) * 0.55;
  const sourceBoost = sourceWeight(source);
  const freshness = recencyScore(item, scoredAt) * 0.55;
  const duration = durationFitScore(item) * 0.8;
  const quality = metadataQualityScore(item) * 0.35;
  const negative = negativeSimilarity(item, profile) * 0.9;
  // Mere non-selection and early exits are neutral. Only confirmed exposure
  // cools repetition; explicit Not-for-me remains a separate hard veto.
  const exposure = Math.min(1.25, stats.exposure_count * 0.06);
  const quickStop = 0;
  const raw = 1 + channel + topic + sourceBoost + freshness + duration + quality
    - negative - exposure - quickStop;
  const score = Math.max(0.01, raw);
  return {
    score,
    breakdown: {
      channel,
      topic,
      source,
      source_boost: sourceBoost,
      freshness,
      duration,
      quality,
      negative,
      exposure,
      quick_stop: quickStop,
      final: score,
    },
  };
}

function isEligibleForYouCandidate(
  candidate: YoutubeForYouCandidate,
  profile: TasteProfile,
  allowRecentExposure: boolean,
): boolean {
  if (candidate.kind !== 'video') return false;
  if (profile.watchedIds.has(candidate.id)) return false;
  // Saved is an explicit anchor rail. Letting those items compete in For You
  // can consume one of its four cards during cross-rail dedupe and hide the
  // entire Saved row when supply is exactly four.
  if (profile.savedIds.has(candidate.id)) return false;
  if (profile.negativeIds.has(candidate.id)) return false;
  if (isLiveVideo(candidate)) return false;
  if (isShortLikeVideo(candidate)) return false;
  if (
    !allowRecentExposure
    && candidate.last_recommended_at !== null
    && nowMs() - candidate.last_recommended_at < FOR_YOU_EXPOSURE_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

function buildForYouReservoir(): void {
  const hints = forYouSourceHints();
  const scoredAt = nowMs();
  const v2AcquiredIds = new Set(listAllYoutubeV2CandidateIds());
  const scored = listYoutubeItems('video', 20_000)
    // A generic metadata row is not legacy acquisition provenance. Keep rows
    // that predate/avoid v2, plus explicit legacy rails when both systems have
    // acquired the same video.
    .filter((item) => !v2AcquiredIds.has(item.id) || hints.has(item.id))
    .filter((item) => !isLiveVideo(item))
    .filter((item) => !isShortLikeVideo(item))
    .map((item) => {
      // The reservoir is a shared retrieval pool, not a viewer slate. Persist
      // only profile-neutral quality so whichever profile triggers refresh
      // cannot remove, classify, or down-rank candidates for another viewer.
      const source = hints.get(item.id) ?? 'wildcard';
      const freshness = recencyScore(item, scoredAt) * 0.55;
      const duration = durationFitScore(item) * 0.8;
      const quality = metadataQualityScore(item) * 0.35;
      const sourceBoost = sourceWeight(source) * 0.25;
      const score = Math.max(0.01, 1 + freshness + duration + quality + sourceBoost);
      return {
        item,
        lane: 'wildcard' as ForYouLane,
        source,
        source_weight: sourceWeight(source),
        topic_cluster: topicCluster(item),
        score,
        score_breakdown: {
          source: 'shared_retrieval',
          source_boost: sourceBoost,
          freshness,
          duration,
          quality,
          final: score,
        },
        reason: 'for_you:shared_retrieval',
      };
    })
    .sort(compareScoreThenId)
    .slice(0, FOR_YOU_RESERVOIR_TARGET);
  replaceForYouCandidates(scored);
}

function forYouDiscoveryQueries(): string[] {
  // Acquisition is shared by every profile. Personal taste is applied only
  // while rendering a slate, never while choosing what enters this reservoir.
  return [...new Set(BASE_FRESH_FIND_QUERY_SPECS.map((spec) => spec.query.trim()).filter(Boolean))]
    .slice(0, 4);
}

function rfc3339DaysAgo(days: number): string {
  return new Date(nowMs() - days * 86_400_000).toISOString();
}

function freshFindQuerySpecs(): FreshFindQuerySpec[] {
  return [...BASE_FRESH_FIND_QUERY_SPECS]
    .filter((spec, index, all) => all.findIndex((entry) => entry.query === spec.query) === index)
    .slice(0, FRESH_FIND_SEARCH_BUDGET);
}

function freshBucketWeight(bucket: FreshFindBucket): number {
  if (bucket === 'taste_adjacent') return 0.65;
  if (bucket === 'quality_fresh') return 0.55;
  if (bucket === 'emerging_creator') return 0.45;
  if (bucket === 'zeitgeist_light') return 0.35;
  return 0.22;
}

function creatorSizeScore(stats: YoutubeChannelStats | null | undefined): number {
  if (!stats || stats.hidden_subscriber_count || stats.subscriber_count === null) {
    return 0.12;
  }
  const subscribers = stats.subscriber_count;
  if (subscribers <= 500_000) return 0.45;
  if (subscribers <= 2_000_000) return 0.25;
  if (subscribers >= 10_000_000) return -0.12;
  return 0.08;
}

function freshNoveltyScore(item: YoutubeItem, profile: TasteProfile): number {
  const channel = item.channel_id || item.channel_title || '';
  const channelKnown = channel ? profile.positiveChannels.has(channel) : false;
  const topic = tokenAffinity(item, profile);
  if (!channelKnown && topic > 0) return 0.5;
  if (!channelKnown) return 0.35;
  return 0.05;
}

function scoreFreshFindItem(
  item: YoutubeItem,
  bucket: FreshFindBucket,
  profile: TasteProfile,
  stats: Pick<YoutubeFreshFindCandidate, 'exposure_count' | 'ignore_count' | 'quick_stop_count'> = {
    exposure_count: 0,
    ignore_count: 0,
    quick_stop_count: 0,
  },
  creatorStats?: YoutubeChannelStats | null,
): { score: number; breakdown: Record<string, number | string> } {
  const freshness = recencyScore(item) * 0.95;
  const duration = durationFitScore(item) * 0.75;
  const quality = metadataQualityScore(item) * 0.5;
  const taste = tokenAffinity(item, profile) * 0.22;
  const novelty = freshNoveltyScore(item, profile);
  const source = freshBucketWeight(bucket);
  const creator = creatorSizeScore(creatorStats);
  const negative = negativeSimilarity(item, profile) * 0.95;
  const exposure = Math.min(1.5, stats.exposure_count * 0.08);
  const quickStop = 0;
  const raw = 1 + freshness + duration + quality + taste + novelty + source + creator
    - negative - exposure - quickStop;
  const score = Math.max(0.01, raw);
  return {
    score,
    breakdown: {
      bucket,
      freshness,
      duration,
      quality,
      taste,
      novelty,
      source,
      creator,
      negative,
      exposure,
      quick_stop: quickStop,
      final: score,
    },
  };
}

function subscribedChannelKeys(): Set<string> {
  const keys = new Set<string>();
  for (const item of listYoutubeRailItems('new_from_subscriptions', SUBSCRIPTION_RAIL_POOL_LIMIT)) {
    if (item.channel_id) keys.add(`id:${item.channel_id}`);
    if (item.channel_title) keys.add(`title:${item.channel_title}`);
  }
  return keys;
}

function isSubscribedChannel(item: YoutubeItem, subscribed: Set<string>): boolean {
  return Boolean(
    (item.channel_id && subscribed.has(`id:${item.channel_id}`))
    || (item.channel_title && subscribed.has(`title:${item.channel_title}`)),
  );
}

function isLowSignalLiveNow(item: YoutubeItem): boolean {
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  return [
    /\b(24\/7|24x7|lofi|lo-fi|sleep music|rain sounds|white noise|ambient music)\b/,
    /\b(live cam|webcam|cctv|security camera|earthcam|traffic cam)\b/,
    /\b(study music|relaxing music|radio station|scanner radio)\b/,
    /\b(stock market live|crypto live|trading live)\b/,
  ].some((pattern) => pattern.test(text));
}

function liveNowLaneWeight(lane: LiveNowLane): number {
  if (lane === 'subscription_live') return 1.35;
  if (lane === 'news_events') return 0.95;
  if (lane === 'sports') return 0.9;
  if (lane === 'music_performance') return 0.8;
  if (lane === 'gaming') return 0.7;
  if (lane === 'culture_talks') return 0.65;
  return 0.35;
}

function scoreLiveNowItem(
  item: YoutubeItem,
  lane: LiveNowLane,
  profile: TasteProfile,
  stats: Pick<YoutubeLiveNowCandidate, 'exposure_count' | 'ignore_count' | 'quick_stop_count'> = {
    exposure_count: 0,
    ignore_count: 0,
    quick_stop_count: 0,
  },
  sourceWeight = 1,
  searchRank = 0,
): { score: number; breakdown: Record<string, number | string> } {
  const laneBoost = liveNowLaneWeight(lane) * sourceWeight;
  const affinity = (channelAffinity(item, profile) * 0.35) + (tokenAffinity(item, profile) * 0.16);
  const freshness = recencyScore(item) * 0.25;
  const quality = metadataQualityScore(item) * 0.45;
  const rank = Math.max(0, 1 - searchRank / 25) * 0.45;
  const negative = negativeSimilarity(item, profile) * 0.95;
  const exposure = Math.min(1.4, stats.exposure_count * 0.1);
  const quickStop = 0;
  const raw = 1 + laneBoost + affinity + freshness + quality + rank
    - negative - exposure - quickStop;
  const score = Math.max(0.01, raw);
  return {
    score,
    breakdown: {
      lane,
      lane_boost: laneBoost,
      affinity,
      freshness,
      quality,
      search_rank: rank,
      negative,
      exposure,
      quick_stop: quickStop,
      final: score,
    },
  };
}

function liveNowLaneForItem(item: YoutubeItem, subscribed: Set<string>): LiveNowLane {
  if (isSubscribedChannel(item, subscribed)) return 'subscription_live';
  const text = `${item.title} ${item.description || ''} ${item.channel_title || ''}`.toLowerCase();
  if (/\b(cricket|football|soccer|basketball|tennis|f1|formula 1|sports?|match|game)\b/.test(text)) {
    return 'sports';
  }
  if (/\b(concert|music|festival|performance|dj|band|artist)\b/.test(text)) {
    return 'music_performance';
  }
  if (/\b(gaming|esports?|gameplay|streamer)\b/.test(text)) {
    return 'gaming';
  }
  if (/\b(interview|podcast|talk show|debate|panel|lecture)\b/.test(text)) {
    return 'culture_talks';
  }
  if (/\b(news|breaking|live event|election|weather|space|science|technology)\b/.test(text)) {
    return 'news_events';
  }
  return 'wildcard';
}

function buildLiveNowCandidatesFromCache(): number {
  const timestamp = nowMs();
  const profile = emptyTasteProfile();
  const subscribed = subscribedChannelKeys();
  const scored = uniqueVideos([
    ...listLiveNowCandidates(LIVE_NOW_POOL_TARGET)
      .filter((item) => item.expires_at > timestamp)
      .map((item) => ({ ...item, updated_at: Math.max(item.updated_at, item.last_verified_at) })),
    ...listYoutubeRailItems('live_now', LIVE_NOW_POOL_TARGET),
    ...listYoutubeRailItems('popular', LIVE_NOW_POOL_TARGET),
    ...listYoutubeItems('video', LIVE_NOW_POOL_TARGET * 8),
  ])
    .filter((item) => item.live_status === 'live')
    .filter((item) => item.updated_at + LIVE_NOW_TTL_MS > timestamp)
    .filter((item) => !isShortLikeVideo(item))
    .filter((item) => !isLowSignalLiveNow(item))
    .map((item) => {
      const lane = liveNowLaneForItem(item, subscribed);
      const { score, breakdown } = scoreLiveNowItem(item, lane, profile, undefined, 0.6);
      return {
        item,
        source_lane: lane,
        query: 'cache',
        topic_cluster: topicCluster(item),
        score,
        score_breakdown: { ...breakdown, source: 'cache' },
        reason: `live_now:${lane}:cache`,
        last_verified_at: item.updated_at,
        expires_at: item.updated_at + LIVE_NOW_TTL_MS,
      };
    })
    .sort(compareScoreThenId)
    .slice(0, LIVE_NOW_POOL_TARGET);
  if (scored.length === 0) {
    return 0;
  }
  upsertLiveNowCandidates(scored);
  pruneLiveNowCandidates(LIVE_NOW_POOL_TARGET);
  return scored.length;
}

function liveNowCacheRevalidationIds(timestamp = nowMs()): string[] {
  return [...new Set(uniqueVideos([
    ...listLiveNowCandidates(LIVE_NOW_POOL_TARGET)
      .filter((item) => item.expires_at > timestamp || item.updated_at + LIVE_NOW_TTL_MS > timestamp),
    ...listYoutubeRailItems('live_now', LIVE_NOW_POOL_TARGET),
    ...listYoutubeRailItems('popular', LIVE_NOW_POOL_TARGET),
    ...listYoutubeItems('video', LIVE_NOW_POOL_TARGET * 8)
      .filter((item) => item.updated_at + LIVE_NOW_TTL_MS > timestamp),
  ])
    .filter((item) => item.live_status === 'live')
    .map((item) => item.id))]
    .slice(0, 150);
}

function seedLiveNowCandidatesFromLegacyRail(): void {
  if (listLiveNowCandidates(1).length > 0) {
    return;
  }
  const timestamp = nowMs();
  const legacy = listYoutubeRailItems('live_now', LIVE_NOW_POOL_TARGET)
    .filter((item) => item.live_status === 'live')
    .filter((item) => item.updated_at + LIVE_NOW_TTL_MS > timestamp);
  if (legacy.length === 0) {
    return;
  }
  upsertLiveNowCandidates(legacy.map((item, index) => ({
    item,
    source_lane: 'wildcard',
    query: 'legacy',
    topic_cluster: topicCluster(item),
    score: item.score || (1 - index * 0.001),
    score_breakdown: { source: 'legacy', final: item.score || (1 - index * 0.001) },
    reason: 'live_now:legacy',
    last_verified_at: item.updated_at,
    expires_at: item.updated_at + LIVE_NOW_TTL_MS,
  })));
}

function isEligibleLiveNowCandidate(
  candidate: YoutubeLiveNowCandidate,
  profile: TasteProfile,
  allowRecentExposure: boolean,
): boolean {
  if (candidate.kind !== 'video') return false;
  if (candidate.live_status !== 'live') return false;
  if (candidate.expires_at <= nowMs()) return false;
  if (profile.negativeIds.has(candidate.id)) return false;
  if (isShortLikeVideo(candidate)) return false;
  if (isLowSignalLiveNow(candidate)) return false;
  if (
    !allowRecentExposure
    && candidate.last_recommended_at !== null
    && nowMs() - candidate.last_recommended_at < LIVE_NOW_EXPOSURE_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

function samplingWeightLiveNow(candidate: ScoredLiveNowCandidate, reshuffle: boolean): number {
  return Math.max(0.01, reshuffle ? candidate.score : candidate.score * candidate.score);
}

function canUseLiveNowCandidate(
  candidate: ScoredLiveNowCandidate,
  selected: ScoredLiveNowCandidate[],
  channelCounts: Map<string, number>,
  laneCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerLane: number,
): boolean {
  if (selected.some((item) => item.id === candidate.id)) return false;
  const channel = candidate.channel_id || candidate.channel_title || candidate.id;
  if ((channelCounts.get(channel) ?? 0) >= maxPerChannel) return false;
  if ((laneCounts.get(candidate.source_lane) ?? 0) >= maxPerLane) return false;
  return true;
}

function weightedPickLiveNow(
  candidates: ScoredLiveNowCandidate[],
  options: YoutubeRailsOptions,
  context: string,
): ScoredLiveNowCandidate | null {
  return deterministicWeightedPick(
    candidates,
    (candidate) => samplingWeightLiveNow(candidate, Boolean(options.reshuffle)),
    options,
    context,
  );
}

function addLiveNowSelection(
  pool: ScoredLiveNowCandidate[],
  selected: ScoredLiveNowCandidate[],
  count: number,
  options: YoutubeRailsOptions,
  context: string,
  channelCounts: Map<string, number>,
  laneCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerLane: number,
): void {
  while (selected.length < YOUTUBE_RAIL_LIMIT && count > 0) {
    const eligible = pool.filter((candidate) => (
      canUseLiveNowCandidate(candidate, selected, channelCounts, laneCounts, maxPerChannel, maxPerLane)
    ));
    if (eligible.length === 0) return;
    const picked = weightedPickLiveNow(eligible, options, `${context}:${selected.length}`);
    if (!picked) return;
    selected.push(picked);
    const channel = picked.channel_id || picked.channel_title || picked.id;
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    laneCounts.set(picked.source_lane, (laneCounts.get(picked.source_lane) ?? 0) + 1);
    count -= 1;
  }
}

function sampleLiveNowCandidates(
  candidates: ScoredLiveNowCandidate[],
  options: YoutubeRailsOptions,
  maxPerChannel: number,
  maxPerLane: number,
): ScoredLiveNowCandidate[] {
  const selected: ScoredLiveNowCandidate[] = [];
  const channelCounts = new Map<string, number>();
  const laneCounts = new Map<string, number>();
  const lanes = [
    'subscription_live',
    'news_events',
    'sports',
    'music_performance',
    'gaming',
    'culture_talks',
    'wildcard',
  ] as LiveNowLane[];
  for (const lane of rotated(lanes, options.slateSequence)) {
    addLiveNowSelection(
      candidates.filter((candidate) => candidate.source_lane === lane),
      selected,
      LIVE_NOW_LANE_QUOTAS[lane],
      options,
      `live_now:${lane}`,
      channelCounts,
      laneCounts,
      maxPerChannel,
      maxPerLane,
    );
  }
  addLiveNowSelection(
    candidates,
    selected,
    YOUTUBE_RAIL_LIMIT - selected.length,
    options,
    'live_now:fallback',
    channelCounts,
    laneCounts,
    maxPerChannel,
    maxPerLane,
  );
  return selected;
}

function liveNowRail(options: YoutubeRailsOptions = {}, tasteProfile?: TasteProfile): YoutubeRail {
  seedLiveNowCandidatesFromLegacyRail();
  const profile = tasteProfile ?? buildTasteProfile();
  const usable = listLiveNowCandidates(YOUTUBE_RAIL_LIMIT)
    .filter((candidate) => candidate.live_status === 'live' && candidate.expires_at > nowMs());
  if (usable.length < YOUTUBE_RAIL_LIMIT) {
    buildLiveNowCandidatesFromCache();
  }
  const profileStates = profileCandidateStateById('live_now', '', options.profileId);
  const scoreCandidates = (allowRecentExposure: boolean) => (
    listLiveNowCandidates(LIVE_NOW_POOL_TARGET)
      .map((candidate) => withProfileCandidateState(candidate, profileStates))
      .filter((candidate) => isEligibleLiveNowCandidate(candidate, profile, allowRecentExposure))
      .map((candidate): ScoredLiveNowCandidate => {
        const lane = (candidate.source_lane || 'wildcard') as LiveNowLane;
        const { score, breakdown } = scoreLiveNowItem(candidate, lane, profile, candidate);
        return { ...candidate, score, score_breakdown: breakdown };
      })
      .sort(compareScoreThenId)
  );
  let candidates = scoreCandidates(false);
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    candidates = scoreCandidates(true);
  }
  let selected = sampleLiveNowCandidates(candidates, options, 1, 2);
  if (selected.length < YOUTUBE_RAIL_LIMIT) {
    selected = sampleLiveNowCandidates(candidates, options, 2, 3);
  }
  if (selected.length < YOUTUBE_RAIL_LIMIT) {
    selected = sampleLiveNowCandidates(candidates, options, YOUTUBE_RAIL_LIMIT, YOUTUBE_RAIL_LIMIT);
  }
  selected = fillThinSlate(selected, candidates);
  const stale = selected.some((item) => nowMs() - item.last_verified_at > LIVE_NOW_REFRESH_STALE_MS);
  return {
    rail_id: 'live_now',
    label: RAIL_LABELS.live_now,
    items: selected.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    reserve_items: candidates.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    cached: selected.length > 0,
    stale,
  };
}

function liveNowSubscriptionSpecs(): LiveNowQuerySpec[] {
  const channels = new Map<string, YoutubeItem>();
  for (const item of listYoutubeRailItems('new_from_subscriptions', SUBSCRIPTION_RAIL_POOL_LIMIT)) {
    if (!item.channel_id) continue;
    channels.set(item.channel_id, item);
  }
  return [...channels.values()].slice(0, LIVE_NOW_SUBSCRIPTION_SEARCH_LIMIT).map((item) => ({
    source_lane: 'subscription_live',
    query: '',
    channelId: item.channel_id || undefined,
    order: 'viewCount',
    limit: 4,
    source_weight: 1.2,
  }));
}

function liveNowEditorialSpecs(): LiveNowQuerySpec[] {
  return [
    {
      source_lane: 'news_events',
      query: 'breaking news live|world news live',
      order: 'viewCount',
      limit: 12,
      source_weight: 1,
    },
    {
      source_lane: 'news_events',
      query: 'technology live|science live|space live',
      order: 'relevance',
      limit: 8,
      source_weight: 0.75,
    },
    {
      source_lane: 'sports',
      query: 'cricket live|football live|basketball live',
      order: 'viewCount',
      limit: 10,
      source_weight: 0.95,
    },
    {
      source_lane: 'music_performance',
      query: 'live concert|music performance live|festival live',
      order: 'relevance',
      limit: 10,
      source_weight: 0.85,
    },
    {
      source_lane: 'gaming',
      query: 'gaming live|esports live',
      order: 'viewCount',
      limit: 10,
      source_weight: 0.8,
    },
    {
      source_lane: 'culture_talks',
      query: 'interview live|talk show live|podcast live',
      order: 'relevance',
      limit: 10,
      source_weight: 0.75,
    },
    {
      source_lane: 'wildcard',
      query: 'live now',
      order: 'viewCount',
      limit: 12,
      source_weight: 0.45,
    },
  ];
}

function liveNowQuerySpecs(): LiveNowQuerySpec[] {
  return [
    ...liveNowSubscriptionSpecs(),
    ...liveNowEditorialSpecs(),
  ].slice(0, LIVE_NOW_SEARCH_BUDGET);
}

function popularRegions(config: YoutubeConfig): string[] {
  return [...new Set([
    config.region_code,
    'IN',
    'US',
  ]
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean))]
    .slice(0, 3);
}

function popularQuerySpecs(config: YoutubeConfig): PopularQuerySpec[] {
  return popularRegions(config).flatMap((sourceRegion) => (
    POPULAR_CATEGORY_SPECS.map((spec) => ({
      ...spec,
      source_region: sourceRegion,
    }))
  ));
}

function popularCategoryQuota(category: string): number {
  return POPULAR_CATEGORY_QUOTAS.get(category) ?? 1;
}

function scorePopularItem(
  item: YoutubeItem,
  spec: PopularQuerySpec,
  stats: Pick<YoutubePopularCandidate, 'exposure_count' | 'ignore_count' | 'quick_stop_count'> = {
    exposure_count: 0,
    ignore_count: 0,
    quick_stop_count: 0,
  },
  chartRank = 0,
): { score: number; breakdown: Record<string, number | string> } {
  const rank = Math.max(0, 1 - chartRank / 50) * 1.25;
  const source = spec.source_weight;
  const freshness = recencyScore(item) * 0.35;
  const duration = durationFitScore(item) * 0.22;
  const quality = metadataQualityScore(item) * 0.32;
  const exposure = Math.min(1.2, stats.exposure_count * 0.08);
  const quickStop = 0;
  const raw = 1 + rank + source + freshness + duration + quality - exposure - quickStop;
  const score = Math.max(0.01, raw);
  return {
    score,
    breakdown: {
      region: spec.source_region,
      category: spec.category_label,
      rank,
      source,
      freshness,
      duration,
      quality,
      exposure,
      quick_stop: quickStop,
      final: score,
    },
  };
}

function seedPopularCandidatesFromLegacyRail(): void {
  if (listPopularCandidates(1).length > 0) {
    return;
  }
  const legacy = listYoutubeRailItems('popular', POPULAR_POOL_TARGET)
    .filter((item) => item.kind === 'video')
    .filter((item) => !isLiveVideo(item))
    .filter((item) => !isShortLikeVideo(item));
  if (legacy.length === 0) {
    return;
  }
  upsertPopularCandidates(legacy.map((item, index) => ({
    item,
    source_region: 'legacy',
    category_id: '0',
    category_label: 'all',
    topic_cluster: topicCluster(item),
    score: item.score || (1 - index * 0.001),
    score_breakdown: { source: 'legacy', final: item.score || (1 - index * 0.001) },
    reason: 'popular:legacy',
  })));
}

function isEligiblePopularCandidate(
  candidate: YoutubePopularCandidate,
  profile: TasteProfile,
  subscribed: Set<string>,
  options: PopularEligibilityOptions,
): boolean {
  if (candidate.kind !== 'video') return false;
  if (profile.watchedIds.has(candidate.id)) return false;
  if (profile.negativeIds.has(candidate.id)) return false;
  if (isLiveVideo(candidate)) return false;
  if (isShortLikeVideo(candidate)) return false;
  if (isLowSignalYoutubeRecommendation(candidate)) return false;
  if (!options.allowSavedOrSubscribed && profile.savedIds.has(candidate.id)) return false;
  if (!options.allowSavedOrSubscribed && isSubscribedChannel(candidate, subscribed)) return false;
  if (
    !options.allowRecentExposure
    && candidate.last_recommended_at !== null
    && nowMs() - candidate.last_recommended_at < POPULAR_EXPOSURE_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

function samplingWeightPopular(candidate: ScoredPopularCandidate, reshuffle: boolean): number {
  return Math.max(0.01, reshuffle ? candidate.score : candidate.score * candidate.score);
}

function canUsePopularCandidate(
  candidate: ScoredPopularCandidate,
  selected: ScoredPopularCandidate[],
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
  categoryCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerTopic: number,
  maxPerCategory: number,
): boolean {
  if (selected.some((item) => item.id === candidate.id)) return false;
  const channel = candidate.channel_id || candidate.channel_title || candidate.id;
  if ((channelCounts.get(channel) ?? 0) >= maxPerChannel) return false;
  const cluster = candidate.topic_cluster || candidate.id;
  if ((topicCounts.get(cluster) ?? 0) >= maxPerTopic) return false;
  const category = candidate.category_label || 'all';
  if ((categoryCounts.get(category) ?? 0) >= maxPerCategory) return false;
  return true;
}

function weightedPickPopular(
  candidates: ScoredPopularCandidate[],
  options: YoutubeRailsOptions,
  context: string,
): ScoredPopularCandidate | null {
  if (!options.reshuffle) {
    return candidates[0] || null;
  }
  return deterministicWeightedPick(
    candidates,
    (candidate) => samplingWeightPopular(candidate, true),
    options,
    context,
  );
}

function addPopularSelection(
  pool: ScoredPopularCandidate[],
  selected: ScoredPopularCandidate[],
  count: number,
  options: YoutubeRailsOptions,
  context: string,
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
  categoryCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerTopic: number,
  maxPerCategory: number,
): void {
  while (selected.length < YOUTUBE_RAIL_LIMIT && count > 0) {
    const eligible = pool.filter((candidate) => (
      canUsePopularCandidate(
        candidate,
        selected,
        channelCounts,
        topicCounts,
        categoryCounts,
        maxPerChannel,
        maxPerTopic,
        maxPerCategory,
      )
    ));
    if (eligible.length === 0) return;
    const picked = weightedPickPopular(eligible, options, `${context}:${selected.length}`);
    if (!picked) return;
    selected.push(picked);
    const channel = picked.channel_id || picked.channel_title || picked.id;
    const cluster = picked.topic_cluster || picked.id;
    const category = picked.category_label || 'all';
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    topicCounts.set(cluster, (topicCounts.get(cluster) ?? 0) + 1);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    count -= 1;
  }
}

function samplePopularCandidates(
  candidates: ScoredPopularCandidate[],
  options: YoutubeRailsOptions,
  maxPerChannel: number,
  maxPerTopic: number,
  maxPerCategory: number,
): ScoredPopularCandidate[] {
  const selected: ScoredPopularCandidate[] = [];
  const channelCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const spec of rotated(POPULAR_CATEGORY_SPECS, options.slateSequence)) {
    addPopularSelection(
      candidates.filter((candidate) => candidate.category_label === spec.category_label),
      selected,
      popularCategoryQuota(spec.category_label),
      options,
      `popular:${spec.category_label}`,
      channelCounts,
      topicCounts,
      categoryCounts,
      maxPerChannel,
      maxPerTopic,
      maxPerCategory,
    );
  }
  addPopularSelection(
    candidates,
    selected,
    YOUTUBE_RAIL_LIMIT - selected.length,
    options,
    'popular:fallback',
    channelCounts,
    topicCounts,
    categoryCounts,
    maxPerChannel,
    maxPerTopic,
    maxPerCategory,
  );
  return selected;
}

function popularRail(options: YoutubeRailsOptions = {}, tasteProfile?: TasteProfile): YoutubeRail {
  seedPopularCandidatesFromLegacyRail();
  const refresh = youtubeRefreshStatus();
  const profile = tasteProfile ?? buildTasteProfile();
  const profileStates = profileCandidateStateById('popular', '', options.profileId);
  const subscribed = subscribedChannelKeys();
  const scoreCandidates = (
    allowRecentExposure: boolean,
    allowSavedOrSubscribed: boolean,
  ) => (
    listPopularCandidates(POPULAR_POOL_TARGET)
      .map((candidate) => withProfileCandidateState(candidate, profileStates))
      .filter((candidate) => isEligiblePopularCandidate(candidate, profile, subscribed, {
        allowRecentExposure,
        allowSavedOrSubscribed,
      }))
      .map((candidate): ScoredPopularCandidate => {
        const spec: PopularQuerySpec = {
          source_region: candidate.source_region || 'cache',
          category_id: candidate.category_id || '0',
          category_label: candidate.category_label || 'all',
          fetch_limit: POPULAR_FETCH_LIMIT,
          source_weight: candidate.category_label === 'all' ? 1.2 : 1,
        };
        const { score, breakdown } = scorePopularItem(candidate, spec, candidate);
        return { ...candidate, score, score_breakdown: breakdown };
      })
      .sort(compareScoreThenId)
  );
  let candidates = scoreCandidates(false, false);
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    candidates = scoreCandidates(false, true);
  }
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    setYoutubeState('popular_needs_expansion', { at: nowMs(), eligible: candidates.length });
    candidates = scoreCandidates(true, true);
  }
  let selected = samplePopularCandidates(candidates, options, 1, 2, 2);
  if (selected.length < YOUTUBE_RAIL_LIMIT) {
    selected = samplePopularCandidates(candidates, options, 2, 3, 3);
  }
  if (selected.length < YOUTUBE_RAIL_LIMIT) {
    selected = samplePopularCandidates(candidates, options, YOUTUBE_RAIL_LIMIT, YOUTUBE_RAIL_LIMIT, YOUTUBE_RAIL_LIMIT);
  }
  selected = fillThinSlate(selected, candidates);
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  return {
    rail_id: 'popular',
    label: RAIL_LABELS.popular,
    items: selected.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    reserve_items: candidates.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    cached: selected.length > 0,
    stale,
  };
}

function seedFreshFindCandidatesFromLegacyRail(): void {
  if (listFreshFindCandidates(1).length > 0) {
    return;
  }
  const legacy = listYoutubeRailItems('fresh_finds', FRESH_FIND_POOL_TARGET);
  if (legacy.length === 0) {
    return;
  }
  upsertFreshFindCandidates(legacy.map((item, index) => ({
    item,
    source_bucket: 'quality_fresh',
    query: 'legacy',
    topic_cluster: topicCluster(item),
    score: item.score || (1 - index * 0.001),
    score_breakdown: { source: 'legacy', final: item.score || (1 - index * 0.001) },
    reason: 'fresh_find:legacy',
  })));
}

function isEligibleFreshFindCandidate(
  candidate: YoutubeFreshFindCandidate,
  profile: TasteProfile,
  subscribed: Set<string>,
  options: FreshFindEligibilityOptions,
): boolean {
  if (candidate.kind !== 'video') return false;
  if (profile.watchedIds.has(candidate.id)) return false;
  if (profile.negativeIds.has(candidate.id)) return false;
  if (isLiveVideo(candidate)) return false;
  if (isShortLikeVideo(candidate)) return false;
  if (isLowSignalFreshFind(candidate)) return false;
  if (!isFreshFindDurationEligible(candidate, options.allowShortDuration)) return false;
  if (!options.allowSavedOrSubscribed && profile.savedIds.has(candidate.id)) return false;
  if (!options.allowSavedOrSubscribed && isSubscribedChannel(candidate, subscribed)) return false;
  if (
    !options.allowRecentExposure
    && candidate.last_recommended_at !== null
    && nowMs() - candidate.last_recommended_at < FRESH_FIND_EXPOSURE_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

function samplingWeightFresh(candidate: ScoredFreshFindCandidate, reshuffle: boolean): number {
  return Math.max(0.01, reshuffle ? candidate.score : candidate.score * candidate.score);
}

function canUseFreshFindCandidate(
  candidate: ScoredFreshFindCandidate,
  selected: ScoredFreshFindCandidate[],
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerTopic: number,
): boolean {
  if (selected.some((item) => item.id === candidate.id)) return false;
  const channel = candidate.channel_id || candidate.channel_title || candidate.id;
  if ((channelCounts.get(channel) ?? 0) >= maxPerChannel) return false;
  const cluster = candidate.topic_cluster || candidate.id;
  if ((topicCounts.get(cluster) ?? 0) >= maxPerTopic) return false;
  return true;
}

function weightedPickFreshFind(
  candidates: ScoredFreshFindCandidate[],
  options: YoutubeRailsOptions,
  context: string,
): ScoredFreshFindCandidate | null {
  return deterministicWeightedPick(
    candidates,
    (candidate) => samplingWeightFresh(candidate, Boolean(options.reshuffle)),
    options,
    context,
  );
}

function addFreshFindSelection(
  pool: ScoredFreshFindCandidate[],
  selected: ScoredFreshFindCandidate[],
  count: number,
  options: YoutubeRailsOptions,
  context: string,
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerTopic: number,
): void {
  while (selected.length < YOUTUBE_RAIL_LIMIT && count > 0) {
    const eligible = pool.filter((candidate) => (
      canUseFreshFindCandidate(candidate, selected, channelCounts, topicCounts, maxPerChannel, maxPerTopic)
    ));
    if (eligible.length === 0) return;
    const picked = weightedPickFreshFind(eligible, options, `${context}:${selected.length}`);
    if (!picked) return;
    selected.push(picked);
    const channel = picked.channel_id || picked.channel_title || picked.id;
    const cluster = picked.topic_cluster || picked.id;
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    topicCounts.set(cluster, (topicCounts.get(cluster) ?? 0) + 1);
    count -= 1;
  }
}

function sampleFreshFindCandidates(
  candidates: ScoredFreshFindCandidate[],
  options: YoutubeRailsOptions,
  maxPerChannel: number,
  maxPerTopic: number,
): ScoredFreshFindCandidate[] {
  const selected: ScoredFreshFindCandidate[] = [];
  const channelCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const buckets = ['taste_adjacent', 'quality_fresh', 'emerging_creator', 'zeitgeist_light', 'wildcard'] as FreshFindBucket[];
  for (const bucket of rotated(buckets, options.slateSequence)) {
    addFreshFindSelection(
      candidates.filter((candidate) => candidate.source_bucket === bucket),
      selected,
      FRESH_FIND_BUCKET_QUOTAS[bucket],
      options,
      `fresh_finds:${bucket}`,
      channelCounts,
      topicCounts,
      maxPerChannel,
      maxPerTopic,
    );
  }
  addFreshFindSelection(
    candidates,
    selected,
    YOUTUBE_RAIL_LIMIT - selected.length,
    options,
    'fresh_finds:fallback',
    channelCounts,
    topicCounts,
    maxPerChannel,
    maxPerTopic,
  );
  return selected;
}

function freshFindRail(options: YoutubeRailsOptions = {}, tasteProfile?: TasteProfile): YoutubeRail {
  seedFreshFindCandidatesFromLegacyRail();
  const refresh = youtubeRefreshStatus();
  const profile = tasteProfile ?? buildTasteProfile();
  const profileStates = profileCandidateStateById('fresh_finds', '', options.profileId);
  const subscribed = subscribedChannelKeys();
  const scoreCandidates = (
    allowRecentExposure: boolean,
    allowSavedOrSubscribed: boolean,
    allowShortDuration: boolean,
  ) => (
    listFreshFindCandidates(FRESH_FIND_POOL_TARGET)
      .map((candidate) => withProfileCandidateState(candidate, profileStates))
      .filter((candidate) => isEligibleFreshFindCandidate(candidate, profile, subscribed, {
        allowRecentExposure,
        allowSavedOrSubscribed,
        allowShortDuration,
      }))
      .map((candidate): ScoredFreshFindCandidate => {
        const bucket = (candidate.source_bucket || 'wildcard') as FreshFindBucket;
        const { score, breakdown } = scoreFreshFindItem(candidate, bucket, profile, candidate, {
          subscriber_count: candidate.creator_subscriber_count,
          video_count: candidate.creator_video_count,
          view_count: null,
          hidden_subscriber_count: candidate.creator_subscriber_count === null,
        });
        return { ...candidate, score, score_breakdown: breakdown };
      })
      .sort(compareScoreThenId)
  );
  let candidates = scoreCandidates(false, false, false);
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    candidates = scoreCandidates(false, true, false);
  }
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    candidates = scoreCandidates(true, true, false);
  }
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    candidates = scoreCandidates(true, true, true);
  }
  let selected = sampleFreshFindCandidates(candidates, options, 1, 2);
  if (selected.length < YOUTUBE_RAIL_LIMIT) {
    selected = sampleFreshFindCandidates(candidates, options, 2, 3);
  }
  selected = fillThinSlate(selected, candidates);
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  return {
    rail_id: 'fresh_finds',
    label: RAIL_LABELS.fresh_finds,
    items: selected.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    reserve_items: candidates.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    cached: selected.length > 0,
    stale,
  };
}

function samplingWeight(candidate: ScoredForYouCandidate, reshuffle: boolean): number {
  return Math.max(0.01, reshuffle ? candidate.score : candidate.score * candidate.score);
}

function canUseForYouCandidate(
  candidate: ScoredForYouCandidate,
  selected: ScoredForYouCandidate[],
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
): boolean {
  if (selected.some((item) => item.id === candidate.id)) return false;
  const channel = candidate.channel_id || candidate.channel_title || candidate.id;
  if ((channelCounts.get(channel) ?? 0) >= 1) return false;
  const cluster = candidate.topic_cluster || candidate.id;
  if ((topicCounts.get(cluster) ?? 0) >= 2) return false;
  return true;
}

function weightedPickForYou(
  candidates: ScoredForYouCandidate[],
  options: YoutubeRailsOptions,
  context: string,
): ScoredForYouCandidate | null {
  return deterministicWeightedPick(
    candidates,
    (candidate) => samplingWeight(candidate, Boolean(options.reshuffle)),
    options,
    context,
  );
}

function addForYouSelection(
  pool: ScoredForYouCandidate[],
  selected: ScoredForYouCandidate[],
  count: number,
  options: YoutubeRailsOptions,
  context: string,
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
): void {
  while (selected.length < YOUTUBE_RAIL_LIMIT && count > 0) {
    const eligible = pool.filter((candidate) => (
      canUseForYouCandidate(candidate, selected, channelCounts, topicCounts)
    ));
    if (eligible.length === 0) return;
    const picked = weightedPickForYou(eligible, options, `${context}:${selected.length}`);
    if (!picked) return;
    selected.push(picked);
    const channel = picked.channel_id || picked.channel_title || picked.id;
    const cluster = picked.topic_cluster || picked.id;
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    topicCounts.set(cluster, (topicCounts.get(cluster) ?? 0) + 1);
    count -= 1;
  }
}

function sampleForYouCandidates(
  candidates: ScoredForYouCandidate[],
  options: YoutubeRailsOptions,
): ScoredForYouCandidate[] {
  const selected: ScoredForYouCandidate[] = [];
  const channelCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const pattern = FOR_YOU_SLATE_PATTERNS[
    Math.abs(Math.trunc(options.slateSequence ?? 0)) % FOR_YOU_SLATE_PATTERNS.length
  ]!;
  for (const lane of ['familiar', 'discovery', 'wildcard'] as ForYouLane[]) {
    addForYouSelection(
      candidates.filter((candidate) => candidate.lane === lane),
      selected,
      pattern[lane],
      options,
      `for_you:${lane}`,
      channelCounts,
      topicCounts,
    );
  }
  const requested = { ...pattern };
  const selectedBeforeFallback = selected.length;
  const fulfilled = selected.reduce<Record<ForYouLane, number>>((counts, candidate) => {
    counts[candidate.lane as ForYouLane] += 1;
    return counts;
  }, { familiar: 0, discovery: 0, wildcard: 0 });
  addForYouSelection(
    candidates,
    selected,
    YOUTUBE_RAIL_LIMIT - selected.length,
    options,
    'for_you:fallback',
    channelCounts,
    topicCounts,
  );
  setYoutubeState('for_you_lane_fallback:last', {
    profile_id: options.profileId ?? 'household',
    slate_sequence: options.slateSequence ?? 0,
    requested,
    fulfilled_before_fallback: fulfilled,
    fallback_slots: Math.max(0, YOUTUBE_RAIL_LIMIT - selectedBeforeFallback),
    complete: selected.length === YOUTUBE_RAIL_LIMIT,
  });
  return selected;
}

function forYouCandidateChannel(candidate: ScoredForYouCandidate): string {
  return candidate.channel_id || candidate.channel_title || candidate.id;
}

function forYouCandidateTopic(candidate: ScoredForYouCandidate): string {
  return candidate.topic_cluster || candidate.id;
}

/**
 * Preserves the selected lane counts and creator/topic caps while representing
 * one genuinely learned secondary script. Two positive examples and two
 * viable candidates are required, so a single item never creates a quota.
 */
function calibrateForYouScriptBalance(
  selected: ScoredForYouCandidate[],
  candidates: ScoredForYouCandidate[],
  profile: TasteProfile,
): ScoredForYouCandidate[] {
  if (selected.length !== YOUTUBE_RAIL_LIMIT) return selected;
  const learned = [...profile.scriptPreferences.entries()]
    .filter(([, preference]) => (
      preference.share >= SECONDARY_SCRIPT_MIN_SHARE
      && preference.evidenceItems >= SECONDARY_SCRIPT_MIN_EVIDENCE_ITEMS
    ))
    .sort((left, right) => right[1].share - left[1].share || left[0].localeCompare(right[0]));
  if (learned.length < 2) return selected;
  const secondary = learned[1]![0];
  if (selected.some((candidate) => youtubeTitleScriptBucket(candidate.title) === secondary)) {
    return selected;
  }
  const supply = candidates.filter((candidate) => (
    youtubeTitleScriptBucket(candidate.title) === secondary
    && !selected.some((item) => item.id === candidate.id)
  ));
  if (supply.length < SECONDARY_SCRIPT_MIN_CANDIDATES) return selected;
  if (new Set(supply.map(forYouCandidateChannel)).size < SECONDARY_SCRIPT_MIN_CANDIDATES) return selected;

  const replacementOrder = selected
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => left.candidate.score - right.candidate.score || right.index - left.index);
  for (const replacement of replacementOrder) {
    const remaining = selected.filter((_, index) => index !== replacement.index);
    const channelCounts = new Map<string, number>();
    const topicCounts = new Map<string, number>();
    for (const candidate of remaining) {
      const channel = forYouCandidateChannel(candidate);
      const topic = forYouCandidateTopic(candidate);
      channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    const replacementCandidate = supply.find((candidate) => (
      candidate.lane === replacement.candidate.lane
      && canUseForYouCandidate(candidate, remaining, channelCounts, topicCounts)
    ));
    if (!replacementCandidate) continue;
    const output = [...selected];
    output[replacement.index] = replacementCandidate;
    return output;
  }
  return selected;
}

function forYouRail(options: YoutubeRailsOptions = {}, tasteProfile?: TasteProfile): YoutubeRail {
  // Lazy init: only rebuild the For-You reservoir on the read path if it is
  // currently empty (first-ever GET after startup or a fresh install). The
  // normal refresh cycle owns keeping the reservoir current
  // (`rebuildForYouReservoir` runs as the final phase of `refresh()`), and
  // `play()` also rebuilds after each watch. Rebuilding on every plain GET
  // was the primary cause of the ~269ms /youtube/rails latency.
  if (listForYouCandidates(1).length === 0) {
    buildForYouReservoir();
  }
  const refresh = youtubeRefreshStatus();
  const profile = tasteProfile ?? buildTasteProfile();
  const hints = forYouSourceHints();
  const profileStates = profileCandidateStateById('for_you', '', options.profileId);
  // One immutable wall-clock snapshot keeps equal candidates byte-for-byte
  // equal and prevents loop timing from becoming an accidental rank feature.
  const scoredAt = nowMs();
  const scoreCandidates = (allowRecentExposure: boolean) => listForYouCandidates(FOR_YOU_RESERVOIR_TARGET)
    .map((candidate) => withProfileCandidateState(candidate, profileStates))
    .filter((candidate) => isEligibleForYouCandidate(candidate, profile, allowRecentExposure))
    .map((candidate): ScoredForYouCandidate => {
      // Source and lane are viewer classifications, never reservoir truth.
      // Recompute both from the active profile even when the item came from a
      // discovery cache built while another profile was active.
      const source = chooseForYouSource(candidate, profile, hints);
      const lane = chooseForYouLane(candidate, source, profile);
      const { score, breakdown } = scoreForYouItem(
        candidate,
        source,
        profile,
        candidate,
        scoredAt,
      );
      return {
        ...candidate,
        source,
        lane,
        source_weight: sourceWeight(source),
        score,
        score_breakdown: breakdown,
        reason: `for_you:${source}`,
      };
    })
    .sort(compareScoreThenId);
  let candidates = scoreCandidates(false);
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    setYoutubeState('for_you_needs_expansion', { at: nowMs(), eligible: candidates.length });
    candidates = scoreCandidates(true);
  }
  let selected = fillThinSlate(sampleForYouCandidates(candidates, options), candidates);
  selected = calibrateForYouScriptBalance(selected, candidates, profile);
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  return {
    rail_id: 'for_you',
    label: RAIL_LABELS.for_you,
    items: selected.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    reserve_items: candidates.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    cached: selected.length > 0,
    stale,
  };
}

function savedRail(
  profileId: string,
  limit = YOUTUBE_RAIL_LIMIT,
  householdBlend = profileId === 'household',
): YoutubeRail {
  const saved = listSavedLibraryItems(YOUTUBE_TAB, limit, {
    profile_id: profileId,
    household_blend: householdBlend,
  })
    .filter((item) => item.source === YOUTUBE_SOURCE && item.type === YOUTUBE_VIDEO_TYPE)
    .map((item) => libraryItemToYoutube(item))
    .filter((item): item is YoutubeRailItem => item !== null);
  return {
    rail_id: 'saved',
    label: RAIL_LABELS.saved,
    items: saved,
    cached: saved.length > 0,
    stale: false,
  };
}

function historyRail(profileId: string, limit = YOUTUBE_RAIL_LIMIT): YoutubeRail {
  const history = listUniqueWatchHistory({
    source: YOUTUBE_SOURCE,
    type: YOUTUBE_VIDEO_TYPE,
    profile_id: profileId,
    household_blend: profileId === 'household',
  });
  const items = history
    .slice(0, limit)
    .map((item) => libraryItemToYoutube(item))
    .filter((item): item is YoutubeRailItem => item !== null);
  return {
    rail_id: 'history',
    label: RAIL_LABELS.history,
    items,
    cached: items.length > 0,
    stale: false,
  };
}

function isBecauseDurationEligible(item: YoutubeItem, allowShortDuration: boolean): boolean {
  if (allowShortDuration) return true;
  if (item.duration_sec === null || item.duration_sec <= 0) return true;
  return item.duration_sec >= BECAUSE_YOU_WATCHED_MIN_DURATION_SEC;
}

function isSameChannel(left: YoutubeItem, right: YoutubeItem): boolean {
  return Boolean(
    (left.channel_id && right.channel_id && left.channel_id === right.channel_id)
    || (left.channel_title && right.channel_title && left.channel_title === right.channel_title),
  );
}

function latestBecauseYouWatchedSeed(profileId: string, limit = 24): RecentWatchedYoutubeItem | null {
  const records = recentWatchedYoutubeRecords(profileId, limit);
  if (records.length === 0) return null;
  const meaningful = records.find(({ item }) => (
    !isLiveVideo(item)
    && !isShortLikeVideo(item)
    && !isLowSignalYoutubeRecommendation(item)
  ));
  return meaningful || records.find(({ item }) => !isLiveVideo(item) && !isShortLikeVideo(item)) || records[0] || null;
}

function becauseRelationForItem(item: YoutubeItem, seed: YoutubeItem): BecauseYouWatchedRelation | null {
  if (item.id === seed.id) return null;
  if (isSameChannel(item, seed)) return 'same_channel';
  const overlap = tokenOverlapScore(titleTokens(seed), titleTokens(item));
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  const deepDive = /\b(documentary|explained|analysis|interview|deep dive|history|lecture|breakdown|essay)\b/.test(text)
    || (item.duration_sec !== null && item.duration_sec >= 45 * 60);
  if (overlap >= 0.45) return 'same_topic';
  if (overlap >= 0.22 && deepDive) return 'deeper_dive';
  if (overlap >= 0.15) return 'wildcard';
  return null;
}

function becauseRelationWeight(relation: BecauseYouWatchedRelation): number {
  if (relation === 'same_channel') return 1.35;
  if (relation === 'same_topic') return 1.1;
  if (relation === 'deeper_dive') return 0.85;
  return 0.35;
}

function scoreBecauseYouWatchedItem(
  item: YoutubeItem,
  seed: YoutubeItem,
  relation: BecauseYouWatchedRelation,
  profile: TasteProfile,
  stats: Pick<YoutubeBecauseYouWatchedCandidate, 'exposure_count' | 'ignore_count' | 'quick_stop_count'> = {
    exposure_count: 0,
    ignore_count: 0,
    quick_stop_count: 0,
  },
): { score: number; breakdown: Record<string, number | string> } {
  const seedOverlap = tokenOverlapScore(titleTokens(seed), titleTokens(item)) * 1.55;
  const relationBoost = becauseRelationWeight(relation);
  const sameChannel = relation === 'same_channel' ? 1.15 : 0;
  const taste = (tokenAffinity(item, profile) * 0.18) + (channelAffinity(item, profile) * 0.12);
  const freshness = recencyScore(item) * 0.35;
  const duration = durationFitScore(item) * 0.65;
  const quality = metadataQualityScore(item) * 0.3;
  const negative = negativeSimilarity(item, profile) * 0.9;
  const exposure = Math.min(1.4, stats.exposure_count * 0.08);
  const quickStop = 0;
  const raw = 1 + relationBoost + sameChannel + seedOverlap + taste + freshness + duration + quality
    - negative - exposure - quickStop;
  const score = Math.max(0.01, raw);
  return {
    score,
    breakdown: {
      relation,
      relation_boost: relationBoost,
      same_channel: sameChannel,
      seed_overlap: seedOverlap,
      taste,
      freshness,
      duration,
      quality,
      negative,
      exposure,
      quick_stop: quickStop,
      final: score,
    },
  };
}

function buildBecauseYouWatchedCandidatesFromCache(seedRecord: RecentWatchedYoutubeItem): void {
  const seed = seedRecord.item;
  const profile = emptyTasteProfile();
  const candidates = uniqueVideos([
    ...listYoutubeRailItems('new_from_subscriptions', BECAUSE_YOU_WATCHED_POOL_TARGET),
    ...listYoutubeRailItems('fresh_finds', BECAUSE_YOU_WATCHED_POOL_TARGET),
    ...listYoutubeRailItems('popular', BECAUSE_YOU_WATCHED_POOL_TARGET),
    ...listYoutubeItems('video', BECAUSE_YOU_WATCHED_POOL_TARGET * 4),
  ])
    .filter((item) => !profile.watchedIds.has(item.id))
    .filter((item) => !profile.negativeIds.has(item.id))
    .filter((item) => !isLiveVideo(item))
    .filter((item) => !isShortLikeVideo(item))
    .filter((item) => !isLowSignalYoutubeRecommendation(item))
    .map((item) => {
      const relation = becauseRelationForItem(item, seed);
      if (!relation) return null;
      const { score, breakdown } = scoreBecauseYouWatchedItem(item, seed, relation, profile);
      return {
        item,
        seed_video_id: seed.id,
        seed_watched_at: seedRecord.watched_at,
        relation_type: relation,
        query: 'cache',
        topic_cluster: topicCluster(item),
        score,
        score_breakdown: breakdown,
        reason: `because_you_watched:${relation}:cache`,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort(compareScoreThenId)
    .slice(0, BECAUSE_YOU_WATCHED_POOL_TARGET);
  upsertBecauseYouWatchedCandidates(candidates);
}

function becauseYouWatchedQuerySpecs(seed: YoutubeItem): BecauseYouWatchedQuerySpec[] {
  const tokens = [...titleTokens(seed)].slice(0, 5);
  const topicQuery = tokens.join(' ');
  const specs: BecauseYouWatchedQuerySpec[] = [];
  if (seed.channel_id) {
    specs.push({
      query: topicQuery,
      relation_type: 'same_channel',
      channelId: seed.channel_id,
      order: 'date',
      limit: 8,
      publishedAfterDays: 365,
      videoDuration: 'medium',
    });
  } else if (seed.channel_title) {
    specs.push({
      query: `${seed.channel_title} ${topicQuery}`.trim(),
      relation_type: 'same_channel',
      order: 'date',
      limit: 8,
      publishedAfterDays: 365,
      videoDuration: 'medium',
    });
  }
  if (topicQuery) {
    specs.push(
      { query: `${topicQuery} explained`, relation_type: 'same_topic', order: 'relevance', limit: 8, publishedAfterDays: 540, videoDuration: 'medium' },
      { query: `${topicQuery} documentary`, relation_type: 'deeper_dive', order: 'relevance', limit: 8, publishedAfterDays: 900, videoDuration: 'long' },
      { query: `${topicQuery} analysis`, relation_type: 'deeper_dive', order: 'relevance', limit: 8, publishedAfterDays: 540, videoDuration: 'medium' },
      { query: `${topicQuery} story`, relation_type: 'wildcard', order: 'relevance', limit: 8, publishedAfterDays: 900, videoDuration: 'medium' },
    );
  }
  return specs
    .filter((spec, index, all) => all.findIndex((entry) => (
      entry.query === spec.query && entry.channelId === spec.channelId && entry.relation_type === spec.relation_type
    )) === index)
    .slice(0, BECAUSE_YOU_WATCHED_SEARCH_BUDGET);
}

function isEligibleBecauseYouWatchedCandidate(
  candidate: YoutubeBecauseYouWatchedCandidate,
  profile: TasteProfile,
  options: BecauseYouWatchedEligibilityOptions,
): boolean {
  if (candidate.kind !== 'video') return false;
  if (profile.watchedIds.has(candidate.id)) return false;
  if (profile.negativeIds.has(candidate.id)) return false;
  if (!options.allowSaved && profile.savedIds.has(candidate.id)) return false;
  if (isLiveVideo(candidate)) return false;
  if (isShortLikeVideo(candidate)) return false;
  if (isLowSignalYoutubeRecommendation(candidate)) return false;
  if (!isBecauseDurationEligible(candidate, options.allowShortDuration)) return false;
  if (
    !options.allowRecentExposure
    && candidate.last_recommended_at !== null
    && nowMs() - candidate.last_recommended_at < BECAUSE_YOU_WATCHED_EXPOSURE_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

function samplingWeightBecause(candidate: ScoredBecauseYouWatchedCandidate, reshuffle: boolean): number {
  return Math.max(0.01, reshuffle ? candidate.score : candidate.score * candidate.score);
}

function canUseBecauseYouWatchedCandidate(
  candidate: ScoredBecauseYouWatchedCandidate,
  selected: ScoredBecauseYouWatchedCandidate[],
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerTopic: number,
): boolean {
  if (selected.some((item) => item.id === candidate.id)) return false;
  const channel = becauseCandidateChannel(candidate);
  if ((channelCounts.get(channel) ?? 0) >= maxPerChannel) return false;
  const cluster = becauseCandidateTopic(candidate);
  if ((topicCounts.get(cluster) ?? 0) >= maxPerTopic) return false;
  return true;
}

function becauseCandidateChannel(candidate: YoutubeItem): string {
  return candidate.channel_id || candidate.channel_title || candidate.id;
}

function becauseCandidateTopic(candidate: ScoredBecauseYouWatchedCandidate): string {
  return candidate.topic_cluster || candidate.id;
}

function distinctBecauseChannels(candidates: ScoredBecauseYouWatchedCandidate[]): number {
  return new Set(candidates.map(becauseCandidateChannel)).size;
}

function weightedPickBecause(
  candidates: ScoredBecauseYouWatchedCandidate[],
  options: YoutubeRailsOptions,
  context: string,
): ScoredBecauseYouWatchedCandidate | null {
  return deterministicWeightedPick(
    candidates,
    (candidate) => samplingWeightBecause(candidate, Boolean(options.reshuffle)),
    options,
    context,
  );
}

function addBecauseYouWatchedSelection(
  pool: ScoredBecauseYouWatchedCandidate[],
  selected: ScoredBecauseYouWatchedCandidate[],
  count: number,
  options: YoutubeRailsOptions,
  context: string,
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
  maxPerChannel: number,
  maxPerTopic: number,
): void {
  while (selected.length < YOUTUBE_RAIL_LIMIT && count > 0) {
    const eligible = pool.filter((candidate) => (
      canUseBecauseYouWatchedCandidate(candidate, selected, channelCounts, topicCounts, maxPerChannel, maxPerTopic)
    ));
    if (eligible.length === 0) return;
    const picked = weightedPickBecause(eligible, options, `${context}:${selected.length}`);
    if (!picked) return;
    selected.push(picked);
    const channel = becauseCandidateChannel(picked);
    const cluster = becauseCandidateTopic(picked);
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    topicCounts.set(cluster, (topicCounts.get(cluster) ?? 0) + 1);
    count -= 1;
  }
}

function sampleBecauseYouWatchedCandidates(
  candidates: ScoredBecauseYouWatchedCandidate[],
  options: YoutubeRailsOptions,
  maxPerChannel: number,
  maxPerTopic: number,
): ScoredBecauseYouWatchedCandidate[] {
  const selected: ScoredBecauseYouWatchedCandidate[] = [];
  const channelCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  for (const relation of ['same_channel', 'same_topic', 'deeper_dive', 'wildcard'] as BecauseYouWatchedRelation[]) {
    addBecauseYouWatchedSelection(
      candidates.filter((candidate) => candidate.relation_type === relation),
      selected,
      BECAUSE_YOU_WATCHED_RELATION_QUOTAS[relation],
      options,
      `because:${relation}`,
      channelCounts,
      topicCounts,
      maxPerChannel,
      maxPerTopic,
    );
  }
  addBecauseYouWatchedSelection(
    candidates,
    selected,
    YOUTUBE_RAIL_LIMIT - selected.length,
    options,
    'because:fallback',
    channelCounts,
    topicCounts,
    maxPerChannel,
    maxPerTopic,
  );
  return selected;
}

function becauseYouWatchedRail(options: YoutubeRailsOptions = {}, tasteProfile?: TasteProfile): YoutubeRail {
  const profileId = options.profileId ?? activeViewerProfileId();
  const seed = latestBecauseYouWatchedSeed(profileId);
  if (!seed) {
    replaceYoutubeRailItems('because_you_watched', []);
    return {
      rail_id: 'because_you_watched',
      label: RAIL_LABELS.because_you_watched,
      items: [],
      cached: false,
      stale: false,
    };
  }
  const profile = tasteProfile ?? buildTasteProfile();
  buildBecauseYouWatchedCandidatesFromCache(seed);
  const refresh = youtubeRefreshStatus();
  const profileStates = profileCandidateStateById('because_you_watched', seed.item.id, profileId);
  const scoreCandidates = (
    allowRecentExposure: boolean,
    allowSaved: boolean,
    allowShortDuration: boolean,
  ) => (
    listBecauseYouWatchedCandidates(seed.item.id, BECAUSE_YOU_WATCHED_POOL_TARGET)
      .map((candidate) => withProfileCandidateState(candidate, profileStates))
      .filter((candidate) => isEligibleBecauseYouWatchedCandidate(candidate, profile, {
        allowRecentExposure,
        allowSaved,
        allowShortDuration,
      }))
      .map((candidate): ScoredBecauseYouWatchedCandidate => {
        const relation = (candidate.relation_type || 'wildcard') as BecauseYouWatchedRelation;
        const { score, breakdown } = scoreBecauseYouWatchedItem(candidate, seed.item, relation, profile, candidate);
        return {
          ...candidate,
          relation_type: relation,
          score,
          score_breakdown: breakdown,
        };
      })
      .sort(compareScoreThenId)
  );
  let candidates = scoreCandidates(false, false, false);
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    candidates = scoreCandidates(false, true, false);
  }
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    setYoutubeState('because_you_watched_needs_expansion', {
      at: nowMs(),
      seed_video_id: seed.item.id,
      eligible: candidates.length,
    });
    candidates = scoreCandidates(true, true, false);
  }
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    candidates = scoreCandidates(true, true, true);
  }
  const strictChannelLimit = distinctBecauseChannels(candidates) >= YOUTUBE_RAIL_LIMIT ? 1 : 2;
  let selected = sampleBecauseYouWatchedCandidates(candidates, options, strictChannelLimit, 2);
  if (selected.length < YOUTUBE_RAIL_LIMIT) {
    selected = sampleBecauseYouWatchedCandidates(candidates, options, strictChannelLimit, 3);
  }
  if (selected.length < YOUTUBE_RAIL_LIMIT) {
    selected = sampleBecauseYouWatchedCandidates(candidates, options, strictChannelLimit, YOUTUBE_RAIL_LIMIT);
  }
  if (selected.length < YOUTUBE_RAIL_LIMIT && strictChannelLimit > 1) {
    selected = sampleBecauseYouWatchedCandidates(candidates, options, 3, YOUTUBE_RAIL_LIMIT);
  }
  if (selected.length < YOUTUBE_RAIL_LIMIT && strictChannelLimit > 1) {
    selected = sampleBecauseYouWatchedCandidates(candidates, options, YOUTUBE_RAIL_LIMIT, YOUTUBE_RAIL_LIMIT);
  }
  selected = fillThinSlate(selected, candidates);
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  setYoutubeState('because_you_watched_active_seed', {
    id: seed.item.id,
    title: seed.item.title,
    watched_at: seed.watched_at,
    selected: selected.length,
  });
  return {
    rail_id: 'because_you_watched',
    label: RAIL_LABELS.because_you_watched,
    candidate_context_id: seed.item.id,
    items: selected.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    reserve_items: candidates.map((item) => ({
      ...item,
      reason: item.reason,
      score: item.score,
    })),
    cached: selected.length > 0,
    stale,
  };
}

function groupCachedSearch(query: string, limit: number): YoutubeSearchGroups {
  const cached = searchCachedYoutubeItems(query, limit * 3);
  return {
    videos: cached.filter((item) => item.kind === 'video').slice(0, limit),
    channels: cached.filter((item) => item.kind === 'channel').slice(0, limit),
    playlists: cached.filter((item) => item.kind === 'playlist').slice(0, limit),
  };
}

function youtubeAdaptiveRailPriority(rail: YoutubeRail): number {
  const base = rail.rail_id === 'because_you_watched'
    ? 100
    : rail.rail_id.startsWith('ai-')
      ? 92
      : rail.rail_id === 'live_now'
        ? 88
        : rail.rail_id === 'fresh_finds'
          ? 82
          : rail.rail_id === 'popular'
            ? 74
            : 60;
  return base + Math.min(YOUTUBE_RAIL_LIMIT, rail.items.length) * 3 - (rail.stale ? 24 : 0);
}

function allocateBecauseRailItems(
  eligible: YoutubeRailItem[],
  globallySeen: Set<string>,
): YoutubeRailItem[] {
  const unseen = eligible.filter((item) => !globallySeen.has(item.id));
  const pool = [...unseen, ...eligible.filter((item) => globallySeen.has(item.id))];
  const desired = Math.min(YOUTUBE_RAIL_LIMIT, eligible.length);
  const policies = [
    { maxPerChannel: 1, maxPerTopic: 2 },
    { maxPerChannel: 2, maxPerTopic: 2 },
    { maxPerChannel: 2, maxPerTopic: 3 },
    { maxPerChannel: YOUTUBE_RAIL_LIMIT, maxPerTopic: YOUTUBE_RAIL_LIMIT },
  ];
  for (const policy of policies) {
    const selected: YoutubeRailItem[] = [];
    const channels = new Map<string, number>();
    const topics = new Map<string, number>();
    for (const item of pool) {
      if (selected.some((candidate) => candidate.id === item.id)) continue;
      const channel = item.channel_id || item.channel_title || item.id;
      const topic = (item as YoutubeRailItem & { topic_cluster?: string }).topic_cluster || topicCluster(item);
      if ((channels.get(channel) ?? 0) >= policy.maxPerChannel) continue;
      if ((topics.get(topic) ?? 0) >= policy.maxPerTopic) continue;
      selected.push(item);
      channels.set(channel, (channels.get(channel) ?? 0) + 1);
      topics.set(topic, (topics.get(topic) ?? 0) + 1);
      if (selected.length >= desired) return selected;
    }
  }
  return pool.slice(0, desired);
}

function dedupeYoutubeRail(
  rail: YoutubeRail,
  seen: Set<string>,
  profile: TasteProfile,
  recommendationRail: boolean,
): YoutubeRail {
  const candidates = [...rail.items, ...(rail.reserve_items ?? [])];
  const localSeen = new Set<string>();
  const stableUserStateRail = rail.rail_id === 'history' || rail.rail_id === 'saved';
  const eligible = candidates.filter((item) => {
    if (localSeen.has(item.id)) return false;
    localSeen.add(item.id);
    // History and Saved are explicit user state, not recommendations. A
    // Not-for-me signal suppresses discovery but never silently rewrites those
    // source-of-truth rails; History remains chronological and Saved remains
    // present until the viewer explicitly removes it.
    if (!stableUserStateRail && profile.negativeIds.has(item.id)) return false;
    if (recommendationRail && profile.watchedIds.has(item.id)) return false;
    if (recommendationRail && (isShortLikeVideo(item) || isLowSignalYoutubeRecommendation(item))) return false;
    return true;
  });
  if (stableUserStateRail) {
    const items = eligible.slice(0, YOUTUBE_RAIL_LIMIT);
    return { ...rail, items, reserve_items: undefined };
  }
  if (rail.rail_id === 'because_you_watched') {
    const items = allocateBecauseRailItems(eligible, seen);
    return { ...rail, items, reserve_items: undefined };
  }
  const items = eligible.filter((item) => !seen.has(item.id)).slice(0, YOUTUBE_RAIL_LIMIT);
  // Deep production reservoirs normally make every card cross-rail unique. If
  // a cache is genuinely thin, preserve a complete useful row rather than
  // hiding it; duplicates are the explicit last-resort degradation.
  for (const item of eligible) {
    if (items.length >= Math.min(YOUTUBE_RAIL_LIMIT, eligible.length)) break;
    if (!items.some((candidate) => candidate.id === item.id)) items.push(item);
  }
  return { ...rail, items, reserve_items: undefined };
}

function allocateYoutubeRails(
  anchors: YoutubeRail[],
  adaptiveCandidates: YoutubeRail[],
  tasteProfile?: TasteProfile,
): YoutubeRail[] {
  const profile = tasteProfile ?? buildTasteProfile();
  const seen = new Set<string>();
  const output: YoutubeRail[] = [];
  for (const rail of anchors) {
    const deduped = dedupeYoutubeRail(
      rail,
      seen,
      profile,
      rail.rail_id === 'for_you' || rail.rail_id === 'new_from_subscriptions',
    );
    if (deduped.items.length !== YOUTUBE_RAIL_LIMIT) continue;
    deduped.items.forEach((item) => seen.add(item.id));
    output.push(deduped);
  }
  let aiRailUsed = false;
  for (const rail of [...adaptiveCandidates].sort((left, right) => (
    Number(new Set([...right.items, ...(right.reserve_items ?? [])].map((item) => item.id)).size >= YOUTUBE_RAIL_LIMIT)
      - Number(new Set([...left.items, ...(left.reserve_items ?? [])].map((item) => item.id)).size >= YOUTUBE_RAIL_LIMIT)
    || youtubeAdaptiveRailPriority(right) - youtubeAdaptiveRailPriority(left)
    || left.rail_id.localeCompare(right.rail_id)
  ))) {
    if (output.filter((item) => !['for_you', 'new_from_subscriptions', 'history', 'saved'].includes(item.rail_id)).length >= 3) {
      break;
    }
    if (rail.rail_id.startsWith('ai-')) {
      if (aiRailUsed) continue;
    }
    const deduped = dedupeYoutubeRail(rail, seen, profile, true);
    if (deduped.items.length !== YOUTUBE_RAIL_LIMIT) continue;
    if (rail.rail_id.startsWith('ai-')) aiRailUsed = true;
    deduped.items.forEach((item) => seen.add(item.id));
    output.push(deduped);
  }
  return output;
}

function publicYoutubeRails(rails: YoutubeRail[]): PublicYoutubeRail[] {
  return rails.map((rail) => ({
    rail_id: rail.rail_id,
    label: rail.label,
    cached: rail.cached,
    stale: rail.stale,
    items: rail.items.map((item): YoutubeItem => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle,
      description: item.description,
      thumbnail: item.thumbnail,
      channel_id: item.channel_id,
      channel_title: item.channel_title,
      published_at: item.published_at,
      duration_sec: item.duration_sec,
      live_status: item.live_status,
      playlist_id: item.playlist_id,
      updated_at: item.updated_at,
    })),
  }));
}

let activeYoutubeService: YoutubeService | null = null;

export function invalidateYoutubeDiscoveryRailsCache(): void {
  activeYoutubeService?.invalidateRailsCache();
}

export class YoutubeService {
  private readonly config: YoutubeConfig;
  private readonly api: YoutubeApiClient;
  // TTL cache of the discovery portion of /youtube/rails. Saved and History
  // are NOT cached here; they are assembled fresh on every request so
  // save/unsave/watch mutations are reflected immediately.
  private readonly discoveryRailsCache = new Map<string, {
    rails: YoutubeRail[];
    slateSequence: number;
    personalizationUpdatedAt: number;
    expiresAt: number;
  }>();
  private readonly searchFlights = new Map<string, Promise<YoutubeSearchGroups>>();
  private firstRunRefresh: Promise<unknown> | null = null;

  constructor(config = loadYoutubeConfig()) {
    this.config = config;
    this.api = new YoutubeApiClient(config);
    initYoutubeDb();
    activeYoutubeService = this;
  }

  invalidateRailsCache(): void {
    this.discoveryRailsCache.clear();
  }

  impressions(input: {
    profile_id: string;
    slate_sequence: number;
    rails: Array<{ rail_id: string; context_id: string; item_ids: string[] }>;
  }): Record<string, unknown> {
    const profileId = input.profile_id.trim().toLowerCase();
    let recorded = 0;
    for (const rail of input.rails.slice(0, 8)) {
      const ids = recordYoutubeImpressions({
        profile_id: profileId,
        slate_sequence: input.slate_sequence,
        rail_id: rail.rail_id,
        context_id: rail.context_id,
        item_ids: rail.item_ids,
      });
      if (ids.length === 0) continue;
      recorded += ids.length;
    }
    return { ok: true, recorded };
  }

  private scheduleFirstRunRefresh(): void {
    if (this.firstRunRefresh || !this.config.enabled || !this.config.api_key) return;
    this.firstRunRefresh = this.refresh('first_run')
      .catch(() => undefined)
      .finally(() => {
        this.firstRunRefresh = null;
      });
  }

  state(): Record<string, unknown> {
    return {
      ok: true,
      enabled: this.config.enabled,
      configured: {
        api_key: Boolean(this.config.api_key),
        oauth_client: youtubeAuthSummary(this.config).configured,
        yt_dlp_command: this.config.yt_dlp_command,
      },
      auth: youtubeAuthSummary(this.config),
      refresh: youtubeRefreshStatus(),
      cache: youtubeCacheSummary(),
      recommendations_v2: youtubeV2Diagnostics(),
    };
  }

  companionStatus(): YoutubeCompanionStatus {
    const auth = youtubeAuthSummary(this.config);
    const refresh = youtubeRefreshStatus();
    return {
      api_key_configured: Boolean(this.config.api_key),
      oauth_configured: auth.configured,
      authenticated: auth.authenticated,
      needs_attention: Boolean(refresh.last_error),
    };
  }

  async startAuth(): Promise<YoutubeAuthStartResult> {
    return startYoutubeDeviceAuth(this.config);
  }

  async pollAuth(sessionId: string): Promise<YoutubeAuthPollResult> {
    return pollYoutubeDeviceAuth(this.config, sessionId);
  }

  disconnectAuth(): Record<string, unknown> {
    clearYoutubeAuth(this.config);
    if (youtubeRecommendationsV2Mode() !== 'off') {
      setYoutubeState('youtube_v2_source_stale', {
        stale: true,
        reason: 'oauth_disconnected',
        at: nowMs(),
        authoritative_subscription_count: listYoutubeV2Subscriptions()
          .filter((row) => row.source === 'oauth').length,
      });
      this.invalidateRailsCache();
    }
    return { ok: true, auth: youtubeAuthSummary(this.config) };
  }

  async startCompanionAuth(): Promise<YoutubeCompanionAuthStart> {
    return youtubeCompanionAuthStartResponse(await this.startAuth());
  }

  async pollCompanionAuth(sessionId: string): Promise<YoutubeCompanionAuthPoll> {
    return youtubeCompanionAuthPollResponse(await this.pollAuth(sessionId));
  }

  disconnectCompanionAuth(): YoutubeCompanionAuthDisconnect {
    this.disconnectAuth();
    return { ok: true };
  }

  private async runRefreshPhase(
    phase: YoutubeRefreshPhase,
    fn: () => Promise<void> | void,
  ): Promise<YoutubeRefreshPhaseResult> {
    const started = nowMs();
    try {
      await fn();
      const ended = nowMs();
      return {
        phase,
        ok: true,
        started_at: started,
        ended_at: ended,
        duration_ms: ended - started,
      };
    } catch (error) {
      const ended = nowMs();
      return {
        phase,
        ok: false,
        started_at: started,
        ended_at: ended,
        duration_ms: ended - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async refreshPopularFromApi(): Promise<void> {
    const specs = popularQuerySpecs(this.config);
    const existing = new Map(listPopularCandidates(POPULAR_POOL_TARGET).map((item) => [item.id, item]));
    const results = await Promise.all(specs.map(async (spec) => {
      try {
        const videos = await this.api.popular(spec.fetch_limit, {
          regionCode: spec.source_region,
          videoCategoryId: spec.category_id === '0' ? undefined : spec.category_id,
        });
        return { ok: true as const, spec, videos, error: null };
      } catch (error) {
        return {
          ok: false as const,
          spec,
          videos: [] as YoutubeItem[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const byId = new Map<string, {
      item: YoutubeItem;
      spec: PopularQuerySpec;
      score: number;
      breakdown: Record<string, number | string>;
      rank: number;
    }>();
    for (const result of results.filter((entry) => entry.ok)) {
      result.videos.forEach((item, index) => {
        if (item.kind !== 'video') return;
        if (isLiveVideo(item)) return;
        if (isShortLikeVideo(item)) return;
        if (isLowSignalYoutubeRecommendation(item)) return;
        const { score, breakdown } = scorePopularItem(item, result.spec, undefined, index);
        const current = byId.get(item.id);
        if (!current || score > current.score) {
          byId.set(item.id, {
            item,
            spec: result.spec,
            score,
            breakdown,
            rank: index,
          });
        }
      });
    }
    const scored = [...byId.values()]
      .sort(compareScoreThenId)
      .slice(0, POPULAR_POOL_TARGET)
      .map(({ item, spec, score, breakdown, rank }) => ({
        item,
        source_region: spec.source_region,
        category_id: spec.category_id,
        category_label: spec.category_label,
        topic_cluster: topicCluster(item),
        score,
        score_breakdown: { ...breakdown, chart_rank: rank },
        reason: `popular:${spec.category_label}:${spec.source_region}`,
      }));
    if (scored.length > 0) {
      upsertPopularCandidates(scored);
      prunePopularCandidates(POPULAR_POOL_TARGET);
      const cache = listPopularCandidates(YOUTUBE_RAIL_POOL_LIMIT);
      replaceYoutubeRailItems('popular', cache.map((item, index) => ({
        item,
        score: item.score,
        reason: `popular:${item.category_label}:${item.source_region}:${index + 1}`,
      })));
    } else if (existing.size === 0) {
      const failures = results
        .filter((entry) => !entry.ok)
        .map((entry) => `${entry.spec.source_region}/${entry.spec.category_label}: ${entry.error || 'failed'}`);
      throw new CatalogError(502, `Popular refresh failed: ${failures.join('; ') || 'no videos returned'}`);
    }
    setYoutubeState('popular_last_refresh_count', scored.length);
    setYoutubeState('popular_last_regions', popularRegions(this.config));
    setYoutubeState('popular_last_partial_failures', results
      .filter((entry) => !entry.ok)
      .map((entry) => ({
        region: entry.spec.source_region,
        category: entry.spec.category_label,
        error: entry.error,
      })));
  }

  private async refreshLiveNowFromApi(): Promise<void> {
    const specs = liveNowQuerySpecs();
    const timestamp = nowMs();
    const revalidationIds = liveNowCacheRevalidationIds(timestamp);
    let revalidationError: string | null = null;
    if (revalidationIds.length > 0) {
      try {
        await this.api.videos(revalidationIds);
      } catch (error) {
        revalidationError = error instanceof Error ? error.message : String(error);
      }
    }
    const cachedCount = buildLiveNowCandidatesFromCache();
    const results = await Promise.all(specs.map(async (spec) => {
      try {
        const groups = await this.api.search(spec.query, {
          limit: spec.limit,
          eventType: 'live',
          order: spec.order,
          type: 'video',
          channelId: spec.channelId,
          safeSearch: 'moderate',
        });
        return { ok: true as const, spec, videos: groups.videos, error: null };
      } catch (error) {
        return {
          ok: false as const,
          spec,
          videos: [] as YoutubeItem[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    if (results.length > 0 && results.every((entry) => !entry.ok) && cachedCount === 0) {
      throw new CatalogError(502, `Live Now refresh failed: ${results.map((entry) => entry.error || entry.spec.source_lane).join('; ')}`);
    }
    const byId = new Map<string, { item: YoutubeItem; spec: LiveNowQuerySpec; rank: number }>();
    for (const result of results.filter((entry) => entry.ok)) {
      result.videos.forEach((item, index) => {
        const current = byId.get(item.id);
        if (!current || result.spec.source_weight > current.spec.source_weight) {
          byId.set(item.id, { item, spec: result.spec, rank: index });
        }
      });
    }
    const profile = emptyTasteProfile();
    const scored = [...byId.values()]
      .map(({ item, spec, rank }) => {
        if (item.kind !== 'video') return null;
        if (item.live_status !== 'live') return null;
        if (isShortLikeVideo(item)) return null;
        if (isLowSignalLiveNow(item)) return null;
        const lane = spec.source_lane;
        const { score, breakdown } = scoreLiveNowItem(item, lane, profile, undefined, spec.source_weight, rank);
        return {
          item,
          source_lane: lane,
          query: spec.channelId ? `channel:${spec.channelId}` : spec.query,
          topic_cluster: topicCluster(item),
          score,
          score_breakdown: breakdown,
          reason: `live_now:${lane}`,
          last_verified_at: timestamp,
          expires_at: timestamp + LIVE_NOW_TTL_MS,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort(compareScoreThenId)
      .slice(0, LIVE_NOW_POOL_TARGET);
    if (scored.length > 0) {
      upsertLiveNowCandidates(scored);
      pruneLiveNowCandidates(LIVE_NOW_POOL_TARGET);
      const cache = listLiveNowCandidates(YOUTUBE_RAIL_POOL_LIMIT)
        .filter((item) => item.live_status === 'live' && item.expires_at > timestamp);
      replaceYoutubeRailItems('live_now', cache.map((item, index) => ({
        item,
        score: item.score,
        reason: `live_now:${item.source_lane}:${index + 1}`,
      })));
    } else if (cachedCount > 0) {
      const cache = listLiveNowCandidates(YOUTUBE_RAIL_POOL_LIMIT)
        .filter((item) => item.live_status === 'live' && item.expires_at > timestamp);
      replaceYoutubeRailItems('live_now', cache.map((item, index) => ({
        item,
        score: item.score,
        reason: `live_now:${item.source_lane}:cache:${index + 1}`,
      })));
    } else {
      replaceYoutubeRailItems('live_now', []);
    }
    setYoutubeState('live_now_last_success_at', timestamp);
    setYoutubeState('live_now_last_refresh_count', scored.length || cachedCount);
    setYoutubeState('live_now_last_refresh_source', scored.length > 0 ? 'search' : cachedCount > 0 ? 'cache' : 'empty');
    setYoutubeState('live_now_last_revalidation_count', revalidationError ? 0 : revalidationIds.length);
    setYoutubeState('live_now_last_revalidation_error', revalidationError);
    setYoutubeState('live_now_last_partial_failures', results
      .filter((entry) => !entry.ok)
      .map((entry) => ({ lane: entry.spec.source_lane, query: entry.spec.query, error: entry.error })));
  }

  private async refreshSubscriptionsIfAuthorized(): Promise<void> {
    const token = await youtubeAccessToken(this.config).catch(() => null);
    if (!token) {
      if (youtubeRecommendationsV2Mode() !== 'off') {
        const authoritativeCount = listYoutubeV2Subscriptions()
          .filter((row) => row.source === 'oauth').length;
        if (authoritativeCount > 0) {
          const stale = {
            stale: true,
            reason: 'oauth_unavailable',
            at: nowMs(),
            authoritative_subscription_count: authoritativeCount,
          };
          setYoutubeState('youtube_v2_source_stale', stale);
          setYoutubeState('youtube_v2_subscription_acquisition', stale);
          throw new Error('YouTube OAuth unavailable; retained the last-good authoritative generation');
        }
        setYoutubeState('youtube_v2_source_stale', {
          stale: false,
          reason: 'not_connected',
          at: nowMs(),
          authoritative_subscription_count: 0,
        });
        return;
      }
      setYoutubeState('subscriptions_last_refresh_count', 0);
      setYoutubeState('subscriptions_last_refresh_skipped', {
        at: nowMs(),
        reason: 'not_authenticated',
      });
      return;
    }
    await this.refreshSubscriptionsFromApi(token);
  }

  private rebuildForYouReservoir(): void {
    buildForYouReservoir();
    setYoutubeState('for_you_last_refresh_count', listForYouCandidates(FOR_YOU_RESERVOIR_TARGET).length);
  }

  private async refreshBecauseYouWatchedFromApi(context: YoutubePersonalizationContext): Promise<void> {
    if (!this.config.api_key) {
      return;
    }
    const legacyActive = youtubeRecommendationsV2Mode() !== 'serve';
    const seed = latestBecauseYouWatchedSeed(legacyActive ? context.profileId : 'household');
    if (!seed) {
      setYoutubeState('because_you_watched_last_refresh_count', 0);
      return;
    }
    buildBecauseYouWatchedCandidatesFromCache(seed);
    const specs = becauseYouWatchedQuerySpecs(seed.item);
    if (specs.length === 0) {
      return;
    }
    const groups = await Promise.all(
      specs.map(async (spec) => ({
        spec,
        groups: await this.api.search(spec.query, {
          limit: spec.limit,
          order: spec.order,
          type: 'video',
          channelId: spec.channelId,
          publishedAfter: spec.publishedAfterDays ? rfc3339DaysAgo(spec.publishedAfterDays) : undefined,
          videoDuration: spec.videoDuration,
          safeSearch: 'moderate',
        }).catch(() => ({ videos: [], channels: [], playlists: [] })),
      })),
    );
    if (legacyActive && !isSameYoutubePersonalization(context)) {
      throw new CatalogError(409, 'YouTube personalization changed during Because You Watched refresh');
    }
    const specPriority: Record<BecauseYouWatchedRelation, number> = {
      same_channel: 4,
      same_topic: 3,
      deeper_dive: 2,
      wildcard: 1,
    };
    const byId = new Map<string, { item: YoutubeItem; spec: BecauseYouWatchedQuerySpec }>();
    for (const entry of groups) {
      for (const item of entry.groups.videos) {
        const current = byId.get(item.id);
        if (!current || specPriority[entry.spec.relation_type] > specPriority[current.spec.relation_type]) {
          byId.set(item.id, { item, spec: entry.spec });
        }
      }
    }
    const profile = emptyTasteProfile();
    const scored = [...byId.values()]
      .map(({ item, spec }) => {
        if (profile.watchedIds.has(item.id)) return null;
        if (profile.negativeIds.has(item.id)) return null;
        if (isLiveVideo(item) || isShortLikeVideo(item) || isLowSignalYoutubeRecommendation(item)) return null;
        const relation = becauseRelationForItem(item, seed.item) || spec.relation_type;
        const { score, breakdown } = scoreBecauseYouWatchedItem(item, seed.item, relation, profile);
        return {
          item,
          seed_video_id: seed.item.id,
          seed_watched_at: seed.watched_at,
          relation_type: relation,
          query: spec.query || 'channel',
          topic_cluster: topicCluster(item),
          score,
          score_breakdown: breakdown,
          reason: `because_you_watched:${relation}`,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort(compareScoreThenId)
      .slice(0, BECAUSE_YOU_WATCHED_POOL_TARGET);
    upsertBecauseYouWatchedCandidates(scored);
    pruneBecauseYouWatchedCandidates(BECAUSE_YOU_WATCHED_POOL_TARGET);
    setYoutubeState('because_you_watched_last_refresh_count', scored.length);
  }

  private async refreshV2HistoryCandidatesFromApi(reason: string): Promise<void> {
    if (!this.config.api_key) {
      setYoutubeState('youtube_v2_history_acquisition', {
        candidates_acquired: 0,
        queries_attempted: 0,
        skipped: 'api_key_not_configured',
        acquired_at: nowMs(),
      });
      return;
    }
    const moreLikeSeed = youtubeV2TopicSeed();
    const budget = youtubeV2AcquisitionQueryBudget(reason);
    const discoverySeeds = youtubeV2DiscoverySeeds(Math.min(12, budget.beyond + 1));
    if (!moreLikeSeed && discoverySeeds.length === 0) {
      setYoutubeState('youtube_v2_history_acquisition', {
        candidates_acquired: 0,
        queries_attempted: 0,
        skipped: 'no_history_or_subscription_seed',
        acquired_at: nowMs(),
      });
      return;
    }
    type AcquisitionSpec = {
      lane: 'more_like' | 'beyond';
      seed: YoutubeV2TopicSeed;
      spec: BecauseYouWatchedQuerySpec;
    };
    const specs: AcquisitionSpec[] = [];
    if (moreLikeSeed) {
      specs.push(...becauseYouWatchedQuerySpecs(moreLikeSeed.item)
        .filter((spec) => moreLikeSeed.kind === 'history' || spec.relation_type !== 'same_channel')
        .slice(0, budget.more_like)
        .map((spec) => ({ lane: 'more_like' as const, seed: moreLikeSeed, spec })));
    }
    const distinctBeyondSeeds = discoverySeeds
      .filter((seed) => seed.provenance_ref !== moreLikeSeed?.provenance_ref);
    // Prefer genuinely separate acquisition seeds. A single-source cold start
    // may fall back to its only available seed rather than suppress Beyond.
    for (const seed of distinctBeyondSeeds.length > 0 ? distinctBeyondSeeds : discoverySeeds) {
      if (specs.filter((entry) => entry.lane === 'beyond').length >= budget.beyond) break;
      const topicSpec = becauseYouWatchedQuerySpecs(seed.item)
        .find((spec) => spec.relation_type !== 'same_channel');
      if (!topicSpec) continue;
      const duplicate = specs.some((entry) => entry.lane === 'beyond'
        && entry.spec.query === topicSpec.query
        && entry.seed.provenance_ref === seed.provenance_ref);
      if (!duplicate) specs.push({ lane: 'beyond', seed, spec: topicSpec });
    }
    const results = await Promise.all(specs.map(async (entry) => {
      try {
        const groups = await this.api.search(entry.spec.query, {
          limit: entry.spec.limit,
          order: entry.spec.order,
          type: 'video',
          channelId: entry.spec.channelId,
          publishedAfter: entry.spec.publishedAfterDays
            ? rfc3339DaysAgo(entry.spec.publishedAfterDays) : undefined,
          videoDuration: entry.spec.videoDuration,
          safeSearch: 'moderate',
        });
        return { ...entry, videos: groups.videos, error: null as string | null };
      } catch (error) {
        return {
          ...entry,
          videos: [] as YoutubeItem[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const acquiredAt = nowMs();
    const candidates = results.flatMap(({ lane, seed, spec, videos }) => {
      const provenance = lane === 'more_like'
        && seed.kind === 'history' && spec.relation_type === 'same_channel'
        ? 'history_channel' as const
        : 'history_topic' as const;
      const sourceGeneration = `${lane}:${createHash('sha256')
        .update(JSON.stringify({
          lane,
          seed_kind: seed.kind,
          seed_id: seed.item.id,
          provenance_ref: seed.provenance_ref,
          seed_source_generation: seed.source_generation,
          relation: spec.relation_type,
          query: spec.query,
          channel_id: spec.channelId ?? null,
        }))
        .digest('hex')}`;
      return videos
        .filter((item) => item.kind === 'video')
        .filter((item) => !isLiveVideo(item) && !isShortLikeVideo(item))
        .filter((item) => !isLowSignalYoutubeRecommendation(item))
        .filter((item) => {
          const relation = becauseRelationForItem(item, seed.item);
          if (provenance === 'history_channel') return relation === 'same_channel';
          if (lane === 'beyond') return relation !== 'same_channel';
          return relation !== null && relation !== 'same_channel';
        })
        .map((item) => ({
          item,
          provenance,
          provenance_ref: seed.provenance_ref,
          source_generation: sourceGeneration,
          acquired_at: acquiredAt,
          expires_at: acquiredAt + YOUTUBE_V2_CANDIDATE_TTL_MS,
        }));
    });
    upsertYoutubeV2CandidateProvenance(candidates);
    const failed = results.filter((result) => result.error);
    setYoutubeState('youtube_v2_history_acquisition', {
      queries_attempted: specs.length,
      query_budget: budget,
      more_like_queries: specs.filter((entry) => entry.lane === 'more_like').length,
      beyond_queries: specs.filter((entry) => entry.lane === 'beyond').length,
      distinct_seed_refs: [...new Set(specs.map((entry) => entry.seed.provenance_ref))],
      query_failures: failed.length,
      candidates_acquired: candidates.length,
      acquired_at: acquiredAt,
      expires_at: acquiredAt + YOUTUBE_V2_CANDIDATE_TTL_MS,
    });
    if (specs.length > 0 && failed.length === specs.length) {
      throw new Error(`YouTube v2 discovery acquisition failed: ${failed[0]?.error || 'all queries failed'}`);
    }
  }

  private async refreshV2SubscribedLiveFromApi(reason: string): Promise<void> {
    const nightly = /(?:nightly|scheduled|maintenance)/i.test(reason);
    if (!nightly || !this.config.api_key) {
      setYoutubeState('youtube_v2_live_acquisition', {
        channels_probed: 0,
        candidates_acquired: 0,
        skipped: nightly ? 'api_key_not_configured' : 'not_nightly',
        acquired_at: nowMs(),
      });
      return;
    }
    const allChannels = listYoutubeV2Subscriptions()
      .filter((row) => row.source === 'oauth' && row.channel_id)
      .sort((left, right) => left.channel_key.localeCompare(right.channel_key));
    const cursor = allChannels.length > 0
      ? Math.max(0, getYoutubeState<number>('youtube_v2_live_probe_cursor', 0)) % allChannels.length
      : 0;
    const rotated = [...allChannels.slice(cursor), ...allChannels.slice(0, cursor)];
    const channels = rotated.slice(0, 8);
    setYoutubeState(
      'youtube_v2_live_probe_cursor',
      allChannels.length > 0 ? (cursor + channels.length) % allChannels.length : 0,
    );
    const results = await Promise.all(channels.map(async (channel) => {
      try {
        const groups = await this.api.search('', {
          limit: 4,
          eventType: 'live',
          type: 'video',
          channelId: channel.channel_id!,
          order: 'date',
          safeSearch: 'moderate',
        });
        return { channel, videos: groups.videos, error: null as string | null };
      } catch (error) {
        return {
          channel,
          videos: [] as YoutubeItem[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const acquiredAt = nowMs();
    const provenance = results.flatMap(({ channel, videos }) => videos
      .filter((item) => item.kind === 'video' && item.live_status === 'live')
      .filter((item) => !isShortLikeVideo(item))
      .filter((item) => item.channel_id === channel.channel_id)
      .map((item) => ({
        item,
        provenance: 'subscription_live' as const,
        provenance_ref: channel.channel_id!,
        source_generation: `live:${channel.source_generation}`,
        acquired_at: acquiredAt,
        expires_at: acquiredAt + YOUTUBE_V2_LIVE_TTL_MS,
      })));
    upsertYoutubeV2CandidateProvenance(provenance);
    const failures = results.filter((row) => row.error);
    setYoutubeState('youtube_v2_live_acquisition', {
      channels_probed: channels.length,
      query_cap: 8,
      query_failures: failures.length,
      candidates_acquired: provenance.length,
      acquired_at: acquiredAt,
      expires_at: acquiredAt + YOUTUBE_V2_LIVE_TTL_MS,
    });
    if (channels.length > 0 && failures.length === channels.length) {
      throw new Error(`YouTube v2 subscribed-live acquisition failed: ${failures[0]?.error || 'all probes failed'}`);
    }
  }

  private async resolveV2TakeoutMetadataFromApi(): Promise<void> {
    if (!this.config.api_key) {
      setYoutubeState('youtube_v2_history_metadata', {
        attempted: 0,
        resolved: 0,
        skipped: 'api_key_not_configured',
        at: nowMs(),
      });
      return;
    }
    const localHistoryIds = listWatchHistory({
      source: 'youtube',
      type: 'youtube_video',
      profile_id: 'household',
      household_blend: false,
      limit: 500,
    }).map((row) => row.id);
    const historyIds = [
      ...listYoutubeV2ImportedHistory(5_000).map((row) => row.video_id),
      ...localHistoryIds,
    ];
    const unresolved = [...new Set(historyIds.filter((id) => {
      const item = getYoutubeItem('video', id);
      return !item || !item.thumbnail || !item.channel_id;
    }))];
    if (unresolved.length === 0) {
      setYoutubeState('youtube_v2_history_metadata', {
        attempted: 0,
        resolved: 0,
        unresolved: 0,
        at: nowMs(),
      });
      return;
    }
    const cursor = Math.max(0, getYoutubeState<number>('youtube_v2_history_metadata_cursor', 0))
      % unresolved.length;
    const rotated = [...unresolved.slice(cursor), ...unresolved.slice(0, cursor)];
    const ids = rotated.slice(0, 50);
    const resolved = await this.api.videos(ids, 'background');
    setYoutubeState(
      'youtube_v2_history_metadata_cursor',
      (cursor + ids.length) % unresolved.length,
    );
    setYoutubeState('youtube_v2_history_metadata', {
      attempted: ids.length,
      resolved: resolved.length,
      unresolved: Math.max(0, unresolved.length - resolved.length),
      at: nowMs(),
    });
  }

  private async expandForYouDiscoveryFromApi(): Promise<void> {
    if (!this.config.api_key) {
      return;
    }
    const queries = forYouDiscoveryQueries();
    if (queries.length === 0) {
      return;
    }
    const groups = await Promise.all(
      queries.map((query) => this.api.search(query, { limit: 8 }).catch(() => ({
        videos: [],
        channels: [],
        playlists: [],
      }))),
    );
    const items = uniqueVideos(groups.flatMap((group) => group.videos))
      .filter((item) => !isLiveVideo(item) && !isShortLikeVideo(item));
    replaceYoutubeRailItems(LEGACY_FOR_YOU_DISCOVERY_RAIL_ID, items.map((item, index) => ({
      item,
      score: 1 - index * 0.001,
      reason: 'legacy for-you discovery acquisition',
    })));
  }

  private async refreshFreshFindsFromApi(): Promise<void> {
    if (!this.config.api_key) {
      return;
    }
    const profile = emptyTasteProfile();
    const specs = freshFindQuerySpecs();
    if (specs.length === 0) {
      return;
    }
    const groups = await Promise.all(
      specs.map(async (spec) => ({
        spec,
        groups: await this.api.search(spec.query, {
          limit: spec.limit,
          order: spec.order,
          type: 'video',
          publishedAfter: spec.publishedAfterDays ? rfc3339DaysAgo(spec.publishedAfterDays) : undefined,
          videoDuration: spec.videoDuration,
          videoDefinition: spec.videoDefinition,
          topicId: spec.topicId,
          safeSearch: 'moderate',
        }).catch(() => ({ videos: [], channels: [], playlists: [] })),
      })),
    );
    const byId = new Map<string, { item: YoutubeItem; spec: FreshFindQuerySpec }>();
    const bucketPriority: Record<FreshFindBucket, number> = {
      taste_adjacent: 5,
      quality_fresh: 4,
      emerging_creator: 3,
      zeitgeist_light: 2,
      wildcard: 1,
    };
    for (const entry of groups) {
      for (const item of entry.groups.videos) {
        const current = byId.get(item.id);
        if (!current || bucketPriority[entry.spec.source_bucket] > bucketPriority[current.spec.source_bucket]) {
          byId.set(item.id, { item, spec: entry.spec });
        }
      }
    }
    const items = [...byId.values()]
      .map((entry) => entry.item)
      .filter((item) => item.kind === 'video')
      .filter((item) => !isLiveVideo(item))
      .filter((item) => !isShortLikeVideo(item))
      .filter((item) => !isLowSignalFreshFind(item));
    if (items.length === 0) {
      return;
    }
    const channelIds = [...new Set(items.map((item) => item.channel_id).filter((id): id is string => Boolean(id)))];
    const channelStats = await this.api.channelStats(channelIds).catch(() => new Map<string, YoutubeChannelStats>());
    const scored = items.map((item) => {
      const spec = byId.get(item.id)?.spec || {
        query: '',
        source_bucket: 'wildcard',
        order: 'relevance',
        limit: 8,
      } satisfies FreshFindQuerySpec;
      const stats = channelStats.get(item.channel_id || '');
      const { score, breakdown } = scoreFreshFindItem(item, spec.source_bucket, profile, undefined, stats);
      return {
        item,
        source_bucket: spec.source_bucket,
        query: spec.query,
        topic_cluster: topicCluster(item),
        score,
        score_breakdown: breakdown,
        reason: `fresh_find:${spec.source_bucket}`,
        creator_subscriber_count: stats?.subscriber_count ?? null,
        creator_video_count: stats?.video_count ?? null,
      };
    })
      .sort(compareScoreThenId)
      .slice(0, FRESH_FIND_POOL_TARGET);
    upsertFreshFindCandidates(scored);
    pruneFreshFindCandidates(FRESH_FIND_POOL_TARGET);
    const cache = listFreshFindCandidates(YOUTUBE_RAIL_POOL_LIMIT);
    replaceYoutubeRailItems('fresh_finds', cache.map((item, index) => ({
      item,
      score: item.score,
      reason: `fresh_find:${item.source_bucket}:${index + 1}`,
    })));
    setYoutubeState('fresh_finds_last_refresh_count', scored.length);
  }

  private async refreshSubscriptionsFromApi(token: string): Promise<void> {
    const v2Mode = youtubeRecommendationsV2Mode();
    let subscriptions: YoutubeItem[];
    try {
      subscriptions = await this.api.subscriptions(
        token,
        v2Mode === 'off'
          ? SUBSCRIPTION_CHANNEL_SCAN_LIMIT
          : V2_SUBSCRIPTION_CHANNEL_SCAN_LIMIT,
        'unread',
      );
    } catch (error) {
      // A failed read is not an authoritative empty subscription set.
      if (v2Mode !== 'off') {
        const stale = {
          stale: true,
          reason: 'oauth_subscription_refresh_failed',
          candidates_acquired: 0,
          error: error instanceof Error ? error.message : String(error),
          at: nowMs(),
        };
        setYoutubeState('youtube_v2_subscription_acquisition', stale);
        setYoutubeState('youtube_v2_source_stale', stale);
        throw error;
      }
      return;
    }
    let sourceGeneration: string | null = null;
    if (v2Mode !== 'off') {
      sourceGeneration = createHash('sha256')
        .update(JSON.stringify(subscriptions
          .map((channel) => [channel.id, channel.title])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0])))))
        .digest('hex');
      // Complete enumeration is the authoritative membership boundary. Publish
      // it before optional upload acquisition; upload failure must not retain
      // channels that the account no longer follows.
      replaceYoutubeV2Subscriptions(subscriptions.map((channel) => ({
        channel_key: channel.id,
        channel_id: channel.id,
        channel_title: channel.title,
        channel_url: `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`,
        source: 'oauth' as const,
        subscribed_at: null,
      })), { source_generation: sourceGeneration });
      setYoutubeState('youtube_v2_source_stale', {
        stale: true,
        reason: 'subscription_snapshot_pending_publish',
        at: nowMs(),
        authoritative_subscription_count: subscriptions.length,
      });
    }
    if (subscriptions.length === 0) {
      if (v2Mode !== 'off') {
        setYoutubeState('youtube_v2_subscription_acquisition', {
          channels_queried: 0,
          candidates_acquired: 0,
          partial: false,
          error: null,
          acquired_at: nowMs(),
        });
      }
      if (v2Mode === 'shadow') replaceYoutubeRailItems('new_from_subscriptions', []);
      return;
    }

    const { channels, nextCursor } = selectSubscriptionRefreshChannels(subscriptions);
    setYoutubeState('subscription_refresh_cursor', nextCursor);
    let fetchedByChannel: Array<{ channel: YoutubeItem; items: YoutubeItem[] }>;
    let uploadError: string | null = null;
    try {
      const uploadPlaylists = await this.api.channelUploadPlaylists(
        channels.map((channel) => channel.id),
        token,
      );
      fetchedByChannel = await Promise.all(channels.map(async (channel) => {
        const playlistId = uploadPlaylists.get(channel.id);
        if (!playlistId) {
          return { channel, items: [] as YoutubeItem[] };
        }
        const items = await this.api.playlistItems(playlistId, SUBSCRIPTION_VIDEOS_PER_CHANNEL, token);
        return { channel, items };
      }));
    } catch (error) {
      if (v2Mode !== 'off') {
        uploadError = error instanceof Error ? error.message : String(error);
        const acquisition = {
          stale: false,
          reason: 'oauth_subscription_upload_refresh_failed',
          candidates_acquired: 0,
          error: uploadError,
          at: nowMs(),
        };
        setYoutubeState('youtube_v2_subscription_acquisition', acquisition);
      }
      fetchedByChannel = channels.map((channel) => ({ channel, items: [] }));
    }
    const fetched = fetchedByChannel.flatMap((entry) => entry.items);

    if (v2Mode !== 'off' && sourceGeneration) {
      const acquiredAt = nowMs();
      const provenance = fetchedByChannel.flatMap(({ channel, items }) => items
        .filter((item) => item.kind === 'video' && !isShortLikeVideo(item))
        .filter((item) => item.channel_id === channel.id)
        .map((item) => ({
          item,
          provenance: isLiveVideo(item) ? 'subscription_live' as const : 'subscription_upload' as const,
          provenance_ref: channel.id,
          source_generation: sourceGeneration,
          acquired_at: acquiredAt,
          expires_at: acquiredAt + (isLiveVideo(item) ? YOUTUBE_V2_LIVE_TTL_MS : YOUTUBE_V2_CANDIDATE_TTL_MS),
        })));
      upsertYoutubeV2CandidateProvenance(provenance);
      setYoutubeState('subscriptions_last_refresh_count', provenance.length);
      setYoutubeState('youtube_v2_subscription_acquisition', {
        channels_queried: channels.length,
        candidates_acquired: provenance.length,
        partial: uploadError !== null,
        error: uploadError,
        acquired_at: acquiredAt,
      });
      if (v2Mode === 'shadow') {
        const existing = listYoutubeRailItems('new_from_subscriptions', SUBSCRIPTION_RAIL_POOL_LIMIT);
        const eligible = sortSubscriptionItems(uniqueVideos([...fetched, ...existing]))
          .filter((item) => item.kind === 'video' && !isLiveVideo(item) && !isShortLikeVideo(item))
          .slice(0, SUBSCRIPTION_RAIL_POOL_LIMIT);
        replaceYoutubeRailItems('new_from_subscriptions', eligible.map((item, index) => ({
          item,
          score: 1 - index * 0.001,
          reason: 'subscription upload',
        })));
      }
      return;
    }

    const existing = listYoutubeRailItems('new_from_subscriptions', SUBSCRIPTION_RAIL_POOL_LIMIT);
    const merged = sortSubscriptionItems(uniqueVideos([...fetched, ...existing]));
    const eligible = merged
      .filter((item) => item.kind === 'video')
      .filter((item) => !isLiveVideo(item))
      .filter((item) => !isShortLikeVideo(item))
      .slice(0, SUBSCRIPTION_RAIL_POOL_LIMIT);
    replaceYoutubeRailItems('new_from_subscriptions', eligible.map((item, index) => ({
      item,
      score: 1 - index * 0.001,
      reason: 'subscription upload',
    })));
  }

  refresh(reason = 'manual'): Promise<RefreshResult> {
    return serializeYoutubeRefresh(() => this.refreshUnserialized(reason));
  }

  private async refreshUnserialized(reason: string): Promise<RefreshResult> {
    if (!this.config.enabled) {
      return { ok: false, error: 'YouTube is disabled', refresh: youtubeRefreshStatus() };
    }
    setYoutubeState('last_refresh_at', nowMs());
    setYoutubeState('last_reason', reason);
    const v2Mode = youtubeRecommendationsV2Mode();
    let shadowV2Phases: YoutubeRefreshPhaseResult[] = [];
    let shadowV2Succeeded = false;
    if (v2Mode !== 'off') {
      const phases: YoutubeRefreshPhaseResult[] = [];
      const subscriptionsPhase = await this.runRefreshPhase(
        'subscriptions',
        () => this.refreshSubscriptionsIfAuthorized(),
      );
      phases.push(subscriptionsPhase);
      const subscriptionAcquisition = getYoutubeState<{
        partial?: boolean;
        stale?: boolean;
        error?: string | null;
        acquired_at?: number;
        at?: number;
      }>('youtube_v2_subscription_acquisition', {});
      const subscriptionAcquisitionAt = Number(
        subscriptionAcquisition.acquired_at ?? subscriptionAcquisition.at ?? 0,
      );
      const currentAcquisition = subscriptionAcquisitionAt >= subscriptionsPhase.started_at;
      const subscriptionAcquisitionError = !subscriptionsPhase.ok
        ? subscriptionsPhase.error ?? 'authoritative subscription enumeration failed'
        : currentAcquisition && (subscriptionAcquisition.partial || subscriptionAcquisition.stale)
          ? subscriptionAcquisition.error ?? 'subscription upload acquisition was partial'
          : null;
      phases.push({
        phase: 'v2_subscription_acquisition',
        ok: subscriptionAcquisitionError === null,
        started_at: subscriptionsPhase.started_at,
        ended_at: subscriptionsPhase.ended_at,
        duration_ms: subscriptionsPhase.duration_ms,
        ...(subscriptionAcquisitionError ? { error: subscriptionAcquisitionError } : {}),
      });
      phases.push(await this.runRefreshPhase(
        'v2_history_metadata',
        () => this.resolveV2TakeoutMetadataFromApi(),
      ));
      const acquisitionPhase = await this.runRefreshPhase(
        'v2_history_acquisition',
        () => this.refreshV2HistoryCandidatesFromApi(reason),
      );
      phases.push(acquisitionPhase);
      // Probe subscribed live channels last so the short validity window starts
      // immediately before atomic publication, not at the beginning of a long
      // nightly acquisition job.
      phases.push(await this.runRefreshPhase(
        'v2_live_acquisition',
        () => this.refreshV2SubscribedLiveFromApi(reason),
      ));
      phases.push(await this.runRefreshPhase('v2_publish', () => {
        if (!subscriptionsPhase.ok) {
          throw new Error('publication skipped because authoritative subscription refresh was not complete');
        }
        if (!acquisitionPhase.ok) {
          throw new Error('publication skipped because discovery acquisition failed');
        }
        rebuildYoutubeV2Generation({ force: true });
        setYoutubeState('youtube_v2_source_stale', {
          stale: subscriptionAcquisitionError !== null,
          reason: subscriptionAcquisitionError !== null ? 'subscription_acquisition_partial' : null,
          at: nowMs(),
          authoritative_subscription_count: listYoutubeV2Subscriptions()
            .filter((row) => row.source === 'oauth').length,
        });
      }));
      const failed = phases.filter((phase) => !phase.ok);
      const succeeded = phases.find((phase) => phase.phase === 'v2_publish')?.ok === true;
      const generation = latestYoutubeV2GenerationRecord();
      const sourceStale = youtubeV2SourceStaleState();
      setYoutubeState('youtube_v2_shadow_status', {
        mode: v2Mode,
        status: sourceStale.stale && generation?.status === 'ready'
          ? 'stale'
          : generation?.status ?? 'setup',
        stale_reason: sourceStale.stale ? sourceStale.reason : null,
        generation: generation?.generation ?? null,
        candidate_count: generation?.candidate_count ?? 0,
        generated_at: generation?.generated_at ?? null,
        refreshed_at: nowMs(),
      });
      setYoutubeState('last_phase_results', phases);
      this.invalidateRailsCache();
      if (succeeded) {
        setYoutubeState('last_success_at', nowMs());
        const partialError = failed.length > 0
          ? `partial refresh: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
          : null;
        setYoutubeState('last_error', partialError);
        setYoutubeState('youtube_v2_last_error', partialError ? { error: partialError, at: nowMs() } : null);
        if (v2Mode === 'serve') return { ok: true, refresh: youtubeRefreshStatus(), phases };
        shadowV2Phases = phases;
        shadowV2Succeeded = true;
      } else if (v2Mode === 'serve') {
        const message = failed.length > 0
          ? `YouTube v2 refresh failed: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
          : 'YouTube v2 refresh failed: no phases ran';
        setYoutubeState('last_error', message);
        setYoutubeState('youtube_v2_last_error', { error: message, at: nowMs() });
        return { ok: false, error: message, refresh: youtubeRefreshStatus(), phases };
      } else {
        shadowV2Phases = phases;
      }
    }
    if (!this.config.api_key) {
      if (v2Mode === 'shadow' && shadowV2Succeeded) {
        return { ok: true, refresh: youtubeRefreshStatus(), phases: shadowV2Phases };
      }
      setYoutubeState('last_error', 'YouTube API key is not configured');
      return {
        ok: false,
        error: 'YouTube API key is not configured',
        refresh: youtubeRefreshStatus(),
        phases: shadowV2Phases,
      };
    }
    const context = captureYoutubePersonalization();
    const phases: YoutubeRefreshPhaseResult[] = [];
    for (const [phase, fn] of [
      ['popular', () => this.refreshPopularFromApi()],
      ...(v2Mode === 'shadow' ? [] : [
        ['subscriptions', () => this.refreshSubscriptionsIfAuthorized()] as [YoutubeRefreshPhase, () => Promise<void>],
      ]),
      ['fresh_finds', () => this.refreshFreshFindsFromApi()],
      ['live_now', () => this.refreshLiveNowFromApi()],
      ['because_you_watched', () => this.refreshBecauseYouWatchedFromApi(context)],
      ['for_you_discovery', () => this.expandForYouDiscoveryFromApi()],
      ['for_you_reservoir', () => this.rebuildForYouReservoir()],
    ] as Array<[YoutubeRefreshPhase, () => Promise<void> | void]>) {
      phases.push(await this.runRefreshPhase(phase, fn));
    }
    const allPhases = [...shadowV2Phases, ...phases];
    setYoutubeState('last_phase_results', allPhases);
    // Any refresh phase may have mutated underlying rail candidates; drop the
    // cached discovery payload so the next GET recomputes from fresh state.
    this.invalidateRailsCache();
    if (!isSameYoutubePersonalization(context)) {
      const message = 'YouTube personalization changed during refresh; shared acquisition was kept, profile slate was not published';
      setYoutubeState('last_error', message);
      return { ok: false, error: message, refresh: youtubeRefreshStatus(), phases: allPhases };
    }
    const failed = allPhases.filter((phase) => !phase.ok);
    const succeeded = allPhases.some((phase) => phase.ok);
    if (succeeded) {
      setYoutubeState('last_success_at', nowMs());
      setYoutubeState('last_error', failed.length > 0
        ? `partial refresh: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
        : null);
      return { ok: true, refresh: youtubeRefreshStatus(), phases: allPhases };
    }
    const message = failed.length > 0
      ? `YouTube refresh failed: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
      : 'YouTube refresh failed: no phases ran';
    setYoutubeState('last_error', message);
    return { ok: false, error: message, refresh: youtubeRefreshStatus(), phases: allPhases };
  }

  private scheduleLiveNowRefreshIfDue(): void {
    if (!this.config.enabled || !this.config.api_key || liveNowRefreshInFlight) {
      return;
    }
    const timestamp = nowMs();
    const lastAttempt = getYoutubeState<number | null>('live_now_last_opportunistic_attempt_at', null);
    if (lastAttempt !== null && timestamp - lastAttempt < LIVE_NOW_OPPORTUNISTIC_THROTTLE_MS) {
      return;
    }
    const lastSuccess = getYoutubeState<number | null>('live_now_last_success_at', null);
    const hasUsableCandidates = listLiveNowCandidates(1)
      .some((candidate) => candidate.live_status === 'live' && candidate.expires_at > timestamp);
    if (lastSuccess !== null && timestamp - lastSuccess < LIVE_NOW_REFRESH_STALE_MS && hasUsableCandidates) {
      return;
    }
    setYoutubeState('live_now_last_opportunistic_attempt_at', timestamp);
    liveNowRefreshInFlight = serializeYoutubeRefresh(() => this.refreshLiveNowFromApi())
      .then(() => {
        setYoutubeState('live_now_last_opportunistic_error', null);
      })
      .catch((error) => {
        setYoutubeState('live_now_last_opportunistic_error', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        liveNowRefreshInFlight = null;
      });
  }

  async freshStart(): Promise<Record<string, unknown>> {
    const aiSlots = slotsForTab(await loadAiCatalogSlots(), YOUTUBE_TAB);
    let aiCatalogsRemoved = 0;
    for (const slot of aiSlots) {
      if (await deleteAiCatalogSlot(slot.slot_id)) {
        aiCatalogsRemoved += 1;
      }
    }

    const cleared = {
      watch_history: clearWatchHistoryForSource(YOUTUBE_SOURCE),
      not_interested: clearLibraryFeedbackForSource('not_interested', YOUTUBE_SOURCE),
      recent_searches: clearProfileRecommendationEvents({
        domain: 'youtube',
        event_types: ['search'],
      }),
      candidate_state: clearYoutubeProfileCandidateStates(activeViewerProfileId()),
      ai_catalogs: aiCatalogsRemoved,
      reservoirs: clearYoutubePersonalizationReservoirs(),
    };

    if (activeViewerProfileId() === 'household') deleteYoutubeState('recent_searches');
    deleteYoutubeState('for_you_needs_expansion');
    this.invalidateRailsCache();

    const refresh = await this.refresh('fresh_start');
    return {
      ok: refresh.ok,
      cleared,
      refresh: refresh.refresh,
      phases: refresh.phases,
      error: refresh.error,
    };
  }

  async railRelated(
    railId: string,
    exclude: TitleRef[],
    limit = 8,
  ): Promise<Record<string, unknown>> {
    const excludeKeys = new Set(exclude.map(titleRefKey));
    const pool = await listYoutubeRailPoolItems(railId);
    const personalization = getPersonalizationState();
    const eligible = filterNotInterested(pool, personalization.active_profile_id).filter((item) => !excludeKeys.has(titleRefKey({
        type: youtubeContentType(item),
        id: item.id,
      })));
    const picked = deterministicShuffle(
      eligible,
      `${personalization.active_profile_id}:rail-related:${railId}:${[...excludeKeys].sort().join(',')}`,
      (item) => item.id,
    ).slice(0, Math.max(1, Math.min(limit, 24)));
    return {
      ok: true,
      rail_id: railId,
      items: picked,
    };
  }

  async rails(options: YoutubeRailsOptions = {}): Promise<YoutubeRailsResponse> {
    assertExpectedPersonalization(
      options.expectedPersonalization,
      getPersonalizationState(),
      'before YouTube rails loaded',
    );
    const v2Mode = youtubeRecommendationsV2Mode();
    if (v2Mode === 'serve') {
      const personalization = getPersonalizationState();
      assertExpectedPersonalization(
        options.expectedPersonalization,
        personalization,
        'while YouTube v2 rails loaded',
      );
      const generation = latestYoutubeV2GenerationRecord();
      const sourceStale = youtubeV2SourceStaleState();
      const servingEpoch = youtubeV2ServingEpoch(
        generation?.status === 'ready' ? generation.generation : null,
        Boolean(options.reshuffle),
      );
      const slateSequence = servingEpoch.slate_sequence;

      // Stable household state rows allocate before recommendation rails so
      // the global de-duplicator never steals or re-adds an exact anchor.
      const reservedIds = new Set<string>();
      const historyItems = youtubeV2HistoryItems(YOUTUBE_RAIL_POOL_LIMIT)
        .filter((item) => !reservedIds.has(item.id))
        .slice(0, YOUTUBE_RAIL_LIMIT);
      const history = historyItems.length === YOUTUBE_RAIL_LIMIT
        ? {
            rail_id: 'history',
            label: 'History',
            items: historyItems,
            cached: true,
            stale: false,
          } satisfies YoutubeRail
        : null;
      history?.items.forEach((item) => reservedIds.add(item.id));
      const savedItems = savedRail('household', YOUTUBE_RAIL_POOL_LIMIT, false).items
        .filter((item) => !reservedIds.has(item.id))
        .slice(0, YOUTUBE_RAIL_LIMIT);
      const saved = savedItems.length === YOUTUBE_RAIL_LIMIT
        ? {
            rail_id: 'saved',
            label: 'Saved',
            items: savedItems,
            cached: true,
            stale: false,
          } satisfies YoutubeRail
        : null;
      saved?.items.forEach((item) => reservedIds.add(item.id));

      const recommendationRails = youtubeV2RecommendationRails({
        shuffle_epoch: servingEpoch.shuffle_epoch,
        reserved_ids: reservedIds,
      });
      const byId = new Map(recommendationRails.map((rail) => [rail.rail_id, rail] as const));
      const rails = [
        byId.get('for_you'),
        byId.get('beyond'),
        byId.get('more_like'),
        history,
        saved,
        byId.get('new_from_subscriptions'),
        byId.get('live_now'),
      ].filter((rail): rail is YoutubeRail => Boolean(rail));
      const attributionContexts = Object.fromEntries(rails.map((rail) => [
        rail.rail_id,
        {
          source_revision: slateSequence,
          context_id: rail.candidate_context_id ?? '',
        },
      ]));
      return {
        ok: true,
        tab: YOUTUBE_TAB,
        profile_id: 'household',
        personalization_updated_at: personalization.updated_at,
        rails: publicYoutubeRails(rails),
        slate_sequence: slateSequence,
        recommendations_status: sourceStale.stale && generation?.status === 'ready'
          ? 'stale'
          : generation?.status ?? 'setup',
        setup_required: !generation || generation.status === 'empty',
        stale_reason: sourceStale.stale ? sourceStale.reason : null,
        attribution_contexts: attributionContexts,
      };
    }

    if (v2Mode === 'off') {
      const cache = youtubeCacheSummary();
      if (this.config.enabled && this.config.api_key && cache.videos === 0) {
        // Legacy cold startup remains background-warmed. V2 Home/X never enters
        // this path: it is strictly latest-generation cache serving.
        this.scheduleFirstRunRefresh();
      }
      if (!options.reshuffle) this.scheduleLiveNowRefreshIfDue();
    }

    // AI catalog loading is asynchronous, so a viewer may switch profiles or
    // mood while the request is in flight. Assemble from one immutable context
    // and retry once instead of returning a cross-profile hybrid.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = captureYoutubePersonalization();
      assertExpectedPersonalization(
        options.expectedPersonalization,
        context.state,
        'while YouTube rails loaded',
      );
      const { profileId, tasteProfile } = context;
      let discoveryRails: YoutubeRail[];
      let slateSequence: number;
      const cached = this.discoveryRailsCache.get(profileId);
      if (
        !options.reshuffle
        && cached
        && cached.expiresAt > Date.now()
        && cached.personalizationUpdatedAt === context.state.updated_at
      ) {
        discoveryRails = cached.rails;
        slateSequence = cached.slateSequence;
      } else {
        const sequenceKey = `recommendation_slate_sequence:${profileId}`;
        slateSequence = getYoutubeState<number>(sequenceKey, 0) + 1;
        setYoutubeState(sequenceKey, slateSequence);
        const slateOptions: YoutubeRailsOptions = {
          ...options,
          slateSequence,
          profileId,
          seedContext: context.state.mood || '',
        };
        discoveryRails = [
          forYouRail(slateOptions, tasteProfile),
          subscriptionRail(slateOptions, tasteProfile),
          liveNowRail(slateOptions, tasteProfile),
          becauseYouWatchedRail(slateOptions, tasteProfile),
          freshFindRail(slateOptions, tasteProfile),
          popularRail(slateOptions, tasteProfile),
        ];
        this.discoveryRailsCache.set(profileId, {
          rails: discoveryRails,
          slateSequence,
          personalizationUpdatedAt: context.state.updated_at,
          expiresAt: Date.now() + YOUTUBE_RAILS_CACHE_TTL_MS,
        });
      }

      const [
        forYou,
        subscriptions,
        liveNow,
        becauseYouWatched,
        freshFinds,
        popular,
      ] = discoveryRails;
      // History and Saved are explicit profile state. Read them with the same
      // owner before crossing the asynchronous AI-catalog boundary.
      const history = historyRail(profileId, YOUTUBE_RAIL_POOL_LIMIT);
      const saved = savedRail(profileId, YOUTUBE_RAIL_POOL_LIMIT);
      const aiCatalogRails = await buildYoutubeAiCatalogRails();
      if (!isSameYoutubePersonalization(context)) {
        this.discoveryRailsCache.delete(profileId);
        if (attempt === 0) continue;
        throw new CatalogError(409, 'YouTube personalization changed while building rails');
      }
      const rails = allocateYoutubeRails(
        [forYou, subscriptions, history, saved],
        [becauseYouWatched, ...aiCatalogRails, liveNow, freshFinds, popular],
        tasteProfile,
      );
      const attributionContexts = Object.fromEntries(rails.map((rail) => [
        rail.rail_id,
        {
          source_revision: slateSequence,
          context_id: rail.candidate_context_id ?? '',
        },
      ]));
      return {
        ok: true,
        tab: YOUTUBE_TAB,
        profile_id: profileId,
        personalization_updated_at: context.state.updated_at,
        rails: publicYoutubeRails(rails),
        slate_sequence: slateSequence,
        attribution_contexts: attributionContexts,
      };
    }
    throw new CatalogError(409, 'YouTube personalization changed while building rails');
  }

  async search(
    query: string,
    limit = this.config.max_results,
    options: {
      kind_scope?: 'youtube' | 'videos';
      safe_search?: 'moderate' | 'strict' | 'none';
      force_refresh?: boolean;
      cache_only?: boolean;
      record_recent?: boolean;
    } = {},
  ): Promise<Record<string, unknown>> {
    const normalized = query.trim();
    if (!normalized) {
      throw new CatalogError(400, 'YouTube search requires q', undefined, {
        couchMessage: 'type something to search YouTube',
      });
    }
    const searchLimit = Math.max(1, Math.min(50, limit));
    const kindScope = options.kind_scope ?? 'youtube';
    const safeSearch = options.safe_search ?? getSearchPreferences().youtube_safe_search;
    const cacheInput = {
      normalized_query: normalized.toLowerCase(),
      kind_scope: kindScope,
      safe_search: safeSearch,
      region_code: this.config.region_code,
      language: this.config.relevance_language,
    };
    const cached = options.force_refresh ? null : getYoutubeSearchCache(cacheInput);
    let cachedOnly = !this.config.api_key;
    let apiError: string | null = null;
    let groups: YoutubeSearchGroups;
    if (cached) {
      groups = cached.groups;
      cachedOnly = true;
    } else if (this.config.api_key && !options.cache_only) {
      try {
        const flightKey = [
          cacheInput.normalized_query,
          kindScope,
          safeSearch,
          searchLimit,
        ].join('|');
        let flight = this.searchFlights.get(flightKey);
        if (!flight) {
          flight = this.api.search(normalized, {
            limit: searchLimit,
            type: kindScope === 'videos' ? 'video' : undefined,
            safeSearch,
            purpose: 'interactive',
          });
          this.searchFlights.set(flightKey, flight);
          const clearFlight = () => {
            if (this.searchFlights.get(flightKey) === flight) {
              this.searchFlights.delete(flightKey);
            }
          };
          void flight.then(clearFlight, clearFlight);
        }
        groups = await flight;
        putYoutubeSearchCache(cacheInput, groups);
      } catch (error) {
        apiError = error instanceof Error ? error.message : String(error);
        setYoutubeState('last_search_error', { query: normalized, error: apiError, at: nowMs() });
        groups = groupCachedSearch(normalized, searchLimit);
        cachedOnly = true;
      }
    } else {
      groups = groupCachedSearch(normalized, searchLimit);
    }
    if (options.record_recent !== false) {
      recordRecentYoutubeSearch(normalized);
    }
    return {
      ok: true,
      query: normalized,
      groups,
      refresh: youtubeRefreshStatus(),
      cached_only: cachedOnly,
      cache_hit: Boolean(cached),
      api_error: apiError,
    };
  }

  async detail(kind: YoutubeItemKind, id: string): Promise<Record<string, unknown>> {
    let item = getYoutubeItem(kind, id);
    let items: YoutubeItem[] = [];
    if (kind === 'video' && this.config.api_key) {
      item = (await this.api.videos([id], 'interactive').catch(() => []))[0] || item;
    }
    if (kind === 'channel') {
      if (!item) {
        item = getYoutubeItem('channel', id);
      }
      if (this.config.api_key) {
        items = await this.api.channelVideos(id, 40, 'interactive').catch(() => []);
      } else {
        items = listYoutubeItems('video', 200).filter((candidate) => candidate.channel_id === id);
      }
    }
    if (kind === 'playlist') {
      if (!item) {
        item = getYoutubeItem('playlist', id);
      }
      if (this.config.api_key) {
        items = await this.api.playlistItems(id, 40, undefined, 'interactive').catch(() => []);
      }
    }
    if (!item) {
      throw new CatalogError(404, 'YouTube item not found', undefined, {
        couchMessage: 'YouTube details unavailable',
      });
    }
    upsertYoutubeItems([item, ...items]);
    return {
      ok: true,
      item,
      items: filterNotInterested(items),
      state: kind === 'video'
        ? getLibraryState({
            source: YOUTUBE_SOURCE,
            type: YOUTUBE_VIDEO_TYPE,
            id,
            profile_id: youtubeRecommendationsV2Mode() === 'serve'
              ? 'household'
              : activeViewerProfileId(),
          })
        : null,
      refresh: youtubeRefreshStatus(),
    };
  }

  notInterested(input: { kind?: string; id?: string; title?: string; reason?: string | null }): Record<string, unknown> {
    const kind = input.kind === 'channel' || input.kind === 'playlist' ? input.kind : 'video';
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) {
      throw new CatalogError(400, 'YouTube Not interested requires id', undefined, {
        couchMessage: 'could not hide that YouTube card',
      });
    }
    const cached = getYoutubeItem(kind, id);
    const feedback = setLibraryFeedback({
      source: YOUTUBE_SOURCE,
      type: itemType(kind),
      id,
      title: cached?.title || input.title || id,
      poster: cached?.thumbnail || null,
      description: cached?.description || null,
      tab: YOUTUBE_TAB,
      feedback: 'not_interested',
      reason: input.reason ?? null,
      profile_id: youtubeRecommendationsV2Mode() === 'serve'
        ? 'household'
        : activeViewerProfileId(),
    });
    // The active recommendation owner is the reversible source of truth. Candidate
    // counters deliberately remain untouched so Undo removes both the exact
    // veto and its decaying semantic contribution on the next read.
    this.invalidateRailsCache();
    return { ok: true, feedback };
  }

  async play(
    input: {
      profile_id?: string;
      id?: string;
      title?: string;
      poster?: string;
      recommendation?: {
        profile_id: string;
        domain: 'youtube';
        rail_id: string;
        slate_revision: number;
        item_type: string;
        item_id: string;
      };
    },
    options: { playEpoch?: number } = {},
  ): Promise<Record<string, unknown>> {
    const profileId = input.profile_id ?? activeViewerProfileId();
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) {
      throw new CatalogError(400, 'YouTube play requires id', undefined, {
        couchMessage: 'YouTube video id is missing',
      });
    }
    let item = getYoutubeItem('video', id);
    if (!item) {
      item = {
        id,
        kind: 'video',
        title: input.title || id,
        subtitle: 'YouTube',
        description: null,
        thumbnail: input.poster || null,
        channel_id: null,
        channel_title: null,
        published_at: null,
        duration_sec: null,
        live_status: 'none',
        playlist_id: null,
        updated_at: nowMs(),
      };
      upsertYoutubeItems([item]);
    }
    const started = nowMs();
    const playEpoch = options.playEpoch ?? await bumpPlayEpoch();
    let resolved = await resolveYoutubePlayback(this.config, id);
    const live = item.live_status === 'live';
    const playResolved = () => playUrl(resolved.url, 90000, {
      live,
      playEpoch,
      minDurationSec: 1,
      audioUrl: resolved.audio_url,
      hud: {
        title: item.title === id ? 'YouTube' : item.title,
        context: item.channel_title,
        kind: 'youtube_video',
      },
    });
    let playback;
    try {
      try {
        playback = await playResolved();
      } catch (firstError) {
        const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
        if (!shouldRefreshYoutubeTransport(firstMessage)) {
          throw firstError;
        }
        await assertPlayEpoch(playEpoch);
        resolved = await resolveYoutubePlayback(this.config, id, 30000, {
          excludeFormats: [resolved.format],
        });
        await assertPlayEpoch(playEpoch);
        playback = await playResolved();
      }
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new CatalogError(502, live
        ? 'YouTube live playback did not start'
        : 'YouTube playback did not start', {
        mpv: message,
      }, {
        couchMessage: live
          ? 'YouTube live playback did not start — try another live video'
          : 'YouTube playback did not start — try another video',
      });
    }
    await assertPlayEpoch(playEpoch);
    recordLibraryWatch({
      profile_id: profileId,
      ...itemToLibraryInput(item),
      play_id: id,
      duration_sec: item.duration_sec ?? 0,
      position_sec: 0,
      event: 'play',
      watched_at: nowMs(),
    });
    if (youtubePlayStartUsesLegacyAcquisition()) {
      buildForYouReservoir();
      this.invalidateRailsCache();
      const refreshContext = captureYoutubePersonalization();
      void serializeYoutubeRefresh(() => this.refreshBecauseYouWatchedFromApi(refreshContext)).catch((error) => {
        setYoutubeState('last_because_you_watched_error', error instanceof Error ? error.message : String(error));
      });
    }
    await startWatchSessionFromPlay({
      profile_id: profileId,
      source: YOUTUBE_SOURCE,
      type: YOUTUBE_VIDEO_TYPE,
      id,
      title: item.title,
      poster: item.thumbnail,
      tab: YOUTUBE_TAB,
      recommendation: input.recommendation,
    });
    return {
      ok: true,
      play_id: id,
      live,
      ttff_ms: playback.ttff_ms,
      total_ms: nowMs() - started,
      stream: {
        source: 'youtube',
        display_label: live ? 'YouTube live' : 'YouTube',
        resolve_ms: resolved.resolve_ms,
        format: resolved.format,
      },
    };
  }
}

const YOUTUBE_V2_TRIGGERED_ACQUISITION_COALESCE_MS = 15 * 60 * 1000;

type YoutubeV2LocalRefreshResult = {
  local_generation: number | null;
  acquisition: 'off' | 'noop' | 'queued' | 'coalesced';
  acquisition_result: RefreshResult | null;
};

export async function refreshYoutubeV2AfterLocalSignal(options: {
  at?: number;
  changed?: boolean;
  reason: 'meaningful_watch' | 'takeout_import' | 'takeout_import_cli';
  wait_for_acquisition?: boolean;
  service?: Pick<YoutubeService, 'refresh' | 'invalidateRailsCache'>;
}): Promise<YoutubeV2LocalRefreshResult> {
  const at = options.at ?? nowMs();
  if (youtubeRecommendationsV2Mode() === 'off') {
    return {
      local_generation: latestYoutubeV2GenerationRecord()?.generation ?? null,
      acquisition: 'off',
      acquisition_result: null,
    };
  }
  if (options.changed === false) {
    return {
      local_generation: latestYoutubeV2GenerationRecord()?.generation ?? null,
      acquisition: 'noop',
      acquisition_result: null,
    };
  }
  const generation = rebuildYoutubeV2Generation({ force: true, at });
  options.service?.invalidateRailsCache();
  const lastTriggered = getYoutubeState<number>('youtube_v2_triggered_acquisition_last_at', 0);
  if (lastTriggered > 0 && at - lastTriggered < YOUTUBE_V2_TRIGGERED_ACQUISITION_COALESCE_MS) {
    return { local_generation: generation?.generation ?? null, acquisition: 'coalesced', acquisition_result: null };
  }
  setYoutubeState('youtube_v2_triggered_acquisition_last_at', at);
  const service = options.service ?? new YoutubeService();
  service.invalidateRailsCache();
  if (options.wait_for_acquisition === false) {
    void service.refresh(options.reason).catch((error) => {
      setYoutubeState('youtube_v2_triggered_acquisition_last_error', {
        reason: options.reason,
        error: error instanceof Error ? error.message : String(error),
        at: nowMs(),
      });
    });
    return {
      local_generation: generation?.generation ?? null,
      acquisition: 'queued',
      acquisition_result: null,
    };
  }
  const acquisitionResult = await service.refresh(options.reason);
  return {
    local_generation: generation?.generation ?? null,
    acquisition: 'queued',
    acquisition_result: acquisitionResult,
  };
}

export function refreshYoutubeAfterTakeoutImport(options: {
  at?: number;
  changed?: boolean;
  service?: Pick<YoutubeService, 'refresh' | 'invalidateRailsCache'>;
} = {}): Promise<YoutubeV2LocalRefreshResult> {
  return refreshYoutubeV2AfterLocalSignal({
    ...options,
    reason: 'takeout_import_cli',
  });
}
