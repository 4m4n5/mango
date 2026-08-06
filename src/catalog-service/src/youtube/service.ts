import { createHash } from 'node:crypto';
import { CatalogError } from '../catalog-errors.js';
import { playUrl } from '../mpv.js';
import { assertPlayEpoch, bumpPlayEpoch } from '../play-cancel.js';
import { startWatchSessionFromPlay } from '../progress/watcher.js';
import {
  activeViewerProfileId,
  getLibraryState,
  getPersonalizationState,
  getSearchPreferences,
  listProfileLibraryFeedback,
  listSavedLibraryItems,
  listWatchHistory,
  recordLibraryWatch,
  setLibraryFeedback,
  type LibraryItemInput,
} from '../library/db.js';
import { YoutubeApiClient } from './api.js';
import { clearYoutubeAuth, pollYoutubeDeviceAuth, startYoutubeDeviceAuth, youtubeAccessToken, youtubeAuthSummary } from './auth.js';
import { loadYoutubeConfig, type YoutubeConfig } from './config.js';
import {
  getYoutubeItem,
  getYoutubeSearchCache,
  getYoutubeState,
  initYoutubeDb,
  listYoutubeItems,
  listYoutubeV2ImportedHistory,
  listYoutubeV2Subscriptions,
  latestYoutubeV2GenerationRecord,
  replaceYoutubeV2Subscriptions,
  recordYoutubeImpressions,
  searchCachedYoutubeItems,
  setYoutubeState,
  putYoutubeSearchCache,
  upsertYoutubeV2CandidateProvenance,
  upsertYoutubeItems,
  youtubeV2ServingEpoch,
  youtubeCacheSummary,
  youtubeRefreshStatus,
} from './db.js';
import { resolveYoutubePlayback, shouldRefreshYoutubeTransport } from './playback.js';
import type {
  YoutubeItem,
  YoutubeItemKind,
  YoutubeRail,
  YoutubeRailItem,
  YoutubeRefreshPhaseResult,
  YoutubeSearchGroups,
} from './types.js';
import { YOUTUBE_RAIL_LIMIT } from './constants.js';
import type { PersonalizationSnapshot } from '../personalization-coherence.js';
import { assertExpectedPersonalization } from '../personalization-request.js';
import { recommendationOwnerForRollout } from '../recommendations/v2-mode.js';
import {
  YOUTUBE_V2_CANDIDATE_TTL_MS,
  YOUTUBE_V2_LIVE_TTL_MS,
  YOUTUBE_V2_MORE_LIKE_MAX_SEEDS,
  YOUTUBE_V2_MORE_LIKE_MIN_SEEDS,
  YOUTUBE_V2_MORE_LIKE_QUERY_SIZE,
  YOUTUBE_V2_MORE_LIKE_TARGET,
  invalidateYoutubeV2ExactExclusions,
  invalidateYoutubeV2HistoryItems,
  persistYoutubeV2MoreLikeSeeds,
  rebuildYoutubeV2Generation,
  youtubeRecommendationsV2Mode,
  youtubeV2CachedHistoryItems,
  youtubeV2Diagnostics,
  youtubeV2DiscoverySeeds,
  youtubeV2ExactExcludedIds,
  youtubeV2MoreLikeSeeds,
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
  invalidateYoutubeV2ExactExclusions,
  primeYoutubeV2ExactExclusions,
  primeYoutubeV2HistoryItems,
  youtubePublicPersonalizationPayload,
  youtubeRecommendationsV2Mode,
} from './v2.js';

const YOUTUBE_SOURCE = 'youtube';
const YOUTUBE_TAB = 'youtube';
const YOUTUBE_VIDEO_TYPE = 'youtube_video';
const YOUTUBE_RAIL_POOL_LIMIT = 60;
// `YoutubeApiClient.subscriptions` paginates until either this bound or the
// provider's nextPageToken ends. V2 treats only a complete OAuth read as the
// authoritative replacement, so use the practical integer ceiling.
const V2_SUBSCRIPTION_CHANNEL_SCAN_LIMIT = Number.MAX_SAFE_INTEGER;
const SUBSCRIPTION_CHANNELS_PER_REFRESH = 24;
const SUBSCRIPTION_ACTIVE_CHANNELS_PER_REFRESH = 12;
const SUBSCRIPTION_VIDEOS_PER_CHANNEL = 8;
const SUBSCRIPTION_PLAYLIST_CONCURRENCY = 6;

export function youtubeV2AcquisitionQueryBudget(reason: string): {
  more_like: number;
  beyond: number;
  total: number;
} {
  const nightly = /(?:nightly|scheduled|maintenance)/i.test(reason);
  const moreLike = YOUTUBE_V2_MORE_LIKE_MAX_SEEDS;
  const beyond = nightly ? 8 : 2;
  return { more_like: moreLike, beyond, total: moreLike + beyond };
}
const BECAUSE_YOU_WATCHED_SEARCH_BUDGET = 6;
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
  sync_status: 'disconnected' | 'paused' | 'syncing' | 'ready' | 'attention';
  channel_title: string | null;
  channel_thumbnail: string | null;
  subscription_count: number | null;
  region_code: string;
  relevance_language: string;
  synced_at: number | null;
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
  account?: YoutubeCompanionStatus;
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
  account?: YoutubeCompanionStatus,
): YoutubeCompanionAuthPoll {
  return {
    status: poll.status,
    ...(typeof poll.interval_sec === 'number' ? { interval_sec: poll.interval_sec } : {}),
    ...(account ? { account } : {}),
  };
}

type YoutubeConnectedAccountState = {
  channel_ref: string;
  channel_title: string;
  channel_thumbnail: string | null;
  subscription_count: number;
  region_code: string;
  relevance_language: string;
  sync_status: 'paused' | 'syncing' | 'ready' | 'attention';
  source_generation: string | null;
  synced_at: number | null;
};

type YoutubeSubscriptionCoverageState = {
  source_generation: string;
  channel_refs: string[];
  complete: boolean;
  updated_at: number;
};

type YoutubeRailsOptions = {
  reshuffle?: boolean;
  expectedPersonalization?: PersonalizationSnapshot | null;
};

type PublicYoutubeRail = {
  rail_id: string;
  label: string;
  cached: boolean;
  stale: boolean;
  // Internal ranking fields are deliberately omitted by publicYoutubeRails.
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

type BecauseYouWatchedRelation = 'same_channel' | 'same_topic' | 'deeper_dive' | 'wildcard';

type YoutubeRefreshPhase =
  | 'subscriptions'
  | 'v2_subscription_acquisition'
  | 'v2_history_metadata'
  | 'v2_history_acquisition'
  | 'v2_live_acquisition'
  | 'v2_publish';

type BecauseYouWatchedQuerySpec = {
  query: string;
  relation_type: BecauseYouWatchedRelation;
  order: 'date' | 'relevance' | 'viewCount';
  limit: number;
  channelId?: string;
  publishedAfterDays?: number;
  videoDuration?: 'medium' | 'long';
};

let youtubeRefreshTail: Promise<void> = Promise.resolve();

function serializeYoutubeRefresh<T>(task: () => Promise<T>): Promise<T> {
  const run = youtubeRefreshTail.catch(() => undefined).then(task);
  youtubeRefreshTail = run.then(() => undefined, () => undefined);
  return run;
}
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

function isShortLikeVideo(item: YoutubeItem): boolean {
  if (item.duration_sec !== null && item.duration_sec <= 60) return true;
  return /(^|\s)#shorts?\b/i.test(`${item.title} ${item.description || ''}`);
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

function isLowSignalYoutubeRecommendation(item: YoutubeItem): boolean {
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  return [
    /\\b(admit card|answer key|cut[ -]?off|exam result|exam notification|sarkari|vacancy)\\b/,
    /\\b(ssc|neet|jee|upsc|mts)\\b.*\\b(result|cut[ -]?off|answer key)\\b/,
    /\\b(result|cut[ -]?off|answer key)\\b.*\\b(ssc|neet|jee|upsc|mts)\\b/,
  ].some((pattern) => pattern.test(text));
}
function rfc3339DaysAgo(days: number): string {
  return new Date(nowMs() - days * 86_400_000).toISOString();
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
    label: 'Saved',
    items: saved,
    cached: saved.length > 0,
    stale: false,
  };
}

function isSameChannel(left: YoutubeItem, right: YoutubeItem): boolean {
  return Boolean(
    (left.channel_id && right.channel_id && left.channel_id === right.channel_id)
    || (left.channel_title && right.channel_title && left.channel_title === right.channel_title),
  );
}

function becauseRelationForItem(item: YoutubeItem, seed: YoutubeItem): BecauseYouWatchedRelation | null {
  if (item.id === seed.id) return null;
  if (isSameChannel(item, seed)) return 'same_channel';
  const semanticTokens = (value: YoutubeItem): Set<string> => youtubeTitleTokens([
    value.title,
    value.description,
    value.channel_title,
    ...(value.tags ?? []),
  ].filter(Boolean).join(' '));
  const seedTokens = semanticTokens(seed);
  const itemTokens = semanticTokens(item);
  const shared = [...seedTokens].filter((token) => itemTokens.has(token));
  const sameCategory = Boolean(item.category_id && seed.category_id && item.category_id === seed.category_id);
  const itemLanguage = item.default_audio_language || item.default_language;
  const seedLanguage = seed.default_audio_language || seed.default_language;
  const languageCompatible = !itemLanguage || !seedLanguage || itemLanguage === seedLanguage;
  if (shared.length < 2 && !(shared.length === 1 && sameCategory && languageCompatible)) return null;
  const overlap = tokenOverlapScore(seedTokens, itemTokens);
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  const deepDive = /\b(documentary|explained|analysis|interview|deep dive|history|lecture|breakdown|essay)\b/.test(text)
    || (item.duration_sec !== null && item.duration_sec >= 45 * 60);
  if (overlap >= 0.45 || (shared.length >= 2 && sameCategory)) return 'same_topic';
  if (overlap >= 0.22 && deepDive) return 'deeper_dive';
  if (overlap >= 0.15) return 'wildcard';
  return null;
}

function becauseYouWatchedQuerySpecs(seed: YoutubeItem): BecauseYouWatchedQuerySpec[] {
  const title = [...titleTokens(seed)];
  const officialTags = youtubeTitleTokens((seed.tags ?? []).join(' '));
  const tokens = [...title, ...[...officialTags].filter((token) => !title.includes(token))].slice(0, 6);
  const topicQuery = tokens.join(' ');
  const specs: BecauseYouWatchedQuerySpec[] = [];
  if (topicQuery) {
    specs.push({
      query: topicQuery,
      relation_type: 'same_topic',
      order: 'relevance',
      limit: 12,
      publishedAfterDays: 900,
      videoDuration: 'medium',
    });
  }
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

function groupCachedSearch(query: string, limit: number): YoutubeSearchGroups {
  const cached = searchCachedYoutubeItems(query, limit * 3);
  return {
    videos: cached.filter((item) => item.kind === 'video').slice(0, limit),
    channels: cached.filter((item) => item.kind === 'channel').slice(0, limit),
    playlists: cached.filter((item) => item.kind === 'playlist').slice(0, limit),
  };
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


export class YoutubeService {
  private readonly config: YoutubeConfig;
  private readonly api: YoutubeApiClient;
  private readonly searchFlights = new Map<string, Promise<YoutubeSearchGroups>>();

  constructor(config = loadYoutubeConfig()) {
    this.config = config;
    this.api = new YoutubeApiClient(config);
    initYoutubeDb();
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
    const account = getYoutubeState<YoutubeConnectedAccountState | null>('youtube_connected_account', null);
    const authenticated = auth.authenticated;
    const syncStatus = !authenticated
      ? 'disconnected' as const
      : account?.sync_status ?? (youtubeRecommendationsV2Mode() === 'off' ? 'paused' : 'syncing');
    return {
      api_key_configured: Boolean(this.config.api_key),
      oauth_configured: auth.configured,
      authenticated,
      needs_attention: syncStatus === 'attention' || Boolean(refresh.last_error),
      sync_status: syncStatus,
      channel_title: authenticated ? account?.channel_title ?? null : null,
      channel_thumbnail: authenticated ? account?.channel_thumbnail ?? null : null,
      subscription_count: authenticated ? account?.subscription_count ?? null : null,
      region_code: this.config.region_code,
      relevance_language: this.config.relevance_language,
      synced_at: authenticated ? account?.synced_at ?? null : null,
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
    }
    return { ok: true, auth: youtubeAuthSummary(this.config) };
  }

  async startCompanionAuth(): Promise<YoutubeCompanionAuthStart> {
    return youtubeCompanionAuthStartResponse(await this.startAuth());
  }

  async pollCompanionAuth(sessionId: string): Promise<YoutubeCompanionAuthPoll> {
    const poll = await this.pollAuth(sessionId);
    if (poll.status === 'authenticated') {
      if (youtubeRecommendationsV2Mode() === 'off') {
        const token = await youtubeAccessToken(this.config).catch(() => null);
        const identity = token ? await this.api.authorizedChannel(token).catch(() => null) : null;
        setYoutubeState('youtube_connected_account', {
          channel_ref: identity
            ? createHash('sha256').update(identity.id).digest('hex').slice(0, 16)
            : '',
          channel_title: identity?.title ?? 'YouTube',
          channel_thumbnail: identity?.thumbnail ?? null,
          subscription_count: listYoutubeV2Subscriptions().filter((row) => row.source === 'oauth').length,
          region_code: this.config.region_code,
          relevance_language: this.config.relevance_language,
          sync_status: 'paused',
          source_generation: null,
          synced_at: null,
        } satisfies YoutubeConnectedAccountState);
      } else {
        const previous = getYoutubeState<YoutubeConnectedAccountState | null>('youtube_connected_account', null);
        setYoutubeState('youtube_connected_account', {
          channel_ref: previous?.channel_ref ?? '',
          channel_title: previous?.channel_title ?? 'YouTube',
          channel_thumbnail: previous?.channel_thumbnail ?? null,
          subscription_count: previous?.subscription_count ?? 0,
          region_code: this.config.region_code,
          relevance_language: this.config.relevance_language,
          sync_status: 'syncing',
          source_generation: previous?.source_generation ?? null,
          synced_at: previous?.synced_at ?? null,
        } satisfies YoutubeConnectedAccountState);
        const refreshed = await this.refresh('oauth_connected');
        if (!refreshed.ok) {
          const current = getYoutubeState<YoutubeConnectedAccountState>('youtube_connected_account', {
            channel_ref: '', channel_title: 'YouTube', channel_thumbnail: null,
            subscription_count: 0, region_code: this.config.region_code,
            relevance_language: this.config.relevance_language, sync_status: 'attention',
            source_generation: null, synced_at: null,
          });
          setYoutubeState('youtube_connected_account', { ...current, sync_status: 'attention' });
        }
      }
    }
    return youtubeCompanionAuthPollResponse(poll, this.companionStatus());
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

  private async refreshSubscriptionsIfAuthorized(reason: string): Promise<void> {
    const token = await youtubeAccessToken(this.config).catch(() => null);
    if (!token) {
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
    await this.refreshSubscriptionsFromApi(token, reason);
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
    const budget = youtubeV2AcquisitionQueryBudget(reason);
    const nightly = /(?:nightly|scheduled|maintenance)/i.test(reason);
    const historySeeds = youtubeV2MoreLikeSeeds(YOUTUBE_V2_MORE_LIKE_MAX_SEEDS);
    const subscriptionFallback = historySeeds.length === 0 ? youtubeV2TopicSeed() : null;
    const moreLikeSeeds = historySeeds.length > 0
      ? historySeeds
      : subscriptionFallback ? [subscriptionFallback] : [];
    const moreLikeSeed = moreLikeSeeds[0] ?? null;
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
      query_index: number;
    };
    type Funnel = {
      lane: 'more_like' | 'beyond';
      seed_ref: string;
      query_index: number;
      query_kind: 'topic' | 'uploads_playlist';
      returned: number;
      live_rejected: number;
      shorts_rejected: number;
      low_signal: number;
      exact_excluded: number;
      relation_rejected: number;
      duplicate: number;
      persisted: number;
      generation_eligible: number;
      rail_allocated: number;
      error: string | null;
    };
    type AcquiredCandidate = Parameters<typeof upsertYoutubeV2CandidateProvenance>[0][number];
    // Candidate acquisition and cached serving share the same exact policy:
    // Saved/Not-for-me remain vetoes, while watched videos cool down for only
    // 30 days. Do not silently turn durable Takeout history into a lifetime
    // acquisition exclusion.
    const exactExcluded = youtubeV2ExactExcludedIds();
    const seen = new Set<string>();
    const funnels: Funnel[] = [];
    const execute = async (entry: AcquisitionSpec): Promise<{
      entry: AcquisitionSpec;
      candidates: AcquiredCandidate[];
      error: string | null;
    }> => {
      const funnel: Funnel = {
        lane: entry.lane,
        seed_ref: createHash('sha256').update(entry.seed.provenance_ref).digest('hex').slice(0, 16),
        query_index: entry.query_index,
        query_kind: entry.spec.channelId ? 'uploads_playlist' : 'topic',
        returned: 0,
        live_rejected: 0,
        shorts_rejected: 0,
        low_signal: 0,
        exact_excluded: 0,
        relation_rejected: 0,
        duplicate: 0,
        persisted: 0,
        generation_eligible: 0,
        rail_allocated: 0,
        error: null,
      };
      try {
        const groups = entry.spec.channelId
          ? await (async (): Promise<YoutubeSearchGroups> => {
              const playlists = await this.api.channelUploadPlaylists([entry.spec.channelId!]);
              const playlistId = playlists.get(entry.spec.channelId!);
              const videos = playlistId
                ? await this.api.playlistItems(playlistId, entry.spec.limit, undefined, 'background')
                : [];
              return { videos, channels: [], playlists: [] };
            })()
          : await this.api.search(entry.spec.query, {
              limit: entry.spec.limit,
              order: entry.spec.order,
              type: 'video',
              publishedAfter: entry.spec.publishedAfterDays
                ? rfc3339DaysAgo(entry.spec.publishedAfterDays) : undefined,
              videoDuration: entry.spec.videoDuration,
              safeSearch: 'moderate',
            });
        funnel.returned = groups.videos.length;
        const acquiredAt = nowMs();
        const provenance = entry.lane === 'more_like' && entry.spec.channelId
          ? 'history_channel' as const
          : 'history_topic' as const;
        const sourceGeneration = `${entry.lane}:${createHash('sha256')
          .update(JSON.stringify({
            lane: entry.lane,
            seed_kind: entry.seed.kind,
            seed_id: entry.seed.item.id,
            provenance_ref: entry.seed.provenance_ref,
            seed_source_generation: entry.seed.source_generation,
            relation: entry.spec.relation_type,
            query: entry.spec.query,
            channel_id: entry.spec.channelId ?? null,
          })).digest('hex')}`;
        const candidates = groups.videos.flatMap((item) => {
          if (item.kind !== 'video') return [];
          if (isLiveVideo(item)) { funnel.live_rejected += 1; return []; }
          if (isShortLikeVideo(item)) { funnel.shorts_rejected += 1; return []; }
          if (isLowSignalYoutubeRecommendation(item)) { funnel.low_signal += 1; return []; }
          if (exactExcluded.has(item.id) || item.id === entry.seed.item.id) {
            funnel.exact_excluded += 1;
            return [];
          }
          const relation = becauseRelationForItem(item, entry.seed.item);
          const related = provenance === 'history_channel'
            ? relation === 'same_channel'
            : entry.lane === 'beyond'
              ? relation !== null && relation !== 'same_channel'
              : relation !== null && relation !== 'same_channel';
          if (!related) { funnel.relation_rejected += 1; return []; }
          if (seen.has(item.id)) { funnel.duplicate += 1; return []; }
          seen.add(item.id);
          return [{
            item,
            provenance,
            provenance_ref: entry.seed.provenance_ref,
            source_generation: sourceGeneration,
            acquired_at: acquiredAt,
            expires_at: acquiredAt + YOUTUBE_V2_CANDIDATE_TTL_MS,
          }];
        });
        funnel.persisted = candidates.length;
        funnel.generation_eligible = candidates.length;
        funnels.push(funnel);
        return { entry, candidates, error: null };
      } catch (error) {
        funnel.error = error instanceof Error ? error.message : String(error);
        funnels.push(funnel);
        return { entry, candidates: [], error: funnel.error };
      }
    };

    const topicSpec = (
      seed: YoutubeV2TopicSeed,
      limit?: number,
    ): BecauseYouWatchedQuerySpec | null => {
      const spec = becauseYouWatchedQuerySpecs(seed.item)
        .find((candidate) => candidate.relation_type !== 'same_channel' && !candidate.channelId);
      return spec ? { ...spec, ...(limit ? { limit } : {}) } : null;
    };
    const exactSpec = (seed: YoutubeV2TopicSeed): BecauseYouWatchedQuerySpec | null => (
      seed.item.channel_id ? {
        query: '', relation_type: 'same_channel', channelId: seed.item.channel_id,
        order: 'date', limit: 12, publishedAfterDays: 365, videoDuration: 'medium',
      } : null
    );
    const allCandidates: AcquiredCandidate[] = [];
    const attemptedMoreLikeSeeds: YoutubeV2TopicSeed[] = [];
    const contributingMoreLikeSeedRefs = new Set<string>();
    const thematicMoreLikeCandidates: AcquiredCandidate[] = [];
    const channelMoreLikeCandidates: AcquiredCandidate[] = [];
    let selectedMode: 'thematic' | 'hybrid' | 'exact_channel' | 'not_applicable' = 'not_applicable';
    const results: Array<Awaited<ReturnType<typeof execute>>> = [];
    const minimumSeedTrials = Math.min(YOUTUBE_V2_MORE_LIKE_MIN_SEEDS, moreLikeSeeds.length);
    for (const seed of moreLikeSeeds.slice(0, budget.more_like)) {
      const spec = topicSpec(seed, YOUTUBE_V2_MORE_LIKE_QUERY_SIZE);
      if (!spec) continue;
      const entry: AcquisitionSpec = {
        lane: 'more_like', seed, spec, query_index: results.length,
      };
      const result = await execute(entry);
      results.push(result);
      attemptedMoreLikeSeeds.push(seed);
      thematicMoreLikeCandidates.push(...result.candidates);
      allCandidates.push(...result.candidates);
      if (result.candidates.length > 0) contributingMoreLikeSeedRefs.add(seed.provenance_ref);
      if (attemptedMoreLikeSeeds.length >= minimumSeedTrials
        && contributingMoreLikeSeedRefs.size >= minimumSeedTrials
        && thematicMoreLikeCandidates.length >= YOUTUBE_V2_MORE_LIKE_TARGET) {
        break;
      }
    }

    // Exact-channel reads are an honest sparse-history fallback, not a way to
    // inflate the 64-title thematic target. Try them only when all topic work
    // still cannot fill the four-card couch row.
    if (thematicMoreLikeCandidates.length < YOUTUBE_RAIL_LIMIT) {
      const remainingMoreLikeOperations = Math.max(0, budget.more_like - attemptedMoreLikeSeeds.length);
      for (const seed of attemptedMoreLikeSeeds.slice(
        0,
        Math.min(nightly ? 2 : 1, remainingMoreLikeOperations),
      )) {
        const spec = exactSpec(seed);
        if (!spec) continue;
        const entry: AcquisitionSpec = {
          lane: 'more_like', seed, spec, query_index: results.length,
        };
        const result = await execute(entry);
        results.push(result);
        channelMoreLikeCandidates.push(...result.candidates);
        allCandidates.push(...result.candidates);
        if (result.candidates.length > 0) contributingMoreLikeSeedRefs.add(seed.provenance_ref);
        if (thematicMoreLikeCandidates.length + channelMoreLikeCandidates.length >= YOUTUBE_RAIL_LIMIT) break;
      }
    }

    let selectedMoreLikeCandidates: AcquiredCandidate[] = [];
    if (thematicMoreLikeCandidates.length >= YOUTUBE_RAIL_LIMIT) {
      selectedMode = 'thematic';
      selectedMoreLikeCandidates = thematicMoreLikeCandidates;
    } else if (thematicMoreLikeCandidates.length > 0
      && thematicMoreLikeCandidates.length + channelMoreLikeCandidates.length >= YOUTUBE_RAIL_LIMIT) {
      selectedMode = 'hybrid';
      selectedMoreLikeCandidates = [
        ...channelMoreLikeCandidates.slice(0, 1),
        ...thematicMoreLikeCandidates,
        ...channelMoreLikeCandidates.slice(1),
      ];
    } else if (channelMoreLikeCandidates.length >= YOUTUBE_RAIL_LIMIT) {
      selectedMode = 'exact_channel';
      selectedMoreLikeCandidates = channelMoreLikeCandidates;
    }
    const selectedMoreLikeIds = new Set(selectedMoreLikeCandidates.map((candidate) => candidate.item.id));
    for (const result of results.filter((entry) => entry.entry.lane === 'more_like')) {
      const funnel = funnels.find((entry) => entry.query_index === result.entry.query_index);
      if (funnel) {
        funnel.rail_allocated = result.candidates
          .filter((candidate) => selectedMoreLikeIds.has(candidate.item.id)).length;
      }
    }

    const attemptedMoreLikeRefs = new Set(attemptedMoreLikeSeeds.map((seed) => seed.provenance_ref));
    const distinctBeyondSeeds = discoverySeeds.filter((seed) => (
      !attemptedMoreLikeRefs.has(seed.provenance_ref)
    ));
    for (const seed of (distinctBeyondSeeds.length > 0 ? distinctBeyondSeeds : discoverySeeds)
      .slice(0, budget.beyond)) {
      const spec = topicSpec(seed);
      if (!spec) continue;
      const result = await execute({
        lane: 'beyond', seed, spec, query_index: results.length,
      });
      results.push(result);
      allCandidates.push(...result.candidates);
    }
    const acquiredAt = nowMs();
    upsertYoutubeV2CandidateProvenance(allCandidates);
    if (selectedMode !== 'not_applicable' && attemptedMoreLikeSeeds.length > 0) {
      persistYoutubeV2MoreLikeSeeds(attemptedMoreLikeSeeds, acquiredAt);
    }
    const opaqueMoreLikeSeedRefs = attemptedMoreLikeSeeds.map((seed) => createHash('sha256')
      .update(seed.provenance_ref).digest('hex').slice(0, 16));
    setYoutubeState('youtube_v2_more_like_status', {
      status: selectedMode,
      seed_ref: opaqueMoreLikeSeedRefs[0] ?? null,
      seed_refs: opaqueMoreLikeSeedRefs,
      attempted_seed_count: attemptedMoreLikeSeeds.length,
      contributing_seed_count: contributingMoreLikeSeedRefs.size,
      candidate_count: selectedMoreLikeCandidates.length,
      target: YOUTUBE_V2_MORE_LIKE_TARGET,
      target_reached: selectedMoreLikeCandidates.length >= YOUTUBE_V2_MORE_LIKE_TARGET,
      at: acquiredAt,
    });
    const failed = results.filter((result) => result.error);
    setYoutubeState('youtube_v2_history_acquisition', {
      queries_attempted: results.length,
      query_budget: budget,
      more_like_queries: results.filter((entry) => entry.entry.lane === 'more_like').length,
      more_like_search_calls: results.filter((entry) => (
        entry.entry.lane === 'more_like' && !entry.entry.spec.channelId
      )).length,
      more_like_channel_fallbacks: results.filter((entry) => (
        entry.entry.lane === 'more_like' && Boolean(entry.entry.spec.channelId)
      )).length,
      beyond_queries: results.filter((entry) => entry.entry.lane === 'beyond').length,
      more_like_status: selectedMode,
      more_like_min_seeds: YOUTUBE_V2_MORE_LIKE_MIN_SEEDS,
      more_like_attempted_seeds: attemptedMoreLikeSeeds.length,
      more_like_contributing_seeds: contributingMoreLikeSeedRefs.size,
      more_like_candidate_count: selectedMoreLikeCandidates.length,
      more_like_target: YOUTUBE_V2_MORE_LIKE_TARGET,
      more_like_target_reached: selectedMoreLikeCandidates.length >= YOUTUBE_V2_MORE_LIKE_TARGET,
      funnels,
      distinct_seed_refs: [...new Set(funnels.map((funnel) => funnel.seed_ref))],
      query_failures: failed.length,
      candidates_acquired: allCandidates.length,
      acquired_at: acquiredAt,
      expires_at: acquiredAt + YOUTUBE_V2_CANDIDATE_TTL_MS,
    });
    const topicResults = results.filter((result) => !result.entry.spec.channelId);
    if (results.length > 0 && (
      failed.length === results.length
      || (allCandidates.length === 0 && topicResults.length > 0
        && topicResults.every((result) => result.error))
    )) {
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
      return !item
        || !item.thumbnail
        || !item.channel_id
        || !item.official_metadata_checked_at
        || item.official_metadata_checked_at < nowMs() - 30 * 86_400_000;
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

  private async refreshSubscriptionsFromApi(token: string, reason: string): Promise<void> {
    let subscriptions: YoutubeItem[];
    let identity: Awaited<ReturnType<YoutubeApiClient['authorizedChannel']>>;
    try {
      [subscriptions, identity] = await Promise.all([
        this.api.subscriptions(token, V2_SUBSCRIPTION_CHANNEL_SCAN_LIMIT, 'unread'),
        this.api.authorizedChannel(token),
      ]);
      if (!identity) throw new Error('Authorized YouTube channel could not be resolved');
    } catch (error) {
      // A failed read is not an authoritative empty subscription set.
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
    const sourceGeneration = createHash('sha256')
      .update(JSON.stringify(subscriptions
        .map((channel) => [channel.id, channel.title])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])))))
      .digest('hex');
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
    if (subscriptions.length === 0) {
      const syncedAt = nowMs();
      setYoutubeState('youtube_v2_subscription_acquisition', {
        channels_queried: 0,
        authoritative_channels: 0,
        coverage_complete: true,
        coverage_remaining: 0,
        batches: 0,
        candidates_acquired: 0,
        partial: false,
        error: null,
        acquired_at: syncedAt,
      });
      setYoutubeState('youtube_v2_subscription_coverage', {
        source_generation: sourceGeneration,
        channel_refs: [],
        complete: true,
        updated_at: syncedAt,
      } satisfies YoutubeSubscriptionCoverageState);
      setYoutubeState('youtube_connected_account', {
        channel_ref: createHash('sha256').update(identity.id).digest('hex').slice(0, 16),
        channel_title: identity.title,
        channel_thumbnail: identity.thumbnail,
        subscription_count: 0,
        region_code: this.config.region_code,
        relevance_language: this.config.relevance_language,
        sync_status: 'ready',
        source_generation: sourceGeneration,
        synced_at: syncedAt,
      } satisfies YoutubeConnectedAccountState);
      return;
    }

    const fullCoverage = reason === 'oauth_connected' || reason === 'subscription_full_refresh';
    const selection = fullCoverage
      ? { channels: subscriptions, nextCursor: 0 }
      : selectSubscriptionRefreshChannels(subscriptions);
    const { channels, nextCursor } = selection;
    setYoutubeState('subscription_refresh_cursor', nextCursor);
    const fetchedByChannel: Array<{ channel: YoutubeItem; items: YoutubeItem[]; unavailable: boolean }> = [];
    const failedChannels: string[] = [];
    const uploadFailures: string[] = [];
    for (let index = 0; index < channels.length; index += SUBSCRIPTION_CHANNELS_PER_REFRESH) {
      const batch = channels.slice(index, index + SUBSCRIPTION_CHANNELS_PER_REFRESH);
      try {
        const uploadPlaylists = await this.api.channelUploadPlaylists(batch.map((channel) => channel.id), token);
        for (let offset = 0; offset < batch.length; offset += SUBSCRIPTION_PLAYLIST_CONCURRENCY) {
          const slice = batch.slice(offset, offset + SUBSCRIPTION_PLAYLIST_CONCURRENCY);
          const results = await Promise.allSettled(slice.map(async (channel) => {
            const playlistId = uploadPlaylists.get(channel.id);
            if (!playlistId) return { channel, items: [] as YoutubeItem[], unavailable: true };
            try {
              const items = await this.api.playlistItems(
                playlistId,
                SUBSCRIPTION_VIDEOS_PER_CHANNEL,
                token,
              );
              return { channel, items, unavailable: false };
            } catch (error) {
              // A deleted/terminated channel can retain an uploads-playlist ID
              // whose playlist is now 404. The source was conclusively
              // inspected, so account coverage is complete with zero usable
              // candidates; auth/quota/transport failures still fail closed.
              if (error instanceof CatalogError && error.status === 404) {
                return { channel, items: [] as YoutubeItem[], unavailable: true };
              }
              throw error;
            }
          }));
          for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
            const result = results[resultIndex]!;
            if (result.status === 'fulfilled') fetchedByChannel.push(result.value);
            else {
              failedChannels.push(slice[resultIndex]!.id);
              uploadFailures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
            }
          }
        }
      } catch (error) {
        failedChannels.push(...batch.map((channel) => channel.id));
        uploadFailures.push(error instanceof Error ? error.message : String(error));
      }
    }
    const uploadError = failedChannels.length > 0
      ? `${uploadFailures[0] || 'upload refresh failed'}; ${failedChannels.length} subscription channels failed`
      : null;
    const acquiredAt = nowMs();
    const unavailableChannels = fetchedByChannel.filter((entry) => entry.unavailable).length;
    const priorCoverage = getYoutubeState<YoutubeSubscriptionCoverageState | null>(
      'youtube_v2_subscription_coverage',
      null,
    );
    const coveredRefs = new Set(
      priorCoverage?.source_generation === sourceGeneration ? priorCoverage.channel_refs : [],
    );
    for (const { channel } of fetchedByChannel) {
      coveredRefs.add(createHash('sha256').update(channel.id).digest('hex').slice(0, 16));
    }
    const coverageComplete = coveredRefs.size >= subscriptions.length && failedChannels.length === 0;
    setYoutubeState('youtube_v2_subscription_coverage', {
      source_generation: sourceGeneration,
      channel_refs: [...coveredRefs].sort(),
      complete: coverageComplete,
      updated_at: acquiredAt,
    } satisfies YoutubeSubscriptionCoverageState);
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
      authoritative_channels: subscriptions.length,
      coverage_complete: coverageComplete,
      coverage_remaining: coverageComplete
        ? 0
        : Math.max(failedChannels.length, subscriptions.length - coveredRefs.size),
      unavailable_channels: unavailableChannels,
      batches: Math.ceil(channels.length / SUBSCRIPTION_CHANNELS_PER_REFRESH),
      candidates_acquired: provenance.length,
      partial: uploadError !== null,
      error: uploadError,
      acquired_at: acquiredAt,
    });
    setYoutubeState('youtube_connected_account', {
      channel_ref: createHash('sha256').update(identity.id).digest('hex').slice(0, 16),
      channel_title: identity.title,
      channel_thumbnail: identity.thumbnail,
      subscription_count: subscriptions.length,
      region_code: this.config.region_code,
      relevance_language: this.config.relevance_language,
      sync_status: uploadError ? 'attention' : coverageComplete ? 'ready' : 'syncing',
      source_generation: sourceGeneration,
      synced_at: uploadError || !coverageComplete ? null : acquiredAt,
    } satisfies YoutubeConnectedAccountState);
  }

  refresh(reason = 'manual'): Promise<RefreshResult> {
    return serializeYoutubeRefresh(() => this.refreshUnserialized(reason));
  }

  private async refreshUnserialized(reason: string): Promise<RefreshResult> {
    if (!this.config.enabled) {
      return { ok: false, error: 'YouTube is disabled', refresh: youtubeRefreshStatus() };
    }
    const mode = youtubeRecommendationsV2Mode();
    if (mode === 'off') {
      return {
        ok: false,
        error: 'YouTube recommendations are operationally off',
        refresh: youtubeRefreshStatus(),
        phases: [],
      };
    }
    setYoutubeState('last_refresh_at', nowMs());
    setYoutubeState('last_reason', reason);
    const phases: YoutubeRefreshPhaseResult[] = [];
    const subscriptionsPhase = await this.runRefreshPhase(
      'subscriptions',
      () => this.refreshSubscriptionsIfAuthorized(reason),
    );
    phases.push(subscriptionsPhase);
    const subscriptionAcquisition = getYoutubeState<{
      partial?: boolean;
      stale?: boolean;
      error?: string | null;
      acquired_at?: number;
      at?: number;
    }>('youtube_v2_subscription_acquisition', {});
    const acquisitionAt = Number(
      subscriptionAcquisition.acquired_at ?? subscriptionAcquisition.at ?? 0,
    );
    const currentAcquisition = acquisitionAt >= subscriptionsPhase.started_at;
    const subscriptionError = !subscriptionsPhase.ok
      ? subscriptionsPhase.error ?? 'authoritative subscription enumeration failed'
      : currentAcquisition && (subscriptionAcquisition.partial || subscriptionAcquisition.stale)
        ? subscriptionAcquisition.error ?? 'subscription upload acquisition was partial'
        : null;
    phases.push({
      phase: 'v2_subscription_acquisition',
      ok: subscriptionError === null,
      started_at: subscriptionsPhase.started_at,
      ended_at: subscriptionsPhase.ended_at,
      duration_ms: subscriptionsPhase.duration_ms,
      ...(subscriptionError ? { error: subscriptionError } : {}),
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
        stale: subscriptionError !== null,
        reason: subscriptionError !== null ? 'subscription_acquisition_partial' : null,
        at: nowMs(),
        authoritative_subscription_count: listYoutubeV2Subscriptions()
          .filter((row) => row.source === 'oauth').length,
      });
    }));
    const failed = phases.filter((phase) => !phase.ok);
    const published = phases.find((phase) => phase.phase === 'v2_publish')?.ok === true;
    const generation = latestYoutubeV2GenerationRecord();
    const sourceStale = youtubeV2SourceStaleState();
    setYoutubeState('youtube_v2_shadow_status', {
      mode,
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
    if (published) {
      setYoutubeState('last_success_at', nowMs());
      const partialError = failed.length > 0
        ? `partial refresh: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
        : null;
      setYoutubeState('last_error', partialError);
      setYoutubeState('youtube_v2_last_error', partialError ? { error: partialError, at: nowMs() } : null);
      return { ok: true, refresh: youtubeRefreshStatus(), phases };
    }
    const message = failed.length > 0
      ? `YouTube refresh failed: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
      : 'YouTube refresh failed: no complete generation published';
    setYoutubeState('last_error', message);
    setYoutubeState('youtube_v2_last_error', { error: message, at: nowMs() });
    return { ok: false, error: message, refresh: youtubeRefreshStatus(), phases };
  }
  async railRelated(
    railId: string,
    exclude: TitleRef[],
    limit = 8,
  ): Promise<Record<string, unknown>> {
    const excludeKeys = new Set(exclude.map(titleRefKey));
    const response = await this.rails();
    const pool = response.rails.find((rail) => rail.rail_id === railId)?.items ?? [];
    const eligible = filterNotInterested(pool, 'household').filter((item) => !excludeKeys.has(titleRefKey({
        type: youtubeContentType(item),
        id: item.id,
      })));
    const picked = deterministicShuffle(
      eligible,
      `household:rail-related:${railId}:${[...excludeKeys].sort().join(',')}`,
      (item) => item.id,
    ).slice(0, Math.max(1, Math.min(limit, 24)));
    return {
      ok: true,
      rail_id: railId,
      items: picked,
    };
  }

  async rails(options: YoutubeRailsOptions = {}): Promise<YoutubeRailsResponse> {
    const personalization = getPersonalizationState();
    assertExpectedPersonalization(
      options.expectedPersonalization,
      personalization,
      'while YouTube rails loaded',
    );
    const mode = youtubeRecommendationsV2Mode();
    const ownerProfileId = recommendationOwnerForRollout(
      'youtube',
      personalization.active_profile_id,
      process.env.MANGO_VOD_RECS_V2,
      mode,
    );
    const generation = latestYoutubeV2GenerationRecord();
    const sourceStale = youtubeV2SourceStaleState();
    const servingEpoch = youtubeV2ServingEpoch(
      generation?.status === 'ready' ? generation.generation : null,
      Boolean(options.reshuffle) && mode === 'serve',
    );
    const reservedIds = new Set<string>();
    const historyItems = youtubeV2CachedHistoryItems(YOUTUBE_RAIL_POOL_LIMIT, ownerProfileId)
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
    const savedItems = savedRail(ownerProfileId, YOUTUBE_RAIL_POOL_LIMIT, false).items
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

    const recommendationRails = mode === 'serve'
      ? youtubeV2RecommendationRails({
          shuffle_epoch: servingEpoch.shuffle_epoch,
          reserved_ids: reservedIds,
        })
      : [];
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
        source_revision: servingEpoch.slate_sequence,
        context_id: rail.candidate_context_id ?? '',
      },
    ]));
    return {
      ok: true,
      tab: YOUTUBE_TAB,
      profile_id: ownerProfileId,
      personalization_updated_at: personalization.updated_at,
      rails: publicYoutubeRails(rails),
      slate_sequence: servingEpoch.slate_sequence,
      recommendations_status: mode === 'off' || mode === 'shadow'
        ? 'setup'
          : sourceStale.stale && generation?.status === 'ready'
            ? 'stale'
            : generation?.status ?? 'setup',
      setup_required: mode === 'serve' && (!generation || generation.status === 'empty'),
      stale_reason: sourceStale.stale ? sourceStale.reason : null,
      attribution_contexts: attributionContexts,
    };
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
            profile_id: youtubeRecommendationsV2Mode() !== 'off'
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
      profile_id: youtubeRecommendationsV2Mode() !== 'off'
        ? 'household'
        : activeViewerProfileId(),
    });
    invalidateYoutubeV2ExactExclusions();
    // The active recommendation owner is the reversible source of truth. Candidate
    // counters deliberately remain untouched so Undo removes both the exact
    // veto and its decaying semantic contribution on the next read.
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
  service?: Pick<YoutubeService, 'refresh'>;
}): Promise<YoutubeV2LocalRefreshResult> {
  const at = options.at ?? nowMs();
  if (options.reason === 'meaningful_watch') {
    // Mango-local viewing is a chronological utility and a 30-day exact-video
    // cooldown only. Official Takeout and OAuth subscriptions are the sole
    // recommendation/acquisition signals, so a local watch does no rank or
    // provider work.
    invalidateYoutubeV2ExactExclusions();
    invalidateYoutubeV2HistoryItems();
  }
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
  if (options.reason === 'meaningful_watch') {
    return {
      local_generation: latestYoutubeV2GenerationRecord()?.generation ?? null,
      acquisition: 'noop',
      acquisition_result: null,
    };
  }
  const generation = rebuildYoutubeV2Generation({ force: true, at });
  const lastTriggered = getYoutubeState<number>('youtube_v2_triggered_acquisition_last_at', 0);
  if (lastTriggered > 0 && at - lastTriggered < YOUTUBE_V2_TRIGGERED_ACQUISITION_COALESCE_MS) {
    return { local_generation: generation?.generation ?? null, acquisition: 'coalesced', acquisition_result: null };
  }
  setYoutubeState('youtube_v2_triggered_acquisition_last_at', at);
  const service = options.service ?? new YoutubeService();
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
  service?: Pick<YoutubeService, 'refresh'>;
} = {}): Promise<YoutubeV2LocalRefreshResult> {
  return refreshYoutubeV2AfterLocalSignal({
    ...options,
    reason: 'takeout_import_cli',
  });
}
