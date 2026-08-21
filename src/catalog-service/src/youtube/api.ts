import { CatalogError } from '../catalog-errors.js';
import {
  incrementYoutubeQuota,
  upsertYoutubeItems,
  youtubeQuotaDecision,
  type YoutubeApiPurpose,
} from './db.js';
import type { YoutubeConfig } from './config.js';
import type { YoutubeItem, YoutubeItemKind, YoutubeLiveStatus, YoutubeSearchGroups } from './types.js';

type SearchItem = {
  id?: { kind?: string; videoId?: string; channelId?: string; playlistId?: string };
  snippet?: Snippet;
};

type Snippet = {
  title?: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  publishedAt?: string;
  thumbnails?: Record<string, { url?: string }>;
  liveBroadcastContent?: string;
  resourceId?: { videoId?: string; channelId?: string; playlistId?: string };
  categoryId?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  tags?: string[];
  position?: number;
};

type VideoItem = {
  id?: string;
  snippet?: Snippet;
  contentDetails?: { duration?: string };
  liveStreamingDetails?: LiveStreamingDetails;
};

type LiveStreamingDetails = {
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  concurrentViewers?: string;
};

type ChannelItem = {
  id?: string;
  snippet?: Snippet;
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
  statistics?: {
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
    hiddenSubscriberCount?: boolean;
  };
};

export type YoutubeSubscriptionOrder = 'alphabetical' | 'relevance' | 'unread';

export type YoutubeChannelStats = {
  subscriber_count: number | null;
  video_count: number | null;
  view_count: number | null;
  hidden_subscriber_count: boolean;
};

export type YoutubeAuthorizedChannel = {
  id: string;
  title: string;
  thumbnail: string | null;
};

export type YoutubeRankedVideo = {
  item: YoutubeItem;
  /** Zero-based position in the provider's Search or uploads response. */
  source_rank: number;
};

export type YoutubeSearchOptions = {
  limit?: number;
  eventType?: 'live' | 'upcoming' | 'completed';
  channelId?: string;
  order?: 'date' | 'relevance' | 'viewCount';
  type?: 'video' | 'channel' | 'playlist';
  publishedAfter?: string;
  videoDuration?: 'any' | 'long' | 'medium' | 'short';
  videoDefinition?: 'any' | 'high' | 'standard';
  topicId?: string;
  safeSearch?: 'moderate' | 'none' | 'strict';
  purpose?: YoutubeApiPurpose;
  /** Absolute wall-clock deadline for background work; each request is still capped at eight seconds. */
  deadline_at?: number;
  /** Recommendation acquisition persists only candidates that pass its policy funnel. */
  persist?: boolean;
};

export type YoutubeRecommendationSearchOptions = Omit<YoutubeSearchOptions, 'purpose' | 'persist'>;

export const YOUTUBE_BACKGROUND_REQUEST_TIMEOUT_MS = 8_000;

function requireApiKey(config: YoutubeConfig): string {
  if (!config.api_key) {
    throw new CatalogError(503, 'YouTube API key is not configured');
  }
  return config.api_key;
}

function thumbnail(snippet?: Snippet): string | null {
  const thumbs = snippet?.thumbnails || {};
  // Prefer `high` (hqdefault). `maxres` 404s for a large fraction of older
  // videos and shows up as blank cards on the YouTube tab.
  return thumbs.high?.url || thumbs.medium?.url || thumbs.standard?.url
    || thumbs.maxres?.url || thumbs.default?.url || null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function parseYoutubeDurationSec(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function liveStatus(value: string | undefined): YoutubeLiveStatus {
  if (value === 'live' || value === 'upcoming') return value;
  if (value === 'none') return 'none';
  return 'none';
}

function videoLiveStatus(snippet?: Snippet, details?: LiveStreamingDetails): YoutubeLiveStatus {
  if (details?.actualEndTime) return 'completed';
  const snippetStatus = liveStatus(snippet?.liveBroadcastContent);
  if (snippetStatus === 'live' || snippetStatus === 'upcoming') return snippetStatus;
  if (snippetStatus === 'none') {
    return details?.actualStartTime || details?.scheduledStartTime ? 'completed' : 'none';
  }
  if (details?.actualStartTime) return details.concurrentViewers ? 'live' : 'completed';
  if (details?.scheduledStartTime) return 'upcoming';
  return 'none';
}

function kindFromSearch(item: SearchItem): YoutubeItemKind | null {
  const kind = item.id?.kind || '';
  if (kind.endsWith('#video') && item.id?.videoId) return 'video';
  if (kind.endsWith('#channel') && item.id?.channelId) return 'channel';
  if (kind.endsWith('#playlist') && item.id?.playlistId) return 'playlist';
  return null;
}

function idFromSearch(item: SearchItem, kind: YoutubeItemKind): string | null {
  if (kind === 'video') return item.id?.videoId || null;
  if (kind === 'channel') return item.id?.channelId || null;
  return item.id?.playlistId || null;
}

function itemFromSnippet(kind: YoutubeItemKind, id: string, snippet?: Snippet, extra: Partial<YoutubeItem> = {}): YoutubeItem {
  const title = text(snippet?.title, id);
  const channelTitle = text(snippet?.channelTitle, '');
  return {
    id,
    kind,
    title,
    subtitle: kind === 'video'
      ? (channelTitle || 'YouTube')
      : kind === 'channel'
        ? 'channel'
        : 'playlist',
    description: text(snippet?.description, '') || null,
    thumbnail: thumbnail(snippet),
    channel_id: snippet?.channelId || null,
    channel_title: channelTitle || null,
    published_at: snippet?.publishedAt || null,
    duration_sec: null,
    live_status: liveStatus(snippet?.liveBroadcastContent),
    playlist_id: null,
    category_id: snippet?.categoryId || null,
    default_language: snippet?.defaultLanguage || null,
    default_audio_language: snippet?.defaultAudioLanguage || null,
    tags: Array.isArray(snippet?.tags)
      ? [...new Set(snippet.tags.map((tag) => text(tag)).filter(Boolean))].slice(0, 64)
      : [],
    updated_at: Date.now(),
    ...extra,
  };
}

function isShortLike(item: YoutubeItem): boolean {
  if (item.kind !== 'video') return false;
  if (item.duration_sec !== null && item.duration_sec <= 180) return true;
  return /(^|\s)#shorts?\b/i.test(`${item.title} ${item.description || ''}`);
}

function nullableNumber(value: string | undefined): number | null {
  const parsed = Number(value || Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export class YoutubeApiClient {
  constructor(private readonly config: YoutubeConfig) {}

  private async request(
    path: string,
    params: Record<string, string | number | undefined>,
    token?: string,
    purpose: YoutubeApiPurpose = 'background',
    deadlineAt?: number,
  ): Promise<unknown> {
    let backgroundTimeoutMs = YOUTUBE_BACKGROUND_REQUEST_TIMEOUT_MS;
    if (purpose === 'background' && deadlineAt !== undefined) {
      const remainingMs = Math.floor(deadlineAt - Date.now());
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        throw new CatalogError(408, 'YouTube background request deadline exhausted');
      }
      backgroundTimeoutMs = Math.min(YOUTUBE_BACKGROUND_REQUEST_TIMEOUT_MS, remainingMs);
    }
    const searchCall = path === 'search';
    const quotaCost = 1;
    const decision = youtubeQuotaDecision(quotaCost, purpose, searchCall);
    if (!decision.allowed) {
      throw new CatalogError(429, decision.reason || 'YouTube quota unavailable');
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    if (!token) {
      url.searchParams.set('key', requireApiKey(this.config));
    }
    // YouTube charges attempted Data API requests even when they fail.
    incrementYoutubeQuota(quotaCost, searchCall);
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: purpose === 'background'
        ? AbortSignal.timeout(backgroundTimeoutMs)
        : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.error?.message === 'string'
        ? payload.error.message
        : `YouTube API ${response.status}`;
      throw new CatalogError(response.status >= 500 ? 502 : response.status, message);
    }
    return payload;
  }

  async search(query: string, options: YoutubeSearchOptions = {}): Promise<YoutubeSearchGroups> {
    return (await this.searchWithProviderRanks(query, options)).groups;
  }

  /**
   * Recommendation-only Search path. It keeps the provider's original result
   * positions across official-metadata enrichment and filtering, performs no
   * cache writes, and fails closed when enrichment cannot be completed.
   */
  async searchRecommendationVideos(
    query: string,
    options: YoutubeRecommendationSearchOptions = {},
  ): Promise<YoutubeRankedVideo[]> {
    return (await this.searchWithProviderRanks(query, {
      ...options,
      type: 'video',
      purpose: 'background',
      persist: false,
    })).ranked_videos;
  }

  private async searchWithProviderRanks(
    query: string,
    options: YoutubeSearchOptions,
  ): Promise<{ groups: YoutubeSearchGroups; ranked_videos: YoutubeRankedVideo[] }> {
    const type = options.eventType
      || options.publishedAfter
      || options.videoDuration
      || options.videoDefinition
      || options.topicId
      ? 'video'
      : options.type;
    const payload = await this.request('search', {
      part: 'snippet',
      q: query,
      maxResults: Math.min(options.limit ?? this.config.max_results, 50),
      regionCode: this.config.region_code,
      relevanceLanguage: this.config.relevance_language,
      safeSearch: options.safeSearch ?? 'none',
      type,
      eventType: options.eventType,
      channelId: options.channelId,
      order: options.order,
      publishedAfter: options.publishedAfter,
      videoDuration: options.videoDuration,
      videoDefinition: options.videoDefinition,
      topicId: options.topicId,
    }, undefined, options.purpose ?? 'background', options.deadline_at) as { items?: SearchItem[] };
    const rankedItems = (payload.items || [])
      .map((entry, sourceRank) => {
        const kind = kindFromSearch(entry);
        const id = kind ? idFromSearch(entry, kind) : null;
        return kind && id
          ? { item: itemFromSnippet(kind, id, entry.snippet), source_rank: sourceRank }
          : null;
      })
      .filter((entry): entry is { item: YoutubeItem; source_rank: number } => entry !== null);
    const items = rankedItems.map((entry) => entry.item);
    const videos = await this.enrichVideos(
      items.filter((entry) => entry.kind === 'video'),
      options.purpose ?? 'background',
      options.persist ?? true,
      options.deadline_at,
    );
    const filteredVideos = this.config.exclude_shorts
      ? videos.filter((item) => !isShortLike(item))
      : videos;
    const channels = items.filter((entry) => entry.kind === 'channel');
    const playlists = items.filter((entry) => entry.kind === 'playlist');
    if (options.persist ?? true) {
      upsertYoutubeItems([...filteredVideos, ...channels, ...playlists]);
    }
    const filteredVideoById = new Map(filteredVideos.map((item) => [item.id, item] as const));
    const seenRankedVideoIds = new Set<string>();
    return {
      groups: { videos: filteredVideos, channels, playlists },
      ranked_videos: rankedItems.flatMap(({ item, source_rank }) => {
        if (item.kind !== 'video' || seenRankedVideoIds.has(item.id)) return [];
        const enriched = filteredVideoById.get(item.id);
        if (!enriched) return [];
        seenRankedVideoIds.add(item.id);
        return [{ item: enriched, source_rank }];
      }),
    };
  }

  async videos(
    ids: string[],
    purpose: YoutubeApiPurpose = 'background',
    persist = true,
    deadlineAt?: number,
  ): Promise<YoutubeItem[]> {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 50);
    if (unique.length === 0) return [];
    const payload = await this.request('videos', {
      part: 'snippet,contentDetails,liveStreamingDetails',
      id: unique.join(','),
      regionCode: this.config.region_code,
    }, undefined, purpose, deadlineAt) as { items?: VideoItem[] };
    const items = (payload.items || []).map((entry) => {
      const id = entry.id || '';
      const duration = parseYoutubeDurationSec(entry.contentDetails?.duration);
      return itemFromSnippet('video', id, entry.snippet, {
        duration_sec: duration,
        live_status: videoLiveStatus(entry.snippet, entry.liveStreamingDetails),
        official_metadata_checked_at: Date.now(),
      });
    }).filter((entry) => entry.id);
    const filtered = this.config.exclude_shorts ? items.filter((item) => !isShortLike(item)) : items;
    if (persist) {
      upsertYoutubeItems(filtered);
    }
    return filtered;
  }

  async playlistItems(
    playlistId: string,
    limit = 25,
    token?: string,
    purpose: YoutubeApiPurpose = 'background',
    persist = true,
  ): Promise<YoutubeItem[]> {
    return (await this.playlistItemsWithProviderRanks(
      playlistId,
      limit,
      token,
      purpose,
      persist,
      undefined,
    )).map((entry) => entry.item);
  }

  /** Recommendation-only uploads path with exact playlist positions. */
  async playlistRecommendationVideos(
    playlistId: string,
    limit = 25,
    token?: string,
    options: { deadline_at?: number } = {},
  ): Promise<YoutubeRankedVideo[]> {
    return this.playlistItemsWithProviderRanks(
      playlistId,
      limit,
      token,
      'background',
      false,
      options.deadline_at,
    );
  }

  private async playlistItemsWithProviderRanks(
    playlistId: string,
    limit: number,
    token: string | undefined,
    purpose: YoutubeApiPurpose,
    persist: boolean,
    deadlineAt: number | undefined,
  ): Promise<YoutubeRankedVideo[]> {
    const rankedVideoIds: Array<{ id: string; source_rank: number }> = [];
    const collectedVideoIds = new Set<string>();
    let fallbackSourceRank = 0;
    let pageToken: string | undefined;
    while (rankedVideoIds.length < limit) {
      const payload = await this.request('playlistItems', {
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: Math.min(limit - rankedVideoIds.length, 50),
        pageToken,
      }, token, purpose, deadlineAt) as {
        items?: Array<{ snippet?: Snippet; contentDetails?: { videoId?: string } }>;
        nextPageToken?: string;
      };
      for (const entry of payload.items || []) {
        const providerPosition = entry.snippet?.position;
        const sourceRank = Number.isInteger(providerPosition) && providerPosition! >= 0
          ? providerPosition!
          : fallbackSourceRank;
        fallbackSourceRank += 1;
        const id = entry.contentDetails?.videoId || entry.snippet?.resourceId?.videoId || '';
        if (!id || collectedVideoIds.has(id)) continue;
        collectedVideoIds.add(id);
        rankedVideoIds.push({ id, source_rank: sourceRank });
        if (rankedVideoIds.length >= limit) break;
      }
      pageToken = payload.nextPageToken;
      if (!pageToken) {
        break;
      }
    }
    const boundedEntries = rankedVideoIds.slice(0, limit);
    const videos = await this.videos(
      boundedEntries.map((entry) => entry.id),
      purpose,
      persist,
      deadlineAt,
    );
    const byId = new Map(videos.map((item) => [item.id, item] as const));
    return boundedEntries.flatMap(({ id, source_rank }) => {
      const item = byId.get(id);
      return item ? [{ item, source_rank }] : [];
    });
  }

  async channelVideos(
    channelId: string,
    limit = 25,
    purpose: YoutubeApiPurpose = 'background',
    persist = true,
  ): Promise<YoutubeItem[]> {
    const groups = await this.search('', {
      channelId,
      limit,
      order: 'date',
      type: 'video',
      purpose,
      persist,
    });
    return groups.videos;
  }

  async subscriptions(token: string, limit = 25, order: YoutubeSubscriptionOrder = 'unread'): Promise<YoutubeItem[]> {
    const channels: YoutubeItem[] = [];
    let pageToken: string | undefined;
    while (channels.length < limit) {
      const payload = await this.request('subscriptions', {
        part: 'snippet',
        mine: 'true',
        maxResults: Math.min(limit - channels.length, 50),
        order,
        pageToken,
      }, token) as { items?: Array<{ snippet?: Snippet }>; nextPageToken?: string };
      channels.push(...(payload.items || [])
        .map((entry) => {
          const id = entry.snippet?.resourceId?.channelId || entry.snippet?.channelId || '';
          return id ? itemFromSnippet('channel', id, entry.snippet) : null;
        })
        .filter((entry): entry is YoutubeItem => entry !== null));
      pageToken = payload.nextPageToken;
      if (!pageToken) {
        break;
      }
    }
    upsertYoutubeItems(channels);
    return channels.slice(0, limit);
  }

  async channelUploadPlaylists(
    channelIds: string[],
    token?: string,
    persist = true,
    deadlineAt?: number,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const unique = [...new Set(channelIds.filter(Boolean))];
    for (let index = 0; index < unique.length; index += 50) {
      const chunk = unique.slice(index, index + 50);
      const payload = await this.request('channels', {
        part: 'snippet,contentDetails',
        id: chunk.join(','),
      }, token, 'background', deadlineAt) as { items?: ChannelItem[] };
      const channels = (payload.items || [])
        .map((entry) => {
          const id = entry.id || '';
          const uploads = entry.contentDetails?.relatedPlaylists?.uploads || '';
          return id && uploads
            ? { item: itemFromSnippet('channel', id, entry.snippet), uploads }
            : null;
        })
        .filter((entry): entry is { item: YoutubeItem; uploads: string } => entry !== null);
      if (persist) {
        upsertYoutubeItems(channels.map((entry) => entry.item));
      }
      for (const entry of channels) {
        result.set(entry.item.id, entry.uploads);
      }
    }
    return result;
  }

  async authorizedChannel(token: string): Promise<YoutubeAuthorizedChannel | null> {
    const payload = await this.request('channels', {
      part: 'snippet',
      mine: 'true',
      maxResults: 1,
    }, token) as { items?: ChannelItem[] };
    const channel = (payload.items || [])[0];
    const id = channel?.id || '';
    if (!id) return null;
    return {
      id,
      title: text(channel.snippet?.title, 'YouTube'),
      thumbnail: thumbnail(channel.snippet),
    };
  }

  async channelStats(channelIds: string[], token?: string): Promise<Map<string, YoutubeChannelStats>> {
    const result = new Map<string, YoutubeChannelStats>();
    const unique = [...new Set(channelIds.filter(Boolean))];
    for (let index = 0; index < unique.length; index += 50) {
      const chunk = unique.slice(index, index + 50);
      const payload = await this.request('channels', {
        part: 'snippet,statistics',
        id: chunk.join(','),
      }, token) as { items?: ChannelItem[] };
      const channels = (payload.items || [])
        .map((entry): { item: YoutubeItem; stats: YoutubeChannelStats } | null => {
          const id = entry.id || '';
          if (!id) return null;
          const stats = entry.statistics || {};
          const parsedStats: YoutubeChannelStats = {
            subscriber_count: stats.hiddenSubscriberCount ? null : nullableNumber(stats.subscriberCount),
            video_count: nullableNumber(stats.videoCount),
            view_count: nullableNumber(stats.viewCount),
            hidden_subscriber_count: Boolean(stats.hiddenSubscriberCount),
          };
          return {
            item: itemFromSnippet('channel', id, entry.snippet),
            stats: parsedStats,
          };
        })
        .filter((entry): entry is { item: YoutubeItem; stats: YoutubeChannelStats } => entry !== null);
      upsertYoutubeItems(channels.map((entry) => entry.item));
      for (const entry of channels) {
        result.set(entry.item.id, entry.stats);
      }
    }
    return result;
  }

  private async enrichVideos(
    videos: YoutubeItem[],
    purpose: YoutubeApiPurpose,
    persist: boolean,
    deadlineAt?: number,
  ): Promise<YoutubeItem[]> {
    const ids = videos.map((item) => item.id);
    if (ids.length === 0) return [];
    let enriched: YoutubeItem[];
    try {
      enriched = await this.videos(ids, purpose, persist, deadlineAt);
    } catch (error) {
      // Interactive search remains useful with snippet metadata during a
      // transient videos.list failure. Recommendation acquisition cannot score
      // or persist an unverified tail, so it must surface the failure instead.
      if (!persist) throw error;
      enriched = [];
    }
    // Background recommendation candidates must have official metadata before
    // they can enter a quality-gated pool. Interactive search can still show
    // snippet-only results when enrichment is temporarily unavailable.
    if (enriched.length === 0) return persist ? videos : [];
    const byId = new Map(enriched.map((item) => [item.id, item]));
    return persist
      ? videos.map((item) => byId.get(item.id) || item)
      : videos.flatMap((item) => {
          const official = byId.get(item.id);
          return official ? [official] : [];
        });
  }
}
