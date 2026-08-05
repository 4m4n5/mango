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
import {
  YOUTUBE_V2_CANDIDATE_TTL_MS,
  YOUTUBE_V2_LIVE_TTL_MS,
  rebuildYoutubeV2Generation,
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
  const overlap = tokenOverlapScore(titleTokens(seed), titleTokens(item));
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  const deepDive = /\b(documentary|explained|analysis|interview|deep dive|history|lecture|breakdown|essay)\b/.test(text)
    || (item.duration_sec !== null && item.duration_sec >= 45 * 60);
  if (overlap >= 0.45) return 'same_topic';
  if (overlap >= 0.22 && deepDive) return 'deeper_dive';
  if (overlap >= 0.15) return 'wildcard';
  return null;
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

  private async refreshSubscriptionsIfAuthorized(): Promise<void> {
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
    await this.refreshSubscriptionsFromApi(token);
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

  private async refreshSubscriptionsFromApi(token: string): Promise<void> {
    let subscriptions: YoutubeItem[];
    try {
      subscriptions = await this.api.subscriptions(
        token,
        V2_SUBSCRIPTION_CHANNEL_SCAN_LIMIT,
        'unread',
      );
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
      setYoutubeState('youtube_v2_subscription_acquisition', {
        channels_queried: 0,
        candidates_acquired: 0,
        partial: false,
        error: null,
        acquired_at: nowMs(),
      });
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
      uploadError = error instanceof Error ? error.message : String(error);
      setYoutubeState('youtube_v2_subscription_acquisition', {
        stale: false,
        reason: 'oauth_subscription_upload_refresh_failed',
        candidates_acquired: 0,
        error: uploadError,
        at: nowMs(),
      });
      fetchedByChannel = channels.map((channel) => ({ channel, items: [] }));
    }
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
    const generation = latestYoutubeV2GenerationRecord();
    const sourceStale = youtubeV2SourceStaleState();
    const servingEpoch = youtubeV2ServingEpoch(
      generation?.status === 'ready' ? generation.generation : null,
      Boolean(options.reshuffle) && mode === 'serve',
    );
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
      profile_id: 'household',
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
