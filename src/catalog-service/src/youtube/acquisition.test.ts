import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetLibraryDbForTests } from '../library/db.js';
import {
  getYoutubeItem,
  getYoutubeState,
  listYoutubeV2CandidateProvenance,
  resetYoutubeDbForTests,
  setYoutubeState,
  upsertYoutubeItems,
  upsertYoutubeV2ImportedHistory,
  youtubeRefreshStatus,
} from './db.js';
import {
  YoutubeApiClient,
  YOUTUBE_BACKGROUND_REQUEST_TIMEOUT_MS,
} from './api.js';
import type { YoutubeConfig } from './config.js';
import {
  YoutubeService,
  YOUTUBE_V2_ACQUISITION_WALL_MS,
  YOUTUBE_V2_LOW_YIELD_STOP_COUNT,
  youtubeV2AcquisitionQueryBudget,
  youtubeV2SubscriptionRefreshPolicy,
} from './service.js';
import type { YoutubeItem } from './types.js';

function rankedVideos(items: YoutubeItem[]) {
  return items.map((item, source_rank) => ({ item, source_rank }));
}

function testConfig(dbPath: string): YoutubeConfig {
  return {
    enabled: true,
    db_path: dbPath,
    api_key: 'test-key',
    api_key_file: '/missing',
    oauth_client_file: '/missing',
    auth_token_file: '/missing',
    region_code: 'US',
    relevance_language: 'en',
    max_results: 25,
    exclude_shorts: true,
    stale_after_ms: 24 * 60 * 60 * 1000,
    yt_dlp_command: 'yt-dlp',
    yt_dlp_format: 'best',
    yt_dlp_cookies: null,
    yt_dlp_cookies_from_browser: null,
  };
}

function video(id: string, title: string, channelId: string): YoutubeItem {
  return {
    id,
    kind: 'video',
    title,
    subtitle: `Channel ${channelId}`,
    description: `${title} documentary analysis`,
    thumbnail: `https://img.example/${id}.jpg`,
    channel_id: channelId,
    channel_title: `Channel ${channelId}`,
    published_at: '2026-08-01T00:00:00Z',
    duration_sec: 1_200,
    live_status: 'none',
    playlist_id: null,
    official_metadata_checked_at: Date.now(),
    updated_at: Date.now(),
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function withTempState<T>(fn: (config: YoutubeConfig) => T | Promise<T>): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-acquisition-'));
  const originalFetch = globalThis.fetch;
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const config = testConfig(process.env.MANGO_YOUTUBE_DB_PATH);
  const cleanup = () => {
    globalThis.fetch = originalFetch;
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_YOUTUBE_API_KEY;
    delete process.env.MANGO_YOUTUBE_RECS_V2;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn(config);
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('adaptive discovery budget preserves couch Search and separates OAuth from explicit full refresh', () => {
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('meaningful_watch', 75), {
    more_like: 10, beyond: 2, total: 12,
  });
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('oauth_connected', 75), {
    more_like: 10, beyond: 2, total: 12,
  });
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('nightly', 75, 8), {
    more_like: 10, beyond: 57, total: 67,
  });
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('subscription_full_refresh', 75), {
    more_like: 10, beyond: 65, total: 75,
  });
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('nightly', 6, 4), {
    more_like: 2, beyond: 0, total: 2,
  });
});

test('subscription refresh policy keeps ordinary work bounded and deepens only nightly or explicit coverage', () => {
  assert.deepEqual(youtubeV2SubscriptionRefreshPolicy('triggered', 140), {
    full_coverage: false, channel_cap: 24, videos_per_channel: 8, depth: 'bounded',
  });
  assert.deepEqual(youtubeV2SubscriptionRefreshPolicy('nightly', 140), {
    full_coverage: false, channel_cap: 96, videos_per_channel: 24, depth: 'deep',
  });
  assert.deepEqual(youtubeV2SubscriptionRefreshPolicy('oauth_connected', 140), {
    full_coverage: true, channel_cap: 140, videos_per_channel: 24, depth: 'full',
  });
});

test('nightly subscription acquisition rotates 96 authoritative channels and requests 24 uploads each', () => withTempState(async (config) => {
  const channels = Array.from({ length: 100 }, (_, index): YoutubeItem => ({
    ...video(`subscription-${index}`, `Subscription ${index}`, `subscription-${index}`),
    kind: 'channel',
  }));
  const service = new YoutubeService(config);
  const queriedBatches: string[][] = [];
  const playlistLimits: number[] = [];
  const api = (service as unknown as { api: {
    subscriptions: () => Promise<YoutubeItem[]>;
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    channelUploadPlaylists: (
      ids: string[], token?: string, persist?: boolean,
    ) => Promise<Map<string, string>>;
    playlistRecommendationVideos: (
      id: string, limit?: number, token?: string, options?: { deadline_at?: number },
    ) => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.subscriptions = async () => channels;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.channelUploadPlaylists = async (ids, _token, persist) => {
    assert.equal(persist, false);
    queriedBatches.push([...ids]);
    return new Map(ids.map((id) => [id, `uploads-${id}`]));
  };
  api.playlistRecommendationVideos = async (_id, limit) => {
    playlistLimits.push(limit ?? 0);
    return [];
  };

  const refreshSubscriptions = (service as unknown as {
    refreshSubscriptionsFromApi: (token: string, reason: string) => Promise<void>;
  }).refreshSubscriptionsFromApi.bind(service);
  await refreshSubscriptions('token', 'nightly');
  const firstChannels = new Set(queriedBatches.flat());
  assert.equal(firstChannels.size, 96);
  assert.equal(playlistLimits.length, 96);
  assert.ok(playlistLimits.every((limit) => limit === 24));
  const firstState = getYoutubeState<{
    channels_queried: number;
    coverage_complete: boolean;
    coverage_remaining: number;
    refresh_depth: string;
  }>('youtube_v2_subscription_acquisition', {
    channels_queried: 0,
    coverage_complete: false,
    coverage_remaining: 0,
    refresh_depth: '',
  });
  assert.deepEqual(firstState, {
    ...firstState,
    channels_queried: 96,
    coverage_complete: false,
    coverage_remaining: 4,
    refresh_depth: 'deep',
  });

  queriedBatches.length = 0;
  playlistLimits.length = 0;
  await refreshSubscriptions('token', 'nightly');
  const secondChannels = new Set(queriedBatches.flat());
  assert.equal(secondChannels.size, 96);
  assert.equal([...secondChannels].some((id) => !firstChannels.has(id)), true);
  assert.equal(getYoutubeState<{ coverage_complete: boolean }>(
    'youtube_v2_subscription_acquisition',
    { coverage_complete: false },
  ).coverage_complete, true);
}));

test('subscription acquisition persists only quality-eligible provider positions', () => withTempState(async (config) => {
  const channel = {
    ...video('quality-sub', 'Quality subscription', 'quality-sub'),
    kind: 'channel' as const,
  };
  const recent = video('quality-sub-recent', 'Recent direct upload', 'quality-sub');
  const weakTail = {
    ...video('quality-sub-weak-tail', 'Old direct upload tail', 'quality-sub'),
    published_at: '2020-01-01T00:00:00Z',
  };
  const service = new YoutubeService(config);
  const api = (service as unknown as { api: {
    subscriptions: () => Promise<YoutubeItem[]>;
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    playlistRecommendationVideos: () => Promise<Array<{ item: YoutubeItem; source_rank: number }>>;
  } }).api;
  api.subscriptions = async () => [channel];
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.channelUploadPlaylists = async () => new Map([[channel.id, 'quality-uploads']]);
  api.playlistRecommendationVideos = async () => [
    { item: recent, source_rank: 0 },
    { item: weakTail, source_rank: 49 },
  ];

  await (service as unknown as {
    refreshSubscriptionsFromApi: (token: string, reason: string) => Promise<void>;
  }).refreshSubscriptionsFromApi('token', 'triggered');

  const provenance = listYoutubeV2CandidateProvenance();
  assert.deepEqual(provenance.map((row) => [row.item.id, row.source_rank]), [[recent.id, 0]]);
  assert.ok(getYoutubeItem('video', recent.id));
  assert.equal(getYoutubeItem('video', weakTail.id), null);
  const state = getYoutubeState<{
    candidates_acquired: number;
    candidates_quality_rejected: number;
  }>('youtube_v2_subscription_acquisition', {
    candidates_acquired: 0,
    candidates_quality_rejected: 0,
  });
  assert.deepEqual(state, {
    ...state,
    candidates_acquired: 1,
    candidates_quality_rejected: 1,
  });
}));

test('background API discovery uses an eight-second deadline and persists no unaccepted tail', () => withTempState(async (config) => {
  const calls: Array<{ url: URL; signal: AbortSignal | null | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, signal: init?.signal });
    if (url.pathname.endsWith('/search')) {
      return jsonResponse({
        items: ['official', 'missing'].map((id) => ({
          id: { kind: 'youtube#video', videoId: id },
          snippet: {
            title: `${id} science documentary`,
            channelId: `channel-${id}`,
            channelTitle: `Channel ${id}`,
          },
        })),
      });
    }
    return jsonResponse({
      items: [{
        id: 'official',
        snippet: {
          title: 'official science documentary',
          channelId: 'channel-official',
          channelTitle: 'Channel official',
        },
        contentDetails: { duration: 'PT20M' },
      }],
    });
  }) as typeof fetch;

  const groups = await new YoutubeApiClient(config).search('science documentary', {
    limit: 50,
    type: 'video',
    purpose: 'background',
    persist: false,
  });
  assert.equal(YOUTUBE_BACKGROUND_REQUEST_TIMEOUT_MS, 8_000);
  assert.deepEqual(groups.videos.map((item) => item.id), ['official']);
  assert.equal(calls[0]?.url.searchParams.get('maxResults'), '50');
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
  assert.equal(getYoutubeItem('video', 'official'), null);
  assert.equal(getYoutubeItem('video', 'missing'), null);
}));

test('acquisition records relation and source-rank evidence, rejects weak tails, and stops after eight low-yield calls', () => withTempState(async (config) => {
  const now = Date.now();
  const seeds = [
    video('seed-alpha', 'Fermentation science alpha craft', 'seed-channel-alpha'),
    video('seed-beta', 'Fermentation science beta craft', 'seed-channel-beta'),
  ];
  upsertYoutubeItems(seeds);
  upsertYoutubeV2ImportedHistory(seeds.map((item, index) => ({
    video_id: item.id,
    title: item.title,
    title_url: null,
    channel_id: item.channel_id,
    channel_title: item.channel_title,
    watched_at: now - index * 1_000,
  })), { source_generation: 'acquisition-test-history', imported_at: now });

  const service = new YoutubeService(config);
  const optionsSeen: Array<Record<string, unknown>> = [];
  let call = 0;
  const api = (service as unknown as { api: {
    searchRecommendationVideos: (
      query: string, options: Record<string, unknown>,
    ) => Promise<ReturnType<typeof rankedVideos>>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
  } }).api;
  api.channelUploadPlaylists = async () => new Map();
  api.searchRecommendationVideos = async (query, options) => {
    optionsSeen.push(options);
    const current = call++;
    return rankedVideos([
        video(`accepted-${current}`, `${query} documentary analysis`, `new-channel-${current}`),
        video(`rejected-${current}`, `SSC exam result ${query}`, `noise-channel-${current}`),
      ]);
  };

  await (service as unknown as {
    refreshV2HistoryCandidatesFromApi: (reason: string) => Promise<void>;
  }).refreshV2HistoryCandidatesFromApi('triggered');

  const acquisition = getYoutubeState<{
    search_calls_attempted: number;
    stop_reason: string;
    candidates_acquired: number;
  }>('youtube_v2_history_acquisition', {
    search_calls_attempted: 0,
    stop_reason: '',
    candidates_acquired: 0,
  });
  assert.equal(acquisition.search_calls_attempted, YOUTUBE_V2_LOW_YIELD_STOP_COUNT);
  assert.equal(acquisition.stop_reason, 'low_yield');
  assert.equal(optionsSeen.length, YOUTUBE_V2_LOW_YIELD_STOP_COUNT - 1);
  assert.equal(acquisition.candidates_acquired, optionsSeen.length);
  assert.ok(optionsSeen.every((options) => (
    options.limit === 50 && typeof options.deadline_at === 'number'
  )));
  const provenance = listYoutubeV2CandidateProvenance();
  assert.equal(provenance.length, optionsSeen.length);
  assert.ok(provenance.every((row) => (
    row.relation_type === 'same_topic' && row.source_rank === 0
  )));
  assert.ok(getYoutubeItem('video', 'accepted-0'));
  assert.equal(getYoutubeItem('video', 'rejected-0'), null);
}));

test('exact-channel fallback shares the discovery budget and preserves the 25-call couch reserve', () => withTempState(async (config) => {
  const now = Date.now();
  const seed = video('budget-seed', 'Ceramic glaze studio craft', 'budget-seed-channel');
  upsertYoutubeItems([seed]);
  upsertYoutubeV2ImportedHistory([{
    video_id: seed.id,
    title: seed.title,
    title_url: null,
    channel_id: seed.channel_id,
    channel_title: seed.channel_title,
    watched_at: now,
  }], { source_generation: 'budget-history', imported_at: now });
  const quota = youtubeRefreshStatus();
  setYoutubeState('quota', {
    day: quota.quota_reset_day,
    units: 0,
    search_calls: quota.search_call_budget - quota.interactive_search_call_reserve - 1,
    api_calls: 0,
    accounting_version: 2,
  });

  const service = new YoutubeService(config);
  let topicCalls = 0;
  let exactPlaylistLookups = 0;
  const api = (service as unknown as { api: {
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
  } }).api;
  api.searchRecommendationVideos = async () => { topicCalls += 1; return []; };
  api.channelUploadPlaylists = async () => {
    exactPlaylistLookups += 1;
    return new Map([[seed.channel_id!, 'budget-uploads']]);
  };

  await (service as unknown as {
    refreshV2HistoryCandidatesFromApi: (reason: string) => Promise<void>;
  }).refreshV2HistoryCandidatesFromApi('triggered-budget-edge');

  assert.equal(topicCalls, 1);
  assert.equal(exactPlaylistLookups, 0);
  const acquisition = getYoutubeState<{
    queries_attempted: number;
    search_calls_attempted: number;
    stop_reason: string;
    query_budget: { total: number };
  }>('youtube_v2_history_acquisition', {
    queries_attempted: 0, search_calls_attempted: 0, stop_reason: '', query_budget: { total: 0 },
  });
  assert.equal(acquisition.query_budget.total, 1);
  assert.equal(acquisition.queries_attempted, 1);
  assert.equal(acquisition.search_calls_attempted, 1);
  assert.equal(acquisition.stop_reason, 'search_budget');
}));

test('quality-rejected rank tails and 61-180 second Shorts never enter recommendation storage', () => withTempState(async (config) => {
  const now = Date.now();
  const seed = {
    ...video('old-quality-seed', 'ceramic kiln glaze firing studio craft', 'old-seed-channel'),
    channel_title: 'Seed Studio',
    category_id: '27',
  };
  upsertYoutubeItems([seed]);
  upsertYoutubeV2ImportedHistory([{
    video_id: seed.id,
    title: seed.title,
    title_url: null,
    channel_id: seed.channel_id,
    channel_title: seed.channel_title,
    watched_at: now - 10 * 365 * 24 * 60 * 60 * 1_000,
  }], { source_generation: 'old-quality-history', imported_at: now });
  const weak = {
    ...video('weak-rank-49-tail', 'craft travel diary', 'weak-tail-channel'),
    description: 'craft travel diary',
    channel_title: 'Travel Maker',
    category_id: '27',
  };
  const threeMinuteShort = {
    ...video('three-minute-short', 'ceramic kiln short lesson', 'short-channel'),
    duration_sec: 120,
    category_id: '27',
  };
  const service = new YoutubeService(config);
  const api = (service as unknown as { api: {
    searchRecommendationVideos: () => Promise<Array<{ item: YoutubeItem; source_rank: number }>>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
  } }).api;
  api.channelUploadPlaylists = async () => new Map();
  api.searchRecommendationVideos = async () => [
    { item: threeMinuteShort, source_rank: 0 },
    { item: weak, source_rank: 49 },
  ];

  await (service as unknown as {
    refreshV2HistoryCandidatesFromApi: (reason: string) => Promise<void>;
  }).refreshV2HistoryCandidatesFromApi('triggered-quality-tail');

  assert.deepEqual(listYoutubeV2CandidateProvenance().map((row) => ({
    id: row.item.id,
    relation_type: row.relation_type,
    source_rank: row.source_rank,
    provenance_ref: row.provenance_ref,
  })), []);
  assert.equal(getYoutubeItem('video', weak.id), null);
  assert.equal(getYoutubeItem('video', threeMinuteShort.id), null);
  const state = getYoutubeState<{
    funnels: Array<{ quality_rejected: number; shorts_rejected: number; persisted: number }>;
  }>('youtube_v2_history_acquisition', { funnels: [] });
  assert.ok(state.funnels.some((funnel) => funnel.quality_rejected > 0));
  assert.ok(state.funnels.some((funnel) => funnel.shorts_rejected > 0));
  assert.ok(state.funnels.every((funnel) => funnel.persisted === 0));
}));

test('the 90-second wall stops normally, discards the late response, and keeps prior eligible work', () => withTempState(async (config) => {
  const realNow = Date.now;
  let clock = Date.UTC(2026, 7, 11, 12);
  const seed = video('wall-seed', 'documentary history craft seed', 'wall-seed-channel');
  upsertYoutubeItems([seed]);
  upsertYoutubeV2ImportedHistory([{
    video_id: seed.id,
    title: seed.title,
    title_url: null,
    channel_id: seed.channel_id,
    channel_title: seed.channel_title,
    watched_at: clock,
  }], { source_generation: 'wall-history', imported_at: clock });
  const service = new YoutubeService(config);
  let calls = 0;
  let observedDeadline = 0;
  const api = (service as unknown as { api: {
    searchRecommendationVideos: (
      query: string, options: { deadline_at?: number },
    ) => Promise<Array<{ item: YoutubeItem; source_rank: number }>>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
  } }).api;
  api.channelUploadPlaylists = async () => new Map();
  api.searchRecommendationVideos = async (query, options) => {
    calls += 1;
    observedDeadline = options.deadline_at ?? 0;
    if (calls === 1) {
      clock += 1_000;
      return rankedVideos(Array.from({ length: 4 }, (_, index) => video(
        `before-wall-${index}`,
        `${query} documentary history craft before wall ${index}`,
        `before-wall-channel-${index}`,
      )));
    }
    clock = Date.UTC(2026, 7, 11, 12) + YOUTUBE_V2_ACQUISITION_WALL_MS;
    return rankedVideos([video('after-wall', 'documentary history craft after wall', 'new-channel')]);
  };
  Date.now = () => clock;
  try {
    await (service as unknown as {
      refreshV2HistoryCandidatesFromApi: (reason: string) => Promise<void>;
    }).refreshV2HistoryCandidatesFromApi('triggered-wall');
  } finally {
    Date.now = realNow;
  }
  assert.equal(calls, 2);
  assert.equal(observedDeadline, Date.UTC(2026, 7, 11, 12) + YOUTUBE_V2_ACQUISITION_WALL_MS);
  assert.equal(getYoutubeItem('video', 'after-wall'), null);
  assert.deepEqual(
    new Set(listYoutubeV2CandidateProvenance().map((row) => row.item.id)),
    new Set(Array.from({ length: 4 }, (_, index) => `before-wall-${index}`)),
  );
  const state = getYoutubeState<{
    stop_reason: string;
    query_failures: number;
    candidates_acquired: number;
  }>('youtube_v2_history_acquisition', {
    stop_reason: '', query_failures: -1, candidates_acquired: 0,
  });
  assert.equal(state.stop_reason, 'wall_limit');
  assert.equal(state.query_failures, 0);
  assert.equal(state.candidates_acquired, 4);
}));
