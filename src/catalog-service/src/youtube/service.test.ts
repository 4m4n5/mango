import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activateViewerProfile,
  createViewerProfile,
  listSavedLibraryItems,
  listUniqueWatchHistory,
  listProfileRecommendationEvents,
  recordLibraryWatch,
  resetLibraryDbForTests,
  saveLibraryItem,
  setViewerMood,
} from '../library/db.js';
import { putRating } from '../library/ratings.js';
import {
  getYoutubeState,
  listFreshFindCandidates,
  listForYouCandidates,
  listLiveNowCandidates,
  listYoutubeProfileCandidateStates,
  replaceYoutubeRailItems,
  resetYoutubeDbForTests,
  setYoutubeProfileCandidateState,
  setYoutubeState,
  upsertBecauseYouWatchedCandidates,
  upsertFreshFindCandidates,
  upsertForYouCandidates,
  upsertLiveNowCandidates,
  upsertPopularCandidates,
} from './db.js';
import {
  resolveYoutubeImpressionSourceRevision,
  YoutubeService,
  youtubeFeedbackSemanticDecay,
  youtubeTitleScriptBucket,
  youtubeTitleTokens,
} from './service.js';
import { YOUTUBE_RAIL_LIMIT } from './constants.js';
import type { YoutubeItem, YoutubeRail } from './types.js';

const TOPIC_WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
  'mango',
  'nectar',
  'orchid',
  'papaya',
  'quartz',
  'rocket',
  'saffron',
  'tango',
];

function setHouseholdCandidateState(
  railId: string,
  id: string,
  state: {
    last_recommended_at?: number | null;
    exposure_count?: number;
    ignore_count?: number;
    quick_stop_count?: number;
  },
  contextId = '',
): void {
  setYoutubeProfileCandidateState({
    profile_id: 'household',
    rail_id: railId,
    context_id: contextId,
    id,
    ...state,
  });
}

function sampleVideo(
  id: string,
  liveStatus: YoutubeItem['live_status'] = 'none',
  channelId = 'channel-1',
  title = `Video ${id}`,
): YoutubeItem {
  return {
    id,
    kind: 'video',
    title,
    subtitle: 'Channel',
    description: 'A cached YouTube video',
    thumbnail: null,
    channel_id: channelId,
    channel_title: `Channel ${channelId}`,
    published_at: '2026-06-01T00:00:00Z',
    duration_sec: 600,
    live_status: liveStatus,
    playlist_id: null,
    updated_at: 1000,
  };
}

const PUBLIC_YOUTUBE_ITEM_KEYS = [
  'channel_id',
  'channel_title',
  'description',
  'duration_sec',
  'id',
  'kind',
  'live_status',
  'playlist_id',
  'published_at',
  'subtitle',
  'thumbnail',
  'title',
  'updated_at',
];

function internalDiscoveryRail(
  service: YoutubeService,
  profileId: string,
  railId: string,
): YoutubeRail | undefined {
  const internal = service as unknown as {
    discoveryRailsCache: Map<string, { rails: YoutubeRail[] }>;
  };
  return internal.discoveryRailsCache.get(profileId)?.rails.find((rail) => rail.rail_id === railId);
}

function seedForYouCandidates(items: YoutubeItem[]): void {
  upsertForYouCandidates(items.map((item, index) => ({
    item,
    lane: 'wildcard',
    source: 'wildcard',
    source_weight: 0.08,
    topic_cluster: item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ':') || `topic-${index}`,
    score: items.length - index,
    reason: 'shared-pool',
  })));
}

function cacheTasteEvidence(items: YoutubeItem[]): void {
  replaceYoutubeRailItems('taste_evidence', items.map((item, index) => ({
    item,
    score: items.length - index,
    reason: 'taste-evidence',
  })));
}

function upsertFreshCandidates(items: Array<{
  item: YoutubeItem;
  bucket?: 'quality_fresh' | 'taste_adjacent' | 'emerging_creator' | 'zeitgeist_light' | 'wildcard';
  topic?: string;
  score?: number;
}>): void {
  upsertFreshFindCandidates(items.map((entry, index) => ({
    item: entry.item,
    source_bucket: entry.bucket || 'quality_fresh',
    query: entry.bucket || 'quality_fresh',
    topic_cluster: entry.topic || entry.item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: entry.score ?? (1 - index * 0.001),
    score_breakdown: { test: true },
    reason: `fresh_find:${entry.bucket || 'quality_fresh'}`,
  })));
}

function upsertLiveCandidates(items: Array<{
  item: YoutubeItem;
  lane?: 'subscription_live' | 'news_events' | 'sports' | 'music_performance' | 'gaming' | 'culture_talks' | 'wildcard';
  topic?: string;
  score?: number;
  verifiedAt?: number;
  expiresAt?: number;
}>): void {
  const now = Date.now();
  upsertLiveNowCandidates(items.map((entry, index) => ({
    item: { ...entry.item, live_status: entry.item.live_status === 'live' ? 'live' : entry.item.live_status },
    source_lane: entry.lane || 'news_events',
    query: entry.lane || 'news_events',
    topic_cluster: entry.topic || entry.item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: entry.score ?? (1 - index * 0.001),
    score_breakdown: { test: true },
    reason: `live_now:${entry.lane || 'news_events'}`,
    last_verified_at: entry.verifiedAt ?? now,
    expires_at: entry.expiresAt ?? (now + 2 * 60 * 60 * 1000),
  })));
}

function upsertPopularCandidatesForTest(items: Array<{
  item: YoutubeItem;
  region?: string;
  categoryId?: string;
  category?: string;
  topic?: string;
  score?: number;
}>): void {
  upsertPopularCandidates(items.map((entry, index) => ({
    item: entry.item,
    source_region: entry.region || (index % 2 === 0 ? 'US' : 'IN'),
    category_id: entry.categoryId || '0',
    category_label: entry.category || 'all',
    topic_cluster: entry.topic || entry.item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: entry.score ?? (1 - index * 0.001),
    score_breakdown: { test: true },
    reason: `popular:${entry.category || 'all'}`,
  })));
}

function upsertBecauseCandidates(
  seed: YoutubeItem,
  seedWatchedAt: number,
  items: Array<{
    item: YoutubeItem;
    relation?: 'same_channel' | 'same_topic' | 'deeper_dive' | 'wildcard';
    topic?: string;
    score?: number;
  }>,
): void {
  upsertBecauseYouWatchedCandidates(items.map((entry, index) => ({
    item: entry.item,
    seed_video_id: seed.id,
    seed_watched_at: seedWatchedAt,
    relation_type: entry.relation || 'same_topic',
    query: entry.relation || 'same_topic',
    topic_cluster: entry.topic || entry.item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: entry.score ?? (1 - index * 0.001),
    score_breakdown: { test: true },
    reason: `because_you_watched:${entry.relation || 'same_topic'}`,
  })));
}

function apiErrorResponse(message = 'quota exceeded', status = 403): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function withTempState<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-service-'));
  const aiCatalogDir = join(dir, 'ai-catalogs');
  mkdirSync(join(aiCatalogDir, 'slots'), { recursive: true });
  const originalFetch = globalThis.fetch;
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  process.env.MANGO_YOUTUBE_API_KEY_FILE = join(dir, 'missing-youtube-api.key');
  process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE = join(dir, 'missing-youtube-oauth-client.json');
  process.env.MANGO_AI_CATALOGS_DIR = aiCatalogDir;
  delete process.env.MANGO_YOUTUBE_API_KEY;
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const cleanup = () => {
    globalThis.fetch = originalFetch;
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    delete process.env.MANGO_YOUTUBE_API_KEY_FILE;
    delete process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE;
    delete process.env.MANGO_YOUTUBE_API_KEY;
    delete process.env.MANGO_AI_CATALOGS_DIR;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('YouTube impression source revision is derived from served tokens and rejects tampering', () => {
  assert.equal(resolveYoutubeImpressionSourceRevision(12, [
    { source_revision: 12 },
    { source_revision: 12 },
  ]), 12);
  assert.throws(
    () => resolveYoutubeImpressionSourceRevision(13, [{ source_revision: 12 }]),
    /does not match its served source revision/,
  );
  assert.throws(
    () => resolveYoutubeImpressionSourceRevision(12, [
      { source_revision: 12 },
      { source_revision: 11 },
    ]),
    /source revisions do not match/,
  );
});

test('not interested removes cached video from YouTube rails', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('KeepMe'), score: 1, reason: 'test' },
    { item: sampleVideo('DropMe'), score: 0.9, reason: 'test' },
  ]);
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'DropMe', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const popular = internalDiscoveryRail(service, 'household', 'popular');
  assert.ok(popular);
  assert.deepEqual(popular.items.map((item) => item.id), ['KeepMe']);
  assert.equal(response.rails.some((rail) => rail.rail_id === 'popular'), false);
}));

test('public YouTube rails expose only the YoutubeItem contract', () => withTempState(async () => {
  const forYouItems = Array.from({ length: 8 }, (_, index) => (
    sampleVideo(`PublicForYou${index}`, 'none', `public-for-you-${index}`, `Public For You ${TOPIC_WORDS[index]}`)
  ));
  seedForYouCandidates(forYouItems);
  setHouseholdCandidateState('for_you', forYouItems[0].id, {
    exposure_count: 2,
    ignore_count: 1,
    quick_stop_count: 1,
  });
  upsertFreshCandidates(Array.from({ length: 8 }, (_, index) => ({
    item: sampleVideo(
      `PublicFresh${index}`,
      'none',
      `public-fresh-${index}`,
      `Public Fresh ${TOPIC_WORDS[index + 8]}`,
    ),
    bucket: 'quality_fresh',
    topic: `public-fresh-topic-${index}`,
  })));

  const response = await new YoutubeService().rails({ reshuffle: true }) as {
    ok: true;
    tab: 'youtube';
    profile_id: string;
    personalization_updated_at: number;
    rails: Array<YoutubeRail & { items: Array<Record<string, unknown>> }>;
    slate_sequence: number;
    attribution_contexts: Record<string, Record<string, unknown>>;
  };
  assert.deepEqual(Object.keys(response).sort(), [
    'attribution_contexts',
    'ok',
    'personalization_updated_at',
    'profile_id',
    'rails',
    'slate_sequence',
    'tab',
  ]);
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  const fresh = response.rails.find((rail) => rail.rail_id === 'fresh_finds');
  assert.ok(forYou?.items.length);
  assert.ok(fresh?.items.length);

  for (const rail of response.rails) {
    assert.deepEqual(Object.keys(rail).sort(), ['cached', 'items', 'label', 'rail_id', 'stale']);
    assert.deepEqual(
      Object.keys(response.attribution_contexts[rail.rail_id] ?? {}).sort(),
      ['context_id', 'source_revision'],
    );
    for (const item of rail.items) {
      assert.deepEqual(Object.keys(item).sort(), PUBLIC_YOUTUBE_ITEM_KEYS);
    }
  }

  const serialized = JSON.stringify(response);
  for (const privateKey of [
    'auth',
    'refresh',
    'api_key',
    'oauth_client',
    'yt_dlp_command',
    'device_code',
    'access_token',
    'refresh_token',
    'quota_used_today',
    'last_error',
    'raw_json',
    'score',
    'reason',
    'query',
    'score_breakdown',
    'source_weight',
    'topic_cluster',
    'lane',
    'last_recommended_at',
    'exposure_count',
    'ignore_count',
    'quick_stop_count',
  ]) {
    assert.equal(serialized.includes(`\"${privateKey}\"`), false, privateKey);
  }
}));

test('personal YouTube history, saves, negatives, and recent searches start clean', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('HouseHidden'), score: 1, reason: 'test' },
    { item: sampleVideo('AliceHidden'), score: 0.9, reason: 'test' },
    { item: sampleVideo('Visible'), score: 0.8, reason: 'test' },
    { item: sampleVideo('HouseWatched'), score: 0.7, reason: 'test' },
    { item: sampleVideo('HouseSaved'), score: 0.6, reason: 'test' },
    { item: sampleVideo('AliceWatched'), score: 0.5, reason: 'test' },
    { item: sampleVideo('AliceSaved'), score: 0.4, reason: 'test' },
  ]);
  recordLibraryWatch({
    source: 'youtube', type: 'youtube_video', id: 'HouseWatched', title: 'House watched',
    tab: 'youtube', event: 'play', watched_at: 1_000,
  });
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: 'HouseSaved', title: 'House saved',
    tab: 'youtube', saved_at: 1_100,
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'HouseHidden', reason: 'user' });

  const alice = createViewerProfile('Alice');
  activateViewerProfile(alice.profile_id);
  service.invalidateRailsCache();
  let response = await service.rails() as { rails: YoutubeRail[] };
  assert.deepEqual(response.rails.find((rail) => rail.rail_id === 'history')?.items ?? [], []);
  assert.deepEqual(response.rails.find((rail) => rail.rail_id === 'saved')?.items ?? [], []);
  assert.equal(response.rails
    .filter((rail) => !['history', 'saved'].includes(rail.rail_id))
    .some((rail) => rail.items.some((item) => item.id === 'HouseHidden')), true);

  recordLibraryWatch({
    source: 'youtube', type: 'youtube_video', id: 'AliceWatched', title: 'Alice watched',
    tab: 'youtube', event: 'play', watched_at: 2_000,
  });
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: 'AliceSaved', title: 'Alice saved',
    tab: 'youtube', saved_at: 2_100,
  });
  service.notInterested({ kind: 'video', id: 'AliceHidden', reason: 'user' });
  await service.search('Alice cooking', 4, { cache_only: true });
  assert.equal(listProfileRecommendationEvents({
    profile_id: alice.profile_id,
    domain: 'youtube',
    event_types: ['search'],
  })[0]?.title, 'Alice cooking');

  const bob = createViewerProfile('Bob');
  activateViewerProfile(bob.profile_id);
  service.invalidateRailsCache();
  response = await service.rails() as { rails: YoutubeRail[] };
  assert.deepEqual(response.rails.find((rail) => rail.rail_id === 'history')?.items ?? [], []);
  assert.deepEqual(response.rails.find((rail) => rail.rail_id === 'saved')?.items ?? [], []);
  const bobDiscovery = response.rails.filter((rail) => !['history', 'saved'].includes(rail.rail_id));
  assert.equal(bobDiscovery.some((rail) => rail.items.some((item) => item.id === 'HouseHidden')), true);
  assert.equal(bobDiscovery.some((rail) => rail.items.some((item) => item.id === 'AliceHidden')), true);
  assert.deepEqual(listProfileRecommendationEvents({
    profile_id: bob.profile_id,
    domain: 'youtube',
    event_types: ['search'],
  }), []);

  activateViewerProfile('household');
  service.invalidateRailsCache();
  response = await service.rails() as { rails: YoutubeRail[] };
  assert.equal(response.rails.some((rail) => rail.rail_id === 'history'), false);
  assert.equal(response.rails.some((rail) => rail.rail_id === 'saved'), false);
  assert.deepEqual(
    new Set(listUniqueWatchHistory({
      source: 'youtube', type: 'youtube_video', profile_id: 'household', household_blend: true,
    }).map((item) => item.id)),
    new Set(['HouseWatched', 'AliceWatched']),
  );
  assert.deepEqual(
    new Set(listSavedLibraryItems('youtube', 100, {
      profile_id: 'household', household_blend: true,
    }).map((item) => item.id)),
    new Set(['HouseSaved', 'AliceSaved']),
  );
  const householdDiscovery = response.rails.filter((rail) => !['history', 'saved'].includes(rail.rail_id));
  assert.equal(householdDiscovery.some((rail) => rail.items.some((item) => item.id === 'HouseHidden')), false);
  assert.equal(householdDiscovery.some((rail) => rail.items.some((item) => item.id === 'AliceHidden')), false);
}));

test('saved YouTube videos stay in Saved until explicitly unsaved', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('KeepMe'), score: 1, reason: 'test' },
    { item: sampleVideo('SavedVideo'), score: 0.9, reason: 'test' },
  ]);
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SavedVideo',
    title: 'Saved video',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'SavedVideo', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const popular = internalDiscoveryRail(service, 'household', 'popular');
  assert.equal(response.rails.some((rail) => rail.rail_id === 'saved'), false);
  assert.deepEqual(listSavedLibraryItems('youtube').map((item) => item.id), ['SavedVideo']);
  assert.ok(popular);
  assert.deepEqual(popular.items.map((item) => item.id), ['KeepMe']);
}));

test('search falls back to local cache when API key is absent', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('LocalOnly'), score: 1, reason: 'test' },
  ]);
  const service = new YoutubeService();
  const response = await service.search('local', 5) as {
    cached_only: boolean;
    groups: { videos: YoutubeItem[] };
  };
  assert.equal(response.cached_only, true);
  assert.deepEqual(response.groups.videos.map((item) => item.id), ['LocalOnly']);
}));

test('cached search token-matches multi-word queries across metadata', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    {
      item: {
        ...sampleVideo('CachedLofiLive', 'live', 'lofi-channel', 'lofi hip hop radio'),
        description: '24/7 live beats for focus',
      },
      score: 1,
      reason: 'test',
    },
  ]);
  const service = new YoutubeService();
  const response = await service.search('lofi live', 5) as {
    cached_only: boolean;
    groups: { videos: YoutubeItem[] };
  };
  assert.equal(response.cached_only, true);
  assert.deepEqual(response.groups.videos.map((item) => item.id), ['CachedLofiLive']);
}));

test('YouTube taste tokenization preserves non-Latin scripts and Unicode marks', () => {
  assert.deepEqual(
    [...youtubeTitleTokens('हिंदी सिनेमा · বাংলা গান · cinéma')],
    ['हिंदी', 'सिनेमा', 'বাংলা', 'গান', 'cinéma'],
  );
  assert.equal(youtubeTitleScriptBucket('भारतीय इतिहास की कहानी'), 'devanagari');
  assert.equal(youtubeTitleScriptBucket('A practical science documentary'), 'latin');
  assert.equal(youtubeTitleScriptBucket('भारत Abcd'), null);
});

test('Not-for-me semantic generalization decays on bounded dual horizons', () => {
  const day = 86_400_000;
  const now = 500 * day;
  assert.equal(youtubeFeedbackSemanticDecay(now, now), 1);
  assert.ok(youtubeFeedbackSemanticDecay(now - 30 * day, now) < 0.7);
  assert.ok(youtubeFeedbackSemanticDecay(now - 365 * day, now) < 0.2);
  assert.equal(youtubeFeedbackSemanticDecay(now - 10_000 * day, now), 0.05);
});

test('explicit session mood nudges YouTube For You ranking', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    sampleVideo('science-1', 'none', 'science-1', 'Astronomy telescope field notes'),
    sampleVideo('science-2', 'none', 'science-2', 'Physics laboratory field notes'),
    sampleVideo('science-3', 'none', 'science-3', 'Ocean ecology field notes'),
    sampleVideo('science-4', 'none', 'science-4', 'Architecture studio field notes'),
    sampleVideo('laugh-1', 'none', 'laugh-1', 'Standup comedy special'),
    sampleVideo('science-5', 'none', 'science-5', 'Robotics workshop field notes'),
  ].map((item, index) => ({ item, score: 1 - index * 0.01, reason: 'test' })));
  setViewerMood('laugh');
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const forYou = internalDiscoveryRail(service, 'household', 'for_you');
  assert.ok(forYou);
  assert.equal(forYou.items[0]?.id, 'laugh-1');
}));

test('search falls back to local cache when YouTube API quota fails', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('LocalQuotaFallback', 'none', 'quota-channel', 'Local quota fallback'), score: 1, reason: 'test' },
  ]);
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded', 429)) as typeof fetch;
  const service = new YoutubeService();
  const response = await service.search('local quota', 5) as {
    cached_only: boolean;
    api_error: string | null;
    groups: { videos: YoutubeItem[] };
  };
  assert.equal(response.cached_only, true);
  assert.match(response.api_error || '', /quota exceeded/);
  assert.deepEqual(response.groups.videos.map((item) => item.id), ['LocalQuotaFallback']);
}));

test('for you rail excludes live videos', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('NormalVideo'), score: 1, reason: 'test' },
    { item: sampleVideo('LiveVideo', 'live'), score: 0.9, reason: 'test' },
  ]);
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const forYou = internalDiscoveryRail(service, 'household', 'for_you');
  assert.ok(forYou);
  assert.ok(forYou.items.some((item) => item.id === 'NormalVideo'));
  assert.ok(!forYou.items.some((item) => item.id === 'LiveVideo'));
}));

test('cached discovery rails keep live videos in live now only', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('PopularNormal'), score: 1, reason: 'test' },
    { item: sampleVideo('PopularLive', 'live'), score: 0.9, reason: 'test' },
  ]);
  upsertLiveCandidates([
    { item: sampleVideo('LiveNow', 'live'), lane: 'news_events', score: 1 },
  ]);
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const popular = internalDiscoveryRail(service, 'household', 'popular');
  const liveNow = internalDiscoveryRail(service, 'household', 'live_now');
  assert.ok(popular);
  assert.ok(liveNow);
  assert.deepEqual(popular.items.map((item) => item.id), ['PopularNormal']);
  assert.deepEqual(liveNow.items.map((item) => item.id), ['LiveNow']);
}));

test('live now filters stale, non-live, loop, and not-interested candidates', () => withTempState(async () => {
  const expiredAt = Date.now() - 1000;
  upsertLiveCandidates([
    { item: sampleVideo('LiveKeep', 'live', 'live-keep', 'Breaking news live'), lane: 'news_events', score: 1 },
    { item: sampleVideo('LiveExpired', 'live', 'live-expired', 'Expired live'), lane: 'news_events', score: 0.9, expiresAt: expiredAt },
    { item: sampleVideo('LiveLoop', 'live', 'live-loop', 'lofi hip hop radio 24/7'), lane: 'music_performance', score: 0.8 },
    { item: sampleVideo('LiveBlocked', 'live', 'live-blocked', 'Blocked live'), lane: 'sports', score: 0.7 },
    { item: sampleVideo('NotActuallyLive', 'none', 'not-live', 'Normal video'), lane: 'wildcard', score: 0.6 },
  ]);
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'LiveBlocked', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const liveNow = internalDiscoveryRail(service, 'household', 'live_now');
  assert.ok(liveNow);
  assert.deepEqual(liveNow.items.map((item) => item.id), ['LiveKeep']);
}));

test('live now returns one complete TV row and reshuffle samples cache only', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return apiErrorResponse('should not fetch on shuffle');
  }) as typeof fetch;
  const lanes = ['news_events', 'sports', 'music_performance', 'gaming', 'culture_talks', 'wildcard'] as const;
  upsertLiveCandidates(Array.from({ length: 14 }, (_, index) => ({
    item: sampleVideo(`LiveDiverse${index}`, 'live', `live-channel-${index}`, `Live ${TOPIC_WORDS[index]} event`),
    lane: lanes[index % lanes.length],
    score: 1 - index * 0.001,
  })));
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const liveNow = internalDiscoveryRail(service, 'household', 'live_now');
  assert.ok(liveNow);
  assert.equal(liveNow.items.length, YOUTUBE_RAIL_LIMIT);
  assert.equal(new Set(liveNow.items.map((item) => item.channel_id)).size, YOUTUBE_RAIL_LIMIT);
  assert.equal(fetchCalls, 0);
}));

test('live now suppresses recently exposed cards when enough alternatives exist', () => withTempState(async () => {
  upsertLiveCandidates(Array.from({ length: YOUTUBE_RAIL_LIMIT + 2 }, (_, index) => ({
    item: sampleVideo(`LiveExposure${index}`, 'live', `exposure-channel-${index}`, `Live exposure ${TOPIC_WORDS[index]}`),
    lane: index === 0 ? 'news_events' : 'wildcard',
    score: 1 - index * 0.001,
  })));
  setHouseholdCandidateState('live_now', 'LiveExposure0', {
    last_recommended_at: Date.now(), exposure_count: 3, ignore_count: 3,
  });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const liveNow = internalDiscoveryRail(service, 'household', 'live_now');
  assert.ok(liveNow);
  assert.ok(liveNow.items.length <= YOUTUBE_RAIL_LIMIT);
  assert.ok(!liveNow.items.some((item) => item.id === 'LiveExposure0'));
}));

test('live now quota refresh falls back to existing reservoir', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  upsertLiveCandidates(Array.from({ length: 9 }, (_, index) => ({
    item: sampleVideo(`LiveStale${index}`, 'live', `live-stale-${index}`, `Stale live ${TOPIC_WORDS[index]}`),
    lane: index < 3 ? 'news_events' : 'wildcard',
  })));
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded')) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_live_failure');
  assert.equal(refresh.ok, true);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'live_now' && phase.ok));
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const liveNow = response.rails.find((rail) => rail.rail_id === 'live_now');
  assert.ok(liveNow);
  assert.equal(liveNow.items.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(liveNow.items.every((item) => item.id.startsWith('LiveStale')));
}));

test('live now revalidates cached candidates before cache fallback', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  upsertLiveCandidates([
    { item: sampleVideo('CachedEndedLive', 'live', 'cached-ended', 'Past premiere') },
    { item: sampleVideo('CachedActuallyLive', 'live', 'cached-live', 'Current live event') },
  ]);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith('/videos') && url.searchParams.has('id')) {
      return new Response(JSON.stringify({
        items: [{
          id: 'CachedEndedLive',
          snippet: {
            title: 'Past premiere',
            channelId: 'cached-ended',
            channelTitle: 'Cached Ended',
            publishedAt: '2026-07-01T00:00:00Z',
            liveBroadcastContent: 'none',
          },
          contentDetails: { duration: 'PT30M' },
          liveStreamingDetails: { actualStartTime: '2026-07-01T01:00:00Z' },
        }, {
          id: 'CachedActuallyLive',
          snippet: {
            title: 'Current live event',
            channelId: 'cached-live',
            channelTitle: 'Cached Live',
            publishedAt: '2026-07-01T00:00:00Z',
            liveBroadcastContent: 'live',
          },
          contentDetails: { duration: 'PT2M' },
          liveStreamingDetails: { actualStartTime: '2026-07-01T01:00:00Z' },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return apiErrorResponse('quota exceeded');
  }) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_live_revalidate');
  assert.equal(refresh.ok, true);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'live_now' && phase.ok));
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const liveNow = internalDiscoveryRail(service, 'household', 'live_now');
  assert.ok(liveNow);
  assert.deepEqual(liveNow.items.map((item) => item.id), ['CachedActuallyLive']);
  assert.equal(response.rails.some((rail) => rail.rail_id === 'live_now'), false);
}));

test('every visible YouTube rail is a complete four-card row', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', Array.from({ length: 14 }, (_, index) => ({
    item: sampleVideo(`Popular${index}`),
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  for (const rail of response.rails) {
    assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT, `${rail.rail_id} has ${rail.items.length} items`);
  }
  const popular = response.rails.find((rail) => rail.rail_id === 'popular');
  assert.equal(popular?.items.length, YOUTUBE_RAIL_LIMIT);
}));

test('popular rail excludes watched saved subscribed live shorts blocked low signal and recent exposure', () => withTempState(async () => {
  replaceYoutubeRailItems('new_from_subscriptions', [
    { item: sampleVideo('PopularSubReference', 'none', 'popular-subscribed', 'Subscribed reference'), score: 1, reason: 'subscription' },
  ]);
  const eligibleCategories = ['all', 'entertainment', 'music', 'gaming', 'sports', 'education', 'comedy', 'travel_culture', 'science_tech'];
  const eligibleCandidates = Array.from({ length: YOUTUBE_RAIL_LIMIT + 3 }, (_, index) => (
    sampleVideo(
      `PopularEligible${index}`,
      'none',
      `popular-eligible-${index}`,
      `Popular eligible ${TOPIC_WORDS[index % TOPIC_WORDS.length]}`,
    )
  ));
  const candidates = [
    sampleVideo('PopularWatched', 'none', 'popular-watched', 'Watched popular'),
    sampleVideo('PopularSaved', 'none', 'popular-saved', 'Saved popular'),
    sampleVideo('PopularSubscribed', 'none', 'popular-subscribed', 'Subscribed popular'),
    sampleVideo('PopularLive', 'live', 'popular-live', 'Live popular'),
    { ...sampleVideo('PopularShort', 'none', 'popular-short', 'Short popular'), duration_sec: 45 },
    sampleVideo('PopularLowSignal', 'none', 'popular-low-signal', 'SSC MTS result cutoff popular'),
    sampleVideo('PopularBlocked', 'none', 'popular-blocked', 'Blocked popular'),
    sampleVideo('PopularRecent', 'none', 'popular-recent', 'Recent popular'),
    ...eligibleCandidates,
  ];
  upsertPopularCandidatesForTest(candidates.map((item, index) => ({
    item,
    category: index >= 8 ? eligibleCategories[(index - 8) % eligibleCategories.length] : 'all',
    categoryId: index >= 8 ? String((index - 8) % eligibleCategories.length) : '0',
    topic: `popular-filter-${index}`,
  })));
  setHouseholdCandidateState('popular', 'PopularRecent', { last_recommended_at: Date.now() });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'PopularWatched',
    title: 'Watched popular',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'PopularSaved',
    title: 'Saved popular',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'PopularBlocked', reason: 'user' });
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'popular');
  assert.ok(rail);
  const ids = rail.items.map((item) => item.id);
  assert.equal(ids.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(!ids.includes('PopularWatched'));
  assert.ok(!ids.includes('PopularSaved'));
  assert.ok(!ids.includes('PopularSubscribed'));
  assert.ok(!ids.includes('PopularLive'));
  assert.ok(!ids.includes('PopularShort'));
  assert.ok(!ids.includes('PopularLowSignal'));
  assert.ok(!ids.includes('PopularBlocked'));
  assert.ok(!ids.includes('PopularRecent'));
  assert.ok(ids.every((id) => id.startsWith('PopularEligible')));
  assert.equal(new Set(rail.items.map((item) => item.channel_id)).size, YOUTUBE_RAIL_LIMIT);
}));

test('popular rail reshuffle samples cached reservoir only and avoids recent exposure', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return apiErrorResponse('should not fetch on shuffle');
  }) as typeof fetch;
  const categories = ['all', 'entertainment', 'music', 'gaming', 'sports', 'education', 'comedy', 'travel_culture', 'science_tech'];
  upsertPopularCandidatesForTest(Array.from({ length: 30 }, (_, index) => ({
    item: sampleVideo(`PopularShuffle${index}`, 'none', `popular-shuffle-${index}`, `Popular shuffle ${TOPIC_WORDS[index % TOPIC_WORDS.length]}`),
    category: categories[index % categories.length],
    categoryId: String(index % categories.length),
    topic: `popular-shuffle-${index}`,
    score: 1 - index * 0.001,
  })));
  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstRail = first.rails.find((entry) => entry.rail_id === 'popular');
  assert.ok(firstRail);
  assert.equal(firstRail.items.length, YOUTUBE_RAIL_LIMIT);
  const second = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const secondRail = second.rails.find((entry) => entry.rail_id === 'popular');
  assert.ok(secondRail);
  assert.equal(secondRail.items.length, YOUTUBE_RAIL_LIMIT);
  const firstIds = new Set(firstRail.items.map((item) => item.id));
  assert.ok(secondRail.items.some((item) => !firstIds.has(item.id)));
  assert.equal(fetchCalls, 0);
}));

test('popular refresh failure keeps existing reservoir visible', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  upsertPopularCandidatesForTest(Array.from({ length: 9 }, (_, index) => ({
    item: sampleVideo(`PopularStale${index}`, 'none', `popular-stale-${index}`, `Popular stale ${TOPIC_WORDS[index]}`),
    category: index === 0 ? 'all' : 'entertainment',
  })));
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded')) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_popular_failure');
  assert.equal(refresh.ok, true);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'popular' && phase.ok));
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'popular');
  assert.ok(rail);
  assert.equal(rail.items.length, Math.min(YOUTUBE_RAIL_LIMIT, 9));
  assert.ok(rail.items.every((item) => item.id.startsWith('PopularStale')));
}));

test('fresh finds is hidden when empty', () => withTempState(async () => {
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  assert.equal(response.rails.some((rail) => rail.rail_id === 'fresh_finds'), false);
}));

test('fresh finds failed refresh keeps existing cached pool visible', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  upsertFreshCandidates(Array.from({ length: 9 }, (_, index) => ({
    item: sampleVideo(`FreshStale${index}`, 'none', `fresh-stale-${index}`, `Stale ${TOPIC_WORDS[index]}`),
    bucket: index < 3
      ? 'taste_adjacent'
      : index < 6
        ? 'quality_fresh'
        : 'emerging_creator',
    topic: `stale-topic-${index}`,
  })));
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded')) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_failure');
  assert.equal(refresh.ok, true);
  assert.match(refresh.refresh.last_error || '', /partial refresh/);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'popular' && !phase.ok));
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'for_you_reservoir' && phase.ok));
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, Math.min(YOUTUBE_RAIL_LIMIT, 9));
  assert.ok(rail.items.every((item) => item.id.startsWith('FreshStale')));
}));

test('fresh finds excludes watched saved subscribed live shorts blocked and recent exposure', () => withTempState(async () => {
  replaceYoutubeRailItems('new_from_subscriptions', [
    { item: sampleVideo('SubReference', 'none', 'subscribed-channel', 'Subscribed reference'), score: 1, reason: 'subscription' },
  ]);
  const candidates = [
    sampleVideo('FreshWatched', 'none', 'watched-channel', 'Watched fresh'),
    sampleVideo('FreshSaved', 'none', 'saved-channel', 'Saved fresh'),
    sampleVideo('FreshSubscribed', 'none', 'subscribed-channel', 'Subscribed fresh'),
    sampleVideo('FreshLive', 'live', 'live-channel', 'Live fresh'),
    { ...sampleVideo('FreshShort', 'none', 'short-channel', 'Short fresh'), duration_sec: 45 },
    { ...sampleVideo('FreshUnderEight', 'none', 'under-eight-channel', 'Short-form official video'), duration_sec: 300 },
    sampleVideo('FreshLowSignal', 'none', 'low-signal-channel', 'SSC MTS result 2025 cutoff today'),
    sampleVideo('FreshBlocked', 'none', 'blocked-channel', 'Blocked fresh'),
    sampleVideo('FreshRecent', 'none', 'recent-channel', 'Recent fresh'),
    ...Array.from({ length: YOUTUBE_RAIL_LIMIT + 3 }, (_, index) => (
      sampleVideo(`FreshEligible${index}`, 'none', `fresh-channel-${index}`, `Fresh eligible ${TOPIC_WORDS[index]}`)
    )),
  ];
  upsertFreshCandidates(candidates.map((item, index) => ({
    item,
    bucket: index % 3 === 0 ? 'taste_adjacent' : 'quality_fresh',
    topic: `topic-${index}`,
  })));
  setHouseholdCandidateState('fresh_finds', 'FreshRecent', { last_recommended_at: Date.now() });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'FreshWatched',
    title: 'Watched fresh',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'FreshSaved',
    title: 'Saved fresh',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'FreshBlocked', reason: 'user' });
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  const ids = rail.items.map((item) => item.id);
  assert.equal(ids.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(!ids.includes('FreshWatched'));
  assert.ok(!ids.includes('FreshSaved'));
  assert.ok(!ids.includes('FreshSubscribed'));
  assert.ok(!ids.includes('FreshLive'));
  assert.ok(!ids.includes('FreshShort'));
  assert.ok(!ids.includes('FreshUnderEight'));
  assert.ok(!ids.includes('FreshLowSignal'));
  assert.ok(!ids.includes('FreshBlocked'));
  assert.ok(!ids.includes('FreshRecent'));
  const channelCounts = new Map<string, number>();
  for (const item of rail.items) {
    channelCounts.set(item.channel_id || item.id, (channelCounts.get(item.channel_id || item.id) ?? 0) + 1);
  }
  assert.ok([...channelCounts.values()].every((count) => count <= 1));
}));

test('fresh finds relaxes saved subscribed and exposure filters only when thin', () => withTempState(async () => {
  replaceYoutubeRailItems('new_from_subscriptions', [
    { item: sampleVideo('SubReference', 'none', 'thin-subscribed', 'Thin subscribed reference'), score: 1, reason: 'subscription' },
  ]);
  const rows = [
    ...Array.from({ length: 2 }, (_, index) => (
      sampleVideo(`FreshThin${index}`, 'none', `thin-channel-${index}`, `Thin ${TOPIC_WORDS[index]}`)
    )),
    sampleVideo('FreshSavedFallback', 'none', 'thin-saved', 'Saved fallback'),
    sampleVideo('FreshSubscribedFallback', 'none', 'thin-subscribed', 'Subscribed fallback'),
    sampleVideo('FreshRecentFallback', 'none', 'thin-recent', 'Recent fallback'),
  ];
  upsertFreshCandidates(rows.map((item, index) => ({
    item,
    bucket: index < 3 ? 'taste_adjacent' : 'quality_fresh',
    topic: `thin-topic-${index}`,
  })));
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'FreshSavedFallback',
    title: 'Saved fallback',
    tab: 'youtube',
  });
  setHouseholdCandidateState('fresh_finds', 'FreshRecentFallback', { last_recommended_at: Date.now() });
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT);
  const ids = rail.items.map((item) => item.id);
  assert.ok(ids.includes('FreshSavedFallback'));
  assert.ok(ids.includes('FreshSubscribedFallback'));
  assert.ok(!ids.includes('FreshRecentFallback'));
}));

test('fresh finds relaxes recent exposure when still thin', () => withTempState(async () => {
  const rows = [
    ...Array.from({ length: 3 }, (_, index) => (
      sampleVideo(`FreshRecentThin${index}`, 'none', `recent-thin-${index}`, `Recent thin ${TOPIC_WORDS[index]}`)
    )),
    sampleVideo('FreshRecentOnlyFallback', 'none', 'recent-thin-fallback', 'Recent only fallback'),
  ];
  upsertFreshCandidates(rows.map((item, index) => ({
    item,
    bucket: index < 3 ? 'taste_adjacent' : 'quality_fresh',
    topic: `recent-thin-topic-${index}`,
  })));
  setHouseholdCandidateState('fresh_finds', 'FreshRecentOnlyFallback', { last_recommended_at: Date.now() });
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(rail.items.some((item) => item.id === 'FreshRecentOnlyFallback'));
}));

test('fresh finds relaxes sub-eight-minute filter only when thin', () => withTempState(async () => {
  const longRows: Array<{
    item: YoutubeItem;
    bucket: 'taste_adjacent' | 'quality_fresh';
    topic: string;
  }> = Array.from({ length: 3 }, (_, index) => ({
    item: sampleVideo(`FreshLongThin${index}`, 'none', `long-thin-${index}`, `Long thin ${TOPIC_WORDS[index]}`),
    bucket: index < 3 ? 'taste_adjacent' : 'quality_fresh',
    topic: `long-thin-topic-${index}`,
  }));
  upsertFreshCandidates([
    ...longRows,
    {
      item: { ...sampleVideo('FreshShortFallback', 'none', 'short-fallback', 'Short fallback'), duration_sec: 300 },
      bucket: 'wildcard',
      topic: 'short-fallback-topic',
    },
  ]);
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(rail);
  assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(rail.items.some((item) => item.id === 'FreshShortFallback'));
}));

test('fresh finds reshuffle uses exposure cooldown to show a different cached set', () => withTempState(async () => {
  upsertFreshCandidates(Array.from({ length: 30 }, (_, index) => ({
    item: sampleVideo(`FreshShuffle${index}`, 'none', `fresh-shuffle-${index}`, `Shuffle ${TOPIC_WORDS[index % TOPIC_WORDS.length]}`),
    bucket: index % 4 === 0
      ? 'taste_adjacent'
      : index % 4 === 1
        ? 'quality_fresh'
        : index % 4 === 2
          ? 'emerging_creator'
          : 'zeitgeist_light',
    topic: `shuffle-topic-${index}`,
  })));
  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstRail = first.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(firstRail);
  assert.equal(firstRail.items.length, YOUTUBE_RAIL_LIMIT);
  const second = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const secondRail = second.rails.find((entry) => entry.rail_id === 'fresh_finds');
  assert.ok(secondRail);
  assert.equal(secondRail.items.length, YOUTUBE_RAIL_LIMIT);
  const firstIds = new Set(firstRail.items.map((item) => item.id));
  assert.ok(secondRail.items.some((item) => !firstIds.has(item.id)));
}));

test('new from subscriptions is an unwatched diverse creator inbox', () => withTempState(async () => {
  const rows = [
    sampleVideo('SubWatched', 'none', 'sub-a', 'Already watched'),
    sampleVideo('SubSaved', 'none', 'sub-b', 'Already saved'),
    sampleVideo('SubLive', 'live', 'sub-c', 'Live upload'),
    { ...sampleVideo('SubShort', 'none', 'sub-d', 'Short upload'), duration_sec: 45 },
    sampleVideo('SubBlocked', 'none', 'sub-e', 'Blocked upload'),
    sampleVideo('SubA1', 'none', 'sub-a', 'Fresh A one'),
    sampleVideo('SubA2', 'none', 'sub-a', 'Fresh A two'),
    sampleVideo('SubB1', 'none', 'sub-b', 'Fresh B one'),
    sampleVideo('SubC1', 'none', 'sub-c', 'Fresh C one'),
    sampleVideo('SubD1', 'none', 'sub-d', 'Fresh D one'),
    sampleVideo('SubE1', 'none', 'sub-e', 'Fresh E one'),
    sampleVideo('SubF1', 'none', 'sub-f', 'Fresh F one'),
    sampleVideo('SubG1', 'none', 'sub-g', 'Fresh G one'),
    sampleVideo('SubH1', 'none', 'sub-h', 'Fresh H one'),
    sampleVideo('SubI1', 'none', 'sub-i', 'Fresh I one'),
    sampleVideo('SubJ1', 'none', 'sub-j', 'Fresh J one'),
    sampleVideo('SubK1', 'none', 'sub-k', 'Fresh K one'),
    sampleVideo('SubL1', 'none', 'sub-l', 'Fresh L one'),
  ];
  replaceYoutubeRailItems('new_from_subscriptions', rows.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SubWatched',
    title: 'Already watched',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SubSaved',
    title: 'Already saved',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'SubBlocked', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'new_from_subscriptions');
  assert.ok(rail);
  const ids = rail.items.map((item) => item.id);
  assert.equal(ids.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(!ids.includes('SubWatched'));
  assert.ok(!ids.includes('SubSaved'));
  assert.ok(!ids.includes('SubLive'));
  assert.ok(!ids.includes('SubShort'));
  assert.ok(!ids.includes('SubBlocked'));
  const channelCounts = new Map<string, number>();
  for (const item of rail.items) {
    channelCounts.set(item.channel_id || item.id, (channelCounts.get(item.channel_id || item.id) ?? 0) + 1);
  }
  assert.ok([...channelCounts.values()].every((count) => count <= 1));
}));

test('new from subscriptions relaxes saved exclusion only when needed', () => withTempState(async () => {
  const rows = [
    ...Array.from({ length: 3 }, (_, index) => (
      sampleVideo(`SubThin${index}`, 'none', `thin-${index}`, `Thin ${index}`)
    )),
    sampleVideo('SubSavedFallback', 'none', 'thin-saved', 'Saved fallback'),
  ];
  replaceYoutubeRailItems('new_from_subscriptions', rows.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'SubSavedFallback',
    title: 'Saved fallback',
    tab: 'youtube',
  });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'new_from_subscriptions');
  assert.ok(rail);
  assert.equal(rail.items.length, Math.min(YOUTUBE_RAIL_LIMIT, 9));
  assert.ok(rail.items.some((item) => item.id === 'SubSavedFallback'));
}));

test('new from subscriptions relaxes channel diversity to max two when thin', () => withTempState(async () => {
  const rows = Array.from({ length: 12 }, (_, index) => (
    sampleVideo(`SubChannel${index}`, 'none', `thin-channel-${index % 3}`, `Channel ${index}`)
  ));
  replaceYoutubeRailItems('new_from_subscriptions', rows.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'new_from_subscriptions');
  assert.ok(rail);
  assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT);
  const channelCounts = new Map<string, number>();
  for (const item of rail.items) {
    channelCounts.set(item.channel_id || item.id, (channelCounts.get(item.channel_id || item.id) ?? 0) + 1);
  }
  assert.ok([...channelCounts.values()].every((count) => count <= 2));
}));

test('For You recomputes source and lane for each active profile without sharing assembled cache', () => withTempState(async () => {
  const candidate = sampleVideo('ProfileClassified', 'none', 'profile-channel', 'Profile classified film');
  const evidence = sampleVideo(
    'ProfileTasteEvidence',
    'none',
    'profile-evidence-channel',
    'Profile classified film analysis',
  );
  upsertForYouCandidates([{
    item: candidate,
    lane: 'wildcard',
    source: 'wildcard',
    source_weight: 0.08,
    topic_cluster: 'profile:classified',
    score: 1,
    reason: 'shared-pool',
  }]);
  cacheTasteEvidence([evidence]);
  const alice = createViewerProfile('Alice classification');
  activateViewerProfile(alice.profile_id);
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: evidence.id, title: evidence.title,
    tab: 'youtube',
  });
  const service = new YoutubeService();
  await service.rails();
  const aliceItem = internalDiscoveryRail(service, alice.profile_id, 'for_you')
    ?.items.find((item) => item.id === candidate.id) as (YoutubeItem & { source?: string; lane?: string }) | undefined;
  assert.equal(aliceItem?.source, 'history');
  assert.equal(aliceItem?.lane, 'familiar');

  const bob = createViewerProfile('Bob classification');
  activateViewerProfile(bob.profile_id);
  // Deliberately do not invalidate the service cache: profile identity itself
  // must prevent Alice's assembled slate/classification from being reused.
  await service.rails();
  const bobItem = internalDiscoveryRail(service, bob.profile_id, 'for_you')
    ?.items.find((item) => item.id === candidate.id) as (YoutubeItem & { source?: string; lane?: string }) | undefined;
  assert.equal(bobItem?.source, 'wildcard');
  assert.equal(bobItem?.lane, 'wildcard');
}));

test('Saved candidates cannot cannibalize the four-card Saved anchor through For You', () => withTempState(async () => {
  const saved = Array.from({ length: YOUTUBE_RAIL_LIMIT }, (_, index) => sampleVideo(
    `SavedAnchor${index}`,
    'none',
    `saved-anchor-channel-${index}`,
    `Saved anchor ${TOPIC_WORDS[index]}`,
  ));
  const discovery = Array.from({ length: 8 }, (_, index) => sampleVideo(
    `SavedDiscovery${index}`,
    'none',
    `saved-discovery-channel-${index}`,
    `Discovery ${TOPIC_WORDS[index + 4]}`,
  ));
  seedForYouCandidates([...saved, ...discovery]);
  for (const item of saved) {
    saveLibraryItem({
      source: 'youtube',
      type: 'youtube_video',
      id: item.id,
      title: item.title,
      tab: 'youtube',
    });
  }

  const response = await new YoutubeService().rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  const savedRail = response.rails.find((rail) => rail.rail_id === 'saved');
  assert.equal(forYou?.items.length, YOUTUBE_RAIL_LIMIT);
  assert.equal(savedRail?.items.length, YOUTUBE_RAIL_LIMIT);
  const savedIds = new Set(saved.map((item) => item.id));
  assert.equal(forYou?.items.some((item) => savedIds.has(item.id)), false);
  assert.deepEqual(new Set(savedRail?.items.map((item) => item.id)), savedIds);
}));

test('For You reservoir construction never removes the builder profile negative', () => withTempState(async () => {
  const blocked = sampleVideo('BuilderNegative', 'none', 'builder-channel', 'Builder negative topic');
  replaceYoutubeRailItems('popular', [{ item: blocked, score: 1, reason: 'test' }]);
  const alice = createViewerProfile('Alice reservoir');
  activateViewerProfile(alice.profile_id);
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: blocked.id, reason: 'user' });
  await service.rails({ reshuffle: true });
  assert.equal(listForYouCandidates().some((candidate) => candidate.id === blocked.id), true);
}));

test('rendered For You exposure cools down Alice without suppressing Bob', () => withTempState(async () => {
  upsertForYouCandidates(Array.from({ length: 12 }, (_, index) => ({
    item: sampleVideo(
      `ProfileExposure${index}`,
      'none',
      `profile-exposure-channel-${index}`,
      `Profile exposure ${TOPIC_WORDS[index]}`,
    ),
    lane: 'wildcard',
    source: 'wildcard',
    source_weight: 0.08,
    topic_cluster: `profile-exposure-${index}`,
    score: 12 - index,
    reason: 'shared-pool',
  })));
  const alice = createViewerProfile('Alice exposure');
  activateViewerProfile(alice.profile_id);
  const service = new YoutubeService();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[]; slate_sequence: number };
    const firstIds = first.rails.find((rail) => rail.rail_id === 'for_you')?.items.map((item) => item.id) ?? [];
    assert.equal(firstIds.length, YOUTUBE_RAIL_LIMIT);
    service.impressions({
      profile_id: alice.profile_id,
      slate_sequence: first.slate_sequence,
      rails: [{ rail_id: 'for_you', context_id: '', item_ids: firstIds }],
    });
    service.invalidateRailsCache();
    const aliceAfter = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    const aliceAfterIds = aliceAfter.rails.find((rail) => rail.rail_id === 'for_you')
      ?.items.map((item) => item.id) ?? [];
    assert.ok(firstIds.every((id) => !aliceAfterIds.includes(id)));

    const bob = createViewerProfile('Bob exposure');
    activateViewerProfile(bob.profile_id);
    const bobResponse = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    const bobIds = bobResponse.rails.find((rail) => rail.rail_id === 'for_you')
      ?.items.map((item) => item.id) ?? [];
    assert.equal(bobIds.length, YOUTUBE_RAIL_LIMIT);
    const bobReserve = internalDiscoveryRail(service, bob.profile_id, 'for_you')?.reserve_items ?? [];
    assert.ok(firstIds.every((id) => bobReserve.some((item) => item.id === id)));
    assert.deepEqual(listYoutubeProfileCandidateStates({
      profile_id: bob.profile_id,
      rail_id: 'for_you',
    }), []);
  } finally {
    Math.random = originalRandom;
  }
}));

test('legacy ignore and quick-stop counters do not penalize recommendation score', () => withTempState(async () => {
  const neutral = Array.from({ length: 6 }, (_, index) => sampleVideo(
    `NeutralSignal${index}`,
    'none',
    `neutral-signal-channel-${index}`,
    'Same neutral documentary topic',
  ));
  seedForYouCandidates(neutral);
  setHouseholdCandidateState('for_you', neutral[0].id, {
    exposure_count: 0,
    ignore_count: 500,
    quick_stop_count: 500,
  });
  const service = new YoutubeService();
  await service.rails({ reshuffle: true });
  const reserve = internalDiscoveryRail(service, 'household', 'for_you')?.reserve_items as Array<YoutubeItem & {
    score: number;
  }> | undefined;
  assert.ok(reserve);
  assert.equal(
    reserve.find((item) => item.id === neutral[0].id)?.score,
    reserve.find((item) => item.id === neutral[1].id)?.score,
  );
}));

test('Household gives a high-activity and minority viewer equal bounded positive taste budgets', () => withTempState(async () => {
  const majorityEvidence = Array.from({ length: 20 }, (_, index) => (
    sampleVideo(`MajorityEvidence${index}`, 'none', `majority-evidence-${index}`, 'Mainstream')
  ));
  const minorityEvidence = Array.from({ length: 2 }, (_, index) => (
    sampleVideo(`MinorityEvidence${index}`, 'none', `minority-evidence-${index}`, 'Niche')
  ));
  cacheTasteEvidence([...majorityEvidence, ...minorityEvidence]);
  const alice = createViewerProfile('High activity viewer');
  activateViewerProfile(alice.profile_id);
  majorityEvidence.forEach((item, index) => recordLibraryWatch({
    source: 'youtube', type: 'youtube_video', id: item.id, title: item.title,
    tab: 'youtube', event: 'play', watched_at: Date.now() + index,
  }));
  const bob = createViewerProfile('Minority viewer');
  activateViewerProfile(bob.profile_id);
  minorityEvidence.forEach((item, index) => recordLibraryWatch({
    source: 'youtube', type: 'youtube_video', id: item.id, title: item.title,
    tab: 'youtube', event: 'play', watched_at: Date.now() + 100 + index,
  }));

  seedForYouCandidates([
    sampleVideo('MajorityCandidate', 'none', 'majority-candidate', 'Mainstream'),
    sampleVideo('MinorityCandidate', 'none', 'minority-candidate', 'Niche'),
  ]);
  activateViewerProfile('household');
  const service = new YoutubeService();
  await service.rails({ reshuffle: true });
  const items = internalDiscoveryRail(service, 'household', 'for_you')?.items as Array<YoutubeItem & {
    source?: string;
    lane?: string;
  }> | undefined;
  assert.ok(items);
  assert.equal(items.find((item) => item.id === 'MajorityCandidate')?.source, 'history');
  assert.equal(items.find((item) => item.id === 'MinorityCandidate')?.source, 'history');
  assert.equal(items.find((item) => item.id === 'MajorityCandidate')?.lane, 'familiar');
  assert.equal(items.find((item) => item.id === 'MinorityCandidate')?.lane, 'familiar');
}));

test('non-Latin positive title tokens rank a related For You candidate', () => withTempState(async () => {
  const viewer = createViewerProfile('Devanagari viewer');
  activateViewerProfile(viewer.profile_id);
  const evidence = sampleVideo('HindiEvidence', 'none', 'hindi-evidence', 'भारतीय इतिहास');
  cacheTasteEvidence([evidence]);
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: evidence.id, title: evidence.title,
    tab: 'youtube', saved_at: Date.now(),
  });
  seedForYouCandidates([
    sampleVideo('HindiMatch', 'none', 'hindi-match', 'भारतीय इतिहास विश्लेषण'),
    sampleVideo('LatinUnrelated', 'none', 'latin-unrelated', 'Garden design workshop'),
  ]);
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const publicItems = response.rails.find((rail) => rail.rail_id === 'for_you')?.items ?? [];
  const items = internalDiscoveryRail(service, viewer.profile_id, 'for_you')?.items as Array<YoutubeItem & {
    source?: string;
  }> | undefined;
  assert.ok(items);
  assert.equal(response.rails.some((rail) => rail.rail_id === 'for_you'), false);
  assert.equal(items[0]?.id, 'HindiMatch');
  assert.equal(items.find((item) => item.id === 'HindiMatch')?.source, 'history');
  assert.equal(items.find((item) => item.id === 'LatinUnrelated')?.source, 'wildcard');
}));

test('For You represents a learned Latin and Devanagari balance with sufficient evidence and supply', () => withTempState(async () => {
  const viewer = createViewerProfile('Multilingual viewer');
  activateViewerProfile(viewer.profile_id);
  const evidence = [
    ...Array.from({ length: 3 }, (_, index) => (
      sampleVideo(`LatinEvidence${index}`, 'none', `latin-evidence-${index}`, 'Science')
    )),
    ...Array.from({ length: 2 }, (_, index) => (
      sampleVideo(`DevanagariEvidence${index}`, 'none', `dev-evidence-${index}`, 'भारतीय')
    )),
  ];
  cacheTasteEvidence(evidence);
  evidence.forEach((item, index) => saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: item.id, title: item.title,
    tab: 'youtube', saved_at: Date.now() + index,
  }));
  seedForYouCandidates([
    ...Array.from({ length: 4 }, (_, index) => (
      sampleVideo(`LatinCandidate${index}`, 'none', `latin-candidate-${index}`, `Science topic${index}`)
    )),
    sampleVideo('DevanagariCandidate0', 'none', 'dev-candidate-0', 'भारतीय कथा'),
    sampleVideo('DevanagariCandidate1', 'none', 'dev-candidate-1', 'भारतीय संगीत'),
  ]);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const response = await new YoutubeService().rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    const items = response.rails.find((rail) => rail.rail_id === 'for_you')?.items ?? [];
    assert.equal(items.length, YOUTUBE_RAIL_LIMIT);
    assert.ok(items.some((item) => youtubeTitleScriptBucket(item.title) === 'devanagari'));
    assert.ok(items.some((item) => youtubeTitleScriptBucket(item.title) === 'latin'));
    assert.equal(new Set(items.map((item) => item.channel_id)).size, YOUTUBE_RAIL_LIMIT);
  } finally {
    Math.random = originalRandom;
  }
}));

test('For You does not force a script quota from one positive item', () => withTempState(async () => {
  const viewer = createViewerProfile('Sparse multilingual viewer');
  activateViewerProfile(viewer.profile_id);
  const evidence = [
    ...Array.from({ length: 3 }, (_, index) => (
      sampleVideo(`SparseLatinEvidence${index}`, 'none', `sparse-latin-evidence-${index}`, 'Science')
    )),
    sampleVideo('SparseDevanagariEvidence', 'none', 'sparse-dev-evidence', 'भारतीय'),
  ];
  cacheTasteEvidence(evidence);
  evidence.forEach((item, index) => saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: item.id, title: item.title,
    tab: 'youtube', saved_at: Date.now() + index,
  }));
  seedForYouCandidates([
    ...Array.from({ length: 4 }, (_, index) => (
      sampleVideo(`SparseLatinCandidate${index}`, 'none', `sparse-latin-candidate-${index}`, `Science topic${index}`)
    )),
    sampleVideo('SparseDevanagariCandidate0', 'none', 'sparse-dev-candidate-0', 'भारतीय कथा'),
    sampleVideo('SparseDevanagariCandidate1', 'none', 'sparse-dev-candidate-1', 'भारतीय संगीत'),
  ]);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const response = await new YoutubeService().rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    const items = response.rails.find((rail) => rail.rail_id === 'for_you')?.items ?? [];
    assert.equal(items.length, YOUTUBE_RAIL_LIMIT);
    assert.equal(items.some((item) => youtubeTitleScriptBucket(item.title) === 'devanagari'), false);
  } finally {
    Math.random = originalRandom;
  }
}));

test('For You does not force a script quota when secondary candidate supply is one', () => withTempState(async () => {
  const viewer = createViewerProfile('Thin multilingual supply');
  activateViewerProfile(viewer.profile_id);
  const evidence = [
    ...Array.from({ length: 3 }, (_, index) => (
      sampleVideo(`ThinLatinEvidence${index}`, 'none', `thin-latin-evidence-${index}`, 'Science')
    )),
    ...Array.from({ length: 2 }, (_, index) => (
      sampleVideo(`ThinDevanagariEvidence${index}`, 'none', `thin-dev-evidence-${index}`, 'भारतीय')
    )),
  ];
  cacheTasteEvidence(evidence);
  evidence.forEach((item, index) => saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: item.id, title: item.title,
    tab: 'youtube', saved_at: Date.now() + index,
  }));
  seedForYouCandidates([
    ...Array.from({ length: 4 }, (_, index) => (
      sampleVideo(`ThinLatinCandidate${index}`, 'none', `thin-latin-candidate-${index}`, `Science topic${index}`)
    )),
    sampleVideo('OnlyDevanagariCandidate', 'none', 'only-dev-candidate', 'भारतीय कथा'),
  ]);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const response = await new YoutubeService().rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    const items = response.rails.find((rail) => rail.rail_id === 'for_you')?.items ?? [];
    assert.equal(items.length, YOUTUBE_RAIL_LIMIT);
    assert.equal(items.some((item) => youtubeTitleScriptBucket(item.title) === 'devanagari'), false);
  } finally {
    Math.random = originalRandom;
  }
}));

test('Fire Water taste tags provide a bounded cross-domain YouTube relevance prior', () => withTempState(async () => {
  const viewer = createViewerProfile('Cross domain viewer');
  activateViewerProfile(viewer.profile_id);
  putRating({
    type: 'movie', id: 'tt-cross-domain', title: 'Interstellar',
    fire: 5, water: 5, expected_revision: 0,
    taste_tags: ['space exploration'],
  });
  seedForYouCandidates([
    sampleVideo('CrossDomainMatch', 'none', 'cross-domain-match', 'Interstellar space exploration'),
    sampleVideo('CrossDomainUnrelated', 'none', 'cross-domain-unrelated', 'Garden design workshop'),
  ]);
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const publicItems = response.rails.find((rail) => rail.rail_id === 'for_you')?.items ?? [];
  const items = internalDiscoveryRail(service, viewer.profile_id, 'for_you')?.items as Array<YoutubeItem & {
    source?: string;
  }> | undefined;
  assert.ok(items);
  assert.equal(response.rails.some((rail) => rail.rail_id === 'for_you'), false);
  assert.equal(items[0]?.id, 'CrossDomainMatch');
  // The VOD prior can discover relevance but stays below YouTube's familiar/history threshold.
  assert.equal(items.find((item) => item.id === 'CrossDomainMatch')?.source, 'discovery');
  assert.equal(items.find((item) => item.id === 'CrossDomainUnrelated')?.source, 'wildcard');
}));

test('low Fire Water ratings add a bounded semantic negative prior', () => withTempState(async () => {
  const viewer = createViewerProfile('Low rating viewer');
  activateViewerProfile(viewer.profile_id);
  putRating({
    type: 'movie', id: 'tt-low-space', title: 'Space fatigue',
    fire: 0.5, water: 0.5, expected_revision: 0,
    taste_tags: ['space exploration'],
  });
  seedForYouCandidates([
    sampleVideo('LowRatingMatch', 'none', 'low-rating-match', 'Space exploration documentary'),
    sampleVideo('LowRatingNeutral', 'none', 'low-rating-neutral', 'Garden design workshop'),
    sampleVideo('LowRatingNeutral2', 'none', 'low-rating-neutral-2', 'Cooking techniques workshop'),
    sampleVideo('LowRatingNeutral3', 'none', 'low-rating-neutral-3', 'Architecture studio workshop'),
  ]);
  const service = new YoutubeService();
  await service.rails({ reshuffle: true });
  const reserve = internalDiscoveryRail(service, viewer.profile_id, 'for_you')?.reserve_items as Array<YoutubeItem & {
    score: number;
  }> | undefined;
  assert.ok(reserve);
  const disliked = reserve.find((item) => item.id === 'LowRatingMatch');
  const neutral = reserve.find((item) => item.id === 'LowRatingNeutral');
  assert.ok(disliked && neutral);
  assert.ok(disliked.score < neutral.score);
}));

test('for you excludes watched shorts live not interested and recent exposures', () => withTempState(async () => {
  const candidates = [
    sampleVideo('WatchedVideo', 'none', 'watched-channel', 'Watched topic'),
    { ...sampleVideo('ShortVideo', 'none', 'short-channel', 'Short topic'), duration_sec: 45 },
    sampleVideo('LiveVideo', 'live', 'live-channel', 'Live topic'),
    sampleVideo('BlockedVideo', 'none', 'blocked-channel', 'Blocked topic'),
    sampleVideo('RecentExposure', 'none', 'recent-channel', 'Recent topic'),
    ...Array.from({ length: YOUTUBE_RAIL_LIMIT + 3 }, (_, index) => (
      sampleVideo(`Eligible${index}`, 'none', `eligible-channel-${index}`, `Eligible ${TOPIC_WORDS[index]}`)
    )),
  ];
  replaceYoutubeRailItems('popular', candidates.map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  // Seed the For-You reservoir directly. Previously the read path scanned
  // youtube_items on every GET and derived the reservoir on demand; now the
  // reservoir is rebuilt only during /youtube/refresh (or lazily once when
  // empty), so tests exercising the eligibility filters have to populate the
  // reservoir explicitly, mirroring what a refresh would do.
  upsertForYouCandidates(candidates.map((item, index) => ({
    item,
    lane: 'familiar',
    source: 'history',
    source_weight: 0.55,
    topic_cluster: item.title.toLowerCase().replace(/[^a-z0-9]+/g, ':'),
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  setHouseholdCandidateState('for_you', 'RecentExposure', { last_recommended_at: Date.now() });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchedVideo',
    title: 'Watched topic',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'BlockedVideo', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  const ids = forYou.items.map((item) => item.id);
  assert.equal(ids.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(!ids.includes('WatchedVideo'));
  assert.ok(!ids.includes('ShortVideo'));
  assert.ok(!ids.includes('LiveVideo'));
  assert.ok(!ids.includes('BlockedVideo'));
  assert.ok(!ids.includes('RecentExposure'));
}));

test('for you uses the current deterministic four-card mix pattern', () => withTempState(async () => {
  replaceYoutubeRailItems('new_from_subscriptions', Array.from({ length: 6 }, (_, index) => ({
    item: sampleVideo(`Sub${index}`, 'none', `sub-channel-${index}`, `Subscription ${TOPIC_WORDS[index]}`),
    score: 1 - index * 0.01,
    reason: 'subscription',
  })));
  replaceYoutubeRailItems('fresh_finds', Array.from({ length: 4 }, (_, index) => ({
    item: sampleVideo(`Fresh${index}`, 'none', `fresh-channel-${index}`, `Fresh ${TOPIC_WORDS[index + 6]}`),
    score: 1 - index * 0.01,
    reason: 'fresh',
  })));
  replaceYoutubeRailItems('popular', Array.from({ length: 4 }, (_, index) => ({
    item: sampleVideo(`Wild${index}`, 'none', `wild-channel-${index}`, `Wildcard ${TOPIC_WORDS[index + 10]}`),
    score: 1 - index * 0.01,
    reason: 'popular',
  })));
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  const ids = forYou.items.map((item) => item.id);
  assert.ok(ids.length <= YOUTUBE_RAIL_LIMIT);
  assert.equal(ids.filter((id) => id.startsWith('Sub')).length, 3);
  assert.equal(ids.filter((id) => id.startsWith('Fresh')).length, 1);
  assert.equal(ids.filter((id) => id.startsWith('Wild')).length, 0);
}));

test('healthy For You supply yields exactly 28 close, 8 adjacent, and 4 explore slots over ten slates', () => withTempState(async () => {
  const familiar = Array.from({ length: 32 }, (_, index) => sampleVideo(
    `MixFamiliar${index}`, 'none', `mix-familiar-channel-${index}`, `fam${index} topic${index}`,
  ));
  const adjacent = Array.from({ length: 16 }, (_, index) => sampleVideo(
    `MixAdjacent${index}`, 'none', `mix-adjacent-channel-${index}`, `adj${index} subject${index}`,
  ));
  const explore = Array.from({ length: 12 }, (_, index) => sampleVideo(
    `MixExplore${index}`, 'none', `mix-explore-channel-${index}`, `exp${index} idea${index}`,
  ));
  replaceYoutubeRailItems('new_from_subscriptions', familiar.map((item, index) => ({
    item, score: familiar.length - index, reason: 'subscription',
  })));
  replaceYoutubeRailItems('fresh_finds', adjacent.map((item, index) => ({
    item, score: adjacent.length - index, reason: 'fresh',
  })));
  replaceYoutubeRailItems('popular', explore.map((item, index) => ({
    item, score: explore.length - index, reason: 'popular',
  })));
  seedForYouCandidates([...familiar, ...adjacent, ...explore]);

  const service = new YoutubeService();
  const totals: Record<'familiar' | 'discovery' | 'wildcard', number> = {
    familiar: 0, discovery: 0, wildcard: 0,
  };
  for (let slate = 0; slate < 10; slate += 1) {
    const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    assert.equal(response.rails.find((rail) => rail.rail_id === 'for_you')?.items.length, YOUTUBE_RAIL_LIMIT);
    const internal = internalDiscoveryRail(service, 'household', 'for_you')?.items as Array<YoutubeItem & {
      lane: 'familiar' | 'discovery' | 'wildcard';
    }> | undefined;
    assert.equal(internal?.length, YOUTUBE_RAIL_LIMIT);
    for (const item of internal ?? []) totals[item.lane] += 1;
  }
  assert.deepEqual(totals, { familiar: 28, discovery: 8, wildcard: 4 });
  const diagnostic = getYoutubeState<{ fallback_slots: number; complete: boolean }>(
    'for_you_lane_fallback:last',
    { fallback_slots: -1, complete: false },
  );
  assert.deepEqual(diagnostic, {
    profile_id: 'household',
    slate_sequence: 10,
    requested: { familiar: 3, discovery: 1, wildcard: 0 },
    fulfilled_before_fallback: { familiar: 3, discovery: 1, wildcard: 0 },
    fallback_slots: 0,
    complete: true,
  });
}));

test('same YouTube evidence, profile, and slate sequence is deterministic across service restart', () => withTempState(async () => {
  const pool = Array.from({ length: 20 }, (_, index) => sampleVideo(
    `Deterministic${index}`, 'none', `deterministic-channel-${index}`, `det${index} topic${index}`,
  ));
  replaceYoutubeRailItems('popular', pool.map((item, index) => ({
    item, score: pool.length - index, reason: 'popular',
  })));
  seedForYouCandidates(pool);
  const firstService = new YoutubeService();
  const first = await firstService.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstIds = first.rails.find((rail) => rail.rail_id === 'for_you')?.items.map((item) => item.id);
  assert.equal(firstIds?.length, YOUTUBE_RAIL_LIMIT);

  setYoutubeState('recommendation_slate_sequence:household', 0);
  const restartedService = new YoutubeService();
  const restarted = await restartedService.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  assert.deepEqual(
    restarted.rails.find((rail) => rail.rail_id === 'for_you')?.items.map((item) => item.id),
    firstIds,
  );
}));

test('for you enforces channel and topic diversity', () => withTempState(async () => {
  const sameChannel = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`SameChannel${index}`, 'none', 'same-channel', `Shared topic ${index}`)
  ));
  const sameTopic = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`SameTopic${index}`, 'none', `topic-channel-${index}`, 'Deep dive mango')
  ));
  const filler = Array.from({ length: 9 }, (_, index) => (
    sampleVideo(`Filler${index}`, 'none', `filler-channel-${index}`, `Unique ${TOPIC_WORDS[index]}`)
  ));
  replaceYoutubeRailItems('popular', [...sameChannel, ...sameTopic, ...filler].map((item, index) => ({
    item,
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const forYou = response.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  assert.equal(forYou.items.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(forYou.items.filter((item) => item.channel_id === 'same-channel').length <= 1);
  assert.ok(forYou.items.filter((item) => item.title === 'Deep dive mango').length <= 2);
}));

test('for you reshuffle avoids recently exposed cards when reservoir is deep enough', () => withTempState(async () => {
  // Use modulo so topic clusters stay unique past TOPIC_WORDS.length — otherwise
  // "Shuffle undefined" collapses maxPerTopic and the rail underfills (flake).
  replaceYoutubeRailItems('popular', Array.from({ length: 30 }, (_, index) => ({
    item: sampleVideo(
      `Shuffle${index}`,
      'none',
      `shuffle-channel-${index}`,
      `Shuffle ${TOPIC_WORDS[index % TOPIC_WORDS.length]} ${index}`,
    ),
    score: 1 - index * 0.01,
    reason: 'test',
  })));
  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstForYou = first.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(firstForYou);
  assert.equal(firstForYou.items.length, YOUTUBE_RAIL_LIMIT);
  const second = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const secondForYou = second.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(secondForYou);
  assert.equal(secondForYou.items.length, YOUTUBE_RAIL_LIMIT);
  const firstIds = new Set(firstForYou.items.map((item) => item.id));
  assert.ok(secondForYou.items.some((item) => !firstIds.has(item.id)));
}));

test('history rail shows latest items up to cap', () => withTempState(async () => {
  for (let index = 0; index < 12; index += 1) {
    recordLibraryWatch({
      source: 'youtube',
      type: 'youtube_video',
      id: `History${index}`,
      title: `History video ${index}`,
      tab: 'youtube',
      event: 'play',
      watched_at: 1000 + index,
    });
  }
  recordLibraryWatch({
    source: 'mango',
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    tab: 'movies',
    event: 'play',
    watched_at: 5000,
  });
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'History11', reason: 'user' });
  const response = await service.rails() as { rails: YoutubeRail[] };
  const history = response.rails.find((rail) => rail.rail_id === 'history');
  assert.ok(history);
  const expected = Array.from({ length: YOUTUBE_RAIL_LIMIT }, (_, index) => `History${11 - index}`);
  assert.deepEqual(history.items.map((item) => item.id), expected);
}));

test('history rail stays stable during recommendation reshuffle', () => withTempState(async () => {
  for (let index = 0; index < 12; index += 1) {
    recordLibraryWatch({
      source: 'youtube',
      type: 'youtube_video',
      id: `History${index}`,
      title: `History video ${index}`,
      tab: 'youtube',
      event: 'play',
      watched_at: 1000 + index,
    });
  }
  const service = new YoutubeService();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    const history = response.rails.find((rail) => rail.rail_id === 'history');
    assert.ok(history);
    const ids = history.items.map((item) => item.id);
    assert.equal(ids.length, YOUTUBE_RAIL_LIMIT);
    assert.equal(new Set(ids).size, YOUTUBE_RAIL_LIMIT);
    assert.deepEqual(ids, ['History11', 'History10', 'History9', 'History8']);
  } finally {
    Math.random = originalRandom;
  }
}));

test('because you watched follows the latest watched YouTube video from cache', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('WatchOld', 'none', 'old-channel', 'Old documentary'), score: 1, reason: 'test' },
    { item: sampleVideo('OldCandidate', 'none', 'old-channel', 'Another old documentary'), score: 0.9, reason: 'test' },
    { item: sampleVideo('WatchNew', 'none', 'new-channel', 'New cooking tour'), score: 0.8, reason: 'test' },
    { item: sampleVideo('NewCandidate', 'none', 'new-channel', 'Another cooking tour'), score: 0.7, reason: 'test' },
  ]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchOld',
    title: 'Old documentary',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchNew',
    title: 'New cooking tour',
    tab: 'youtube',
    event: 'play',
    watched_at: 2000,
  });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const because = internalDiscoveryRail(service, 'household', 'because_you_watched');
  assert.ok(because);
  assert.equal(because.items[0]?.id, 'NewCandidate');
}));

test('served YouTube attribution keeps the exact Because You Watched seed after the live profile advances', () => withTempState(async () => {
  const firstSeed = sampleVideo('AttributionSeedA', 'none', 'seed-a-channel', 'First science documentary');
  const secondSeed = sampleVideo('AttributionSeedB', 'none', 'seed-b-channel', 'Second cooking documentary');
  replaceYoutubeRailItems('popular', [
    { item: firstSeed, score: 1, reason: 'seed-a' },
    { item: secondSeed, score: 0.9, reason: 'seed-b' },
  ]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: firstSeed.id,
    title: firstSeed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 1_000,
  });
  upsertBecauseCandidates(firstSeed, 1_000, Array.from({ length: 8 }, (_, index) => ({
    item: sampleVideo(
      `AttributionA${index}`,
      'none',
      `attribution-a-channel-${index}`,
      `First science follow up ${TOPIC_WORDS[index]}`,
    ),
    topic: `attribution-a-${index}`,
  })));

  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as {
    rails: YoutubeRail[];
    slate_sequence: number;
    attribution_contexts: Record<string, { source_revision: number; context_id: string }>;
  };
  const firstRail = first.rails.find((rail) => rail.rail_id === 'because_you_watched');
  assert.ok(firstRail);
  assert.equal(Object.hasOwn(firstRail, 'candidate_context_id'), false);
  assert.deepEqual(first.attribution_contexts.because_you_watched, {
    source_revision: first.slate_sequence,
    context_id: firstSeed.id,
  });

  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: secondSeed.id,
    title: secondSeed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 2_000,
  });
  upsertBecauseCandidates(secondSeed, 2_000, Array.from({ length: 8 }, (_, index) => ({
    item: sampleVideo(
      `AttributionB${index}`,
      'none',
      `attribution-b-channel-${index}`,
      `Second cooking follow up ${TOPIC_WORDS[index + 8]}`,
    ),
    topic: `attribution-b-${index}`,
  })));
  service.invalidateRailsCache();
  const second = await service.rails({ reshuffle: true }) as {
    slate_sequence: number;
    attribution_contexts: Record<string, { source_revision: number; context_id: string }>;
  };
  assert.notEqual(second.slate_sequence, first.slate_sequence);
  assert.equal(second.attribution_contexts.because_you_watched?.context_id, secondSeed.id);

  const firstIds = firstRail.items.map((item) => item.id);
  service.impressions({
    profile_id: 'household',
    slate_sequence: first.slate_sequence,
    rails: [{
      rail_id: 'because_you_watched',
      context_id: first.attribution_contexts.because_you_watched!.context_id,
      item_ids: firstIds,
    }],
  });
  assert.deepEqual(
    new Set(listYoutubeProfileCandidateStates({
      profile_id: 'household',
      rail_id: 'because_you_watched',
      context_id: firstSeed.id,
    }).map((item) => item.id)),
    new Set(firstIds),
  );
  assert.deepEqual(listYoutubeProfileCandidateStates({
    profile_id: 'household',
    rail_id: 'because_you_watched',
    context_id: secondSeed.id,
  }), []);
}));

test('because you watched scans past repeated live history to find a non-live seed', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [
    { item: sampleVideo('LiveSeed', 'live', 'live-channel', 'lofi radio live'), score: 1, reason: 'test' },
    { item: sampleVideo('WatchNew', 'none', 'new-channel', 'New cooking tour'), score: 0.9, reason: 'test' },
    { item: sampleVideo('NewCandidate', 'none', 'new-channel', 'Another cooking tour'), score: 0.8, reason: 'test' },
  ]);
  for (let index = 0; index < 8; index += 1) {
    recordLibraryWatch({
      source: 'youtube',
      type: 'youtube_video',
      id: 'LiveSeed',
      title: 'lofi radio live',
      tab: 'youtube',
      event: 'play',
      watched_at: 2000 + index,
    });
  }
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchNew',
    title: 'New cooking tour',
    tab: 'youtube',
    event: 'play',
    watched_at: 1000,
  });
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const because = internalDiscoveryRail(service, 'household', 'because_you_watched');
  assert.ok(because);
  assert.equal(because.items[0]?.id, 'NewCandidate');
}));

test('because you watched failed refresh keeps cached seed reservoir visible', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const seed = sampleVideo('SeedStale', 'none', 'seed-stale-channel', 'Stale cooking tour');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  upsertBecauseCandidates(seed, 5000, Array.from({ length: YOUTUBE_RAIL_LIMIT }, (_, index) => ({
    item: sampleVideo(`BecauseStale${index}`, 'none', `because-stale-${index}`, `Stale cooking follow up ${TOPIC_WORDS[index]}`),
    relation: index < 3 ? 'same_topic' : index < 6 ? 'deeper_dive' : 'wildcard',
    topic: `stale-because-${index}`,
  })));
  globalThis.fetch = (async () => apiErrorResponse('quota exceeded')) as typeof fetch;

  const service = new YoutubeService();
  const refresh = await service.refresh('test_failure');
  assert.equal(refresh.ok, true);
  assert.match(refresh.refresh.last_error || '', /partial refresh/);
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'popular' && !phase.ok));
  assert.ok(refresh.refresh.phase_results.some((phase) => phase.phase === 'because_you_watched' && phase.ok));
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(rail.items.every((item) => item.id.startsWith('BecauseStale')));
}));

test('because you watched excludes watched saved live shorts blocked low signal recent exposure and short duration', () => withTempState(async () => {
  const seed = sampleVideo('BecauseSeed', 'none', 'seed-channel', 'Travel food documentary');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'BecauseWatched',
    title: 'Watched follow up',
    tab: 'youtube',
    event: 'play',
    watched_at: 4000,
  });
  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'BecauseSaved',
    title: 'Saved follow up',
    tab: 'youtube',
  });
  const candidates = [
    sampleVideo('BecauseWatched', 'none', 'watched-channel', 'Watched follow up'),
    sampleVideo('BecauseSaved', 'none', 'saved-channel', 'Saved follow up'),
    sampleVideo('BecauseLive', 'live', 'live-channel', 'Live follow up'),
    { ...sampleVideo('BecauseShort', 'none', 'short-channel', 'Short follow up'), duration_sec: 45 },
    { ...sampleVideo('BecauseUnderEight', 'none', 'under-eight-channel', 'Under eight follow up'), duration_sec: 300 },
    sampleVideo('BecauseLowSignal', 'none', 'low-signal-channel', 'SSC MTS result cutoff follow up'),
    sampleVideo('BecauseBlocked', 'none', 'blocked-channel', 'Blocked follow up'),
    sampleVideo('BecauseRecent', 'none', 'recent-channel', 'Recent follow up'),
    ...Array.from({ length: YOUTUBE_RAIL_LIMIT + 3 }, (_, index) => (
      sampleVideo(`BecauseEligible${index}`, 'none', `because-eligible-${index}`, `Travel food follow up ${TOPIC_WORDS[index]}`)
    )),
  ];
  upsertBecauseCandidates(seed, 5000, candidates.map((item, index) => ({
    item,
    relation: index % 3 === 0 ? 'same_topic' : index % 3 === 1 ? 'deeper_dive' : 'wildcard',
    topic: `because-filter-${index}`,
  })));
  setHouseholdCandidateState(
    'because_you_watched',
    'BecauseRecent',
    { last_recommended_at: Date.now() },
    seed.id,
  );
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: 'BecauseBlocked', reason: 'user' });
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  const ids = rail.items.map((item) => item.id);
  assert.equal(ids.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(!ids.includes('BecauseWatched'));
  assert.ok(!ids.includes('BecauseSaved'));
  assert.ok(!ids.includes('BecauseLive'));
  assert.ok(!ids.includes('BecauseShort'));
  assert.ok(!ids.includes('BecauseUnderEight'));
  assert.ok(!ids.includes('BecauseLowSignal'));
  assert.ok(!ids.includes('BecauseBlocked'));
  assert.ok(!ids.includes('BecauseRecent'));
}));

test('because you watched enforces channel and topic diversity before relaxing', () => withTempState(async () => {
  const seed = sampleVideo('BecauseDiversitySeed', 'none', 'seed-channel', 'Mango topic documentary');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  const sameChannel = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`BecauseSameChannel${index}`, 'none', 'same-channel', `Mango channel follow up ${index}`)
  ));
  const sameTopic = Array.from({ length: 4 }, (_, index) => (
    sampleVideo(`BecauseSameTopic${index}`, 'none', `topic-channel-${index}`, `Mango shared topic ${index}`)
  ));
  const filler = Array.from({ length: 9 }, (_, index) => (
    sampleVideo(`BecauseFiller${index}`, 'none', `because-filler-${index}`, `Distinct ${TOPIC_WORDS[index]}`)
  ));
  upsertBecauseCandidates(seed, 5000, [
    ...sameChannel.map((item) => ({ item, relation: 'same_channel' as const, topic: `same-channel-${item.id}` })),
    ...sameTopic.map((item) => ({ item, relation: 'same_topic' as const, topic: 'shared-topic' })),
    ...filler.map((item, index) => ({ item, relation: 'wildcard' as const, topic: `filler-topic-${index}` })),
  ]);
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT);
  assert.ok(rail.items.filter((item) => item.channel_id === 'same-channel').length <= 1);
  assert.ok(rail.items.filter((item) => item.title.startsWith('Mango shared topic')).length <= 2);
}));

test('because you watched reshuffle avoids recently exposed cached follow-ups when deep enough', () => withTempState(async () => {
  const seed = sampleVideo('BecauseShuffleSeed', 'none', 'seed-channel', 'Shuffle cooking travel');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  upsertBecauseCandidates(seed, 5000, Array.from({ length: 30 }, (_, index) => ({
    item: sampleVideo(`BecauseShuffle${index}`, 'none', `because-shuffle-${index}`, `Shuffle cooking travel ${TOPIC_WORDS[index % TOPIC_WORDS.length]}`),
    relation: index % 4 === 0
      ? 'same_channel'
      : index % 4 === 1
        ? 'same_topic'
        : index % 4 === 2
          ? 'deeper_dive'
          : 'wildcard',
    topic: `because-shuffle-${index}`,
  })));
  const service = new YoutubeService();
  const first = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const firstRail = first.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(firstRail);
  assert.equal(firstRail.items.length, YOUTUBE_RAIL_LIMIT);
  const second = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const secondRail = second.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(secondRail);
  assert.equal(secondRail.items.length, YOUTUBE_RAIL_LIMIT);
  const firstIds = new Set(firstRail.items.map((item) => item.id));
  assert.ok(secondRail.items.some((item) => !firstIds.has(item.id)));
}));

test('because you watched relaxes recent exposure and duration only when thin', () => withTempState(async () => {
  const seed = sampleVideo('BecauseThinSeed', 'none', 'seed-channel', 'Thin cooking travel');
  replaceYoutubeRailItems('popular', [{ item: seed, score: 1, reason: 'seed' }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: seed.id,
    title: seed.title,
    tab: 'youtube',
    event: 'play',
    watched_at: 5000,
  });
  const rows = [
    ...Array.from({ length: 2 }, (_, index) => (
      sampleVideo(`BecauseThin${index}`, 'none', `because-thin-${index}`, `Thin cooking travel ${TOPIC_WORDS[index]}`)
    )),
    sampleVideo('BecauseRecentFallback', 'none', 'because-thin-recent', 'Recent fallback cooking'),
    { ...sampleVideo('BecauseShortDurationFallback', 'none', 'because-thin-short', 'Short duration fallback cooking'), duration_sec: 300 },
  ];
  upsertBecauseCandidates(seed, 5000, rows.map((item, index) => ({
    item,
    relation: index < 3 ? 'same_topic' : 'wildcard',
    topic: `because-thin-${index}`,
  })));
  setHouseholdCandidateState(
    'because_you_watched',
    'BecauseRecentFallback',
    { last_recommended_at: Date.now() },
    seed.id,
  );
  const service = new YoutubeService();
  const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const rail = response.rails.find((entry) => entry.rail_id === 'because_you_watched');
  assert.ok(rail);
  assert.equal(rail.items.length, YOUTUBE_RAIL_LIMIT);
  const ids = rail.items.map((item) => item.id);
  assert.ok(ids.includes('BecauseRecentFallback'));
  assert.ok(ids.includes('BecauseShortDurationFallback'));
}));

test('rails retry from one immutable profile snapshot instead of mixing an in-flight profile switch', () => withTempState(async () => {
  const alice = createViewerProfile('Snapshot Alice');
  const bob = createViewerProfile('Snapshot Bob');
  activateViewerProfile(bob.profile_id);
  for (let index = 0; index < 4; index += 1) {
    recordLibraryWatch({
      source: 'youtube', type: 'youtube_video', id: `SnapshotBob${index}`,
      title: `Bob history ${index}`, tab: 'youtube', event: 'play', watched_at: 2_000 + index,
    });
  }
  activateViewerProfile(alice.profile_id);
  for (let index = 0; index < 4; index += 1) {
    recordLibraryWatch({
      source: 'youtube', type: 'youtube_video', id: `SnapshotAlice${index}`,
      title: `Alice history ${index}`, tab: 'youtube', event: 'play', watched_at: 1_000 + index,
    });
  }
  const service = new YoutubeService();
  const pending = service.rails({ reshuffle: true });
  activateViewerProfile(bob.profile_id);
  const response = await pending as { rails: YoutubeRail[] };
  const history = response.rails.find((rail) => rail.rail_id === 'history');
  assert.deepEqual(
    new Set(history?.items.map((item) => item.id)),
    new Set(Array.from({ length: 4 }, (_, index) => `SnapshotBob${index}`)),
  );
  assert.equal(history?.items.some((item) => item.id.startsWith('SnapshotAlice')), false);
  assert.equal(internalDiscoveryRail(service, alice.profile_id, 'for_you'), undefined);
}));

test('rails echo the exact owner and reject a caller whose expected owner is stale', () => withTempState(async () => {
  const alice = createViewerProfile('Expected Alice');
  const bob = createViewerProfile('Expected Bob');
  const expected = activateViewerProfile(alice.profile_id);
  const service = new YoutubeService();
  const response = await service.rails({ expectedPersonalization: expected });
  assert.equal(response.profile_id, alice.profile_id);
  assert.equal(response.personalization_updated_at, expected.updated_at);

  activateViewerProfile(bob.profile_id);
  await assert.rejects(
    service.rails({ expectedPersonalization: expected }),
    (error: unknown) => (
      error instanceof Error
      && 'status' in error
      && (error as Error & { status: number }).status === 409
    ),
  );
}));

test('concurrent full YouTube refreshes execute serially', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const service = new YoutubeService();
  const internal = service as unknown as {
    refreshPopularFromApi: () => Promise<void>;
    refreshSubscriptionsIfAuthorized: () => Promise<void>;
    refreshFreshFindsFromApi: () => Promise<void>;
    refreshLiveNowFromApi: () => Promise<void>;
    refreshBecauseYouWatchedFromApi: (context: unknown) => Promise<void>;
    expandForYouDiscoveryFromApi: () => Promise<void>;
    rebuildForYouReservoir: () => void;
  };
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  internal.refreshPopularFromApi = async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls === 1) await firstGate;
    active -= 1;
  };
  internal.refreshSubscriptionsIfAuthorized = async () => undefined;
  internal.refreshFreshFindsFromApi = async () => undefined;
  internal.refreshLiveNowFromApi = async () => undefined;
  internal.refreshBecauseYouWatchedFromApi = async () => undefined;
  internal.expandForYouDiscoveryFromApi = async () => undefined;
  internal.rebuildForYouReservoir = () => undefined;

  const first = service.refresh('serial-first');
  const second = service.refresh('serial-second');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(maxActive, 1);
  releaseFirst();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.ok), [true, true]);
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
}));

test('Alice-triggered acquisition stays neutral and remains renderable for Bob', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const alice = createViewerProfile('Acquisition Alice');
  const bob = createViewerProfile('Acquisition Bob');
  activateViewerProfile(alice.profile_id);
  const subscriptionItems = Array.from({ length: 4 }, (_, index) => sampleVideo(
    `AcqSubscription${index}`, 'none', `acq-subscription-channel-${index}`, `Acquisition subscription ${TOPIC_WORDS[index]}`,
  ));
  const freshItems = Array.from({ length: 4 }, (_, index) => sampleVideo(
    `AcqFresh${index}`, 'none', `acq-fresh-channel-${index}`, `Acquisition fresh ${TOPIC_WORDS[index + 4]}`,
  ));
  const liveItems = Array.from({ length: 4 }, (_, index) => sampleVideo(
    `AcqLive${index}`, 'live', `acq-live-channel-${index}`, `Live event ${TOPIC_WORDS[index + 8]}`,
  ));
  const service = new YoutubeService();
  service.notInterested({ kind: 'video', id: subscriptionItems[0].id, reason: 'alice-only' });
  service.notInterested({ kind: 'video', id: freshItems[0].id, reason: 'alice-only' });
  service.notInterested({ kind: 'video', id: liveItems[0].id, reason: 'alice-only' });
  const internal = service as unknown as {
    api: {
      subscriptions: () => Promise<YoutubeItem[]>;
      channelUploadPlaylists: () => Promise<Map<string, string>>;
      playlistItems: () => Promise<YoutubeItem[]>;
      search: () => Promise<{ videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[] }>;
      channelStats: () => Promise<Map<string, never>>;
      videos: () => Promise<YoutubeItem[]>;
    };
    refreshSubscriptionsFromApi: (token: string) => Promise<void>;
    refreshFreshFindsFromApi: () => Promise<void>;
    refreshLiveNowFromApi: () => Promise<void>;
  };
  internal.api.subscriptions = async () => [sampleVideo('AcqSubscriptionChannel')];
  internal.api.channelUploadPlaylists = async () => new Map([['AcqSubscriptionChannel', 'acq-uploads']]);
  internal.api.playlistItems = async () => subscriptionItems;
  await internal.refreshSubscriptionsFromApi('token');

  internal.api.search = async () => ({ videos: freshItems, channels: [], playlists: [] });
  internal.api.channelStats = async () => new Map<string, never>();
  await internal.refreshFreshFindsFromApi();

  internal.api.search = async () => ({ videos: liveItems, channels: [], playlists: [] });
  internal.api.videos = async () => liveItems;
  await internal.refreshLiveNowFromApi();
  assert.ok(listFreshFindCandidates().some((item) => item.id === freshItems[0].id));
  assert.ok(listLiveNowCandidates().some((item) => item.id === liveItems[0].id));

  activateViewerProfile(bob.profile_id);
  service.invalidateRailsCache();
  await service.rails({ reshuffle: true });
  assert.ok(internalDiscoveryRail(service, bob.profile_id, 'new_from_subscriptions')?.items
    .some((item) => item.id === subscriptionItems[0].id));
  assert.ok(internalDiscoveryRail(service, bob.profile_id, 'fresh_finds')?.items
    .some((item) => item.id === freshItems[0].id));
  assert.ok(internalDiscoveryRail(service, bob.profile_id, 'live_now')?.items
    .some((item) => item.id === liveItems[0].id));
}));

test('rails payload is served from cache within TTL', () => withTempState(async () => {
  upsertPopularCandidatesForTest(Array.from({ length: 4 }, (_, index) => ({
    item: sampleVideo(`PopCache${index}`, 'none', `pop-cache-channel-${index}`),
    score: 4 - index,
  })));
  const service = new YoutubeService();
  const first = await service.rails() as { rails: YoutubeRail[] };
  const firstPopular = first.rails.find((rail) => rail.rail_id === 'popular');
  assert.ok(firstPopular);
  const firstIds = firstPopular.items.map((item) => item.id);
  assert.equal(firstIds.length, YOUTUBE_RAIL_LIMIT);
  // Mutate the underlying popular pool with a much higher-scored entry. If the
  // second call recomputed, PopCacheHigher would appear (and outrank
  // PopCacheFirst). It must not, because the payload is cached.
  upsertPopularCandidatesForTest([
    { item: sampleVideo('PopCacheHigher'), score: 100 },
  ]);
  const second = await service.rails() as { rails: YoutubeRail[] };
  const secondPopular = second.rails.find((rail) => rail.rail_id === 'popular');
  assert.ok(secondPopular);
  assert.deepEqual(secondPopular.items.map((item) => item.id), firstIds);
}));

test('rails reshuffle bypasses the payload cache', () => withTempState(async () => {
  upsertPopularCandidatesForTest(Array.from({ length: 4 }, (_, index) => ({
    item: sampleVideo(`PopReshuffleBase${index}`, 'none', `pop-reshuffle-channel-${index}`),
    score: 4 - index,
  })));
  const service = new YoutubeService();
  await service.rails();
  upsertPopularCandidatesForTest([{ item: sampleVideo('PopReshuffleExtra'), score: 100 }]);
  const shuffled = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
  const popular = shuffled.rails.find((rail) => rail.rail_id === 'popular');
  assert.ok(popular);
  assert.ok(popular.items.some((item) => item.id === 'PopReshuffleExtra'));
}));

test('not interested invalidates the cached rails payload', () => withTempState(async () => {
  upsertPopularCandidatesForTest([
    { item: sampleVideo('PopKeepAfterNI'), score: 1 },
    { item: sampleVideo('PopDropAfterNI'), score: 0.9 },
    { item: sampleVideo('PopKeepAfterNI2', 'none', 'pop-keep-2'), score: 0.8 },
    { item: sampleVideo('PopKeepAfterNI3', 'none', 'pop-keep-3'), score: 0.7 },
    { item: sampleVideo('PopKeepAfterNI4', 'none', 'pop-keep-4'), score: 0.6 },
  ]);
  const service = new YoutubeService();
  const first = await service.rails() as { rails: YoutubeRail[] };
  const firstPop = first.rails.find((rail) => rail.rail_id === 'popular');
  assert.ok(firstPop);
  assert.deepEqual(
    firstPop.items.map((item) => item.id).sort(),
    ['PopDropAfterNI', 'PopKeepAfterNI', 'PopKeepAfterNI2', 'PopKeepAfterNI3'],
  );
  service.notInterested({ kind: 'video', id: 'PopDropAfterNI', reason: 'user' });
  const second = await service.rails() as { rails: YoutubeRail[] };
  const secondPop = second.rails.find((rail) => rail.rail_id === 'popular');
  assert.ok(secondPop);
  assert.deepEqual(
    new Set(secondPop.items.map((item) => item.id)),
    new Set(['PopKeepAfterNI', 'PopKeepAfterNI2', 'PopKeepAfterNI3', 'PopKeepAfterNI4']),
  );
}));

test('for you reservoir is not rebuilt on cached repeat GET', () => withTempState(async () => {
  upsertPopularCandidatesForTest(Array.from({ length: 4 }, (_, index) => ({
    item: sampleVideo(`ResSeed${index}`, 'none', `res-seed-channel-${index}`),
    score: 4 - index,
  })));
  const service = new YoutubeService();
  await service.rails();
  // A second popular candidate is added AFTER the reservoir has been lazily
  // built. Because the payload cache is served, the discovery rails must not
  // recompute — the new item must NOT appear in For You.
  upsertPopularCandidatesForTest([
    { item: sampleVideo('ResNew'), score: 100 },
  ]);
  const second = await service.rails() as { rails: YoutubeRail[] };
  const forYou = second.rails.find((rail) => rail.rail_id === 'for_you');
  assert.ok(forYou);
  assert.ok(!forYou.items.some((item) => item.id === 'ResNew'));
}));

test('YouTube rails follow the canonical tab order', () => withTempState(async () => {
  const popularItems = Array.from({ length: 8 }, (_, index) => sampleVideo(
    `Pop${index}`, 'none', `pop-order-channel-${index}`, `Popular order ${TOPIC_WORDS[index]}`,
  ));
  const subscriptionItems = Array.from({ length: 4 }, (_, index) => sampleVideo(
    `Sub${index}`, 'none', `sub-order-channel-${index}`, `Subscription order ${TOPIC_WORDS[index + 8]}`,
  ));
  replaceYoutubeRailItems('popular', popularItems.map((item, index) => ({ item, score: 8 - index, reason: 'test' })));
  replaceYoutubeRailItems('new_from_subscriptions', subscriptionItems.map((item, index) => ({ item, score: 4 - index, reason: 'test' })));
  upsertPopularCandidatesForTest(popularItems.map((item, index) => ({ item, score: 8 - index })));
  const service = new YoutubeService();
  const response = await service.rails() as { rails: YoutubeRail[] };
  const railIds = response.rails.map((rail) => rail.rail_id);
  const forYouIdx = railIds.indexOf('for_you');
  const subIdx = railIds.indexOf('new_from_subscriptions');
  const liveIdx = railIds.indexOf('live_now');
  const becauseIdx = railIds.indexOf('because_you_watched');
  const freshIdx = railIds.indexOf('fresh_finds');
  const popularIdx = railIds.indexOf('popular');
  const historyIdx = railIds.indexOf('history');
  assert.ok(forYouIdx >= 0);
  assert.ok(subIdx > forYouIdx);
  if (liveIdx >= 0) assert.ok(liveIdx > subIdx);
  if (becauseIdx >= 0 && liveIdx >= 0) assert.ok(becauseIdx > liveIdx);
  if (freshIdx >= 0 && becauseIdx >= 0) assert.ok(freshIdx > becauseIdx);
  if (popularIdx >= 0 && freshIdx >= 0) assert.ok(popularIdx > freshIdx);
  if (historyIdx >= 0 && popularIdx >= 0) assert.ok(historyIdx > popularIdx);
}));

test('freshStart clears YouTube watch history and personalization reservoirs', () => withTempState(async () => {
  replaceYoutubeRailItems('popular', [{ item: sampleVideo('Pop'), score: 1, reason: 'test' }]);
  upsertPopularCandidatesForTest([{ item: sampleVideo('Pop'), score: 1 }]);
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'WatchedOnce',
    title: 'Watched once',
    tab: 'youtube',
    position_sec: 120,
    duration_sec: 600,
  });
  const service = new YoutubeService();
  const result = await service.freshStart() as {
    ok: boolean;
    cleared: { watch_history: number; reservoirs: { candidates_cleared: number } };
  };
  assert.equal(result.cleared.watch_history, 1);
  assert.ok(result.cleared.reservoirs.candidates_cleared > 0);
  const response = await service.rails() as { rails: YoutubeRail[] };
  assert.equal(response.rails.some((rail) => rail.rail_id === 'history'), false);
}));

test('railRelated samples pool titles outside the home exclude set', () => withTempState(async () => {
  const pool = Array.from({ length: 20 }, (_, index) => ({
    item: sampleVideo(`Pool${index}`),
    score: 1 - index * 0.01,
    reason: 'test',
  }));
  replaceYoutubeRailItems('popular', pool);
  upsertPopularCandidatesForTest(pool.map((entry, index) => ({
    item: entry.item,
    score: 1 - index * 0.01,
  })));
  const service = new YoutubeService();
  const exclude = Array.from({ length: 12 }, (_, index) => ({
    type: 'youtube_video',
    id: `Pool${index}`,
  }));
  const response = await service.railRelated('popular', exclude, 8) as { items: YoutubeItem[] };
  assert.equal(response.items.length, 8);
  for (const item of response.items) {
    assert.ok(Number(item.id.replace('Pool', '')) >= 12);
  }
}));
