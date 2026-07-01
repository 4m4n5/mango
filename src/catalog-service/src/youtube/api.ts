import { CatalogError } from '../catalog-errors.js';
import { incrementYoutubeQuota, upsertYoutubeItems } from './db.js';
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

function requireApiKey(config: YoutubeConfig): string {
  if (!config.api_key) {
    throw new CatalogError(503, 'YouTube API key is not configured');
  }
  return config.api_key;
}

function thumbnail(snippet?: Snippet): string | null {
  const thumbs = snippet?.thumbnails || {};
  return thumbs.maxres?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null;
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
    updated_at: Date.now(),
    ...extra,
  };
}

function isShortLike(item: YoutubeItem): boolean {
  if (item.kind !== 'video') return false;
  if (item.duration_sec !== null && item.duration_sec <= 60) return true;
  return /(^|\s)#shorts?\b/i.test(`${item.title} ${item.description || ''}`);
}

function nullableNumber(value: string | undefined): number | null {
  const parsed = Number(value || Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export class YoutubeApiClient {
  constructor(private readonly config: YoutubeConfig) {}

  private async request(path: string, params: Record<string, string | number | undefined>, token?: string): Promise<unknown> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    if (!token) {
      url.searchParams.set('key', requireApiKey(this.config));
    }
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    incrementYoutubeQuota(path === 'search' ? 1 : 1);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.error?.message === 'string'
        ? payload.error.message
        : `YouTube API ${response.status}`;
      throw new CatalogError(response.status >= 500 ? 502 : response.status, message);
    }
    return payload;
  }

  async search(query: string, options: {
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
  } = {}): Promise<YoutubeSearchGroups> {
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
    }) as { items?: SearchItem[] };
    const items = (payload.items || [])
      .map((entry) => {
        const kind = kindFromSearch(entry);
        const id = kind ? idFromSearch(entry, kind) : null;
        return kind && id ? itemFromSnippet(kind, id, entry.snippet) : null;
      })
      .filter((entry): entry is YoutubeItem => entry !== null);
    const videos = await this.enrichVideos(items.filter((entry) => entry.kind === 'video'));
    const filteredVideos = this.config.exclude_shorts
      ? videos.filter((item) => !isShortLike(item))
      : videos;
    const channels = items.filter((entry) => entry.kind === 'channel');
    const playlists = items.filter((entry) => entry.kind === 'playlist');
    upsertYoutubeItems([...filteredVideos, ...channels, ...playlists]);
    return { videos: filteredVideos, channels, playlists };
  }

  async videos(ids: string[]): Promise<YoutubeItem[]> {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 50);
    if (unique.length === 0) return [];
    const payload = await this.request('videos', {
      part: 'snippet,contentDetails,liveStreamingDetails',
      id: unique.join(','),
      regionCode: this.config.region_code,
    }) as { items?: VideoItem[] };
    const items = (payload.items || []).map((entry) => {
      const id = entry.id || '';
      const duration = parseYoutubeDurationSec(entry.contentDetails?.duration);
      return itemFromSnippet('video', id, entry.snippet, {
        duration_sec: duration,
        live_status: videoLiveStatus(entry.snippet, entry.liveStreamingDetails),
      });
    }).filter((entry) => entry.id);
    const filtered = this.config.exclude_shorts ? items.filter((item) => !isShortLike(item)) : items;
    upsertYoutubeItems(filtered);
    return filtered;
  }

  async popular(limit = 25, options: {
    regionCode?: string;
    videoCategoryId?: string;
  } = {}): Promise<YoutubeItem[]> {
    const payload = await this.request('videos', {
      part: 'snippet,contentDetails,liveStreamingDetails',
      chart: 'mostPopular',
      maxResults: Math.min(limit, 50),
      regionCode: options.regionCode || this.config.region_code,
      videoCategoryId: options.videoCategoryId,
    }) as { items?: VideoItem[] };
    const items = (payload.items || []).map((entry) => itemFromSnippet('video', entry.id || '', entry.snippet, {
      duration_sec: parseYoutubeDurationSec(entry.contentDetails?.duration),
      live_status: videoLiveStatus(entry.snippet, entry.liveStreamingDetails),
    })).filter((entry) => entry.id);
    const filtered = this.config.exclude_shorts ? items.filter((item) => !isShortLike(item)) : items;
    upsertYoutubeItems(filtered);
    return filtered;
  }

  async playlistItems(playlistId: string, limit = 25, token?: string): Promise<YoutubeItem[]> {
    const videoIds: string[] = [];
    let pageToken: string | undefined;
    while (videoIds.length < limit) {
      const payload = await this.request('playlistItems', {
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: Math.min(limit - videoIds.length, 50),
        pageToken,
      }, token) as {
        items?: Array<{ snippet?: Snippet; contentDetails?: { videoId?: string } }>;
        nextPageToken?: string;
      };
      videoIds.push(...(payload.items || [])
        .map((entry) => entry.contentDetails?.videoId || entry.snippet?.resourceId?.videoId || '')
        .filter(Boolean));
      pageToken = payload.nextPageToken;
      if (!pageToken) {
        break;
      }
    }
    return this.videos(videoIds.slice(0, limit));
  }

  async channelVideos(channelId: string, limit = 25): Promise<YoutubeItem[]> {
    const groups = await this.search('', {
      channelId,
      limit,
      order: 'date',
      type: 'video',
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

  async channelUploadPlaylists(channelIds: string[], token?: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const unique = [...new Set(channelIds.filter(Boolean))];
    for (let index = 0; index < unique.length; index += 50) {
      const chunk = unique.slice(index, index + 50);
      const payload = await this.request('channels', {
        part: 'snippet,contentDetails',
        id: chunk.join(','),
      }, token) as { items?: ChannelItem[] };
      const channels = (payload.items || [])
        .map((entry) => {
          const id = entry.id || '';
          const uploads = entry.contentDetails?.relatedPlaylists?.uploads || '';
          return id && uploads
            ? { item: itemFromSnippet('channel', id, entry.snippet), uploads }
            : null;
        })
        .filter((entry): entry is { item: YoutubeItem; uploads: string } => entry !== null);
      upsertYoutubeItems(channels.map((entry) => entry.item));
      for (const entry of channels) {
        result.set(entry.item.id, entry.uploads);
      }
    }
    return result;
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

  private async enrichVideos(videos: YoutubeItem[]): Promise<YoutubeItem[]> {
    const ids = videos.map((item) => item.id);
    if (ids.length === 0) return [];
    const enriched = await this.videos(ids).catch(() => []);
    if (enriched.length === 0) return videos;
    const byId = new Map(enriched.map((item) => [item.id, item]));
    return videos.map((item) => byId.get(item.id) || item);
  }
}
