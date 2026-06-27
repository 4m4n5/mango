import { CatalogError } from '../catalog-errors.js';
import { playUrl } from '../mpv.js';
import { bumpPlayEpoch } from '../play-cancel.js';
import { startWatchSessionFromPlay } from '../progress/watcher.js';
import {
  getLibraryState,
  listLibraryFeedback,
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
  initYoutubeDb,
  listYoutubeItems,
  listYoutubeRailItems,
  replaceYoutubeRailItems,
  searchCachedYoutubeItems,
  setYoutubeState,
  upsertYoutubeItems,
  youtubeCacheSummary,
  youtubeRefreshStatus,
} from './db.js';
import { resolveYoutubePlayback } from './playback.js';
import type { YoutubeItem, YoutubeItemKind, YoutubeRail, YoutubeRailItem, YoutubeSearchGroups } from './types.js';

const YOUTUBE_SOURCE = 'youtube';
const YOUTUBE_TAB = 'youtube';
const YOUTUBE_VIDEO_TYPE = 'youtube_video';

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

const FRESH_FIND_QUERIES = [
  'documentary essay',
  'technology deep dive',
  'travel food culture',
  'live music performance',
];

type RefreshResult = {
  ok: boolean;
  refresh: ReturnType<typeof youtubeRefreshStatus>;
  error?: string;
};

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

function recencyScore(item: YoutubeItem): number {
  const published = item.published_at ? Date.parse(item.published_at) : item.updated_at;
  if (!Number.isFinite(published)) {
    return 0;
  }
  const ageDays = Math.max(0, (nowMs() - published) / 86_400_000);
  return Math.max(0, 1 - ageDays / 180);
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

function cachedRail(railId: string, limit = 40): YoutubeRail {
  const refresh = youtubeRefreshStatus();
  const items = filterNotInterested(listYoutubeRailItems(railId, limit));
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

function savedRail(limit = 40): YoutubeRail {
  const saved = listSavedLibraryItems(YOUTUBE_TAB, limit)
    .filter((item) => item.source === YOUTUBE_SOURCE && item.type === YOUTUBE_VIDEO_TYPE)
    .map((item) => libraryItemToYoutube(item))
    .filter((item): item is YoutubeRailItem => item !== null);
  return {
    rail_id: 'saved',
    label: RAIL_LABELS.saved,
    items: filterNotInterested(saved),
    cached: saved.length > 0,
    stale: false,
  };
}

function historyRail(limit = 40): YoutubeRail {
  const seen = new Set<string>();
  const items = listWatchHistory(limit * 3)
    .filter((item) => item.source === YOUTUBE_SOURCE && item.type === YOUTUBE_VIDEO_TYPE)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, limit)
    .map((item) => libraryItemToYoutube(item))
    .filter((item): item is YoutubeRailItem => item !== null);
  return {
    rail_id: 'history',
    label: RAIL_LABELS.history,
    items: filterNotInterested(items),
    cached: items.length > 0,
    stale: false,
  };
}

function rankForYou(limit = 40): YoutubeItem[] {
  const blocked = notInterestedIds();
  const history = listWatchHistory(200).filter((row) => row.source === YOUTUBE_SOURCE);
  const channelWeights = new Map<string, number>();
  for (const row of history) {
    const cached = getYoutubeItem('video', row.id);
    const channel = cached?.channel_id || cached?.channel_title;
    if (channel) {
      channelWeights.set(channel, (channelWeights.get(channel) ?? 0) + 1);
    }
  }
  return listYoutubeItems('video', 300)
    .filter((item) => !blocked.has(item.id))
    .filter((item) => !isLiveVideo(item))
    .map((item) => {
      const channel = item.channel_id || item.channel_title || '';
      const affinity = channel ? (channelWeights.get(channel) ?? 0) : 0;
      return {
        item,
        score: recencyScore(item) + Math.min(2, affinity * 0.35),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
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
    try {
      const popular = await this.api.popular(36);
      replaceYoutubeRailItems('popular', popular.map((item, index) => ({
        item,
        score: 1 - index * 0.01,
        reason: 'trending fallback',
      })));

      const freshGroups = await Promise.all(
        FRESH_FIND_QUERIES.map((query) => this.api.search(query, { limit: 10 }).catch(() => ({
          videos: [],
          channels: [],
          playlists: [],
        }))),
      );
      const fresh = uniqueVideos(freshGroups.flatMap((group) => group.videos));
      replaceYoutubeRailItems('fresh_finds', fresh.map((item, index) => ({
        item,
        score: 1 - index * 0.01,
        reason: 'fresh broad discovery',
      })));

      const liveGroups = await this.api.search('news|music|gaming', { limit: 25, eventType: 'live' })
        .catch(() => ({ videos: [], channels: [], playlists: [] }));
      replaceYoutubeRailItems('live_now', liveGroups.videos.map((item, index) => ({
        item,
        score: 1 - index * 0.01,
        reason: 'live now',
      })));

      const recentHistory = listWatchHistory(20)
        .filter((row) => row.source === YOUTUBE_SOURCE && row.type === YOUTUBE_VIDEO_TYPE);
      const watchedQueries = recentHistory
        .map((row) => getYoutubeItem('video', row.id)?.channel_title || row.title || '')
        .filter(Boolean)
        .slice(0, 4);
      const watchedGroups = await Promise.all(
        watchedQueries.map((query) => this.api.search(query, { limit: 8 }).catch(() => ({
          videos: [],
          channels: [],
          playlists: [],
        }))),
      );
      const becauseWatched = nonLiveVideos(uniqueVideos(watchedGroups.flatMap((group) => group.videos)));
      replaceYoutubeRailItems('because_you_watched', becauseWatched.map((item, index) => ({
        item,
        score: 1 - index * 0.01,
        reason: 'based on watch history',
      })));

      const token = await youtubeAccessToken(this.config).catch(() => null);
      if (token) {
        const subscriptions = await this.api.subscriptions(token, 20).catch(() => []);
        const subscriptionVideos = (
          await Promise.all(subscriptions.slice(0, 8).map((channel) => (
            this.api.channelVideos(channel.id, 5).catch(() => [])
          )))
        ).flat();
        replaceYoutubeRailItems('new_from_subscriptions', uniqueVideos(subscriptionVideos).map((item, index) => ({
          item,
          score: 1 - index * 0.01,
          reason: 'subscription upload',
        })));
      }

      const forYou = rankForYou(40);
      replaceYoutubeRailItems('for_you', forYou.map((item, index) => ({
        item,
        score: 1 - index * 0.01,
        reason: 'local Mango ranker',
      })));

      setYoutubeState('last_success_at', nowMs());
      setYoutubeState('last_error', null);
      return { ok: true, refresh: youtubeRefreshStatus() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setYoutubeState('last_error', message);
      return { ok: false, error: message, refresh: youtubeRefreshStatus() };
    }
  }

  async rails(): Promise<Record<string, unknown>> {
    const cache = youtubeCacheSummary();
    if (this.config.enabled && this.config.api_key && cache.videos === 0) {
      await this.refresh('first_run').catch(() => undefined);
    }
    const forYouItems = rankForYou(40);
    if (forYouItems.length > 0) {
      replaceYoutubeRailItems('for_you', forYouItems.map((item, index) => ({
        item,
        score: 1 - index * 0.01,
        reason: 'local Mango ranker',
      })));
    }
    const rails: YoutubeRail[] = [
      savedRail(),
      historyRail(),
      cachedRail('for_you'),
      cachedRail('new_from_subscriptions'),
      cachedRail('fresh_finds'),
      cachedRail('because_you_watched'),
      cachedRail('live_now'),
      cachedRail('popular'),
    ].filter((rail) => rail.items.length > 0 || rail.rail_id === 'fresh_finds' || rail.rail_id === 'popular');
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
    const groups = this.config.api_key
      ? await this.api.search(normalized, { limit: Math.max(1, Math.min(50, limit)) })
      : groupCachedSearch(normalized, Math.max(1, Math.min(50, limit)));
    return {
      ok: true,
      query: normalized,
      groups,
      refresh: youtubeRefreshStatus(),
      cached_only: !this.config.api_key,
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
