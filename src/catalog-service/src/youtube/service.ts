import { CatalogError } from '../catalog-errors.js';
import { playUrl } from '../mpv.js';
import { bumpPlayEpoch } from '../play-cancel.js';
import { startWatchSessionFromPlay } from '../progress/watcher.js';
import {
  getLibraryState,
  listLibraryFeedback,
  listSavedLibraryItems,
  listUniqueWatchHistory,
  listWatchHistory,
  recordLibraryWatch,
  setLibraryFeedback,
  type LibraryItemInput,
} from '../library/db.js';
import { YoutubeApiClient, type YoutubeChannelStats } from './api.js';
import { clearYoutubeAuth, pollYoutubeDeviceAuth, startYoutubeDeviceAuth, youtubeAccessToken, youtubeAuthSummary } from './auth.js';
import { loadYoutubeConfig, type YoutubeConfig } from './config.js';
import {
  getYoutubeItem,
  getYoutubeState,
  initYoutubeDb,
  listBecauseYouWatchedCandidates,
  listFreshFindCandidates,
  listForYouCandidates,
  listLiveNowCandidates,
  listYoutubeItems,
  listYoutubeRailItems,
  noteBecauseYouWatchedExposures,
  noteFreshFindExposures,
  noteForYouExposures,
  noteLiveNowExposures,
  pruneBecauseYouWatchedCandidates,
  pruneFreshFindCandidates,
  pruneLiveNowCandidates,
  replaceYoutubeRailItems,
  searchCachedYoutubeItems,
  setYoutubeState,
  upsertBecauseYouWatchedCandidates,
  upsertFreshFindCandidates,
  upsertForYouCandidates,
  upsertLiveNowCandidates,
  upsertYoutubeItems,
  youtubeCacheSummary,
  youtubeRefreshStatus,
  type YoutubeBecauseYouWatchedCandidate,
  type YoutubeFreshFindCandidate,
  type YoutubeForYouCandidate,
  type YoutubeLiveNowCandidate,
} from './db.js';
import { resolveYoutubePlayback } from './playback.js';
import type {
  YoutubeItem,
  YoutubeItemKind,
  YoutubeRail,
  YoutubeRailItem,
  YoutubeRefreshPhaseResult,
  YoutubeSearchGroups,
} from './types.js';

const YOUTUBE_SOURCE = 'youtube';
const YOUTUBE_TAB = 'youtube';
const YOUTUBE_VIDEO_TYPE = 'youtube_video';
const YOUTUBE_RAIL_LIMIT = 9;
const YOUTUBE_RAIL_POOL_LIMIT = 60;
const SUBSCRIPTION_CHANNEL_SCAN_LIMIT = 50;
const SUBSCRIPTION_CHANNELS_PER_REFRESH = 24;
const SUBSCRIPTION_ACTIVE_CHANNELS_PER_REFRESH = 12;
const SUBSCRIPTION_VIDEOS_PER_CHANNEL = 8;
const SUBSCRIPTION_RAIL_POOL_LIMIT = 160;
const FOR_YOU_RESERVOIR_TARGET = 1000;
const FOR_YOU_EXPOSURE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const FOR_YOU_SEARCH_HISTORY_LIMIT = 20;
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
const FOR_YOU_LANE_QUOTAS: Record<ForYouLane, number> = {
  familiar: 5,
  discovery: 3,
  wildcard: 1,
};
const FRESH_FIND_BUCKET_QUOTAS: Record<FreshFindBucket, number> = {
  taste_adjacent: 3,
  quality_fresh: 3,
  emerging_creator: 1,
  zeitgeist_light: 1,
  wildcard: 1,
};
const BECAUSE_YOU_WATCHED_RELATION_QUOTAS: Record<BecauseYouWatchedRelation, number> = {
  same_channel: 1,
  same_topic: 3,
  deeper_dive: 3,
  wildcard: 2,
};
const LIVE_NOW_LANE_QUOTAS: Record<LiveNowLane, number> = {
  subscription_live: 2,
  news_events: 2,
  sports: 1,
  music_performance: 1,
  gaming: 1,
  culture_talks: 1,
  wildcard: 1,
};
const SHUFFLEABLE_YOUTUBE_RAILS = new Set([
  'for_you',
  'new_from_subscriptions',
  'fresh_finds',
  'because_you_watched',
  'live_now',
  'popular',
]);
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

const RAIL_LABELS: Record<string, string> = {
  saved: 'Saved',
  history: 'History',
  for_you: 'For You',
  new_from_subscriptions: 'New From Subscriptions',
  fresh_finds: 'Fresh Finds',
  because_you_watched: 'Because You Watched',
  live_now: 'Live Now',
  popular: 'Popular on YouTube',
};

type RefreshResult = {
  ok: boolean;
  refresh: ReturnType<typeof youtubeRefreshStatus>;
  phases?: YoutubeRefreshPhaseResult[];
  error?: string;
};

type YoutubeRailsOptions = {
  reshuffle?: boolean;
};

type ForYouLane = 'familiar' | 'discovery' | 'wildcard';
type ForYouSource = 'history' | 'saved' | 'subscription' | 'discovery' | 'popular' | 'wildcard';
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
  | 'for_you_reservoir';

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
};

type ScoredForYouCandidate = YoutubeForYouCandidate & {
  score: number;
  score_breakdown: Record<string, number | string>;
};

type ScoredFreshFindCandidate = YoutubeFreshFindCandidate & {
  score: number;
  score_breakdown: Record<string, number | string>;
};

type ScoredLiveNowCandidate = YoutubeLiveNowCandidate & {
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

let liveNowRefreshInFlight: Promise<void> | null = null;

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

function notInterestedIds(): Set<string> {
  return new Set(
    listLibraryFeedback('not_interested', YOUTUBE_SOURCE)
      .filter((row) => row.type === YOUTUBE_VIDEO_TYPE)
      .map((row) => row.id),
  );
}

function filterNotInterested<T extends YoutubeItem>(items: T[]): T[] {
  const blocked = notInterestedIds();
  return items.filter((item) => item.kind !== 'video' || !blocked.has(item.id));
}

function shouldShowLiveInRail(railId: string): boolean {
  return railId === 'live_now' || railId === 'history';
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

function nonLiveVideos(items: YoutubeItem[]): YoutubeItem[] {
  return items.filter((item) => !isLiveVideo(item));
}

function shuffled<T>(items: T[]): T[] {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function railWindow<T extends YoutubeItem>(railId: string, items: T[], options: YoutubeRailsOptions = {}): T[] {
  const windowed = options.reshuffle && SHUFFLEABLE_YOUTUBE_RAILS.has(railId)
    ? shuffled(items)
    : items;
  return windowed.slice(0, YOUTUBE_RAIL_LIMIT);
}

function publishedOrUpdatedMs(item: YoutubeItem): number {
  const published = item.published_at ? Date.parse(item.published_at) : Number.NaN;
  return Number.isFinite(published) ? published : item.updated_at;
}

function titleTokens(item: YoutubeItem | { title?: string | null }): Set<string> {
  const title = item.title || '';
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !TITLE_TOKEN_STOPWORDS.has(token)),
  );
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

function recentWatchedYoutubeRecords(limit = 6): RecentWatchedYoutubeItem[] {
  const seen = new Set<string>();
  const output: RecentWatchedYoutubeItem[] = [];
  for (const row of listWatchHistory(Math.max(50, limit * 12))) {
    if (row.source !== YOUTUBE_SOURCE || row.type !== YOUTUBE_VIDEO_TYPE || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
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

function recencyScore(item: YoutubeItem): number {
  const published = item.published_at ? Date.parse(item.published_at) : item.updated_at;
  if (!Number.isFinite(published)) {
    return 0;
  }
  const ageDays = Math.max(0, (nowMs() - published) / 86_400_000);
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

function recentYoutubeSearches(): RecentYoutubeSearch[] {
  return getYoutubeState<RecentYoutubeSearch[]>('recent_searches', [])
    .filter((entry) => typeof entry.query === 'string' && Number.isFinite(entry.searched_at))
    .slice(0, FOR_YOU_SEARCH_HISTORY_LIMIT);
}

function recordRecentYoutubeSearch(query: string): void {
  const normalized = query.trim();
  if (!normalized) return;
  const deduped = recentYoutubeSearches().filter(
    (entry) => entry.query.toLowerCase() !== normalized.toLowerCase(),
  );
  setYoutubeState('recent_searches', [
    { query: normalized, searched_at: nowMs() },
    ...deduped,
  ].slice(0, FOR_YOU_SEARCH_HISTORY_LIMIT));
}

function cachedVideoFromLibrary(item: { id: string; title?: string | null; poster?: string | null }): YoutubeItem {
  return getYoutubeItem('video', item.id) || {
    id: item.id,
    kind: 'video',
    title: item.title || item.id,
    subtitle: 'YouTube',
    description: null,
    thumbnail: item.poster || null,
    channel_id: null,
    channel_title: null,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: nowMs(),
  };
}

function buildTasteProfile(): TasteProfile {
  const profile: TasteProfile = {
    watchedIds: new Set(),
    savedIds: new Set(),
    positiveChannels: new Map(),
    positiveTokens: new Map(),
    negativeIds: new Set(),
    negativeChannels: new Map(),
    negativeTokens: new Map(),
    recentSearches: recentYoutubeSearches(),
  };

  const history = listUniqueWatchHistory({
    source: YOUTUBE_SOURCE,
    type: YOUTUBE_VIDEO_TYPE,
    limit: 500,
  });
  for (const row of history) {
    profile.watchedIds.add(row.id);
    const item = cachedVideoFromLibrary(row);
    addWeight(profile.positiveChannels, item.channel_id || item.channel_title, 1);
    addTokenWeights(profile.positiveTokens, item, 0.75);
  }

  const saved = listSavedLibraryItems(YOUTUBE_TAB, 200)
    .filter((item) => item.source === YOUTUBE_SOURCE && item.type === YOUTUBE_VIDEO_TYPE);
  for (const row of saved) {
    profile.savedIds.add(row.id);
    const item = cachedVideoFromLibrary(row);
    addWeight(profile.positiveChannels, item.channel_id || item.channel_title, 1.5);
    addTokenWeights(profile.positiveTokens, item, 1.25);
  }

  for (const entry of profile.recentSearches) {
    const ageDays = Math.max(0, (nowMs() - entry.searched_at) / 86_400_000);
    const weight = Math.max(0, 1 - ageDays / 7);
    if (weight > 0) {
      addTokenWeights(profile.positiveTokens, { title: entry.query }, weight * 0.5);
    }
  }

  for (const row of listLibraryFeedback('not_interested', YOUTUBE_SOURCE)) {
    if (row.type !== YOUTUBE_VIDEO_TYPE) continue;
    profile.negativeIds.add(row.id);
    const item = getYoutubeItem('video', row.id) || { title: row.id };
    if ('channel_id' in item) {
      addWeight(profile.negativeChannels, item.channel_id || item.channel_title, 1);
    }
    addTokenWeights(profile.negativeTokens, item, 0.8);
  }
  return profile;
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
  return filterNotInterested(items)
    .filter((item) => item.kind === 'video')
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

function subscriptionRail(options: YoutubeRailsOptions = {}): YoutubeRail {
  const refresh = youtubeRefreshStatus();
  const profile = buildTasteProfile();
  const candidates = subscriptionEligibleItems(
    listYoutubeRailItems('new_from_subscriptions', SUBSCRIPTION_RAIL_POOL_LIMIT),
    profile,
  );
  const withoutSaved = candidates.filter((item) => !profile.savedIds.has(item.id));
  const pool = withoutSaved.length >= YOUTUBE_RAIL_LIMIT ? withoutSaved : candidates;
  const ordered = options.reshuffle ? shuffled(pool) : pool;
  let items = selectDiverseByChannel(ordered, YOUTUBE_RAIL_LIMIT, 1);
  if (items.length < YOUTUBE_RAIL_LIMIT) {
    items = selectDiverseByChannel(ordered, YOUTUBE_RAIL_LIMIT, 2);
  }
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  return {
    rail_id: 'new_from_subscriptions',
    label: RAIL_LABELS.new_from_subscriptions,
    items,
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
  for (const item of listYoutubeRailItems('because_you_watched', FOR_YOU_RESERVOIR_TARGET)) {
    hints.set(item.id, 'history');
  }
  for (const item of listYoutubeRailItems('new_from_subscriptions', FOR_YOU_RESERVOIR_TARGET)) {
    hints.set(item.id, 'subscription');
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
): { score: number; breakdown: Record<string, number | string> } {
  const channel = channelAffinity(item, profile) * 0.45;
  const topic = tokenAffinity(item, profile) * 0.55;
  const sourceBoost = sourceWeight(source);
  const freshness = recencyScore(item) * 0.55;
  const duration = durationFitScore(item) * 0.8;
  const quality = metadataQualityScore(item) * 0.35;
  const negative = negativeSimilarity(item, profile) * 0.9;
  const exposure = Math.min(1.25, stats.exposure_count * 0.06 + stats.ignore_count * 0.04);
  const quickStop = Math.min(0.7, stats.quick_stop_count * 0.18);
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
  const profile = buildTasteProfile();
  const hints = forYouSourceHints();
  const scored = listYoutubeItems('video', FOR_YOU_RESERVOIR_TARGET * 2)
    .filter((item) => !profile.watchedIds.has(item.id))
    .filter((item) => !profile.negativeIds.has(item.id))
    .filter((item) => !isLiveVideo(item))
    .filter((item) => !isShortLikeVideo(item))
    .map((item) => {
      const source = chooseForYouSource(item, profile, hints);
      const { score, breakdown } = scoreForYouItem(item, source, profile);
      return {
        item,
        lane: chooseForYouLane(item, source, profile),
        source,
        source_weight: sourceWeight(source),
        topic_cluster: topicCluster(item),
        score,
        score_breakdown: breakdown,
        reason: `for_you:${source}`,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, FOR_YOU_RESERVOIR_TARGET);
  upsertForYouCandidates(scored);
}

function topProfileTokens(profile: TasteProfile, limit: number): string[] {
  return [...profile.positiveTokens.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([token]) => token)
    .slice(0, limit);
}

function forYouDiscoveryQueries(): string[] {
  const profile = buildTasteProfile();
  const queries: string[] = [];
  for (const search of profile.recentSearches.slice(0, 3)) {
    queries.push(search.query);
  }
  const tokens = topProfileTokens(profile, 8);
  for (let index = 0; index < tokens.length - 1; index += 2) {
    queries.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  queries.push(...BASE_FRESH_FIND_QUERY_SPECS.map((spec) => spec.query));
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 4);
}

function rfc3339DaysAgo(days: number): string {
  return new Date(nowMs() - days * 86_400_000).toISOString();
}

function freshFindQuerySpecs(profile: TasteProfile): FreshFindQuerySpec[] {
  const tasteSpecs: FreshFindQuerySpec[] = [];
  const tokens = topProfileTokens(profile, 12);
  for (let index = 0; index < tokens.length - 1; index += 2) {
    tasteSpecs.push({
      query: `${tokens[index]} ${tokens[index + 1]} explained`,
      source_bucket: 'taste_adjacent',
      order: index % 4 === 0 ? 'relevance' : 'date',
      limit: 8,
      publishedAfterDays: 120,
      videoDuration: index % 3 === 0 ? 'long' : 'medium',
      videoDefinition: 'high',
    });
  }
  return [...tasteSpecs, ...BASE_FRESH_FIND_QUERY_SPECS]
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
  const exposure = Math.min(1.5, stats.exposure_count * 0.08 + stats.ignore_count * 0.08);
  const quickStop = Math.min(0.8, stats.quick_stop_count * 0.2);
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
  const exposure = Math.min(1.4, stats.exposure_count * 0.1 + stats.ignore_count * 0.1);
  const quickStop = Math.min(0.8, stats.quick_stop_count * 0.2);
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
  const profile = buildTasteProfile();
  const subscribed = subscribedChannelKeys();
  const existing = new Map(listLiveNowCandidates(LIVE_NOW_POOL_TARGET).map((item) => [item.id, item]));
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
    .filter((item) => !profile.negativeIds.has(item.id))
    .filter((item) => !isShortLikeVideo(item))
    .filter((item) => !isLowSignalLiveNow(item))
    .map((item) => {
      const lane = liveNowLaneForItem(item, subscribed);
      const previous = existing.get(item.id);
      const { score, breakdown } = scoreLiveNowItem(item, lane, profile, previous, 0.6);
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
    .sort((left, right) => right.score - left.score)
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
  reshuffle: boolean,
): ScoredLiveNowCandidate | null {
  const total = candidates.reduce((sum, item) => sum + samplingWeightLiveNow(item, reshuffle), 0);
  if (total <= 0) return candidates[0] || null;
  let cursor = Math.random() * total;
  for (const candidate of candidates) {
    cursor -= samplingWeightLiveNow(candidate, reshuffle);
    if (cursor <= 0) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function addLiveNowSelection(
  pool: ScoredLiveNowCandidate[],
  selected: ScoredLiveNowCandidate[],
  count: number,
  reshuffle: boolean,
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
    const picked = weightedPickLiveNow(eligible, reshuffle);
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
  for (const lane of [
    'subscription_live',
    'news_events',
    'sports',
    'music_performance',
    'gaming',
    'culture_talks',
    'wildcard',
  ] as LiveNowLane[]) {
    addLiveNowSelection(
      candidates.filter((candidate) => candidate.source_lane === lane),
      selected,
      LIVE_NOW_LANE_QUOTAS[lane],
      Boolean(options.reshuffle),
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
    Boolean(options.reshuffle),
    channelCounts,
    laneCounts,
    maxPerChannel,
    maxPerLane,
  );
  return selected;
}

function liveNowRail(options: YoutubeRailsOptions = {}): YoutubeRail {
  seedLiveNowCandidatesFromLegacyRail();
  const usable = listLiveNowCandidates(YOUTUBE_RAIL_LIMIT)
    .filter((candidate) => candidate.live_status === 'live' && candidate.expires_at > nowMs());
  if (usable.length < YOUTUBE_RAIL_LIMIT) {
    buildLiveNowCandidatesFromCache();
  }
  const profile = buildTasteProfile();
  const scoreCandidates = (allowRecentExposure: boolean) => (
    listLiveNowCandidates(LIVE_NOW_POOL_TARGET)
      .filter((candidate) => isEligibleLiveNowCandidate(candidate, profile, allowRecentExposure))
      .map((candidate): ScoredLiveNowCandidate => {
        const lane = (candidate.source_lane || 'wildcard') as LiveNowLane;
        const { score, breakdown } = scoreLiveNowItem(candidate, lane, profile, candidate);
        return { ...candidate, score, score_breakdown: breakdown };
      })
      .sort((left, right) => right.score - left.score)
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
  if (selected.length > 0) {
    replaceYoutubeRailItems('live_now', selected.map((item, index) => ({
      item,
      score: item.score,
      reason: `live_now:${item.source_lane}:${index + 1}`,
    })));
    noteLiveNowExposures(selected.map((item) => item.id));
  }
  const stale = selected.some((item) => nowMs() - item.last_verified_at > LIVE_NOW_REFRESH_STALE_MS);
  return {
    rail_id: 'live_now',
    label: RAIL_LABELS.live_now,
    items: selected.map((item) => ({
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
  reshuffle: boolean,
): ScoredFreshFindCandidate | null {
  const total = candidates.reduce((sum, item) => sum + samplingWeightFresh(item, reshuffle), 0);
  if (total <= 0) return candidates[0] || null;
  let cursor = Math.random() * total;
  for (const candidate of candidates) {
    cursor -= samplingWeightFresh(candidate, reshuffle);
    if (cursor <= 0) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function addFreshFindSelection(
  pool: ScoredFreshFindCandidate[],
  selected: ScoredFreshFindCandidate[],
  count: number,
  reshuffle: boolean,
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
    const picked = weightedPickFreshFind(eligible, reshuffle);
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
  for (const bucket of ['taste_adjacent', 'quality_fresh', 'emerging_creator', 'zeitgeist_light', 'wildcard'] as FreshFindBucket[]) {
    addFreshFindSelection(
      candidates.filter((candidate) => candidate.source_bucket === bucket),
      selected,
      FRESH_FIND_BUCKET_QUOTAS[bucket],
      Boolean(options.reshuffle),
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
    Boolean(options.reshuffle),
    channelCounts,
    topicCounts,
    maxPerChannel,
    maxPerTopic,
  );
  return selected;
}

function freshFindRail(options: YoutubeRailsOptions = {}): YoutubeRail {
  seedFreshFindCandidatesFromLegacyRail();
  const refresh = youtubeRefreshStatus();
  const profile = buildTasteProfile();
  const subscribed = subscribedChannelKeys();
  const scoreCandidates = (
    allowRecentExposure: boolean,
    allowSavedOrSubscribed: boolean,
    allowShortDuration: boolean,
  ) => (
    listFreshFindCandidates(FRESH_FIND_POOL_TARGET)
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
      .sort((left, right) => right.score - left.score)
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
  if (selected.length > 0) {
    replaceYoutubeRailItems('fresh_finds', selected.map((item, index) => ({
      item,
      score: item.score,
      reason: `fresh_find:${item.source_bucket}:${index + 1}`,
    })));
    noteFreshFindExposures(selected.map((item) => item.id));
  }
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
  reshuffle: boolean,
): ScoredForYouCandidate | null {
  const total = candidates.reduce((sum, item) => sum + samplingWeight(item, reshuffle), 0);
  if (total <= 0) return candidates[0] || null;
  let cursor = Math.random() * total;
  for (const candidate of candidates) {
    cursor -= samplingWeight(candidate, reshuffle);
    if (cursor <= 0) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function addForYouSelection(
  pool: ScoredForYouCandidate[],
  selected: ScoredForYouCandidate[],
  count: number,
  reshuffle: boolean,
  channelCounts: Map<string, number>,
  topicCounts: Map<string, number>,
): void {
  while (selected.length < YOUTUBE_RAIL_LIMIT && count > 0) {
    const eligible = pool.filter((candidate) => (
      canUseForYouCandidate(candidate, selected, channelCounts, topicCounts)
    ));
    if (eligible.length === 0) return;
    const picked = weightedPickForYou(eligible, reshuffle);
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
  for (const lane of ['familiar', 'discovery', 'wildcard'] as ForYouLane[]) {
    addForYouSelection(
      candidates.filter((candidate) => candidate.lane === lane),
      selected,
      FOR_YOU_LANE_QUOTAS[lane],
      Boolean(options.reshuffle),
      channelCounts,
      topicCounts,
    );
  }
  addForYouSelection(
    candidates,
    selected,
    YOUTUBE_RAIL_LIMIT - selected.length,
    Boolean(options.reshuffle),
    channelCounts,
    topicCounts,
  );
  return selected;
}

function forYouRail(options: YoutubeRailsOptions = {}): YoutubeRail {
  buildForYouReservoir();
  const refresh = youtubeRefreshStatus();
  const profile = buildTasteProfile();
  const scoreCandidates = (allowRecentExposure: boolean) => listForYouCandidates(FOR_YOU_RESERVOIR_TARGET)
    .filter((candidate) => isEligibleForYouCandidate(candidate, profile, allowRecentExposure))
    .map((candidate): ScoredForYouCandidate => {
      const source = (candidate.source || 'wildcard') as ForYouSource;
      const { score, breakdown } = scoreForYouItem(candidate, source, profile, candidate);
      return {
        ...candidate,
        score,
        score_breakdown: breakdown,
      };
    })
    .sort((left, right) => right.score - left.score);
  let candidates = scoreCandidates(false);
  if (candidates.length < YOUTUBE_RAIL_LIMIT) {
    setYoutubeState('for_you_needs_expansion', { at: nowMs(), eligible: candidates.length });
    candidates = scoreCandidates(true);
  }
  const selected = sampleForYouCandidates(candidates, options);
  if (selected.length > 0) {
    replaceYoutubeRailItems('for_you', selected.map((item, index) => ({
      item,
      score: item.score,
      reason: `for_you:${item.source}:${index + 1}`,
    })));
    noteForYouExposures(selected.map((item) => item.id));
  }
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
    cached: selected.length > 0,
    stale,
  };
}

function railFromItems(railId: string, items: YoutubeItem[], reason: string): YoutubeRail {
  const refresh = youtubeRefreshStatus();
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  return {
    rail_id: railId,
    label: RAIL_LABELS[railId] || railId,
    items: filterNotInterested(items).map((item, index) => ({
      ...item,
      score: 1 / (index + 1),
      reason,
    })),
    cached: items.length > 0,
    stale,
  };
}

function cachedRail(railId: string, options: YoutubeRailsOptions = {}): YoutubeRail {
  const refresh = youtubeRefreshStatus();
  const candidates = filterNotInterested(listYoutubeRailItems(railId, YOUTUBE_RAIL_POOL_LIMIT))
    .filter((item) => shouldShowLiveInRail(railId) || !isLiveVideo(item));
  const items = railWindow(railId, candidates, options);
  const stale = refresh.last_success_at !== null
    && refresh.last_success_at < nowMs() - loadYoutubeConfig().stale_after_ms;
  return {
    rail_id: railId,
    label: RAIL_LABELS[railId] || railId,
    items,
    cached: items.length > 0,
    stale,
  };
}

function savedRail(limit = YOUTUBE_RAIL_LIMIT): YoutubeRail {
  const saved = listSavedLibraryItems(YOUTUBE_TAB, limit)
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

function historyRail(options: YoutubeRailsOptions = {}, limit = YOUTUBE_RAIL_LIMIT): YoutubeRail {
  const history = listUniqueWatchHistory({
    source: YOUTUBE_SOURCE,
    type: YOUTUBE_VIDEO_TYPE,
  });
  const items = (options.reshuffle ? shuffled(history) : history)
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

function latestBecauseYouWatchedSeed(limit = 24): RecentWatchedYoutubeItem | null {
  const records = recentWatchedYoutubeRecords(limit);
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
  const exposure = Math.min(1.4, stats.exposure_count * 0.08 + stats.ignore_count * 0.08);
  const quickStop = Math.min(0.7, stats.quick_stop_count * 0.18);
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
  const profile = buildTasteProfile();
  const existing = new Map(
    listBecauseYouWatchedCandidates(seed.id, BECAUSE_YOU_WATCHED_POOL_TARGET)
      .map((candidate) => [candidate.id, candidate]),
  );
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
      const previous = existing.get(item.id);
      const { score, breakdown } = scoreBecauseYouWatchedItem(item, seed, relation, profile, previous);
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
    .sort((left, right) => right.score - left.score)
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
  reshuffle: boolean,
): ScoredBecauseYouWatchedCandidate | null {
  const total = candidates.reduce((sum, item) => sum + samplingWeightBecause(item, reshuffle), 0);
  if (total <= 0) return candidates[0] || null;
  let cursor = Math.random() * total;
  for (const candidate of candidates) {
    cursor -= samplingWeightBecause(candidate, reshuffle);
    if (cursor <= 0) return candidate;
  }
  return candidates[candidates.length - 1] || null;
}

function addBecauseYouWatchedSelection(
  pool: ScoredBecauseYouWatchedCandidate[],
  selected: ScoredBecauseYouWatchedCandidate[],
  count: number,
  reshuffle: boolean,
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
    const picked = weightedPickBecause(eligible, reshuffle);
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
      Boolean(options.reshuffle),
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
    Boolean(options.reshuffle),
    channelCounts,
    topicCounts,
    maxPerChannel,
    maxPerTopic,
  );
  return selected;
}

function becauseYouWatchedRail(options: YoutubeRailsOptions = {}): YoutubeRail {
  const seed = latestBecauseYouWatchedSeed();
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
  buildBecauseYouWatchedCandidatesFromCache(seed);
  const refresh = youtubeRefreshStatus();
  const profile = buildTasteProfile();
  const scoreCandidates = (
    allowRecentExposure: boolean,
    allowSaved: boolean,
    allowShortDuration: boolean,
  ) => (
    listBecauseYouWatchedCandidates(seed.item.id, BECAUSE_YOU_WATCHED_POOL_TARGET)
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
      .sort((left, right) => right.score - left.score)
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
  if (selected.length > 0) {
    replaceYoutubeRailItems('because_you_watched', selected.map((item, index) => ({
      item,
      score: item.score,
      reason: `because_you_watched:${item.relation_type}:${index + 1}`,
    })));
    noteBecauseYouWatchedExposures(seed.item.id, selected.map((item) => item.id));
  }
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
    items: selected.map((item) => ({
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

export class YoutubeService {
  private readonly config: YoutubeConfig;
  private readonly api: YoutubeApiClient;

  constructor(config = loadYoutubeConfig()) {
    this.config = config;
    this.api = new YoutubeApiClient(config);
    initYoutubeDb();
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
    };
  }

  async startAuth(): Promise<Record<string, unknown>> {
    return startYoutubeDeviceAuth(this.config);
  }

  async pollAuth(sessionId: string): Promise<Record<string, unknown>> {
    return pollYoutubeDeviceAuth(this.config, sessionId);
  }

  disconnectAuth(): Record<string, unknown> {
    clearYoutubeAuth(this.config);
    return { ok: true, auth: youtubeAuthSummary(this.config) };
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
    const popular = await this.api.popular(36);
    replaceYoutubeRailItems('popular', popular.map((item, index) => ({
      item,
      score: 1 - index * 0.01,
      reason: 'trending fallback',
    })));
    setYoutubeState('popular_last_refresh_count', popular.length);
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
    const profile = buildTasteProfile();
    const existing = new Map(listLiveNowCandidates(LIVE_NOW_POOL_TARGET).map((item) => [item.id, item]));
    const scored = [...byId.values()]
      .map(({ item, spec, rank }) => {
        if (item.kind !== 'video') return null;
        if (item.live_status !== 'live') return null;
        if (profile.negativeIds.has(item.id)) return null;
        if (isShortLikeVideo(item)) return null;
        if (isLowSignalLiveNow(item)) return null;
        const lane = spec.source_lane;
        const previous = existing.get(item.id);
        const { score, breakdown } = scoreLiveNowItem(item, lane, profile, previous, spec.source_weight, rank);
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
      .sort((left, right) => right.score - left.score)
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

  private async refreshBecauseYouWatchedFromApi(): Promise<void> {
    if (!this.config.api_key) {
      return;
    }
    const seed = latestBecauseYouWatchedSeed();
    if (!seed) {
      replaceYoutubeRailItems('because_you_watched', []);
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
    const profile = buildTasteProfile();
    const existing = new Map(
      listBecauseYouWatchedCandidates(seed.item.id, BECAUSE_YOU_WATCHED_POOL_TARGET)
        .map((candidate) => [candidate.id, candidate]),
    );
    const scored = [...byId.values()]
      .map(({ item, spec }) => {
        if (profile.watchedIds.has(item.id)) return null;
        if (profile.negativeIds.has(item.id)) return null;
        if (isLiveVideo(item) || isShortLikeVideo(item) || isLowSignalYoutubeRecommendation(item)) return null;
        const relation = becauseRelationForItem(item, seed.item) || spec.relation_type;
        const previous = existing.get(item.id);
        const { score, breakdown } = scoreBecauseYouWatchedItem(item, seed.item, relation, profile, previous);
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
      .sort((left, right) => right.score - left.score)
      .slice(0, BECAUSE_YOU_WATCHED_POOL_TARGET);
    upsertBecauseYouWatchedCandidates(scored);
    pruneBecauseYouWatchedCandidates(BECAUSE_YOU_WATCHED_POOL_TARGET);
    const visible = listBecauseYouWatchedCandidates(seed.item.id, YOUTUBE_RAIL_POOL_LIMIT);
    replaceYoutubeRailItems('because_you_watched', visible.map((item, index) => ({
      item,
      score: item.score,
      reason: `because_you_watched:${item.relation_type}:${index + 1}`,
    })));
    setYoutubeState('because_you_watched_last_refresh_count', scored.length);
  }

  private async expandForYouDiscoveryFromApi(): Promise<void> {
    if (!this.config.api_key) {
      return;
    }
    const queries = forYouDiscoveryQueries();
    if (queries.length === 0) {
      return;
    }
    await Promise.all(
      queries.map((query) => this.api.search(query, { limit: 8 }).catch(() => ({
        videos: [],
        channels: [],
        playlists: [],
      }))),
    );
  }

  private async refreshFreshFindsFromApi(): Promise<void> {
    if (!this.config.api_key) {
      return;
    }
    const profile = buildTasteProfile();
    const specs = freshFindQuerySpecs(profile);
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
      .filter((item) => !profile.watchedIds.has(item.id))
      .filter((item) => !profile.negativeIds.has(item.id))
      .filter((item) => !isLiveVideo(item))
      .filter((item) => !isShortLikeVideo(item))
      .filter((item) => !isLowSignalFreshFind(item));
    if (items.length === 0) {
      return;
    }
    const channelIds = [...new Set(items.map((item) => item.channel_id).filter((id): id is string => Boolean(id)))];
    const channelStats = await this.api.channelStats(channelIds).catch(() => new Map<string, YoutubeChannelStats>());
    const existing = new Map(listFreshFindCandidates(FRESH_FIND_POOL_TARGET).map((item) => [item.id, item]));
    const scored = items.map((item) => {
      const spec = byId.get(item.id)?.spec || {
        query: '',
        source_bucket: 'wildcard',
        order: 'relevance',
        limit: 8,
      } satisfies FreshFindQuerySpec;
      const stats = channelStats.get(item.channel_id || '');
      const previous = existing.get(item.id);
      const { score, breakdown } = scoreFreshFindItem(item, spec.source_bucket, profile, previous, stats);
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
      .sort((left, right) => right.score - left.score)
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
    const subscriptions = await this.api.subscriptions(
      token,
      SUBSCRIPTION_CHANNEL_SCAN_LIMIT,
      'unread',
    ).catch(() => []);
    if (subscriptions.length === 0) {
      return;
    }

    const { channels, nextCursor } = selectSubscriptionRefreshChannels(subscriptions);
    setYoutubeState('subscription_refresh_cursor', nextCursor);
    const uploadPlaylists = await this.api.channelUploadPlaylists(
      channels.map((channel) => channel.id),
      token,
    ).catch(() => new Map<string, string>());

    const fetched = (
      await Promise.all(channels.map((channel) => {
        const playlistId = uploadPlaylists.get(channel.id);
        if (!playlistId) {
          return Promise.resolve([] as YoutubeItem[]);
        }
        return this.api.playlistItems(playlistId, SUBSCRIPTION_VIDEOS_PER_CHANNEL, token)
          .catch(() => [] as YoutubeItem[]);
      }))
    ).flat();

    const profile = buildTasteProfile();
    const existing = listYoutubeRailItems('new_from_subscriptions', SUBSCRIPTION_RAIL_POOL_LIMIT);
    const merged = sortSubscriptionItems(uniqueVideos([...fetched, ...existing]));
    const eligible = subscriptionEligibleItems(merged, profile).slice(0, SUBSCRIPTION_RAIL_POOL_LIMIT);
    replaceYoutubeRailItems('new_from_subscriptions', eligible.map((item, index) => ({
      item,
      score: 1 - index * 0.001,
      reason: 'subscription upload',
    })));
  }

  async refresh(reason = 'manual'): Promise<RefreshResult> {
    if (!this.config.enabled) {
      return { ok: false, error: 'YouTube is disabled', refresh: youtubeRefreshStatus() };
    }
    if (!this.config.api_key) {
      setYoutubeState('last_error', 'YouTube API key is not configured');
      return { ok: false, error: 'YouTube API key is not configured', refresh: youtubeRefreshStatus() };
    }
    setYoutubeState('last_refresh_at', nowMs());
    setYoutubeState('last_reason', reason);
    const phases: YoutubeRefreshPhaseResult[] = [];
    for (const [phase, fn] of [
      ['popular', () => this.refreshPopularFromApi()],
      ['subscriptions', () => this.refreshSubscriptionsIfAuthorized()],
      ['fresh_finds', () => this.refreshFreshFindsFromApi()],
      ['live_now', () => this.refreshLiveNowFromApi()],
      ['because_you_watched', () => this.refreshBecauseYouWatchedFromApi()],
      ['for_you_discovery', () => this.expandForYouDiscoveryFromApi()],
      ['for_you_reservoir', () => this.rebuildForYouReservoir()],
    ] as Array<[YoutubeRefreshPhase, () => Promise<void> | void]>) {
      phases.push(await this.runRefreshPhase(phase, fn));
    }
    setYoutubeState('last_phase_results', phases);
    const failed = phases.filter((phase) => !phase.ok);
    const succeeded = phases.some((phase) => phase.ok);
    if (succeeded) {
      setYoutubeState('last_success_at', nowMs());
      setYoutubeState('last_error', failed.length > 0
        ? `partial refresh: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
        : null);
      return { ok: true, refresh: youtubeRefreshStatus(), phases };
    }
    const message = failed.length > 0
      ? `YouTube refresh failed: ${failed.map((phase) => `${phase.phase}: ${phase.error || 'failed'}`).join('; ')}`
      : 'YouTube refresh failed: no phases ran';
    setYoutubeState('last_error', message);
    return { ok: false, error: message, refresh: youtubeRefreshStatus(), phases };
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
    liveNowRefreshInFlight = this.refreshLiveNowFromApi()
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

  async rails(options: YoutubeRailsOptions = {}): Promise<Record<string, unknown>> {
    const cache = youtubeCacheSummary();
    if (this.config.enabled && this.config.api_key && cache.videos === 0) {
      await this.refresh('first_run').catch(() => undefined);
    }
    if (!options.reshuffle) {
      this.scheduleLiveNowRefreshIfDue();
    }
    const rails: YoutubeRail[] = [
      savedRail(),
      historyRail(options),
      forYouRail(options),
      subscriptionRail(options),
      freshFindRail(options),
      becauseYouWatchedRail(options),
      liveNowRail(options),
      cachedRail('popular', options),
    ].filter((rail) => rail.items.length > 0 || rail.rail_id === 'popular');
    return {
      ok: true,
      tab: YOUTUBE_TAB,
      rails,
      refresh: youtubeRefreshStatus(),
      auth: youtubeAuthSummary(this.config),
    };
  }

  async search(query: string, limit = this.config.max_results): Promise<Record<string, unknown>> {
    const normalized = query.trim();
    if (!normalized) {
      throw new CatalogError(400, 'YouTube search requires q', undefined, {
        couchMessage: 'type something to search YouTube',
      });
    }
    const searchLimit = Math.max(1, Math.min(50, limit));
    let cachedOnly = !this.config.api_key;
    let apiError: string | null = null;
    let groups: YoutubeSearchGroups;
    if (this.config.api_key) {
      try {
        groups = await this.api.search(normalized, { limit: searchLimit });
      } catch (error) {
        apiError = error instanceof Error ? error.message : String(error);
        setYoutubeState('last_search_error', { query: normalized, error: apiError, at: nowMs() });
        groups = groupCachedSearch(normalized, searchLimit);
        cachedOnly = true;
      }
    } else {
      groups = groupCachedSearch(normalized, searchLimit);
    }
    recordRecentYoutubeSearch(normalized);
    return {
      ok: true,
      query: normalized,
      groups,
      refresh: youtubeRefreshStatus(),
      cached_only: cachedOnly,
      api_error: apiError,
    };
  }

  async detail(kind: YoutubeItemKind, id: string): Promise<Record<string, unknown>> {
    let item = getYoutubeItem(kind, id);
    let items: YoutubeItem[] = [];
    if (kind === 'video' && this.config.api_key) {
      item = (await this.api.videos([id]).catch(() => []))[0] || item;
    }
    if (kind === 'channel') {
      if (!item) {
        item = getYoutubeItem('channel', id);
      }
      if (this.config.api_key) {
        items = await this.api.channelVideos(id, 40).catch(() => []);
      } else {
        items = listYoutubeItems('video', 200).filter((candidate) => candidate.channel_id === id);
      }
    }
    if (kind === 'playlist') {
      if (!item) {
        item = getYoutubeItem('playlist', id);
      }
      if (this.config.api_key) {
        items = await this.api.playlistItems(id, 40).catch(() => []);
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
        ? getLibraryState({ source: YOUTUBE_SOURCE, type: YOUTUBE_VIDEO_TYPE, id })
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
    });
    return { ok: true, feedback };
  }

  async play(input: { id?: string; title?: string; poster?: string }): Promise<Record<string, unknown>> {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) {
      throw new CatalogError(400, 'YouTube play requires id', undefined, {
        couchMessage: 'YouTube video id is missing',
      });
    }
    let item = getYoutubeItem('video', id);
    if (!item && this.config.api_key) {
      item = (await this.api.videos([id]).catch(() => []))[0] || null;
    }
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
    const playEpoch = await bumpPlayEpoch();
    const resolved = await resolveYoutubePlayback(this.config, id);
    const live = item.live_status === 'live';
    const playback = await playUrl(resolved.url, 90000, {
      live,
      playEpoch,
      minDurationSec: live ? 1 : 1,
      audioUrl: resolved.audio_url,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new CatalogError(502, live ? 'YouTube live playback did not start' : 'YouTube playback did not start', {
        mpv: message,
      }, {
        couchMessage: live
          ? 'YouTube live playback did not start — try another live video'
          : 'YouTube playback did not start — try another video',
      });
    });
    recordLibraryWatch({
      ...itemToLibraryInput(item),
      play_id: id,
      duration_sec: item.duration_sec ?? 0,
      position_sec: 0,
      event: 'play',
      watched_at: nowMs(),
    });
    buildForYouReservoir();
    void this.refreshBecauseYouWatchedFromApi().catch((error) => {
      setYoutubeState('last_because_you_watched_error', error instanceof Error ? error.message : String(error));
    });
    await startWatchSessionFromPlay({
      source: YOUTUBE_SOURCE,
      type: YOUTUBE_VIDEO_TYPE,
      id,
      title: item.title,
      poster: item.thumbnail,
      tab: YOUTUBE_TAB,
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
