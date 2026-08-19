import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { CatalogError } from '../catalog-errors.js';
import {
  activateViewerProfile,
  createViewerProfile,
  getPersonalizationState,
  libraryDatabase,
  recordLibraryWatch,
  resetLibraryDbForTests,
  saveLibraryItem,
  setLibraryFeedback,
} from '../library/db.js';
import {
  getYoutubeState,
  latestYoutubeV2Generation,
  latestYoutubeV2GenerationRecord,
  latestYoutubeV2TakeoutImport,
  listYoutubeV2CandidateProvenance,
  listYoutubeV2ImportedHistory,
  listYoutubeV2Subscriptions,
  migrateLegacyYoutubeV2TakeoutToLibrary,
  recordYoutubeV2TakeoutImport,
  publishYoutubeV2Generation,
  recordYoutubeImpressions,
  replaceYoutubeV2Subscriptions,
  resetYoutubeDbForTests,
  setYoutubeState,
  upsertYoutubeItems,
  upsertYoutubeV2CandidateProvenance,
  upsertYoutubeV2ImportedHistory,
  youtubeRefreshStatus,
} from './db.js';
import {
  refreshYoutubeAfterTakeoutImport,
  refreshYoutubeV2AfterLocalSignal,
  YoutubeService,
  youtubeV2AcquisitionQueryBudget,
} from './service.js';
import {
  createYoutubeV2CandidateQualityEvaluator,
  invalidateYoutubeV2ExactExclusions,
  invalidateYoutubeV2HistoryItems,
  rebuildYoutubeV2Generation,
  YOUTUBE_V2_MORE_LIKE_QUERY_SIZE,
  YOUTUBE_V2_MORE_LIKE_TARGET,
  YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
  YOUTUBE_V2_C_TIER_LIMIT,
  YOUTUBE_V2_RESERVE_LIMIT,
  YOUTUBE_V2_WATCH_COOLDOWN_MS,
  youtubePublicPersonalizationPayload,
  youtubeRecommendationsV2Mode,
  youtubeV2HistoryItems,
  youtubeV2ExactExclusionCacheDiagnostics,
  youtubeV2Diagnostics,
  youtubeV2ExactExcludedIds,
  youtubeV2MoreLikeSeeds,
  youtubeV2RecommendationRails,
  youtubeV2RecommendationRailsFromSnapshot,
  youtubeV2SourceStaleState,
  youtubeV2TopicSeed,
  youtubeV2QualityTier,
  youtubeV2WeightedPoolDiagnostics,
  youtubeV2WeightedShuffle,
  weightedDailyHistorySeedId,
} from './v2.js';
import type { YoutubeItem, YoutubeRail } from './types.js';
import { evaluateYoutubeVariants } from './eval-cli.js';

function video(
  id: string,
  title: string,
  channelId: string,
  liveStatus: YoutubeItem['live_status'] = 'none',
): YoutubeItem {
  return {
    id,
    kind: 'video',
    title,
    subtitle: `Channel ${channelId}`,
    description: `${title} documentary analysis`,
    thumbnail: `https://img.example/${id}.jpg`,
    channel_id: channelId,
    channel_title: `Channel ${channelId}`,
    published_at: '2026-07-01T00:00:00Z',
    duration_sec: 600,
    live_status: liveStatus,
    playlist_id: null,
    updated_at: Date.now(),
  };
}

function rankedVideos(items: YoutubeItem[]) {
  return items.map((item, source_rank) => ({ item, source_rank }));
}

function importOfficialHistory(
  items: readonly YoutubeItem[],
  at = Date.now(),
  sourceGeneration = `takeout-test-${at}`,
): void {
  upsertYoutubeV2ImportedHistory(items.map((item, index) => ({
    video_id: item.id,
    title: item.title,
    title_url: null,
    channel_id: item.channel_id,
    channel_title: item.channel_title,
    watched_at: at - index * 1_000,
  })), { source_generation: sourceGeneration, imported_at: at });
}

function withTempState<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-v2-'));
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_YOUTUBE_API_KEY_FILE = join(dir, 'missing-api-key');
  process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE = join(dir, 'missing-oauth.json');
  process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE = join(dir, 'missing-auth.json');
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const cleanup = () => {
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_YOUTUBE_API_KEY_FILE;
    delete process.env.MANGO_YOUTUBE_API_KEY;
    delete process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE;
    delete process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE;
    delete process.env.MANGO_YOUTUBE_RECS_V2;
    delete process.env.MANGO_YOUTUBE_EMBEDDINGS;
    delete process.env.MANGO_YOUTUBE_SIM;
    delete process.env.MANGO_YOUTUBE_SCORING;
    delete process.env.MANGO_YTDLP_COMMAND;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

type SeededV2 = {
  history: YoutubeItem[];
  saved: YoutubeItem[];
  chartOnly: YoutubeItem;
  watchedChannel: string;
  subscriptionChannels: Set<string>;
};

function seedV2(): SeededV2 {
  const now = Date.now();
  const watchedChannel = 'watched-channel';
  const history = Array.from({ length: 4 }, (_, index) => video(
    `WatchSeed${index}`,
    `Fermentation science kitchen ${index}`,
    watchedChannel,
  ));
  const saved = Array.from({ length: 4 }, (_, index) => video(
    `SavedOnly${index}`,
    `Saved household title ${index}`,
    `saved-channel-${index}`,
  ));
  const subscriptionChannels = new Set(Array.from({ length: 16 }, (_, index) => `subscribed-channel-${index}`));
  const subscriptionVideos = [...subscriptionChannels].slice(0, 12).map((channel, index) => video(
    `SubVideo${index}`,
    `Fermentation subscription ${index}`,
    channel,
  ));
  const topicVideos = Array.from({ length: 24 }, (_, index) => video(
    `TopicVideo${index}`,
    `Fermentation science field guide ${index}`,
    `topic-channel-${index}`,
  ));
  const channelVideos = Array.from({ length: 12 }, (_, index) => video(
    `ChannelVideo${index}`,
    `Fermentation creator followup ${index}`,
    watchedChannel,
  ));
  const liveVideos = [...subscriptionChannels].slice(12).map((channel, index) => video(
    `SubscribedLive${index}`,
    `Fermentation live session ${index}`,
    channel,
    'live',
  ));
  const short = { ...video('ShortBlocked01', '#shorts fermentation', 'subscribed-channel-0'), duration_sec: 40 };
  const conservativeShort = {
    ...video('ShortBlocked02', 'Vertical-format duration unknown locally', 'subscribed-channel-1'),
    duration_sec: 180,
  };
  const chartOnly = video('ChartOnly01', 'Unrelated generic chart hit', 'chart-channel');
  upsertYoutubeItems([
    ...history, ...saved, ...subscriptionVideos, ...topicVideos, ...channelVideos,
    ...liveVideos, short, conservativeShort, chartOnly,
  ]);
  replaceYoutubeV2Subscriptions([...subscriptionChannels].map((channel) => ({
    channel_key: channel,
    channel_id: channel,
    channel_title: `Channel ${channel}`,
    channel_url: `https://www.youtube.com/channel/${channel}`,
    source: 'oauth' as const,
    subscribed_at: null,
  })), { source_generation: 'subscriptions-v1', imported_at: now });
  importOfficialHistory(history, now, 'takeout-seed-v2');
  saved.forEach((item, index) => saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: item.id,
    title: item.title,
    tab: 'youtube',
    saved_at: now - index * 1_000,
  }));
  const provenance = [
    ...subscriptionVideos.map((item) => ({ item, provenance: 'subscription_upload' as const, provenance_ref: item.channel_id! })),
    ...liveVideos.map((item) => ({ item, provenance: 'subscription_live' as const, provenance_ref: item.channel_id! })),
    ...history.flatMap((watch) => topicVideos.map((item) => ({
      item, provenance: 'history_topic' as const, provenance_ref: watch.id,
    }))),
    ...history.flatMap((watch) => channelVideos.map((item) => ({
      item, provenance: 'history_channel' as const, provenance_ref: watch.id,
    }))),
    { item: short, provenance: 'subscription_upload' as const, provenance_ref: short.channel_id! },
    {
      item: conservativeShort,
      provenance: 'subscription_upload' as const,
      provenance_ref: conservativeShort.channel_id!,
    },
    { item: saved[0]!, provenance: 'history_topic' as const, provenance_ref: history[0]!.id },
    { item: history[0]!, provenance: 'history_topic' as const, provenance_ref: history[0]!.id },
  ].map((row) => ({
    ...row,
    source_generation: 'acquisition-v1',
    acquired_at: now,
    expires_at: now + (row.provenance === 'subscription_live'
      ? 15 * 60 * 1_000
      : 30 * 24 * 60 * 60 * 1_000),
  }));
  upsertYoutubeV2CandidateProvenance(provenance);
  return { history, saved, chartOnly, watchedChannel, subscriptionChannels };
}

test('YouTube v2 flag fails safely to off', () => {
  assert.equal(youtubeRecommendationsV2Mode(undefined), 'off');
  assert.equal(youtubeRecommendationsV2Mode('serve'), 'serve');
  assert.equal(youtubeRecommendationsV2Mode('SHADOW'), 'shadow');
  assert.equal(youtubeRecommendationsV2Mode('true'), 'off');
});

test('off, shadow, and serve return utility rails owned by the mode-authoritative profile', () => withTempState(async () => {
  const now = Date.now();
  const householdItems = Array.from({ length: 8 }, (_, index) => video(
    `ModeHousehold${index}`,
    `Household utility ${index}`,
    `household-channel-${index}`,
  ));
  const personalItems = Array.from({ length: 8 }, (_, index) => video(
    `ModePersonal${index}`,
    `Personal utility ${index}`,
    `personal-channel-${index}`,
  ));
  upsertYoutubeItems([...householdItems, ...personalItems]);
  const personal = createViewerProfile('Mode Owner');
  for (const [index, item] of householdItems.entries()) {
    if (index < 4) {
      saveLibraryItem({
        profile_id: 'household', source: 'youtube', type: 'youtube_video', id: item.id,
        title: item.title, poster: item.thumbnail, tab: 'youtube', saved_at: now + index,
      });
    } else {
      recordLibraryWatch({
        profile_id: 'household', source: 'youtube', type: 'youtube_video', id: item.id,
        play_id: item.id, title: item.title, duration_sec: 600, position_sec: 60,
        event: 'play', watched_at: now + index,
      });
    }
  }
  for (const [index, item] of personalItems.entries()) {
    if (index < 4) {
      saveLibraryItem({
        profile_id: personal.profile_id, source: 'youtube', type: 'youtube_video', id: item.id,
        title: item.title, poster: item.thumbnail, tab: 'youtube', saved_at: now + index,
      });
    } else {
      recordLibraryWatch({
        profile_id: personal.profile_id, source: 'youtube', type: 'youtube_video', id: item.id,
        play_id: item.id, title: item.title, duration_sec: 600, position_sec: 60,
        event: 'play', watched_at: now + index,
      });
    }
  }
  activateViewerProfile(personal.profile_id);
  const service = new YoutubeService();
  const expectedIds = (prefix: string) => new Set(Array.from({ length: 8 }, (_, index) => `${prefix}${index}`));

  for (const mode of ['off', 'shadow', 'serve'] as const) {
    process.env.MANGO_YOUTUBE_RECS_V2 = mode;
    const response = await service.rails();
    const expectedOwner = mode === 'off' ? personal.profile_id : 'household';
    assert.equal(response.profile_id, expectedOwner, `${mode} internal owner`);
    const utilityIds = response.rails
      .filter((rail) => rail.rail_id === 'history' || rail.rail_id === 'saved')
      .flatMap((rail) => rail.items.map((item) => item.id));
    assert.equal(utilityIds.length, 8, `${mode} utility rail supply`);
    assert.deepEqual(
      new Set(utilityIds),
      expectedIds(mode === 'off' ? 'ModePersonal' : 'ModeHousehold'),
      `${mode} utility ownership`,
    );
    if (mode !== 'serve') {
      const attemptedShuffle = await service.rails({ reshuffle: true });
      assert.equal(
        attemptedShuffle.slate_sequence,
        response.slate_sequence,
        `${mode} must not advance a hidden recommendation epoch`,
      );
    }
  }
}));

test('daily More Like selection is deterministic and weighted by decayed watch strength', () => {
  const candidates = [
    { id: 'strong-complete', weight: 25 },
    { id: 'weak-old-partial', weight: 1 },
  ];
  assert.equal(
    weightedDailyHistorySeedId(candidates, '2026-08-04'),
    weightedDailyHistorySeedId(candidates, '2026-08-04'),
  );
  const selections = Array.from({ length: 120 }, (_, day) => weightedDailyHistorySeedId(
    candidates,
    `2026-day-${day}`,
  ));
  assert.ok(selections.filter((id) => id === 'strong-complete').length >= 105);
});

test('triggered and nightly discovery budgets fund ten More Like seeds without touching couch reserve', () => {
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('meaningful_watch', 75), {
    more_like: 10, beyond: 2, total: 12,
  });
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('nightly', 75, 8), {
    more_like: 10, beyond: 57, total: 67,
  });
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('oauth_connected', 75), {
    more_like: 10, beyond: 2, total: 12,
  });
});

test('More Like seeks eight contributing topics and uses all ten seeds toward the 512 cap', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const seeds = Array.from({ length: 10 }, (_, index) => video(
    `MultiSeed${index}`,
    `Distinct topic ${index} craft`,
    `seed-channel-${index}`,
  ));
  upsertYoutubeItems(seeds);
  importOfficialHistory(seeds, now, 'takeout-multi-seed');
  assert.equal(new Set(youtubeV2MoreLikeSeeds(10, now).map((seed) => seed.provenance_ref)).size, 10);

  const service = new YoutubeService();
  let moreLikeSearches = 0;
  const api = (service as unknown as { api: {
    searchRecommendationVideos: (
      query: string, options: { limit?: number; eventType?: string },
    ) => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.searchRecommendationVideos = async (query, options) => {
    if (options.eventType || options.limit !== YOUTUBE_V2_MORE_LIKE_QUERY_SIZE) {
      return [];
    }
    const call = moreLikeSearches++;
    return rankedVideos(Array.from({ length: 32 }, (_, index) => video(
        `MultiCandidate${call}-${index}`,
        `${query} analysis ${call} ${index}`,
        `candidate-channel-${call}-${index}`,
      )));
  };

  const result = await service.refresh('manual_multi_seed');
  assert.equal(result.ok, true);
  assert.ok(moreLikeSearches <= 12);
  const acquisition = getYoutubeState<{
    more_like_search_calls: number;
    more_like_attempted_seeds: number;
    more_like_contributing_seeds: number;
    more_like_candidate_count: number;
    more_like_target_reached: boolean;
  }>('youtube_v2_history_acquisition', {
    more_like_search_calls: 0,
    more_like_attempted_seeds: 0,
    more_like_contributing_seeds: 0,
    more_like_candidate_count: 0,
    more_like_target_reached: false,
  });
  assert.deepEqual(acquisition, {
    ...acquisition,
    more_like_search_calls: 10,
    more_like_attempted_seeds: 10,
    more_like_contributing_seeds: 10,
    more_like_candidate_count: 320,
    more_like_target_reached: false,
  });
  const generation = latestYoutubeV2Generation()!;
  const reserve = generation.items.filter((item) => item.rail_id === 'more_like');
  assert.equal(reserve.length, 320);
  assert.ok(reserve.length < YOUTUBE_V2_MORE_LIKE_TARGET);
  assert.equal(new Set(reserve.map((item) => item.provenance_ref)).size, 10);
  const rail = youtubeV2RecommendationRails({ shuffle_epoch: 0 })
    .find((entry) => entry.rail_id === 'more_like')!;
  assert.equal(rail.items.length, 4);
  const provenanceById = new Map(reserve.map((item) => [item.id, item.provenance_ref] as const));
  assert.equal(new Set(rail.items.map((item) => provenanceById.get(item.id))).size, 4);
}));

test('Takeout refresh is off-safe and uses one durable 15-minute acquisition coalescer', () => withTempState(async () => {
  const off = await refreshYoutubeAfterTakeoutImport({ at: 1_000_000 });
  assert.deepEqual(off, {
    local_generation: null,
    acquisition: 'off',
    acquisition_result: null,
  });
  assert.equal(latestYoutubeV2GenerationRecord(), null);

  process.env.MANGO_YOUTUBE_RECS_V2 = 'shadow';
  seedV2();
  let refreshes = 0;
  const service = {
    refresh: async () => {
      refreshes += 1;
      return { ok: true };
    },
  } as unknown as Pick<YoutubeService, 'refresh'>;
  const beforeNoop = latestYoutubeV2GenerationRecord()?.generation ?? null;
  const noop = await refreshYoutubeAfterTakeoutImport({
    at: 1_500_000, changed: false, service,
  });
  assert.equal(noop.acquisition, 'noop');
  assert.equal(noop.local_generation, beforeNoop);
  assert.equal(refreshes, 0);
  const first = await refreshYoutubeAfterTakeoutImport({ at: 2_000_000, service });
  const second = await refreshYoutubeAfterTakeoutImport({ at: 2_000_001, service });
  assert.equal(first.acquisition, 'queued');
  assert.equal(second.acquisition, 'coalesced');
  assert.equal(refreshes, 1);
}));

test('a Mango-local meaningful watch rebuilds taste and coalesces acquisition', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  const now = Date.now();
  seedV2();
  const before = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const local = video('LocalCooldownOnly', 'Local cooldown only', 'subscribed-channel-0');
  upsertYoutubeItems([local]);
  upsertYoutubeV2CandidateProvenance([{
    item: local,
    provenance: 'subscription_upload',
    provenance_ref: local.channel_id!,
    source_generation: 'local-cooldown-candidate',
    acquired_at: now,
    expires_at: now + 1_000_000,
  }]);
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: local.id,
    play_id: 'local-cooldown-play', title: local.title, duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now + 1,
  });
  let providerRefreshes = 0;
  const result = await refreshYoutubeV2AfterLocalSignal({
    reason: 'meaningful_watch',
    at: now + 2,
    service: { refresh: async () => {
      providerRefreshes += 1;
      return { ok: true };
    } } as unknown as Pick<YoutubeService, 'refresh'>,
  });
  assert.equal(result.acquisition, 'queued');
  assert.ok((result.local_generation ?? 0) > before.generation);
  assert.equal(providerRefreshes, 1);
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === local.id), true);
  assert.equal(youtubeV2RecommendationRails({ shuffle_epoch: 0 })
    .flatMap((rail) => rail.items).some((item) => item.id === local.id), false);
}));

test('More Like and Beyond provenance generations coexist for the same video and source seed', () => withTempState(() => {
  const now = Date.now();
  const seed = video('LaneSeed', 'Lane seed documentary', 'lane-seed-channel');
  const candidate = video('LaneCandidate', 'Lane candidate documentary', 'lane-candidate-channel');
  upsertYoutubeItems([seed]);
  importOfficialHistory([seed], now, 'takeout-lane-seed');
  upsertYoutubeV2CandidateProvenance([
    {
      item: candidate, provenance: 'history_topic', provenance_ref: seed.id,
      source_generation: 'more_like:lane-test', acquired_at: now, expires_at: now + 1_000_000,
    },
    {
      item: candidate, provenance: 'history_topic', provenance_ref: seed.id,
      source_generation: 'beyond:lane-test', acquired_at: now, expires_at: now + 1_000_000,
    },
  ]);
  assert.equal(listYoutubeV2CandidateProvenance().filter((row) => row.item.id === candidate.id).length, 2);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now })!;
  assert.ok(generation.items.some((item) => item.rail_id === 'more_like' && item.id === candidate.id));
  assert.ok(generation.items.some((item) => item.rail_id === 'beyond' && item.id === candidate.id));
}));

test('cross-lane provenance cannot influence More Like reserve ordering', () => withTempState(() => {
  const now = Date.now();
  const seed = video('LaneOrderSeed', 'Lane order history seed', 'lane-order-history');
  const clean = video('ACleanLaneOrder', 'Clean More Like candidate', 'clean-lane-channel');
  const leaked = video('ZCrossLaneOrder', 'Cross-lane candidate', 'cross-lane-channel');
  upsertYoutubeItems([seed]);
  importOfficialHistory([seed], now, 'takeout-lane-order');
  replaceYoutubeV2Subscriptions([{
    channel_key: 'lane-order-sub', channel_id: 'lane-order-sub',
    channel_title: 'Lane order subscription', channel_url: null,
    source: 'oauth', subscribed_at: null,
  }], { source_generation: 'lane-order-subscriptions', imported_at: now });
  upsertYoutubeV2CandidateProvenance([
    {
      item: clean, provenance: 'history_topic', provenance_ref: seed.id,
      source_generation: 'more_like:clean', acquired_at: now, expires_at: now + 1_000_000,
    },
    {
      item: leaked, provenance: 'history_topic', provenance_ref: seed.id,
      source_generation: 'more_like:cross', acquired_at: now, expires_at: now + 1_000_000,
    },
    {
      item: leaked, provenance: 'history_topic', provenance_ref: 'subscription:lane-order-sub',
      source_generation: 'beyond:cross', acquired_at: now, expires_at: now + 1_000_000,
    },
  ]);
  const moreLike = rebuildYoutubeV2Generation({ force: true, at: now })!.items
    .filter((item) => item.rail_id === 'more_like');
  assert.deepEqual(moreLike.slice(0, 2).map((item) => item.id), [clean.id, leaked.id]);
  assert.equal(moreLike[0]?.score, moreLike[1]?.score);
}));

test('generic youtube_items are never eligible and an empty source supersedes stale-ready state', () => withTempState(() => {
  const generic = video('GenericSubscribed01', 'Generic cache row', 'subscribed-channel');
  upsertYoutubeItems([generic]);
  replaceYoutubeV2Subscriptions([{
    channel_key: 'subscribed-channel',
    channel_id: 'subscribed-channel',
    channel_title: 'Channel subscribed-channel',
    channel_url: null,
    source: 'oauth',
    subscribed_at: null,
  }], { source_generation: 'subscriptions-only' });
  assert.equal(rebuildYoutubeV2Generation({ force: true }), null);
  assert.equal(latestYoutubeV2GenerationRecord()?.status, 'empty');
  assert.equal(latestYoutubeV2Generation(), null);
  assert.equal(listYoutubeV2CandidateProvenance().length, 0);
}));

test('Saved-only cold start keeps setup_required and the stable Saved utility rail', () => withTempState(async () => {
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  const items = Array.from({ length: 4 }, (_, index) => video(
    `SavedCold${index}`, `Saved cold-start video ${index}`, `saved-cold-channel-${index}`,
  ));
  upsertYoutubeItems(items);
  items.forEach((item, index) => saveLibraryItem({
    source: index === 0 ? 'mango' : 'youtube', type: 'youtube_video', id: item.id, title: item.title,
    poster: item.thumbnail, tab: 'youtube', saved_at: Date.now() + index,
  }));
  assert.equal(rebuildYoutubeV2Generation({ force: true }), null);
  const response = await new YoutubeService().rails() as {
    setup_required: boolean;
    recommendations_status: string;
    rails: YoutubeRail[];
  };
  assert.equal(response.setup_required, true);
  assert.equal(response.recommendations_status, 'empty');
  assert.deepEqual(response.rails.map((rail) => rail.rail_id), ['saved']);
  assert.equal(response.rails[0]?.items.length, 4);
  assert.equal(
    response.rails[0]?.items.find((item) => item.id === items[0]?.id)?.library_source,
    'mango',
  );
}));

test('clearing Mango history preserves official history and an official empty source tombstone supersedes ready', () => withTempState(() => {
  seedV2();
  assert.ok(rebuildYoutubeV2Generation({ force: true }));
  libraryDatabase().prepare("DELETE FROM watch_history WHERE source = 'youtube'").run();
  replaceYoutubeV2Subscriptions([], { source_generation: 'oauth-empty' });
  assert.ok(
    rebuildYoutubeV2Generation({ force: true }),
    'the source-scoped Mango cleanup must preserve official Takeout history',
  );
  libraryDatabase().prepare('DELETE FROM youtube_takeout_history').run();
  assert.equal(rebuildYoutubeV2Generation({ force: true }), null);
  assert.equal(latestYoutubeV2GenerationRecord()?.status, 'empty');
  assert.equal(latestYoutubeV2Generation(), null);
}));

test('v2 ranks only four exact provenance types and enforces watch, Saved, Shorts, and live isolation', () => withTempState(() => {
  const seeded = seedV2();
  const orphanTopic = video('OrphanTopic01', 'Untraceable topic result', 'orphan-channel');
  upsertYoutubeV2CandidateProvenance([{
    item: orphanTopic,
    provenance: 'history_topic',
    provenance_ref: 'missing-history-seed',
    source_generation: 'orphan-acquisition',
    acquired_at: Date.now(),
    expires_at: Date.now() + 1_000_000,
  }]);
  const generation = rebuildYoutubeV2Generation({ force: true });
  assert.ok(generation);
  const allowed = new Set([
    'subscription_upload', 'subscription_live', 'history_channel', 'history_topic',
    'rewatch', 'frequent_channel',
  ]);
  assert.ok(generation.items.every((item) => allowed.has(item.provenance)));
  assert.equal(generation.items.some((item) => item.id === seeded.chartOnly.id), false);
  assert.equal(generation.items.some((item) => item.id === 'ShortBlocked01'), false);
  assert.equal(generation.items.some((item) => item.id === 'ShortBlocked02'), false);
  assert.equal(generation.items.some((item) => item.id === orphanTopic.id), false);
  assert.ok(generation.items
    .filter((item) => item.provenance === 'history_topic')
    .every((item) => seeded.history.some((watch) => watch.id === item.provenance_ref)
      || (item.provenance_ref.startsWith('subscription:')
        && seeded.subscriptionChannels.has(item.provenance_ref.slice('subscription:'.length)))));
  assert.equal(generation.items.some((item) => seeded.history.some((history) => history.id === item.id)), false);
  assert.equal(generation.items.some((item) => seeded.saved.some((saved) => saved.id === item.id)), false);
  assert.ok(generation.items.filter((item) => item.id.startsWith('SubscribedLive'))
    .every((item) => item.rail_id === 'live_now' && item.provenance === 'subscription_live'));
}));

test('watched cooldown is exhaustive for 30 days and expires without discarding history', () => withTempState(() => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1_000;
  seedV2();
  const expiredImported = video(
    'ExpiredImported00000',
    'Expired imported watch outside the first five thousand',
    'subscribed-channel-0',
  );
  const recentImported = video(
    'RecentImported00000',
    'Recently imported watch',
    'subscribed-channel-0',
  );
  const imported = Array.from({ length: 5_001 }, (_, index) => ({
    video_id: index === 0 ? expiredImported.id : `CooldownWatched${String(index).padStart(5, '0')}`,
    title: `Cooldown watched ${index}`,
    title_url: null,
    channel_id: 'historical-channel',
    channel_title: 'Historical Channel',
    // Index zero is old enough to leave the cooldown and is also outside the
    // first 5,000 rows returned by the chronological presentation query.
    watched_at: index === 0
      ? now - YOUTUBE_V2_WATCH_COOLDOWN_MS - dayMs
      : now - (5_001 - index) * 1_000,
  }));
  assert.equal(upsertYoutubeV2ImportedHistory(imported, {
    source_generation: 'takeout-over-five-thousand',
    imported_at: now,
  }).inserted, 5_001);
  assert.equal(upsertYoutubeV2ImportedHistory([
    {
      video_id: recentImported.id,
      title: recentImported.title,
      title_url: null,
      channel_id: recentImported.channel_id,
      channel_title: recentImported.channel_title,
      watched_at: now - YOUTUBE_V2_WATCH_COOLDOWN_MS - dayMs,
    },
    {
      video_id: recentImported.id,
      title: recentImported.title,
      title_url: null,
      channel_id: recentImported.channel_id,
      channel_title: recentImported.channel_title,
      watched_at: now - YOUTUBE_V2_WATCH_COOLDOWN_MS + dayMs,
    },
  ], {
    source_generation: 'takeout-recent-cooldown',
    imported_at: now,
  }).inserted, 2);
  assert.equal(listYoutubeV2ImportedHistory(5_000).some((row) => row.video_id === expiredImported.id), false);

  const expiredLocal = video('ExpiredLocalWatch', 'Expired local watch', 'subscribed-channel-1');
  const recentLocal = video('RecentLocalWatch', 'Recent local watch', 'subscribed-channel-1');
  for (const [item, watchedAt] of [
    [expiredLocal, now - YOUTUBE_V2_WATCH_COOLDOWN_MS - dayMs],
    [recentLocal, now - YOUTUBE_V2_WATCH_COOLDOWN_MS + dayMs],
  ] as const) {
    recordLibraryWatch({
      source: 'youtube', type: 'youtube_video', id: item.id,
      title: item.title, duration_sec: 600, position_sec: 600,
      event: 'finished', watched_at: watchedAt,
    });
  }

  const savedTarget = video(
    'LifetimeSaved00000',
    'Old Saved title outside the visible Saved query cap',
    'subscribed-channel-1',
  );
  saveLibraryItem({
    source: 'mango', type: 'youtube_video', id: savedTarget.id,
    title: savedTarget.title, tab: 'youtube', saved_at: now - 100_000,
  });
  for (let index = 1; index <= 500; index += 1) {
    saveLibraryItem({
      source: 'youtube', type: 'youtube_video', id: `LifetimeSaved${String(index).padStart(5, '0')}`,
      title: `Lifetime Saved ${index}`, tab: 'youtube', saved_at: now + index,
    });
  }

  upsertYoutubeV2CandidateProvenance([
    expiredImported,
    recentImported,
    expiredLocal,
    recentLocal,
    savedTarget,
  ].map((item) => ({
    item,
    provenance: 'subscription_upload' as const,
    provenance_ref: item.channel_id!,
    source_generation: 'subscription-lifetime-exclusion',
    acquired_at: now,
    expires_at: now + 30 * 24 * 60 * 60 * 1_000,
  })));
  const generation = rebuildYoutubeV2Generation({ force: true, at: now });
  assert.ok(generation);
  assert.equal(generation.items.some((item) => item.id === expiredImported.id), true);
  assert.equal(generation.items.some((item) => item.id === expiredLocal.id), true);
  assert.equal(generation.items.some((item) => item.id === recentImported.id), false);
  assert.equal(generation.items.some((item) => item.id === recentLocal.id), false);
  assert.equal(generation.items.some((item) => item.id === savedTarget.id), false);
  assert.equal(listYoutubeV2ImportedHistory(5_000).some((row) => row.video_id === expiredImported.id), false);
  assert.equal(listYoutubeV2ImportedHistory(20_000).some((row) => row.video_id === expiredImported.id), true);
}));

test('More Like acquisition can reacquire an official-history video after the 30-day cooldown', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const recent = video('CooldownRecentSeed', 'Shared craft history', 'recent-seed-channel');
  const old = [
    video('CooldownOldA', 'Shared craft history retrospective', 'old-channel-a'),
    video('CooldownOldB', 'Shared craft history archive', 'old-channel-b'),
  ];
  upsertYoutubeItems([recent, ...old]);
  importOfficialHistory([recent], now, 'takeout-cooldown-recent');
  upsertYoutubeV2ImportedHistory(old.map((item, index) => ({
    video_id: item.id,
    title: item.title,
    title_url: null,
    channel_id: item.channel_id,
    channel_title: item.channel_title,
    watched_at: now - YOUTUBE_V2_WATCH_COOLDOWN_MS - (index + 1) * 1_000,
  })), { source_generation: 'takeout-cooldown-old', imported_at: now });
  const firstSeed = youtubeV2MoreLikeSeeds(10, now)[0]!.provenance_ref;
  const eligibleOld = old.find((item) => item.id !== firstSeed)!;

  const service = new YoutubeService();
  let moreLikeCall = 0;
  const api = (service as unknown as { api: {
    searchRecommendationVideos: (
      query: string, options: { limit?: number; eventType?: string },
    ) => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.searchRecommendationVideos = async (query, options) => {
    if (options.eventType || options.limit !== YOUTUBE_V2_MORE_LIKE_QUERY_SIZE) {
      return [];
    }
    const call = moreLikeCall++;
    return rankedVideos([
        ...(call === 0 ? [eligibleOld] : []),
        ...Array.from({ length: 4 }, (_, index) => video(
          `CooldownFresh${call}-${index}`,
          `${query} documentary ${call} ${index}`,
          `cooldown-fresh-channel-${call}-${index}`,
        )),
      ]);
  };
  const result = await service.refresh('cooldown_reacquisition');
  assert.equal(result.ok, true);
  assert.ok(listYoutubeV2CandidateProvenance().some((row) => (
    row.item.id === eligibleOld.id && row.source_generation.startsWith('more_like:')
  )));
}));

test('official Takeout and meaningful local watches both drive taste', () => withTempState(() => {
  const now = Date.now();
  const complete = video('CompleteSeed', 'Complete fermentation seed', 'complete-channel');
  const bare = video('BareSeed', 'Bare fermentation seed', 'bare-channel');
  const takeoutRecent = video('TakeoutRecent', 'Takeout recent seed', 'takeout-channel');
  const takeoutOld = video('TakeoutOld', 'Takeout old seed', 'takeout-old-channel');
  const candidates = [
    video('CompleteCandidate', 'Complete related', 'related-a'),
    video('BareCandidate', 'Bare related', 'related-b'),
    video('TakeoutRecentCandidate', 'Takeout recent related', 'related-c'),
    video('TakeoutOldCandidate', 'Takeout old related', 'related-d'),
  ];
  upsertYoutubeItems([complete, bare, takeoutRecent, takeoutOld, ...candidates]);
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: complete.id,
    play_id: complete.id, title: complete.title, duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now,
  });
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: bare.id,
    play_id: bare.id, title: bare.title, duration_sec: 600, position_sec: 10,
    event: 'started', watched_at: now,
  });
  upsertYoutubeV2ImportedHistory([
    { video_id: takeoutRecent.id, title: takeoutRecent.title, title_url: null, channel_id: takeoutRecent.channel_id, channel_title: takeoutRecent.channel_title, watched_at: now },
    { video_id: takeoutOld.id, title: takeoutOld.title, title_url: null, channel_id: takeoutOld.channel_id, channel_title: takeoutOld.channel_title, watched_at: now - 90 * 24 * 60 * 60 * 1000 },
  ], { source_generation: 'takeout-history', imported_at: now });
  upsertYoutubeV2CandidateProvenance(candidates.map((item, index) => ({
    item,
    provenance: 'history_topic',
    provenance_ref: [complete.id, bare.id, takeoutRecent.id, takeoutOld.id][index]!,
    source_generation: 'history-acquisition',
    acquired_at: now,
    expires_at: now + 30 * 24 * 60 * 60 * 1000,
    relation_type: 'same_topic',
    source_rank: 0,
  })));
  const generation = rebuildYoutubeV2Generation({ force: true, at: now });
  assert.ok(generation);
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === complete.id), true);
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === bare.id), true);
  assert.equal(youtubeV2TopicSeed(now)?.provenance_ref, youtubeV2TopicSeed(now + 60_000)?.provenance_ref);
  const forYou = new Map(generation.items.filter((item) => item.rail_id === 'for_you').map((item) => [item.id, item.score]));
  assert.equal(forYou.has('CompleteCandidate'), true);
  assert.equal(forYou.has('BareCandidate'), false);
  assert.ok(forYou.get('TakeoutRecentCandidate')! > forYou.get('TakeoutOldCandidate')!);
}));

test('a bare local play remains recommendation-eligible until meaningful viewing', () => withTempState(() => {
  const now = Date.now();
  const bare = video('BareExactCandidate', 'Bare exact eligible candidate', 'bare-subscription');
  replaceYoutubeV2Subscriptions([{
    channel_key: 'bare-subscription', channel_id: 'bare-subscription',
    channel_title: 'Bare Subscription', channel_url: null, source: 'oauth', subscribed_at: null,
  }], { source_generation: 'bare-subscription-generation', imported_at: now });
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: bare.id,
    play_id: bare.id, title: bare.title, duration_sec: 600, position_sec: 10,
    event: 'play', watched_at: now,
  });
  upsertYoutubeV2CandidateProvenance([{
    item: bare, provenance: 'subscription_upload', provenance_ref: 'bare-subscription',
    source_generation: 'bare-acquisition', acquired_at: now, expires_at: now + 1_000_000,
  }]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now });
  assert.ok(generation?.items.some((item) => item.id === bare.id));
}));

test('materially distinct repeat watches increase affinity while History keeps one card', () => withTempState(() => {
  const now = Date.now();
  const repeated = video('RepeatedSeed', 'Repeated deep craft seed', 'repeat-channel');
  const single = video('SingleSeed', 'Single deep craft seed', 'single-channel');
  const repeatedCandidate = video('RepeatedCandidate', 'Repeated related analysis', 'novel-repeat');
  const singleCandidate = video('SingleCandidate', 'Single related analysis', 'novel-single');
  upsertYoutubeItems([repeated, single, repeatedCandidate, singleCandidate]);
  upsertYoutubeV2ImportedHistory([
    { video_id: repeated.id, title: repeated.title, title_url: null, channel_id: repeated.channel_id, channel_title: repeated.channel_title, watched_at: now },
    { video_id: repeated.id, title: repeated.title, title_url: null, channel_id: repeated.channel_id, channel_title: repeated.channel_title, watched_at: now - 2 * 24 * 60 * 60 * 1_000 },
    { video_id: single.id, title: single.title, title_url: null, channel_id: single.channel_id, channel_title: single.channel_title, watched_at: now },
  ], { source_generation: 'takeout-repeats', imported_at: now });
  upsertYoutubeV2CandidateProvenance([
    { item: repeatedCandidate, provenance: 'history_topic', provenance_ref: repeated.id, source_generation: 'repeat-topic', acquired_at: now, expires_at: now + 1_000_000, relation_type: 'same_topic', source_rank: 0 },
    { item: singleCandidate, provenance: 'history_topic', provenance_ref: single.id, source_generation: 'single-topic', acquired_at: now, expires_at: now + 1_000_000, relation_type: 'same_topic', source_rank: 0 },
  ]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const scores = new Map(generation.items
    .filter((item) => item.rail_id === 'for_you')
    .map((item) => [item.id, item.score]));
  assert.ok(scores.get(repeatedCandidate.id)! > scores.get(singleCandidate.id)!);
  assert.equal(youtubeV2HistoryItems().filter((item) => item.id === repeated.id).length, 1);
}));

test('independent supporting sources boost quality without restoring the retired 60/40 blend', () => withTempState(() => {
  const now = Date.now();
  const seed = video('BlendSeed', 'Blend seed', 'watched-channel');
  const both = video('BlendBoth', 'Blend both', 'subscribed-channel');
  const historyOnly = video('BlendHistory', 'Blend history', 'history-channel');
  const subscriptionOnly = video('BlendSubscription', 'Blend subscription', 'subscribed-channel');
  upsertYoutubeItems([seed, both, historyOnly, subscriptionOnly]);
  importOfficialHistory([seed], now, 'takeout-blend');
  upsertYoutubeV2ImportedHistory([{
    video_id: seed.id, title: seed.title, title_url: null,
    channel_id: seed.channel_id, channel_title: seed.channel_title,
    watched_at: now - 2 * 24 * 60 * 60 * 1_000,
  }], { source_generation: 'takeout-blend-repeat', imported_at: now });
  replaceYoutubeV2Subscriptions([{
    channel_key: 'subscribed-channel', channel_id: 'subscribed-channel',
    channel_title: 'Channel subscribed-channel', channel_url: null, source: 'oauth', subscribed_at: null,
  }], { source_generation: 'subscription-blend' });
  upsertYoutubeV2CandidateProvenance([
    { item: both, provenance: 'history_topic', provenance_ref: seed.id, source_generation: 'history', acquired_at: now, expires_at: now + 1_000_000, relation_type: 'same_topic', source_rank: 0 },
    { item: both, provenance: 'subscription_upload', provenance_ref: 'subscribed-channel', source_generation: 'subscription', acquired_at: now, expires_at: now + 1_000_000, relation_type: 'direct', source_rank: 0 },
    { item: historyOnly, provenance: 'history_topic', provenance_ref: seed.id, source_generation: 'history', acquired_at: now, expires_at: now + 1_000_000, relation_type: 'same_topic', source_rank: 0 },
    { item: subscriptionOnly, provenance: 'subscription_upload', provenance_ref: 'subscribed-channel', source_generation: 'subscription', acquired_at: now, expires_at: now + 1_000_000, relation_type: 'direct', source_rank: 0 },
  ]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now });
  assert.ok(generation);
  const scores = new Map(generation.items.filter((item) => item.rail_id === 'for_you').map((item) => [item.id, item.score]));
  assert.ok(scores.get(both.id)! > Math.max(scores.get(historyOnly.id)!, scores.get(subscriptionOnly.id)!));
  assert.ok(scores.get(historyOnly.id)! >= 0.20);
  assert.ok(scores.get(subscriptionOnly.id)! >= 0.20);
}));

test('subscription-only cold start builds Beyond and thematic More fallback from auditable subscription topic seeds', () => withTempState(() => {
  const now = Date.now();
  const channels = Array.from({ length: 6 }, (_, index) => `cold-sub-${index}`);
  replaceYoutubeV2Subscriptions(channels.map((channel) => ({
    channel_key: channel,
    channel_id: channel,
    channel_title: `Cold Followed ${channel}`,
    channel_url: null,
    source: 'oauth' as const,
    subscribed_at: null,
  })), { source_generation: 'cold-subscriptions', imported_at: now });
  const direct = channels.flatMap((channel) => Array.from({ length: 4 }, (_, index) => video(
    `ColdUpload-${channel}-${index}`,
    `Deep craft upload ${channel} ${index}`,
    channel,
  )));
  const topic = channels.flatMap((channel) => Array.from({ length: 8 }, (_, index) => video(
    `ColdTopic-${channel}-${index}`,
    `Deep craft exploration ${channel} ${index}`,
    `novel-${channel}-${index}`,
  )));
  upsertYoutubeV2CandidateProvenance([
    ...direct.map((item) => ({
      item,
      provenance: 'subscription_upload' as const,
      provenance_ref: item.channel_id!,
      source_generation: 'cold-subscriptions',
      acquired_at: now,
      expires_at: now + 1_000_000,
    })),
    ...channels.flatMap((channel) => topic
      .filter((item) => item.id.startsWith(`ColdTopic-${channel}-`))
      .map((item, index) => ({
        item,
        provenance: 'history_topic' as const,
        provenance_ref: `subscription:${channel}`,
        source_generation: `cold-topic:${channel}`,
        acquired_at: now,
        expires_at: now + 1_000_000,
        relation_type: 'same_topic' as const,
        source_rank: index,
      }))),
  ]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now });
  assert.ok(generation);
  const allowedTopicRefs = new Set(channels.map((channel) => `subscription:${channel}`));
  assert.ok(generation.items
    .filter((item) => item.provenance === 'history_topic')
    .every((item) => allowedTopicRefs.has(item.provenance_ref)));
  const rails = youtubeV2RecommendationRails({ shuffle_epoch: 0 });
  const beyond = rails.find((rail) => rail.rail_id === 'beyond');
  const more = rails.find((rail) => rail.rail_id === 'more_like');
  assert.ok(beyond);
  assert.ok(beyond.items.every((item) => !channels.includes(item.channel_id || '')));
  assert.equal(more?.label, 'More from channels you follow');
  assert.equal(more?.items.length, 4);
  assert.equal(more?.items.filter((item) => channels.includes(item.channel_id || '')).length, 1);
}));

test('From Your Subscriptions uses explicit freshness bands before stable fallback ordering', () => withTempState(() => {
  const now = Date.now();
  const publishedDaysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const items = [
    { item: video('LexicalZ', 'Old upload', 'newest-channel-0'), published: publishedDaysAgo(400) },
    { item: video('LexicalA', 'Newest upload', 'newest-channel-1'), published: publishedDaysAgo(2) },
    { item: video('LexicalY', 'Second newest', 'newest-channel-2'), published: publishedDaysAgo(20) },
    { item: video('LexicalB', 'Third newest', 'newest-channel-3'), published: publishedDaysAgo(60) },
    { item: video('LexicalX', 'Fourth newest', 'newest-channel-4'), published: publishedDaysAgo(200) },
  ].map(({ item, published }) => ({ ...item, published_at: published }));
  replaceYoutubeV2Subscriptions(items.map((item) => ({
    channel_key: item.channel_id!, channel_id: item.channel_id!, channel_title: item.channel_title!,
    channel_url: null, source: 'oauth' as const, subscribed_at: null,
  })), { source_generation: 'newest-subscriptions', imported_at: now });
  upsertYoutubeV2CandidateProvenance(items.map((item) => ({
    item,
    provenance: 'subscription_upload' as const,
    provenance_ref: item.channel_id!,
    source_generation: 'newest-subscriptions',
    acquired_at: now,
    expires_at: now + 1_000_000,
    relation_type: 'direct' as const,
    source_rank: 0,
  })));
  const generation = rebuildYoutubeV2Generation({ force: true, at: now })!;
  assert.deepEqual(
    generation.items
      .filter((item) => item.rail_id === 'new_from_subscriptions')
      .slice(0, 4)
      .map((item) => item.id),
    ['LexicalA', 'LexicalY', 'LexicalB', 'LexicalX'],
  );
}));

test('Home and X are latest-generation-only; ordinary reload epoch is stable', () => withTempState(async () => {
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true });
  const generation = latestYoutubeV2GenerationRecord()!.generation;
  const service = new YoutubeService();
  let apiCalls = 0;
  const api = (service as unknown as { api: Record<string, (...args: unknown[]) => Promise<unknown>> }).api;
  for (const method of ['search', 'subscriptions', 'channelUploadPlaylists', 'playlistItems']) {
    api[method] = async () => { apiCalls += 1; throw new Error(`unexpected ${method}`); };
  }
  const first = await service.rails() as { slate_sequence: number; rails: YoutubeRail[] };
  const savedAfterPublish = first.rails.find((rail) => rail.rail_id === 'for_you')!.items[0]!;
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: savedAfterPublish.id,
    title: savedAfterPublish.title, tab: 'youtube', saved_at: 1,
  });
  invalidateYoutubeV2ExactExclusions();
  const afterSaved = await service.rails() as { slate_sequence: number; rails: YoutubeRail[] };
  assert.equal(afterSaved.rails.some((rail) => rail.items.some((item) => item.id === savedAfterPublish.id)), false);
  upsertYoutubeItems([video('LateGeneric', 'Late generic cache mutation', 'late-channel')]);
  const second = await service.rails() as { slate_sequence: number; rails: YoutubeRail[] };
  assert.equal(afterSaved.slate_sequence, second.slate_sequence);
  assert.deepEqual(afterSaved.rails.map((rail) => rail.items.map((item) => item.id)), second.rails.map((rail) => rail.items.map((item) => item.id)));
  assert.equal(latestYoutubeV2GenerationRecord()!.generation, generation);
  const shuffled = await service.rails({ reshuffle: true }) as { slate_sequence: number; rails: YoutubeRail[] };
  const reloaded = await service.rails() as { slate_sequence: number; rails: YoutubeRail[] };
  assert.ok(shuffled.slate_sequence > second.slate_sequence);
  assert.equal(reloaded.slate_sequence, shuffled.slate_sequence);
  assert.equal(apiCalls, 0);
}));

test('fifty X presses stay cache-only under the latency bound and keep Saved stable', () => withTempState(async () => {
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true });
  const generation = latestYoutubeV2GenerationRecord()!.generation;
  const service = new YoutubeService();
  let apiCalls = 0;
  const api = (service as unknown as { api: Record<string, (...args: unknown[]) => Promise<unknown>> }).api;
  for (const method of [
    'search', 'searchRecommendationVideos', 'subscriptions', 'channelUploadPlaylists',
    'playlistItems', 'playlistRecommendationVideos', 'videos',
  ]) {
    api[method] = async () => { apiCalls += 1; throw new Error(`unexpected ${method}`); };
  }
  const initial = await service.rails() as { rails: YoutubeRail[] };
  const stable = (railId: string) => initial.rails.find((rail) => rail.rail_id === railId)?.items
    .map((item) => item.id) ?? [];
  const saved = stable('saved');
  const quotaBefore = youtubeRefreshStatus();
  const historyBuildsBefore = (youtubeV2ExactExclusionCacheDiagnostics() as {
    history_build_count: number;
  }).history_build_count;
  const durationsMs: number[] = [];
  for (let press = 0; press < 50; press += 1) {
    const startedAt = process.hrtime.bigint();
    const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    durationsMs.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    assert.deepEqual(response.rails.find((rail) => rail.rail_id === 'saved')?.items.map((item) => item.id), saved);
    assert.equal(response.rails.find((rail) => rail.rail_id === 'history')?.items.length, 4);
  }
  const quotaAfter = youtubeRefreshStatus();
  const historyBuildsAfter = (youtubeV2ExactExclusionCacheDiagnostics() as {
    history_build_count: number;
  }).history_build_count;
  assert.equal(apiCalls, 0);
  assert.equal(historyBuildsAfter, historyBuildsBefore);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, generation);
  const p95 = [...durationsMs].sort((left, right) => left - right)[Math.ceil(durationsMs.length * 0.95) - 1]!;
  assert.ok(p95 <= 250, `cached X p95=${p95.toFixed(2)}ms`);
  assert.deepEqual(
    [quotaAfter.quota_used_today, quotaAfter.search_calls_today, quotaAfter.api_calls_today],
    [quotaBefore.quota_used_today, quotaBefore.search_calls_today, quotaBefore.api_calls_today],
  );
}));

test('X shuffles History from the cached watch pool and ordinary reload keeps that slate', () => withTempState(async () => {
  seedV2();
  const extra = Array.from({ length: 12 }, (_, index) => video(
    `HistoryShuffle${index}`,
    `History shuffle watch ${index}`,
    `history-shuffle-channel-${index}`,
  ));
  upsertYoutubeItems(extra);
  importOfficialHistory(extra, Date.now() - 60_000, 'history-shuffle-pool');
  invalidateYoutubeV2HistoryItems();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true });
  const service = new YoutubeService();
  const ids = (rails: YoutubeRail[], railId: string) => rails
    .find((rail) => rail.rail_id === railId)?.items.map((item) => item.id) ?? [];
  const first = await service.rails() as { slate_sequence: number; rails: YoutubeRail[] };
  const firstHistory = ids(first.rails, 'history');
  const saved = ids(first.rails, 'saved');
  assert.equal(firstHistory.length, 4);
  let changed = firstHistory;
  for (let press = 0; press < 8; press += 1) {
    const shuffled = await service.rails({ reshuffle: true }) as { slate_sequence: number; rails: YoutubeRail[] };
    changed = ids(shuffled.rails, 'history');
    assert.equal(changed.length, 4);
    assert.deepEqual(ids(shuffled.rails, 'saved'), saved);
    if (changed.join(',') !== firstHistory.join(',')) break;
  }
  assert.notEqual(changed.join(','), firstHistory.join(','));
  const reloaded = await service.rails() as { rails: YoutubeRail[] };
  assert.deepEqual(ids(reloaded.rails, 'history'), changed);
  assert.deepEqual(ids(reloaded.rails, 'saved'), saved);
}));

test('fifty cache-only X presses stay fast with four complete 512-candidate pools', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  replaceYoutubeV2Subscriptions([{
    channel_key: 'depth-subscription',
    channel_id: 'depth-subscription',
    channel_title: 'Depth Subscription',
    channel_url: null,
    source: 'oauth',
    subscribed_at: null,
  }], { source_generation: 'depth-subscriptions', imported_at: now });
  const scoreAt = (index: number) => index < 320
    ? 0.65 + 0.35 * (1 - index / 319)
    : index < 448
      ? 0.38 + 0.269 * (1 - (index - 320) / 127)
      : 0.20 + 0.179 * (1 - (index - 448) / 63);
  const railIds = ['for_you', 'new_from_subscriptions', 'more_like', 'beyond'] as const;
  publishYoutubeV2Generation({
    model_version: YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
    source_hash: 'complete-512-pools',
    watch_count: 64,
    subscription_count: 1,
    generated_at: now,
    items: railIds.flatMap((railId) => Array.from({ length: 512 }, (_, index) => {
      const subscription = railId === 'new_from_subscriptions';
      const item = video(
        `Depth-${railId}-${index}`,
        `Depth ${railId} candidate ${index}`,
        subscription ? 'depth-subscription' : `depth-${railId}-creator-${index}`,
      );
      if (subscription) item.channel_title = 'Depth Subscription';
      return {
        rail_id: railId,
        item,
        score: scoreAt(index),
        reason: 'youtube_v2:depth_fixture',
        provenance: subscription ? 'subscription_upload' as const : 'history_topic' as const,
        provenance_ref: subscription ? 'depth-subscription' : `depth-seed-${index % 64}`,
        source_expires_at: now + 24 * 60 * 60 * 1_000,
        context_id: railId === 'more_like' ? 'multi_history:depth' : '',
      };
    })),
  });
  const service = new YoutubeService();
  let apiCalls = 0;
  const api = (service as unknown as { api: Record<string, (...args: unknown[]) => Promise<unknown>> }).api;
  for (const method of [
    'search', 'searchRecommendationVideos', 'subscriptions', 'channelUploadPlaylists',
    'playlistItems', 'playlistRecommendationVideos', 'videos',
  ]) {
    api[method] = async () => { apiCalls += 1; throw new Error(`unexpected ${method}`); };
  }
  const initial = await service.rails() as { rails: YoutubeRail[] };
  assert.deepEqual(
    initial.rails.filter((rail) => railIds.includes(rail.rail_id as typeof railIds[number]))
      .map((rail) => rail.rail_id),
    [...railIds],
  );
  const diagnostics = youtubeV2Diagnostics() as {
    reserve_depths: Record<string, number>;
  };
  assert.ok(railIds.every((railId) => diagnostics.reserve_depths[railId] === 512));
  const quotaBefore = youtubeRefreshStatus();
  const durationsMs: number[] = [];
  for (let press = 0; press < 50; press += 1) {
    const startedAt = process.hrtime.bigint();
    const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    durationsMs.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    assert.ok(railIds.every((railId) => (
      response.rails.find((rail) => rail.rail_id === railId)?.items.length === 4
    )));
  }
  const p95 = [...durationsMs].sort((left, right) => left - right)[
    Math.ceil(durationsMs.length * 0.95) - 1
  ]!;
  assert.ok(p95 <= 250, `complete 512-pool cached X p95=${p95.toFixed(2)}ms`);
  assert.equal(apiCalls, 0);
  const quotaAfter = youtubeRefreshStatus();
  assert.deepEqual(
    [quotaAfter.quota_used_today, quotaAfter.search_calls_today, quotaAfter.api_calls_today],
    [quotaBefore.quota_used_today, quotaBefore.search_calls_today, quotaBefore.api_calls_today],
  );
}));

test('concurrent X calls serialize epochs and ordinary reload reproduces the latest slate', () => withTempState(async () => {
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true });
  const service = new YoutubeService();
  await service.rails();
  const before = getYoutubeState<{
    shuffle_epoch: number;
    slate_sequence: number;
  }>('youtube_v2_serving_epoch', { shuffle_epoch: -1, slate_sequence: -1 });
  const responses = await Promise.all(Array.from({ length: 8 }, () => (
    service.rails({ reshuffle: true }) as Promise<{ slate_sequence: number; rails: YoutubeRail[] }>
  )));
  const sequences = responses.map((response) => response.slate_sequence);
  assert.equal(new Set(sequences).size, responses.length);
  assert.deepEqual([...sequences].sort((left, right) => left - right),
    Array.from({ length: 8 }, (_, index) => before.slate_sequence + index + 1));
  const after = getYoutubeState<{
    shuffle_epoch: number;
    slate_sequence: number;
  }>('youtube_v2_serving_epoch', { shuffle_epoch: -1, slate_sequence: -1 });
  assert.equal(after.shuffle_epoch, before.shuffle_epoch + 8);
  assert.equal(after.slate_sequence, before.slate_sequence + 8);
  const latestResponse = responses.find((response) => response.slate_sequence === after.slate_sequence)!;
  const reload = await service.rails();
  assert.equal(reload.slate_sequence, after.slate_sequence);
  assert.deepEqual(
    reload.rails.map((rail) => [rail.rail_id, rail.items.map((item) => item.id)]),
    latestResponse.rails.map((rail) => [rail.rail_id, rail.items.map((item) => item.id)]),
  );
}));

test('cached Home and X reuse exact exclusions until a source mutation invalidates them', () => withTempState(() => {
  const seeded = seedV2();
  rebuildYoutubeV2Generation({ force: true });
  const initial = youtubeV2ExactExclusionCacheDiagnostics() as {
    ready: boolean;
    build_count: number;
    total_count: number;
  };
  assert.equal(initial.ready, true);
  for (let epoch = 0; epoch < 10; epoch += 1) {
    youtubeV2RecommendationRails({ shuffle_epoch: epoch });
  }
  const reused = youtubeV2ExactExclusionCacheDiagnostics() as {
    build_count: number;
    total_count: number;
  };
  assert.equal(reused.build_count, initial.build_count);
  assert.equal(reused.total_count, initial.total_count);

  const candidate = latestYoutubeV2Generation()!.items.find((item) => (
    item.rail_id === 'for_you'
    && !seeded.history.some((history) => history.id === item.id)
    && !seeded.saved.some((saved) => saved.id === item.id)
  ))!;
  saveLibraryItem({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: candidate.id,
    title: candidate.title, poster: candidate.thumbnail, tab: 'youtube', saved_by: 'user',
  });
  invalidateYoutubeV2ExactExclusions();
  assert.equal((youtubeV2ExactExclusionCacheDiagnostics() as { ready: boolean }).ready, false);
  const afterMutation = youtubeV2RecommendationRails({ shuffle_epoch: 11 });
  assert.equal(afterMutation.flatMap((rail) => rail.items).some((item) => item.id === candidate.id), false);
  const rebuilt = youtubeV2ExactExclusionCacheDiagnostics() as {
    ready: boolean;
    build_count: number;
    total_count: number;
  };
  assert.equal(rebuilt.ready, true);
  assert.equal(rebuilt.build_count, initial.build_count + 1);
  assert.equal(rebuilt.total_count, initial.total_count + 1);
}));

test('dormant personal watch, Saved, and Not-for-me rows have zero v2 influence and owner stays Household', () => withTempState(async () => {
  const now = Date.now();
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  const before = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const beforeMembership = before.items.map((item) => `${item.rail_id}:${item.id}`);
  const personal = createViewerProfile('Dormant Personal');
  activateViewerProfile(personal.profile_id);
  recordLibraryWatch({
    profile_id: personal.profile_id,
    source: 'youtube', type: 'youtube_video', id: 'TopicVideo0', play_id: 'personal-watch',
    title: 'Personal-only watch', duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now + 1,
  });
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: 'TopicVideo1', title: 'Personal-only Saved',
    tab: 'youtube', saved_at: now + 2,
  });
  setLibraryFeedback({
    source: 'youtube', type: 'youtube_video', id: 'TopicVideo2', title: 'Personal-only negative',
    tab: 'youtube', feedback: 'not_interested', created_at: now + 3,
  });
  const after = rebuildYoutubeV2Generation({ force: true, at: now + 4 })!;
  assert.deepEqual(after.items.map((item) => `${item.rail_id}:${item.id}`), beforeMembership);
  const response = await new YoutubeService().rails();
  assert.equal(response.profile_id, 'household');
  const personalization = getPersonalizationState();
  const publicResponse = youtubePublicPersonalizationPayload(response, personalization);
  assert.equal(response.profile_id, 'household', 'adapting the HTTP envelope must not mutate internal ownership');
  assert.equal(publicResponse.profile_id, personal.profile_id);
  assert.equal(publicResponse.personalization_updated_at, personalization.updated_at);
}));

test('v2 refresh runs only subscription/history acquisition and bounded publish phases', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token',
    expires_at: now + 60 * 60 * 1_000,
  }));
  const seed = video('RefreshSeed', 'Fermentation science seed', 'watched-channel');
  upsertYoutubeItems([seed]);
  importOfficialHistory([seed], now, 'takeout-refresh');
  replaceYoutubeV2Subscriptions([{
    channel_key: 'subscribed-channel', channel_id: 'subscribed-channel',
    channel_title: 'Channel subscribed-channel', channel_url: null, source: 'oauth', subscribed_at: null,
  }], { source_generation: 'oauth-complete', imported_at: now });
  const service = new YoutubeService();
  let searchCalls = 0;
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: (ids: string[]) => Promise<Map<string, string>>;
    playlistRecommendationVideos: (playlist: string) => Promise<ReturnType<typeof rankedVideos>>;
    searchRecommendationVideos: (
      query: string, options: { channelId?: string },
    ) => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => [{
    ...video('subscribed-channel', 'Channel subscribed-channel', 'subscribed-channel'),
    kind: 'channel',
  }];
  api.channelUploadPlaylists = async () => new Map([['subscribed-channel', 'uploads']]);
  api.playlistRecommendationVideos = async () => rankedVideos(Array.from({ length: 8 }, (_, index) => video(
    `RefreshSubscription${index}`,
    `Fermentation subscription ${index}`,
    'subscribed-channel',
  )));
  api.searchRecommendationVideos = async (_query, options) => {
    const call = searchCalls++;
    const channel = options.channelId || `refresh-topic-channel-${call}`;
    return rankedVideos([video(`RefreshHistory${call}`, `Fermentation science analysis ${call}`, channel)]);
  };
  const result = await service.refresh('triggered');
  assert.equal(result.ok, true);
  assert.deepEqual(result.phases?.map((phase) => phase.phase), [
    'subscriptions', 'v2_subscription_acquisition', 'v2_history_metadata',
    'v2_history_acquisition', 'v2_live_acquisition', 'v2_publish', 'v2_embeddings',
  ]);
  assert.ok(searchCalls <= 12);
  const acquisition = getYoutubeState<{
    queries_attempted: number;
    more_like_queries: number;
    beyond_queries: number;
    distinct_seed_refs: string[];
    more_like_status: string;
    funnels: Array<{ returned: number; persisted: number; seed_ref: string }>;
  }>('youtube_v2_history_acquisition', {
    queries_attempted: 0, more_like_queries: 0, beyond_queries: 0, distinct_seed_refs: [],
    more_like_status: '', funnels: [],
  });
  assert.ok(acquisition.queries_attempted <= 12);
  assert.ok(acquisition.more_like_queries <= 10);
  assert.ok(acquisition.more_like_queries + acquisition.beyond_queries <= 12);
  assert.ok(acquisition.distinct_seed_refs.length >= 1);
  assert.equal(acquisition.more_like_status, 'not_applicable');
  assert.ok(acquisition.funnels.every((funnel) => (
    funnel.returned >= funnel.persisted && /^[a-f0-9]{16}$/.test(funnel.seed_ref)
  )));
  assert.ok(listYoutubeV2CandidateProvenance().every((row) => new Set([
    'subscription_upload', 'subscription_live', 'history_channel', 'history_topic',
  ]).has(row.provenance)));
  assert.equal(latestYoutubeV2GenerationRecord()?.status, 'ready');
}));

test('shadow refresh builds only the provenance-gated v2 phases', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'shadow';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const seed = video('ShadowSeed', 'Shadow history seed', 'shadow-history-channel');
  upsertYoutubeItems([seed]);
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: seed.id,
    play_id: seed.id, title: seed.title, duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now,
  });
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    playlistRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    videos: () => Promise<YoutubeItem[]>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => [{
    ...video('shadow-subscription', 'Shadow subscription', 'shadow-subscription'), kind: 'channel',
  }];
  api.channelUploadPlaylists = async () => new Map();
  api.playlistRecommendationVideos = async () => [];
  api.searchRecommendationVideos = async () => [];
  api.videos = async () => [];

  const result = await service.refresh('triggered-shadow');
  assert.equal(result.ok, true);
  const phases = result.phases?.map((phase) => phase.phase) ?? [];
  assert.deepEqual(phases, [
    'subscriptions', 'v2_subscription_acquisition', 'v2_history_metadata',
    'v2_history_acquisition', 'v2_live_acquisition', 'v2_publish', 'v2_embeddings',
  ]);
}));

test('OAuth-connected refresh resolves account truth and covers every subscription in bounded batches', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const channels = Array.from({ length: 55 }, (_, index) => `full-channel-${index}`);
  const uploadBatches: number[] = [];
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: (ids: string[]) => Promise<Map<string, string>>;
    playlistRecommendationVideos: (playlist: string) => Promise<ReturnType<typeof rankedVideos>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.authorizedChannel = async () => ({
    id: 'owner-channel', title: 'Aman', thumbnail: 'https://img.example/owner.jpg',
  });
  api.subscriptions = async () => channels.map((channel) => ({
    ...video(channel, `Channel ${channel}`, channel), kind: 'channel',
  }));
  api.channelUploadPlaylists = async (ids) => {
    uploadBatches.push(ids.length);
    return new Map(ids.map((id) => [id, `uploads-${id}`]));
  };
  api.playlistRecommendationVideos = async (playlist) => {
    const channel = playlist.slice('uploads-'.length);
    return rankedVideos([video(`upload-${channel}`, `Official upload ${channel}`, channel)]);
  };
  api.searchRecommendationVideos = async () => [];

  const result = await service.refresh('oauth_connected');
  assert.equal(result.ok, true);
  assert.equal(listYoutubeV2Subscriptions().length, 55);
  const acquisition = getYoutubeState<{
    authoritative_channels: number; coverage_complete: boolean; coverage_remaining: number; batches: number;
  }>('youtube_v2_subscription_acquisition', {
    authoritative_channels: 0, coverage_complete: false, coverage_remaining: -1, batches: 0,
  });
  assert.deepEqual(acquisition, {
    ...acquisition,
    authoritative_channels: 55,
    coverage_complete: true,
    coverage_remaining: 0,
    batches: 3,
  });
  assert.deepEqual(uploadBatches.slice(0, 3), [24, 24, 7]);
  assert.ok(uploadBatches.every((size) => size <= 24));
  assert.deepEqual(service.companionStatus(), {
    api_key_configured: true,
    oauth_configured: false,
    authenticated: true,
    needs_attention: false,
    sync_status: 'ready',
    channel_title: 'Aman',
    channel_thumbnail: 'https://img.example/owner.jpg',
    subscription_count: 55,
    region_code: 'IN',
    relevance_language: 'en',
    synced_at: (service.companionStatus().synced_at),
  });
}));

test('a conclusively missing uploads playlist is covered-empty, not an account sync failure', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    playlistRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => [{
    ...video('terminated-channel', 'Terminated channel', 'terminated-channel'), kind: 'channel',
  }];
  api.channelUploadPlaylists = async () => new Map([['terminated-channel', 'missing-uploads']]);
  api.playlistRecommendationVideos = async () => { throw new CatalogError(404, 'playlist cannot be found'); };
  api.searchRecommendationVideos = async () => [];

  const result = await service.refresh('oauth_connected');
  assert.equal(result.ok, true);
  const acquisition = getYoutubeState<{
    coverage_complete: boolean; coverage_remaining: number; unavailable_channels: number;
    partial: boolean; error: string | null;
  }>('youtube_v2_subscription_acquisition', {
    coverage_complete: false, coverage_remaining: 1, unavailable_channels: 0,
    partial: true, error: 'missing',
  });
  assert.deepEqual(acquisition, {
    ...acquisition,
    coverage_complete: true,
    coverage_remaining: 0,
    unavailable_channels: 1,
    partial: false,
    error: null,
  });
  assert.equal(service.companionStatus().sync_status, 'ready');
}));

test('More Like uses uploads playlists and publishes a same-channel plus thematic hybrid', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const seed = {
    ...video('hybrid-seed', 'Ceramic craft science', 'seed-channel'),
    tags: ['ceramic', 'craft'], category_id: '27',
  };
  upsertYoutubeItems([seed]);
  importOfficialHistory([seed], now, 'takeout-hybrid');
  const service = new YoutubeService();
  let uploadsCalls = 0;
  const searchOptions: Array<{ channelId?: string }> = [];
  const api = (service as unknown as { api: {
    channelUploadPlaylists: (ids: string[]) => Promise<Map<string, string>>;
    playlistRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    searchRecommendationVideos: (
      query: string, options: { channelId?: string },
    ) => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.channelUploadPlaylists = async (ids) => {
    uploadsCalls += 1;
    return new Map([[ids[0]!, 'seed-uploads']]);
  };
  api.playlistRecommendationVideos = async () => rankedVideos([
    video('same-channel-1', 'Ceramic craft studio visit', 'seed-channel'),
    video('same-channel-2', 'Ceramic craft firing guide', 'seed-channel'),
  ]);
  api.searchRecommendationVideos = async (_query, options) => {
    searchOptions.push(options);
    return rankedVideos([
        video('thematic-1', 'Ceramic craft science analysis', 'thematic-one'),
        video('thematic-2', 'Ceramic craft science documentary', 'thematic-two'),
      ]);
  };
  const result = await service.refresh('triggered-hybrid');
  assert.equal(result.ok, true);
  assert.ok(uploadsCalls >= 1);
  assert.ok(searchOptions.every((options) => !options.channelId));
  const status = getYoutubeState<{ status: string }>('youtube_v2_more_like_status', { status: '' });
  assert.equal(status.status, 'hybrid');
  const more = latestYoutubeV2Generation()!.items.filter((item) => item.rail_id === 'more_like');
  assert.ok(more.length >= 4);
  assert.ok(more.some((item) => item.provenance === 'history_channel'));
  assert.ok(more.some((item) => item.provenance === 'history_topic'));
  const publicMore = youtubeV2RecommendationRails({ shuffle_epoch: 0 })
    .find((rail) => rail.rail_id === 'more_like')!;
  assert.equal(publicMore.label, 'More Like');
  const publicProvenance = publicMore.items.map((item) => (
    more.find((entry) => entry.id === item.id)?.provenance
  ));
  assert.ok(publicProvenance.includes('history_channel'));
  assert.ok(publicProvenance.includes('history_topic'));
  assert.ok(Math.max(...[...new Set(publicMore.items.map((item) => item.channel_id))]
    .map((creator) => publicMore.items.filter((item) => item.channel_id === creator).length)) <= 2);
}));

test('More Like reports and labels an exact-channel fallback honestly when topic search yields no relation', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const seed = video('channel-seed', 'Boxing footwork lesson', 'boxing-channel');
  upsertYoutubeItems([seed]);
  importOfficialHistory([seed], now, 'takeout-channel-fallback');
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    channelUploadPlaylists: (ids: string[]) => Promise<Map<string, string>>;
    playlistRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.channelUploadPlaylists = async (ids) => new Map([[ids[0]!, 'boxing-uploads']]);
  api.playlistRecommendationVideos = async () => rankedVideos(Array.from({ length: 10 }, (_, index) => (
    video(`same-channel-${index}`, `Boxing footwork episode ${index}`, 'boxing-channel')
  )));
  api.searchRecommendationVideos = async () => [];

  const result = await service.refresh('triggered-exact-channel');
  assert.equal(result.ok, true);
  const status = getYoutubeState<{ status: string }>('youtube_v2_more_like_status', { status: '' });
  assert.equal(status.status, 'exact_channel');
  const publicMore = youtubeV2RecommendationRails({ shuffle_epoch: 0 })
    .find((rail) => rail.rail_id === 'more_like')!;
  assert.equal(publicMore.label, 'More from Channel boxing-channel');
  assert.equal(publicMore.items.length, 4);
  assert.ok(publicMore.items.every((item) => item.channel_id === 'boxing-channel'));
}));

test('an all-query discovery failure retains the last-good generation and blocks publication', () => withTempState(async () => {
  const now = Date.now();
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const published = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => [...seedV2().subscriptionChannels].map((channel) => ({
    ...video(channel, `Channel ${channel}`, channel), kind: 'channel',
  }));
  api.channelUploadPlaylists = async () => new Map();
  api.searchRecommendationVideos = async () => { throw new Error('search unavailable'); };
  const result = await service.refresh('triggered-failure');
  assert.equal(result.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_history_acquisition')?.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
  const retained = await service.rails();
  assert.equal(retained.recommendations_status, 'stale');
  assert.equal(retained.stale_reason, 'discovery_acquisition_failed');
  assert.ok(retained.rails
    .filter((rail) => !['history', 'saved'].includes(rail.rail_id))
    .every((rail) => rail.stale));
}));

test('Takeout-only discovery failure marks retained recommendations stale until a clean publish', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const seed = video('takeout-only-seed', 'History craft documentary seed', 'takeout-seed-channel');
  const candidates = Array.from({ length: 6 }, (_, index) => video(
    `takeout-only-candidate-${index}`,
    `History craft documentary candidate ${index}`,
    `takeout-candidate-channel-${index}`,
  ));
  upsertYoutubeItems([seed]);
  importOfficialHistory([seed], now, 'takeout-only-history');
  upsertYoutubeV2CandidateProvenance(candidates.map((item, sourceRank) => ({
    item,
    provenance: 'history_topic' as const,
    provenance_ref: seed.id,
    source_generation: 'takeout-only-candidates',
    acquired_at: now,
    expires_at: now + 1_000_000,
    relation_type: 'same_topic' as const,
    source_rank: sourceRank,
  })));
  const published = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    videos: () => Promise<YoutubeItem[]>;
  } }).api;
  api.channelUploadPlaylists = async () => new Map();
  api.videos = async () => [seed];
  api.searchRecommendationVideos = async () => { throw new Error('takeout discovery unavailable'); };

  const failed = await service.refresh('takeout-only-failure');
  assert.equal(failed.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
  const stale = await service.rails();
  assert.equal(stale.recommendations_status, 'stale');
  assert.equal(stale.stale_reason, 'discovery_acquisition_failed');

  api.searchRecommendationVideos = async () => [];
  const recovered = await service.refresh('takeout-only-recovery');
  assert.equal(recovered.ok, true);
  const ready = await service.rails();
  assert.equal(ready.recommendations_status, 'ready');
  assert.equal(ready.stale_reason, null);
}));

test('Takeout-only publication failure keeps the last-good generation explicitly stale', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  const seed = video('publish-failure-seed', 'Woodworking design history seed', 'publish-seed-channel');
  const candidates = Array.from({ length: 6 }, (_, index) => video(
    `publish-failure-candidate-${index}`,
    `Woodworking design history candidate ${index}`,
    `publish-candidate-channel-${index}`,
  ));
  upsertYoutubeItems([seed]);
  importOfficialHistory([seed], now, 'publish-failure-history');
  upsertYoutubeV2CandidateProvenance(candidates.map((item, sourceRank) => ({
    item,
    provenance: 'history_topic' as const,
    provenance_ref: seed.id,
    source_generation: 'publish-failure-candidates',
    acquired_at: now,
    expires_at: now + 1_000_000,
    relation_type: 'same_topic' as const,
    source_rank: sourceRank,
  })));
  const published = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const faultDb = new Database(process.env.MANGO_YOUTUBE_DB_PATH!);
  faultDb.exec(`
CREATE TRIGGER fail_youtube_v2_generation_publish
BEFORE INSERT ON youtube_v2_generations
BEGIN
  SELECT RAISE(ABORT, 'forced publication failure');
END;
`);
  faultDb.close();

  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
    videos: () => Promise<YoutubeItem[]>;
  } }).api;
  api.channelUploadPlaylists = async () => new Map();
  api.searchRecommendationVideos = async () => [];
  api.videos = async () => [seed];

  const failed = await service.refresh('takeout-only-publication-failure');
  assert.equal(failed.ok, false);
  assert.equal(failed.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
  const stale = await service.rails();
  assert.equal(stale.recommendations_status, 'stale');
  assert.equal(stale.stale_reason, 'publication_failed');

  const repairDb = new Database(process.env.MANGO_YOUTUBE_DB_PATH!);
  repairDb.exec('DROP TRIGGER fail_youtube_v2_generation_publish');
  repairDb.close();
  const recovered = await service.refresh('takeout-only-publication-recovery');
  assert.equal(recovered.ok, true);
  const ready = await service.rails();
  assert.equal(ready.recommendations_status, 'ready');
  assert.equal(ready.stale_reason, null);
}));

test('one failed discovery request retains the complete last-good generation', () => withTempState(async () => {
  const now = Date.now();
  const seeded = seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const published = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const publishedItems = published.items.map((item) => ({ ...item }));
  const service = new YoutubeService();
  let discoveryCalls = 0;
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    searchRecommendationVideos: (
      query: string, options: { eventType?: string },
    ) => Promise<ReturnType<typeof rankedVideos>>;
    videos: () => Promise<YoutubeItem[]>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => [...seeded.subscriptionChannels].map((channel) => ({
    ...video(channel, `Channel ${channel}`, channel), kind: 'channel',
  }));
  api.channelUploadPlaylists = async () => new Map();
  api.videos = async () => [];
  api.searchRecommendationVideos = async (query, options) => {
    if (options.eventType) return [];
    const call = discoveryCalls++;
    if (call === 1) throw new Error('one discovery shard timed out');
    return call === 0
      ? rankedVideos([video('partial-good', `${query} documentary analysis`, 'partial-good-channel')])
      : [];
  };

  const result = await service.refresh('partial-discovery');
  assert.equal(result.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_history_acquisition')?.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
  assert.deepEqual(latestYoutubeV2Generation()!.items, publishedItems);
  const retained = await service.rails();
  assert.equal(retained.recommendations_status, 'stale');
  assert.equal(retained.stale_reason, 'discovery_acquisition_failed');
}));

test('one failed Live probe retains the complete last-good generation', () => withTempState(async () => {
  const now = Date.now();
  const seeded = seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const published = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const publishedItems = published.items.map((item) => ({ ...item }));
  const service = new YoutubeService();
  let liveCalls = 0;
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    searchRecommendationVideos: (
      query: string, options: { eventType?: string; channelId?: string },
    ) => Promise<ReturnType<typeof rankedVideos>>;
    videos: () => Promise<YoutubeItem[]>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => [...seeded.subscriptionChannels].map((channel) => ({
    ...video(channel, `Channel ${channel}`, channel), kind: 'channel',
  }));
  api.channelUploadPlaylists = async () => new Map();
  api.videos = async () => [];
  api.searchRecommendationVideos = async (_query, options) => {
    if (options.eventType !== 'live') return [];
    const call = liveCalls++;
    if (call === 1) throw new Error('one live probe timed out');
    return call === 0
      ? rankedVideos([video('partial-live', 'Partial live', options.channelId!, 'live')])
      : [];
  };

  const result = await service.refresh('nightly');
  assert.equal(result.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_live_acquisition')?.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
  assert.deepEqual(latestYoutubeV2Generation()!.items, publishedItems);
  const retained = await service.rails();
  assert.equal(retained.recommendations_status, 'stale');
  assert.equal(retained.stale_reason, 'live_acquisition_failed');
}));

test('nightly probes at most eight authoritative subscribed channels for live streams just before publish', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const channels = Array.from({ length: 12 }, (_, index) => `nightly-live-channel-${index}`);
  const service = new YoutubeService();
  let liveProbes = 0;
  const probedChannels: string[] = [];
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    searchRecommendationVideos: (
      query: string, options: { eventType?: string; channelId?: string },
    ) => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => channels.map((channel) => ({
    ...video(channel, `Channel ${channel}`, channel), kind: 'channel',
  }));
  api.channelUploadPlaylists = async () => new Map();
  api.searchRecommendationVideos = async (_query, options) => {
    if (options.eventType !== 'live') return [];
    liveProbes += 1;
    probedChannels.push(options.channelId!);
    return rankedVideos([
      video(`LiveProbe${liveProbes}`, `Live probe ${liveProbes}`, options.channelId!, 'live'),
    ]);
  };
  const result = await service.refresh('nightly');
  assert.equal(result.ok, true);
  assert.equal(liveProbes, 8);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_live_acquisition')?.ok, true);
  assert.ok(latestYoutubeV2Generation()?.items.some((item) => item.rail_id === 'live_now'));
  const state = getYoutubeState<{ channels_probed: number; query_cap: number }>(
    'youtube_v2_live_acquisition', { channels_probed: 0, query_cap: 0 },
  );
  assert.deepEqual(state, { ...state, channels_probed: 8, query_cap: 8 });
  const second = await service.refresh('nightly');
  assert.equal(second.ok, true);
  assert.equal(liveProbes, 16);
  assert.ok(probedChannels.slice(8, 12).every((channel) => !probedChannels.slice(0, 8).includes(channel)));
}));

test('OAuth loss keeps the last authoritative generation and marks it stale without republishing', () => withTempState(async () => {
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  const published = rebuildYoutubeV2Generation({ force: true })!;
  const service = new YoutubeService();
  const result = await service.refresh('oauth-loss');
  assert.equal(result.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'subscriptions')?.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
  const rails = await service.rails() as {
    profile_id: string;
    recommendations_status: string;
    stale_reason: string | null;
  };
  assert.equal(rails.profile_id, 'household');
  assert.equal(rails.recommendations_status, 'stale');
  assert.equal(rails.stale_reason, 'oauth_unavailable');
}));

test('failed authoritative subscription enumeration mutates neither membership nor last-good publication', () => withTempState(async () => {
  const now = Date.now();
  const seeded = seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token', expires_at: now + 60 * 60 * 1_000,
  }));
  const published = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const beforeSubscriptions = listYoutubeV2Subscriptions().map((row) => row.channel_key);
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => { throw new Error('pagination failed'); };
  const result = await service.refresh('enumeration-failure');
  assert.equal(result.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'subscriptions')?.ok, false);
  assert.deepEqual(listYoutubeV2Subscriptions().map((row) => row.channel_key), beforeSubscriptions);
  assert.equal(listYoutubeV2Subscriptions().length, seeded.subscriptionChannels.size);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
}));

test('OAuth-disconnected stale mode can serve expired non-live last-good rows but never stale Live', () => withTempState(() => {
  const publishedAt = Date.now();
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true, at: publishedAt });
  new YoutubeService().disconnectAuth();
  const originalNow = Date.now;
  try {
    Date.now = () => publishedAt + 31 * 24 * 60 * 60 * 1_000;
    const rails = youtubeV2RecommendationRails({ shuffle_epoch: 0 });
    assert.ok(rails.some((rail) => rail.rail_id !== 'live_now' && rail.items.length === 4));
    assert.equal(rails.some((rail) => rail.rail_id === 'live_now'), false);
    assert.ok(rails.every((rail) => rail.stale));
  } finally {
    Date.now = originalNow;
  }
}));

test('complete OAuth enumeration preserves new membership but upload failure retains the last-good generation', () => withTempState(async () => {
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token',
    expires_at: Date.now() + 60 * 60 * 1_000,
  }));
  const published = rebuildYoutubeV2Generation({ force: true })!;
  const publishedItems = published.items.map((item) => ({ ...item }));
  const servedBefore = youtubeV2RecommendationRails({ shuffle_epoch: 17 })
    .filter((rail) => rail.rail_id !== 'live_now')
    .map((rail) => [rail.rail_id, rail.items.map((item) => item.id)] as const);
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    authorizedChannel: () => Promise<{ id: string; title: string; thumbnail: string | null }>;
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.authorizedChannel = async () => ({ id: 'owner', title: 'Owner', thumbnail: null });
  api.subscriptions = async () => [{
    ...video('new-subscription', 'New subscription', 'new-subscription'),
    kind: 'channel',
  }];
  api.channelUploadPlaylists = async () => { throw new Error('uploads unavailable'); };
  api.searchRecommendationVideos = async () => [];

  const result = await service.refresh('partial-oauth-source');
  assert.equal(result.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'subscriptions')?.ok, true);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_subscription_acquisition')?.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()!.generation, published.generation);
  assert.deepEqual(latestYoutubeV2Generation()!.items, publishedItems);
  assert.deepEqual(listYoutubeV2Subscriptions().map((row) => row.channel_key), ['new-subscription']);
  const retainedRails = youtubeV2RecommendationRails({ shuffle_epoch: 17 });
  assert.deepEqual(
    retainedRails
      .filter((rail) => rail.rail_id !== 'live_now')
      .map((rail) => [rail.rail_id, rail.items.map((item) => item.id)] as const),
    servedBefore,
  );
  assert.equal(retainedRails.some((rail) => rail.rail_id === 'live_now'), false);
  assert.ok(retainedRails.every((rail) => rail.stale));
  const stale = getYoutubeState<{ stale: boolean; reason: string | null }>(
    'youtube_v2_source_stale',
    { stale: false, reason: '' },
  );
  assert.deepEqual(
    { stale: stale.stale, reason: stale.reason },
    { stale: true, reason: 'subscription_acquisition_partial' },
  );
  const acquisition = getYoutubeState<{ partial: boolean; error: string | null }>(
    'youtube_v2_subscription_acquisition',
    { partial: false, error: null },
  );
  assert.equal(acquisition.partial, true);
  assert.match(acquisition.error ?? '', /uploads unavailable/);
}));

test('refresh resolves missing Takeout metadata in one bounded background videos batch', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  upsertYoutubeV2ImportedHistory([{
    video_id: 'TakeoutNeedsMetadata',
    title: 'Deep craft imported watch',
    title_url: null,
    channel_id: null,
    channel_title: null,
    watched_at: now,
  }], { source_generation: 'takeout-metadata', imported_at: now });
  upsertYoutubeItems([{
    ...video('TakeoutNeedsMetadata', 'Deep craft imported watch', 'unknown'),
    thumbnail: null,
    channel_id: null,
    channel_title: null,
    duration_sec: null,
  }]);
  const service = new YoutubeService();
  let resolvedIds: string[] = [];
  const api = (service as unknown as { api: {
    videos: (ids: string[]) => Promise<YoutubeItem[]>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.videos = async (ids) => {
    resolvedIds = ids;
    const resolved = [{
      ...video('TakeoutNeedsMetadata', 'Deep craft imported watch', 'resolved-channel'),
      thumbnail: 'https://img.example/resolved.jpg',
    }];
    upsertYoutubeItems(resolved);
    return resolved;
  };
  api.searchRecommendationVideos = async () => [];
  const result = await service.refresh('takeout-metadata');
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_history_metadata')?.ok, true);
  assert.deepEqual(resolvedIds, ['TakeoutNeedsMetadata']);
  assert.equal(youtubeV2HistoryItems()[0]?.thumbnail, 'https://img.example/resolved.jpg');
  const state = getYoutubeState<{ attempted: number; resolved: number; unresolved: number }>(
    'youtube_v2_history_metadata',
    { attempted: 0, resolved: 0, unresolved: 0 },
  );
  assert.deepEqual(
    { attempted: state.attempted, resolved: state.resolved, unresolved: state.unresolved },
    { attempted: 1, resolved: 1, unresolved: 0 },
  );
}));

test('refresh also queues unresolved Mango-local History launches for metadata resolution', () => withTempState(async () => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: 'LocalNeedsMetadata',
    play_id: 'local-bare-play', title: 'Local unresolved launch', duration_sec: 600,
    position_sec: 5, event: 'play', watched_at: now,
  });
  const service = new YoutubeService();
  let resolvedIds: string[] = [];
  const api = (service as unknown as { api: {
    videos: (ids: string[]) => Promise<YoutubeItem[]>;
    searchRecommendationVideos: () => Promise<ReturnType<typeof rankedVideos>>;
  } }).api;
  api.videos = async (ids) => {
    resolvedIds = ids;
    const resolved = [video('LocalNeedsMetadata', 'Local unresolved launch', 'local-resolved-channel')];
    upsertYoutubeItems(resolved);
    return resolved;
  };
  api.searchRecommendationVideos = async () => [];
  await service.refresh('local-history-metadata');
  assert.deepEqual(resolvedIds, ['LocalNeedsMetadata']);
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === 'LocalNeedsMetadata'), true);
}));

test('serve order, labels, card counts, creator caps, and global dedupe match the couch contract', () => withTempState(async () => {
  const seeded = seedV2();
  saveLibraryItem({
    source: 'mango', type: 'youtube_video', id: seeded.history[0]!.id,
    title: seeded.history[0]!.title, tab: 'youtube', saved_at: Date.now() + 10_000,
  });
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true });
  const response = await new YoutubeService().rails() as {
    recommendations_status: string;
    rails: YoutubeRail[];
  };
  assert.equal(response.recommendations_status, 'ready');
  assert.deepEqual(response.rails.map((rail) => [rail.rail_id, rail.label]), [
    ['for_you', 'For You'],
    ['new_from_subscriptions', 'From Your Subscriptions'],
    ['frequently_watched', 'Your regulars'],
    ['more_like', `More from Channel ${seeded.watchedChannel}`],
    ['beyond', 'Beyond Your Subscriptions'],
    ['history', 'History'],
    ['saved', 'Saved'],
    ['live_now', 'Live Now'],
  ]);
  for (const rail of response.rails) {
    if (rail.rail_id === 'live_now') assert.ok(rail.items.length >= 1 && rail.items.length <= 4);
    else assert.equal(rail.items.length, 4, rail.rail_id);
  }
  assert.equal(
    response.rails.find((rail) => rail.rail_id === 'history')?.items
      .find((item) => item.id === seeded.history[0]!.id)?.library_source,
    'mango',
  );
  const ids = response.rails.flatMap((rail) => rail.items.map((item) => item.id));
  assert.equal(new Set(ids).size, ids.length);
  const creators = (railId: string) => response.rails.find((rail) => rail.rail_id === railId)!.items
    .map((item) => item.channel_id || item.channel_title);
  assert.equal(new Set(creators('beyond')).size, 4);
  assert.equal(new Set(creators('new_from_subscriptions')).size, 4);
  assert.ok(Math.max(...[...new Set(creators('for_you'))].map((creator) => creators('for_you').filter((value) => value === creator).length)) <= 2);
  assert.ok(response.rails.find((rail) => rail.rail_id === 'live_now')!.items
    .every((item) => item.channel_id && seeded.subscriptionChannels.has(item.channel_id)));
  const moreLike = response.rails.find((rail) => rail.rail_id === 'more_like')!.items;
  assert.equal(moreLike.filter((item) => item.channel_id === seeded.watchedChannel).length, 4);
  assert.equal(
    response.rails.flatMap((rail) => rail.items).some((item) => 'description' in item),
    false,
  );
}));

test('For You and Beyond enforce source, seed, and creator portfolios before deterministic relaxation', () => withTempState(() => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  const subscriptions = ['sub-a', 'sub-b', 'sub-c', 'sub-d'];
  replaceYoutubeV2Subscriptions(subscriptions.map((channel) => ({
    channel_key: channel, channel_id: channel, channel_title: channel,
    channel_url: null, source: 'oauth' as const, subscribed_at: null,
  })), { source_generation: 'portfolio-subscriptions', imported_at: now });
  const forYou = [
    ...Array.from({ length: 4 }, (_, index) => ({
      item: video(`history-a-${index}`, `History A ${index}`, `history-creator-${index}`),
      provenance: 'history_topic' as const, provenance_ref: 'history-seed-a',
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      item: video(`history-b-${index}`, `History B ${index}`, `history-b-creator-${index}`),
      provenance: 'history_topic' as const, provenance_ref: 'history-seed-b',
    })),
    ...subscriptions.map((channel, index) => ({
      item: video(`subscription-${index}`, `Subscription ${index}`, channel),
      provenance: 'subscription_upload' as const, provenance_ref: channel,
    })),
  ];
  const beyond = Array.from({ length: 6 }, (_, index) => ({
    item: video(`beyond-${index}`, `Beyond ${index}`, `beyond-creator-${index}`),
    provenance: 'history_topic' as const,
    provenance_ref: index < 4 ? 'beyond-seed-a' : 'beyond-seed-b',
  }));
  publishYoutubeV2Generation({
    model_version: 'youtube-household-v2.3',
    source_hash: 'portfolio-fixture', watch_count: 2, subscription_count: subscriptions.length,
    generated_at: now,
    items: [...forYou.map((entry, index) => ({
      rail_id: 'for_you' as const, item: entry.item, score: 100 - index,
      reason: null, provenance: entry.provenance, provenance_ref: entry.provenance_ref,
      source_expires_at: now + 1_000_000,
    })), ...beyond.map((entry, index) => ({
      rail_id: 'beyond' as const, item: entry.item, score: 100 - index,
      reason: null, provenance: entry.provenance, provenance_ref: entry.provenance_ref,
      source_expires_at: now + 1_000_000,
    }))],
  });
  const rails = youtubeV2RecommendationRails({ shuffle_epoch: 0 });
  const selectedForYou = rails.find((rail) => rail.rail_id === 'for_you')!.items;
  const generation = latestYoutubeV2Generation()!;
  const entryById = new Map(generation.items.map((entry) => [entry.id, entry]));
  const selectedEntries = selectedForYou.map((item) => entryById.get(item.id)!);
  assert.equal(selectedEntries.some((entry) => entry.provenance === 'history_topic'), true);
  assert.equal(selectedEntries.some((entry) => entry.provenance === 'subscription_upload'), true);
  const selectedSeedCounts = selectedEntries.reduce((counts, entry) => (
    counts.set(entry.provenance_ref, (counts.get(entry.provenance_ref) ?? 0) + 1), counts
  ), new Map<string, number>());
  assert.ok(Math.max(...selectedSeedCounts.values()) <= 2);
  const selectedBeyond = rails.find((rail) => rail.rail_id === 'beyond')!.items
    .map((item) => entryById.get(item.id)!);
  const beyondSeedCounts = selectedBeyond.reduce((counts, entry) => (
    counts.set(entry.provenance_ref, (counts.get(entry.provenance_ref) ?? 0) + 1), counts
  ), new Map<string, number>());
  assert.ok(Math.max(...beyondSeedCounts.values()) <= 2);
  assert.equal(new Set(selectedBeyond.map((entry) => entry.channel_id)).size, 4);
}));

test('Takeout history merges into History, dedupes within 60s, and persists sanitized import diagnostics', () => withTempState(() => {
  const now = Date.now();
  const first = upsertYoutubeV2ImportedHistory([{
    video_id: 'TakeoutVideo', title: 'Takeout video', title_url: null,
    channel_id: 'takeout-channel', channel_title: 'Takeout Channel', watched_at: now,
  }], { source_generation: 'takeout-a', imported_at: now });
  const duplicate = upsertYoutubeV2ImportedHistory([{
    video_id: 'TakeoutVideo', title: 'Takeout video duplicate', title_url: null,
    channel_id: 'takeout-channel', channel_title: 'Takeout Channel', watched_at: now + 30_000,
  }], { source_generation: 'takeout-b', imported_at: now + 1 });
  const distinct = upsertYoutubeV2ImportedHistory([{
    video_id: 'TakeoutVideo', title: 'Takeout video later', title_url: null,
    channel_id: 'takeout-channel', channel_title: 'Takeout Channel', watched_at: now + 61_000,
  }], { source_generation: 'takeout-c', imported_at: now + 2 });
  assert.deepEqual([first.inserted, duplicate.inserted, distinct.inserted], [1, 0, 1]);
  assert.equal(listYoutubeV2ImportedHistory().length, 2);
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === 'TakeoutVideo'), false);
  upsertYoutubeItems([video('TakeoutVideo', 'Takeout video', 'takeout-channel')]);
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === 'TakeoutVideo'), true);
  recordYoutubeV2TakeoutImport({
    generation: 'takeout-c', format: 'zip', source_filename: '/private/path/watch-history.zip',
    source_hash: 'abc123', status: 'partial', history_count: 2, subscription_count: 4,
    imported_at: now, warnings: ['one warning'], errors: [],
  });
  assert.equal(latestYoutubeV2TakeoutImport()?.source_filename, 'watch-history.zip');
  assert.deepEqual(latestYoutubeV2TakeoutImport()?.warnings, ['one warning']);
}));

test('legacy youtube.db Takeout rows migrate idempotently into durable library.db and survive cache deletion', () => withTempState(() => {
  const now = Date.now();
  // Initialize the legacy cache schema without invoking a durable Takeout wrapper.
  upsertYoutubeItems([]);
  const legacyPath = process.env.MANGO_YOUTUBE_DB_PATH!;
  const legacy = new Database(legacyPath);
  try {
    legacy.prepare(`
INSERT INTO youtube_v2_imported_history(
  video_id, title, title_url, channel_id, channel_title, watched_at, source_generation, imported_at
) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
`).run('LegacyTakeoutVideo', 'Legacy durable watch', 'legacy-channel', 'Legacy Channel', now, 'legacy-batch', now);
    legacy.prepare(`
INSERT INTO youtube_v2_takeout_imports(
  generation, format, source_filename, source_hash, status,
  history_count, subscription_count, imported_at, warnings_json, errors_json
) VALUES (?, 'zip', ?, ?, 'success', 1, 0, ?, '[]', '[]')
`).run('legacy-batch', '/private/legacy.zip', 'legacy-hash', now);
  } finally {
    legacy.close();
  }
  assert.deepEqual(migrateLegacyYoutubeV2TakeoutToLibrary(), {
    history_inserted: 1,
    audits_copied: 1,
  });
  assert.equal(listYoutubeV2ImportedHistory().filter((row) => row.video_id === 'LegacyTakeoutVideo').length, 1);
  assert.equal(latestYoutubeV2TakeoutImport()?.source_filename, 'legacy.zip');
  const durable = new Database(process.env.MANGO_LIBRARY_DB_PATH!);
  try {
    assert.ok(durable.prepare('SELECT 1 FROM library_migrations WHERE version = 13').get());
    assert.equal(Number((durable.prepare('SELECT COUNT(*) AS count FROM youtube_takeout_history').get() as { count: number }).count), 1);
  } finally {
    durable.close();
  }
  resetYoutubeDbForTests();
  rmSync(legacyPath, { force: true });
  rmSync(`${legacyPath}-wal`, { force: true });
  rmSync(`${legacyPath}-shm`, { force: true });
  assert.equal(listYoutubeV2ImportedHistory().filter((row) => row.video_id === 'LegacyTakeoutVideo').length, 1);
  assert.equal(latestYoutubeV2TakeoutImport()?.generation, 'legacy-batch');
}));

test('cached selector never re-adds a cross-rail duplicate after specialized allocation', () => withTempState(() => {
  seedV2();
  rebuildYoutubeV2Generation({ force: true });
  const rails = youtubeV2RecommendationRails({ shuffle_epoch: 3 });
  const ids = rails.flatMap((rail) => rail.items.map((item) => item.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(rails.filter((rail) => rail.rail_id !== 'live_now').every((rail) => rail.items.length === 4));
}));

test('published subscription rows are revalidated against the current authoritative snapshot', () => withTempState(() => {
  seedV2();
  rebuildYoutubeV2Generation({ force: true });
  replaceYoutubeV2Subscriptions(Array.from({ length: 4 }, (_, index) => ({
    channel_key: `subscribed-channel-${index}`,
    channel_id: `subscribed-channel-${index}`,
    channel_title: `Channel subscribed-channel-${index}`,
    channel_url: null,
    source: 'oauth' as const,
    subscribed_at: null,
  })), { source_generation: 'subscriptions-pruned' });
  const current = new Set(listYoutubeV2Subscriptions().map((row) => row.channel_id));
  const rails = youtubeV2RecommendationRails({ shuffle_epoch: 0 });
  for (const rail of rails.filter((row) => row.rail_id === 'new_from_subscriptions' || row.rail_id === 'live_now')) {
    assert.ok(rail.items.every((item) => current.has(item.channel_id)));
  }
  assert.equal(rails.flatMap((rail) => rail.items)
    .some((item) => item.channel_id === 'subscribed-channel-10'), false);
}));

test('same-ID generic metadata mutation cannot leak a Short or completed live item', () => withTempState(() => {
  seedV2();
  rebuildYoutubeV2Generation({ force: true });
  const before = youtubeV2RecommendationRails({ shuffle_epoch: 0 });
  const normal = before
    .filter((rail) => rail.rail_id !== 'live_now')
    .flatMap((rail) => rail.items)[0]!;
  const live = before.find((rail) => rail.rail_id === 'live_now')!.items[0]!;
  upsertYoutubeItems([
    { ...normal, duration_sec: 30, title: `${normal.title} #shorts`, updated_at: Date.now() + 1 },
    { ...live, live_status: 'completed', updated_at: Date.now() + 1 },
  ]);
  const after = youtubeV2RecommendationRails({ shuffle_epoch: 0 });
  assert.equal(after.flatMap((rail) => rail.items).some((item) => item.id === normal.id), false);
  assert.equal(after.flatMap((rail) => rail.items).some((item) => item.id === live.id), false);
}));

test('From Subscriptions fills one complete row from one creator only when supply requires it', () => withTempState(() => {
  const now = Date.now();
  const channel = 'single-subscription';
  replaceYoutubeV2Subscriptions([{
    channel_key: channel, channel_id: channel, channel_title: 'Single Subscription',
    channel_url: null, source: 'oauth', subscribed_at: null,
  }], { source_generation: 'single-subscription', imported_at: now });
  const uploads = Array.from({ length: 6 }, (_, index) => video(
    `SingleUpload${index}`, `Single creator upload ${index}`, channel,
  ));
  upsertYoutubeV2CandidateProvenance(uploads.map((item) => ({
    item, provenance: 'subscription_upload' as const, provenance_ref: channel,
    source_generation: 'single-upload-acquisition', acquired_at: now,
    expires_at: now + 1_000_000,
  })));
  rebuildYoutubeV2Generation({ force: true, at: now });
  const rail = youtubeV2RecommendationRails({ shuffle_epoch: 0 })
    .find((entry) => entry.rail_id === 'new_from_subscriptions');
  assert.equal(rail?.items.length, 4);
  assert.equal(new Set(rail?.items.map((item) => item.channel_id)).size, 1);
}));

test('published Live Now membership disappears when its source TTL expires without a Home refresh', () => withTempState(() => {
  const servingAt = Date.now();
  seedV2();
  rebuildYoutubeV2Generation({ force: true, at: servingAt });
  assert.ok(youtubeV2RecommendationRails({ shuffle_epoch: 0 })
    .some((rail) => rail.rail_id === 'live_now'));
  const originalNow = Date.now;
  try {
    Date.now = () => servingAt + 16 * 60 * 1_000;
    const rails = youtubeV2RecommendationRails({ shuffle_epoch: 0 });
    assert.equal(rails.some((rail) => rail.rail_id === 'live_now'), false);
    assert.ok(rails.some((rail) => rail.rail_id === 'for_you'));
  } finally {
    Date.now = originalNow;
  }
}));

test('v2.7 quality factors and independent support boost match the locked product weights', () => withTempState(() => {
  const at = Date.UTC(2026, 7, 11, 12);
  const anchors = Array.from({ length: 6 }, (_, index) => video(
    `QualityFactorAnchor${index}`,
    `Quality factor anchor ${index}`,
    `quality-anchor-channel-${index}`,
  ));
  upsertYoutubeItems(anchors);
  upsertYoutubeV2ImportedHistory(anchors.map((item) => ({
    video_id: item.id,
    title: item.title,
    title_url: null,
    channel_id: item.channel_id,
    channel_title: item.channel_title,
    watched_at: at,
  })), { source_generation: 'quality-factor-history', imported_at: at });
  replaceYoutubeV2Subscriptions([{
    channel_key: 'quality-subscription',
    channel_id: 'quality-subscription',
    channel_title: 'Quality Subscription',
    channel_url: null,
    source: 'oauth',
    subscribed_at: null,
  }], { source_generation: 'quality-factor-subscriptions', imported_at: at });
  const evaluator = createYoutubeV2CandidateQualityEvaluator(at);
  const expiresAt = at + 1_000_000;
  const historyItem = video('QualityFactorHistoryCandidate', 'History candidate', 'novel-channel');
  const historyRow = (provenanceRef: string, overrides: Record<string, unknown> = {}) => ({
    item: historyItem,
    provenance: 'history_topic' as const,
    provenance_ref: provenanceRef,
    source_generation: `quality:${provenanceRef}:${String(overrides.source_generation ?? 'base')}`,
    acquired_at: at,
    expires_at: expiresAt,
    relation_type: 'same_topic' as const,
    source_rank: 0,
    ...overrides,
  });
  const historyAffinity = 0.6 + 0.4 * (0.55 / 3);
  assert.ok(Math.abs(evaluator.quality([historyRow(anchors[0]!.id)]) - historyAffinity) < 1e-12);
  assert.ok(Math.abs(evaluator.quality([historyRow(anchors[0]!.id, {
    relation_type: 'deeper_dive',
  })]) - 0.85 * historyAffinity) < 1e-12);
  assert.ok(Math.abs(evaluator.quality([historyRow(anchors[0]!.id, {
    relation_type: 'wildcard',
  })]) - 0.55 * historyAffinity) < 1e-12);
  assert.ok(Math.abs(evaluator.quality([historyRow(anchors[0]!.id, {
    relation_type: null,
    source_generation: 'legacy',
  })]) - 0.35 * historyAffinity) < 1e-12);
  assert.ok(Math.abs(evaluator.quality([historyRow(anchors[0]!.id, {
    source_rank: 49,
  })]) - 0.55 * historyAffinity) < 1e-12);
  assert.ok(Math.abs(evaluator.quality([historyRow(anchors[0]!.id, {
    source_rank: null,
  })]) - 0.75 * historyAffinity) < 1e-12);

  const sameAnchorTwice = [
    historyRow(anchors[0]!.id),
    historyRow(anchors[0]!.id, {
      provenance: 'history_channel',
      relation_type: 'direct',
      source_generation: 'same-anchor-channel',
    }),
  ];
  assert.ok(Math.abs(evaluator.quality(sameAnchorTwice) - historyAffinity) < 1e-12);
  assert.ok(Math.abs(evaluator.quality([
    ...sameAnchorTwice,
    historyRow(anchors[1]!.id),
  ]) - (historyAffinity + 0.03)) < 1e-12);
  assert.ok(Math.abs(evaluator.quality(anchors.map((anchor) => historyRow(anchor.id)))
    - (historyAffinity + 0.12)) < 1e-12);

  const subscriptionQuality = (ageMs: number, sourceRank: number | null = 0) => {
    const item = {
      ...video(`SubscriptionAt${ageMs}`, 'Subscription quality', 'quality-subscription'),
      published_at: new Date(at - ageMs).toISOString(),
    };
    return evaluator.quality([{
      item,
      provenance: 'subscription_upload',
      provenance_ref: 'quality-subscription',
      source_generation: 'quality-subscription-generation',
      acquired_at: at,
      expires_at: expiresAt,
      relation_type: 'direct',
      source_rank: sourceRank,
    }]);
  };
  const day = 24 * 60 * 60 * 1_000;
  const dormantSub = 0.75;
  assert.equal(subscriptionQuality(7 * day), dormantSub);
  assert.equal(subscriptionQuality(7 * day + 1), dormantSub * 0.9);
  assert.equal(subscriptionQuality(30 * day), dormantSub * 0.9);
  assert.equal(subscriptionQuality(30 * day + 1), dormantSub * 0.75);
  assert.equal(subscriptionQuality(90 * day), dormantSub * 0.75);
  assert.equal(subscriptionQuality(90 * day + 1), dormantSub * 0.55);
  assert.equal(subscriptionQuality(365 * day), dormantSub * 0.55);
  assert.equal(subscriptionQuality(365 * day + 1), dormantSub * 0.35);
  assert.equal(subscriptionQuality(0, 49), dormantSub * 0.55);
  assert.equal(subscriptionQuality(0, null), dormantSub * 0.75);
}));

test('v2.7 quality gates bound exploration and publish the full honest reserve', () => withTempState(() => {
  const now = Date.now();
  const anchor = video('QualityAnchor', 'Deep ocean science', 'anchor-channel');
  importOfficialHistory([anchor], now, 'quality-history');
  const strong = Array.from({ length: 448 }, (_, index) => ({
    item: video(`StrongCandidate${index}`, `Deep ocean analysis ${index}`, `strong-channel-${index}`),
    provenance: 'history_topic' as const,
    provenance_ref: anchor.id,
    source_generation: 'more_like:quality',
    acquired_at: now,
    expires_at: now + 1_000_000,
    relation_type: 'same_topic' as const,
    source_rank: 0,
  }));
  const exploration = Array.from({ length: 152 }, (_, index) => ({
    item: video(`ExploreCandidate${index}`, `Ocean adjacent wildcard ${index}`, `explore-channel-${index}`),
    provenance: 'history_topic' as const,
    provenance_ref: anchor.id,
    source_generation: 'more_like:quality',
    acquired_at: now,
    expires_at: now + 1_000_000,
    relation_type: 'wildcard' as const,
    source_rank: 0,
  }));
  upsertYoutubeV2CandidateProvenance([...strong, ...exploration]);
  rebuildYoutubeV2Generation({ force: true, at: now });
  const generation = latestYoutubeV2Generation()!;
  assert.equal(generation.model_version, YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION);
  for (const railId of ['for_you', 'more_like']) {
    const pool = generation.items.filter((item) => item.rail_id === railId);
    assert.equal(pool.length, YOUTUBE_V2_RESERVE_LIMIT);
    assert.equal(pool.filter((item) => youtubeV2QualityTier(item.score) === 'C').length, YOUTUBE_V2_C_TIER_LIMIT);
    assert.equal(pool.filter((item) => youtubeV2QualityTier(item.score) === 'rejected').length, 0);
  }
  assert.deepEqual([
    youtubeV2QualityTier(0.65), youtubeV2QualityTier(0.649999),
    youtubeV2QualityTier(0.38), youtubeV2QualityTier(0.379999),
    youtubeV2QualityTier(0.20), youtubeV2QualityTier(0.199999),
  ], ['A', 'B', 'B', 'C', 'C', 'rejected']);
}));

test('production selector has deep weighted exposure, modest overlap, and no cross-epoch memory', () => withTempState(() => {
  const now = Date.now();
  const candidates = [
    ...Array.from({ length: 320 }, (_, index) => ({
      id: `A-${index.toString().padStart(3, '0')}`,
      score: 0.65 + 0.35 * (1 - index / 319),
    })),
    ...Array.from({ length: 128 }, (_, index) => ({
      id: `B-${index.toString().padStart(3, '0')}`,
      score: 0.38 + 0.269 * (1 - index / 127),
    })),
    ...Array.from({ length: 64 }, (_, index) => ({
      id: `C-${index.toString().padStart(3, '0')}`,
      score: 0.20 + 0.179 * (1 - index / 63),
    })),
  ];
  const first = youtubeV2WeightedShuffle(candidates, {
    generation: 7, shuffle_epoch: 0, rail_id: 'for_you',
  });
  assert.deepEqual(youtubeV2WeightedShuffle(candidates, {
    generation: 7, shuffle_epoch: 0, rail_id: 'for_you',
  }), first);
  assert.notDeepEqual(youtubeV2WeightedShuffle(candidates, {
    generation: 7, shuffle_epoch: 1, rail_id: 'for_you',
  }).slice(0, 4), first.slice(0, 4));

  const shallow = Array.from({ length: 4 }, (_, index) => ({ id: `shallow-${index}`, score: 0.8 }));
  const shallowInitial = youtubeV2WeightedShuffle(shallow, {
    generation: 7, shuffle_epoch: 0, rail_id: 'beyond',
  }).slice(0, 4);
  const shallowNext = youtubeV2WeightedShuffle(shallow, {
    generation: 7, shuffle_epoch: 1, rail_id: 'beyond',
  }).slice(0, 4);
  const shallowRollover = youtubeV2WeightedShuffle(shallow, {
    generation: 8, shuffle_epoch: 0, rail_id: 'beyond',
  }).slice(0, 4);
  assert.deepEqual(new Set(shallowNext.map((item) => item.id)), new Set(shallowInitial.map((item) => item.id)));
  assert.deepEqual(new Set(shallowRollover.map((item) => item.id)), new Set(shallowInitial.map((item) => item.id)));

  const candidateById = new Map(candidates.map((candidate, index) => [candidate.id, {
    ...candidate,
    item: video(
      candidate.id,
      `Production weighted candidate ${index}`,
      `production-creator-${Math.floor(index / 4)}`,
    ),
    provenance_ref: `production-seed-${Math.floor(index / 4)}`,
  }] as const));
  publishYoutubeV2Generation({
    model_version: YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
    source_hash: 'production-weighted-distribution',
    watch_count: 128,
    subscription_count: 0,
    generated_at: now,
    items: [...candidateById.values()].map((candidate) => ({
      rail_id: 'for_you' as const,
      item: candidate.item,
      score: candidate.score,
      reason: 'youtube_v2:distribution_fixture',
      provenance: 'history_topic' as const,
      provenance_ref: candidate.provenance_ref,
      source_expires_at: now + 1_000_000,
    })),
  });
  const productionGeneration = latestYoutubeV2Generation()!;
  const productionSlate = (epoch: number) => {
    const rail = youtubeV2RecommendationRailsFromSnapshot({
      generation: productionGeneration,
      subscriptions: [],
      source_stale: { stale: false, reason: null, at: null },
      serving_at: now,
      shuffle_epoch: epoch,
    })
      .find((entry) => entry.rail_id === 'for_you');
    assert.ok(rail);
    assert.equal(rail.items.length, 4);
    return rail.items;
  };
  assert.deepEqual(
    productionSlate(0).map((item) => item.id),
    productionSlate(0).map((item) => item.id),
  );

  const exposure = new Map<string, number>();
  let abSelections = 0;
  let overlap = 0;
  let previous = new Set<string>();
  for (let epoch = 0; epoch < 10_000; epoch += 1) {
    const slate = productionSlate(epoch);
    assert.equal(new Set(slate.map((item) => item.id)).size, 4);
    const creatorCounts = new Map<string, number>();
    const seedCounts = new Map<string, number>();
    for (const item of slate) {
      exposure.set(item.id, (exposure.get(item.id) ?? 0) + 1);
      const fixture = candidateById.get(item.id)!;
      if (youtubeV2QualityTier(fixture.score) !== 'C') abSelections += 1;
      if (previous.has(item.id)) overlap += 1;
      creatorCounts.set(item.channel_id!, (creatorCounts.get(item.channel_id!) ?? 0) + 1);
      seedCounts.set(
        fixture.provenance_ref,
        (seedCounts.get(fixture.provenance_ref) ?? 0) + 1,
      );
    }
    assert.ok(Math.max(...creatorCounts.values()) <= 2);
    assert.ok(Math.max(...seedCounts.values()) <= 2);
    previous = new Set(slate.map((item) => item.id));
  }
  const totalSelections = 40_000;
  const observedEffectivePoolSize = 1 / [...exposure.values()]
    .reduce((sum, count) => sum + (count / totalSelections) ** 2, 0);
  const metrics = youtubeV2WeightedPoolDiagnostics(candidates);
  assert.ok(metrics.effective_pool_size >= 320, JSON.stringify(metrics));
  assert.ok(observedEffectivePoolSize >= 320, `observed effective pool=${observedEffectivePoolSize}`);
  assert.ok(metrics.top_quartile_sampling_share > metrics.bottom_quartile_sampling_share);
  assert.ok(metrics.bottom_quartile_sampling_share > 0);
  assert.ok(metrics.minimum_sampling_weight > 0);
  assert.ok(overlap / 9_999 <= 0.10, `mean adjacent overlap=${overlap / 9_999}`);
  assert.ok(abSelections / 40_000 >= 0.90, `A/B share=${abSelections / 40_000}`);
  assert.equal(exposure.size, candidates.length);
  assert.ok([...exposure.entries()].filter(([id]) => id.startsWith('A-'))
    .reduce((sum, [, count]) => sum + count, 0)
    > [...exposure.entries()].filter(([id]) => id.startsWith('C-'))
      .reduce((sum, [, count]) => sum + count, 0));
  assert.ok(Math.min(...[...exposure.entries()]
    .filter(([id]) => id.startsWith('C-')).map(([, count]) => count)) > 0);
}));

test('rendered impression counters do not influence a weighted v2 slate', () => withTempState(() => {
  seedV2();
  rebuildYoutubeV2Generation({ force: true });
  const before = youtubeV2RecommendationRails({ shuffle_epoch: 73 });
  for (const rail of before) {
    recordYoutubeImpressions({
      profile_id: 'household',
      slate_sequence: 91,
      rail_id: rail.rail_id,
      item_ids: rail.items.map((item) => item.id),
      impressed_at: Date.now(),
    });
  }
  assert.deepEqual(
    youtubeV2RecommendationRails({ shuffle_epoch: 73 })
      .map((rail) => [rail.rail_id, rail.items.map((item) => item.id)]),
    before.map((rail) => [rail.rail_id, rail.items.map((item) => item.id)]),
  );
}));

test('YouTube state exposes only allowlisted yt-dlp command descriptors', () => withTempState(() => {
  process.env.MANGO_YTDLP_COMMAND = 'yt-dlp';
  const ytDlpState = new YoutubeService().state().configured as Record<string, unknown>;
  assert.equal(ytDlpState.api_key, false);
  assert.equal(ytDlpState.oauth_client, false);
  assert.equal(ytDlpState.yt_dlp_command, 'yt-dlp');
  assert.equal(ytDlpState.yt_dlp_command_kind, 'yt_dlp');
  assert.equal(ytDlpState.playback_cookies, false);
  assert.equal(typeof ytDlpState.yt_dlp_version === 'string' || ytDlpState.yt_dlp_version === null, true);
  assert.equal(typeof ytDlpState.pot_server, 'boolean');

  process.env.MANGO_YTDLP_COMMAND = '/private/bin/scripts/m6-ship/youtube-yt-dlp.sh';
  const wrapperState = new YoutubeService().state().configured as Record<string, unknown>;
  assert.equal(wrapperState.yt_dlp_command, 'mango_wrapper');
  assert.equal(wrapperState.yt_dlp_command_kind, 'mango_wrapper');
  assert.equal(wrapperState.yt_dlp_version, null);
  assert.equal(typeof wrapperState.pot_server, 'boolean');

  process.env.MANGO_YTDLP_COMMAND = 'https://operator:custom-command-secret@private.example/runner';
  const customState = new YoutubeService().state();
  const customConfigured = customState.configured as Record<string, unknown>;
  assert.deepEqual({
    api_key: customConfigured.api_key,
    oauth_client: customConfigured.oauth_client,
    yt_dlp_command: customConfigured.yt_dlp_command,
    yt_dlp_command_kind: customConfigured.yt_dlp_command_kind,
    playback_cookies: customConfigured.playback_cookies,
    yt_dlp_version: customConfigured.yt_dlp_version,
  }, {
    api_key: false,
    oauth_client: false,
    yt_dlp_command: '',
    yt_dlp_command_kind: 'custom',
    playback_cookies: false,
    yt_dlp_version: null,
  });
  assert.equal(typeof customConfigured.pot_server, 'boolean');
  assert.equal(JSON.stringify(customState).includes('custom-command-secret'), false);
}));

test('full YouTube state and rails sanitize config, refresh, import, acquisition, and stale diagnostics', () => withTempState(async () => {
  const now = Date.now();
  const anchor = video('DiagnosticAnchorSecret', 'raw diagnostic query secret', 'diagnostic-anchor-channel');
  const candidate = {
    ...video('DiagnosticCandidateSecret', 'credential marker secret', 'diagnostic-candidate-channel'),
    thumbnail: 'https://private.example/watch?token=credential-marker-secret',
  };
  upsertYoutubeItems([anchor]);
  importOfficialHistory([anchor], now, 'diagnostic-history-generation');
  upsertYoutubeV2CandidateProvenance([{
    item: candidate,
    provenance: 'history_topic',
    provenance_ref: anchor.id,
    source_generation: 'more_like:diagnostic-safe-generation',
    acquired_at: now,
    expires_at: now + 1_000_000,
    relation_type: 'same_topic',
    source_rank: 0,
  }]);
  rebuildYoutubeV2Generation({ force: true, at: now });

  recordYoutubeV2TakeoutImport({
    generation: 'takeout-generation-secret-marker',
    format: 'zip',
    source_filename: '/private/imports/takeout-filename-secret-marker.zip',
    source_hash: 'takeout-source-hash-secret-marker',
    status: 'partial',
    history_count: 17,
    subscription_count: 9,
    imported_at: now,
    warnings: ['warning echoed https://private.example/watch?q=takeout-query-secret-marker'],
    errors: ['provider HTTP 403 echoed access-token-secret-marker'],
  });
  setYoutubeState('last_refresh_at', now - 500);
  setYoutubeState('last_success_at', now - 1_000);
  setYoutubeState('last_error', 'HTTP 403 token refresh-error-secret-marker at https://private.example');
  setYoutubeState('last_reason', 'manual raw-refresh-query-secret-marker');
  setYoutubeState('last_phase_results', [{
    phase: 'v2_publish',
    ok: false,
    started_at: now - 100,
    ended_at: now,
    duration_ms: 100,
    error: 'provider HTTP 403 token phase-error-secret-marker',
  }, {
    phase: 'raw-phase-secret-marker',
    ok: false,
    started_at: now - 50,
    ended_at: now,
    duration_ms: 50,
    error: 'network fetch https://private.example?q=phase-query-secret-marker',
  }]);
  setYoutubeState('youtube_v2_subscription_acquisition', {
    stale: true,
    reason: 'oauth_subscription_refresh_failed',
    channels_queried: 3,
    authoritative_channels: 4,
    channel_ids: ['subscription-channel-secret-marker'],
    error: 'OAuth token subscription-error-secret-marker',
    acquired_at: now,
  });
  setYoutubeState('youtube_v2_history_metadata', {
    attempted: 5,
    resolved: 4,
    unresolved: 1,
    video_ids: ['history-video-secret-marker'],
    error: 'metadata-error-secret-marker',
    at: now,
  });
  setYoutubeState('youtube_v2_history_acquisition', {
    queries_attempted: 1,
    search_calls_attempted: 1,
    query_budget: { more_like: 1, beyond: 0, total: 1 },
    more_like_queries: 1,
    more_like_search_calls: 1,
    more_like_status: 'thematic',
    more_like_min_seeds: 8,
    more_like_attempted_seeds: 1,
    more_like_contributing_seeds: 1,
    more_like_candidate_count: 4,
    more_like_target: 512,
    more_like_target_reached: false,
    funnels: [{
      query: 'history-funnel-query-secret-marker',
      seed_ref: 'history-funnel-seed-secret-marker',
      returned: 5,
      persisted: 4,
      error: 'HTTP 429 funnel-error-secret-marker',
    }],
    distinct_seed_refs: ['history-funnel-seed-secret-marker'],
    query_failures: 1,
    candidates_acquired: 4,
    unique_candidates_acquired: 4,
    low_yield_streak: 2,
    low_yield_stop_after: 8,
    low_yield_min_new: 4,
    stop_reason: 'search_budget',
    wall_limit_ms: 90_000,
    duration_ms: 2_500,
    acquired_at: now,
    expires_at: now + 1_000,
  });
  setYoutubeState('youtube_v2_more_like_status', {
    status: 'thematic',
    seed_refs: ['more-like-seed-secret-marker'],
    attempted_seed_count: 1,
    contributing_seed_count: 1,
    candidate_count: 4,
    target: 512,
    target_reached: false,
    at: now,
  });
  setYoutubeState('youtube_v2_daily_topic_seed', {
    day: 'daily-topic-day-secret-marker',
    kind: 'daily-topic-kind-secret-marker',
    provenance_ref: 'daily-topic-ref-secret-marker',
    item_id: 'daily-topic-item-secret-marker',
    source_generation: 'daily-topic-generation-secret-marker',
    selected_at: 'daily-topic-time-secret-marker',
  });
  setYoutubeState('youtube_v2_daily_more_like_seed_set', {
    day: 'daily-set-day-secret-marker',
    seeds: [{
      provenance_ref: 'daily-set-ref-secret-marker',
      item_id: 'daily-set-item-secret-marker',
      source_generation: 'daily-set-generation-secret-marker',
    }],
    selected_at: 'daily-set-time-secret-marker',
  });
  setYoutubeState('youtube_v2_live_acquisition', {
    channels_probed: 2,
    channel_ids: ['live-channel-secret-marker'],
    query_cap: 8,
    query_failures: 1,
    candidates_acquired: 1,
    error: 'live-provider-error-secret-marker',
    acquired_at: now,
    expires_at: now + 1_000,
  });
  setYoutubeState('youtube_v2_source_stale', {
    stale: true,
    reason: 'source-stale-reason-secret-marker',
    error: 'OAuth token source-stale-error-secret-marker',
    at: now,
    authoritative_subscription_count: 4,
  });
  setYoutubeState('youtube_v2_last_error', {
    error: 'provider HTTP 403 token v2-last-error-secret-marker',
    at: now,
  });
  assert.deepEqual(
    { ...youtubeV2SourceStaleState(), error: undefined },
    {
      stale: true,
      reason: null,
      at: now,
      authoritative_subscription_count: 4,
      error: undefined,
    },
  );

  process.env.MANGO_YOUTUBE_API_KEY = 'api-key-secret-marker';
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YTDLP_COMMAND = 'https://operator:command-secret-marker@private.example/runner';
  const stateDir = dirname(process.env.MANGO_YOUTUBE_DB_PATH!);
  const oauthClientPath = join(stateDir, 'oauth-client-file-secret-marker.json');
  const tokenPath = join(stateDir, 'token-file-secret-marker.json');
  process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE = oauthClientPath;
  process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE = tokenPath;
  writeFileSync(oauthClientPath, JSON.stringify({
    installed: {
      client_id: 'oauth-client-id-secret-marker',
      client_secret: 'oauth-client-secret-marker',
    },
  }));
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access-token-secret-marker',
    refresh_token: 'refresh-token-secret-marker',
    expires_at: now + 10_000,
    scope: 'scope-token-secret-marker https://private.example/auth/scope',
  }));

  const service = new YoutubeService();
  const state = service.state();
  const rails = await service.rails();
  assert.equal(rails.recommendations_status, 'stale');
  assert.equal(rails.stale_reason, null);
  assert.equal(JSON.stringify(rails).includes('source-stale-reason-secret-marker'), false);
  assert.deepEqual({
    api_key: (state.configured as Record<string, unknown>).api_key,
    oauth_client: (state.configured as Record<string, unknown>).oauth_client,
    yt_dlp_command: (state.configured as Record<string, unknown>).yt_dlp_command,
    yt_dlp_command_kind: (state.configured as Record<string, unknown>).yt_dlp_command_kind,
    playback_cookies: (state.configured as Record<string, unknown>).playback_cookies,
    yt_dlp_version: (state.configured as Record<string, unknown>).yt_dlp_version,
  }, {
    api_key: true,
    oauth_client: true,
    yt_dlp_command: '',
    yt_dlp_command_kind: 'custom',
    playback_cookies: false,
    yt_dlp_version: null,
  });
  assert.equal(typeof (state.configured as Record<string, unknown>).pot_server, 'boolean');
  assert.deepEqual(state.auth, {
    configured: true,
    authenticated: true,
    expires_at: now + 10_000,
    scope_count: 2,
  });
  const refresh = state.refresh as {
    last_error: string | null;
    last_reason: string | null;
    phase_results: Array<Record<string, unknown>>;
  };
  assert.equal(refresh.last_error, 'auth');
  assert.equal(refresh.last_reason, 'triggered');
  assert.deepEqual(refresh.phase_results.map((phase) => [phase.phase, phase.error_category]), [
    ['v2_publish', 'auth'],
    ['unknown', 'network'],
  ]);

  const diagnostics = state.recommendations_v2 as {
    sampling: Record<string, unknown>;
    pool_quality: Record<string, unknown>;
    latest_takeout_import: Record<string, unknown>;
    history_acquisition: Record<string, unknown>;
    more_like_status: Record<string, unknown>;
    daily_topic_seed: Record<string, unknown>;
    daily_more_like_seed_set: Record<string, unknown>;
    source_stale: Record<string, unknown>;
    last_error: Record<string, unknown>;
  };
  assert.deepEqual(diagnostics.sampling, {
    policy: 'independent_weighted_v1',
    independent_epoch_draws: true,
    without_replacement_scope: 'visible_slate',
    impression_aware: false,
    recent_slate_state: false,
  });
  assert.ok(diagnostics.pool_quality.for_you);
  assert.deepEqual(Object.keys(diagnostics.latest_takeout_import).sort(), [
    'error_categories',
    'error_count',
    'format',
    'history_count',
    'imported_at',
    'status',
    'subscription_count',
    'warning_count',
  ]);
  assert.equal(diagnostics.latest_takeout_import.warning_count, 1);
  assert.equal(diagnostics.latest_takeout_import.error_count, 1);
  assert.equal(diagnostics.history_acquisition.stop_reason, 'search_budget');
  assert.equal(diagnostics.history_acquisition.distinct_seed_count, 1);
  assert.equal((diagnostics.history_acquisition.funnel_totals as Record<string, unknown>).persisted, 4);
  assert.equal((diagnostics.more_like_status.seed_refs as string[]).length, 1);
  assert.deepEqual(diagnostics.daily_topic_seed, {
    day: null,
    kind: 'unknown',
    seed_ref: diagnostics.daily_topic_seed.seed_ref,
    selected_at: null,
  });
  assert.match(String(diagnostics.daily_topic_seed.seed_ref), /^[a-f0-9]{16}$/);
  assert.deepEqual(diagnostics.daily_more_like_seed_set, {
    day: null,
    seed_count: 1,
    seed_refs: diagnostics.daily_more_like_seed_set.seed_refs,
    selected_at: null,
  });
  assert.match(
    String((diagnostics.daily_more_like_seed_set.seed_refs as string[])[0]),
    /^[a-f0-9]{16}$/,
  );
  assert.deepEqual(diagnostics.source_stale, {
    stale: true,
    reason: null,
    error_category: 'auth',
    at: now,
    authoritative_subscription_count: 4,
  });
  assert.deepEqual(diagnostics.last_error, { category: 'auth', at: now });

  const serialized = JSON.stringify(state);
  for (const forbidden of [
    anchor.id,
    anchor.title,
    candidate.id,
    candidate.title,
    candidate.thumbnail!,
    anchor.channel_id!,
    'raw diagnostic query secret',
    'credential-marker-secret',
    'api-key-secret-marker',
    'oauth-client-file-secret-marker',
    'oauth-client-id-secret-marker',
    'oauth-client-secret-marker',
    'token-file-secret-marker',
    'access-token-secret-marker',
    'refresh-token-secret-marker',
    'scope-token-secret-marker',
    'command-secret-marker',
    'refresh-error-secret-marker',
    'raw-refresh-query-secret-marker',
    'phase-error-secret-marker',
    'phase-query-secret-marker',
    'raw-phase-secret-marker',
    'subscription-channel-secret-marker',
    'subscription-error-secret-marker',
    'history-video-secret-marker',
    'metadata-error-secret-marker',
    'history-funnel-query-secret-marker',
    'history-funnel-seed-secret-marker',
    'funnel-error-secret-marker',
    'more-like-seed-secret-marker',
    'daily-topic-day-secret-marker',
    'daily-topic-kind-secret-marker',
    'daily-topic-ref-secret-marker',
    'daily-topic-item-secret-marker',
    'daily-topic-generation-secret-marker',
    'daily-topic-time-secret-marker',
    'daily-set-day-secret-marker',
    'daily-set-ref-secret-marker',
    'daily-set-item-secret-marker',
    'daily-set-generation-secret-marker',
    'daily-set-time-secret-marker',
    'live-channel-secret-marker',
    'live-provider-error-secret-marker',
    'source-stale-reason-secret-marker',
    'source-stale-error-secret-marker',
    'v2-last-error-secret-marker',
    'takeout-generation-secret-marker',
    'takeout-filename-secret-marker',
    'takeout-source-hash-secret-marker',
    'takeout-query-secret-marker',
    'more_like:diagnostic-safe-generation',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `state leaked ${forbidden}`);
  }

  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'malformed-access-token-secret-marker',
    expires_at: 'malformed-expiry-secret-marker',
  }));
  const malformedAuthState = new YoutubeService().state();
  assert.equal((malformedAuthState.auth as Record<string, unknown>).expires_at, null);
  assert.equal(JSON.stringify(malformedAuthState).includes('malformed-expiry-secret-marker'), false);
  assert.equal(JSON.stringify(malformedAuthState).includes('malformed-access-token-secret-marker'), false);
}));

test('Your regulars mixes rewatch cooldown exemption with frequent-channel uploads', () => withTempState(() => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  const repeat = video('RepeatRegular', 'Repeat fermentation kitchen', 'regular-channel');
  const fresh = video('FreshRegular', 'Fresh fermentation kitchen', 'regular-channel');
  upsertYoutubeItems([repeat, fresh]);
  upsertYoutubeV2ImportedHistory([
    {
      video_id: repeat.id, title: repeat.title, title_url: null,
      channel_id: repeat.channel_id, channel_title: repeat.channel_title, watched_at: now,
    },
    {
      video_id: repeat.id, title: repeat.title, title_url: null,
      channel_id: repeat.channel_id, channel_title: repeat.channel_title,
      watched_at: now - 3 * 24 * 60 * 60 * 1000,
    },
  ], { source_generation: 'regulars-history', imported_at: now });
  upsertYoutubeV2CandidateProvenance([{
    item: fresh, provenance: 'history_channel', provenance_ref: repeat.id,
    source_generation: 'regulars-channel', acquired_at: now, expires_at: now + 1_000_000,
    relation_type: 'direct', source_rank: 0,
  }]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const regulars = generation.items.filter((item) => item.rail_id === 'frequently_watched');
  assert.ok(regulars.some((item) => item.id === repeat.id && item.provenance === 'rewatch'));
  assert.ok(regulars.some((item) => item.id === fresh.id && item.provenance === 'frequent_channel'));
  assert.equal(generation.items.some((item) => item.rail_id !== 'frequently_watched' && item.id === repeat.id), false);
}));

test('Your regulars shuffle deals from the full reserve instead of a frozen four', () => withTempState(() => {
  const now = Date.now();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  const items = [
    ...Array.from({ length: 16 }, (_, index) => ({
      rail_id: 'frequently_watched' as const,
      item: video(`rewatch-${index}`, `Rewatch kitchen ${index}`, `rewatch-channel-${index}`),
      score: 0.7,
      reason: 'youtube_v2:rewatch',
      provenance: 'rewatch' as const,
      provenance_ref: `rewatch-${index}`,
      source_expires_at: now + 1_000_000,
      context_id: 'rewatch',
    })),
    ...Array.from({ length: 24 }, (_, index) => ({
      rail_id: 'frequently_watched' as const,
      item: video(`frequent-${index}`, `Frequent upload ${index}`, `frequent-channel-${index}`),
      score: 0.55,
      reason: 'youtube_v2:frequent_channel',
      provenance: 'frequent_channel' as const,
      provenance_ref: `frequent-channel-${index}`,
      source_expires_at: now + 1_000_000,
      context_id: 'frequent_channel',
    })),
  ];
  publishYoutubeV2Generation({
    model_version: YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
    source_hash: 'regulars-shuffle-depth',
    watch_count: 16,
    subscription_count: 0,
    generated_at: now,
    items,
  });
  importOfficialHistory(
    items.filter((entry) => entry.provenance === 'rewatch').map((entry) => entry.item),
    now,
    'regulars-shuffle-history',
  );
  invalidateYoutubeV2ExactExclusions();
  assert.ok(youtubeV2ExactExcludedIds().has('rewatch-0'));
  const unique = new Set<string>();
  let previous = '';
  let changed = 0;
  const slate = (epoch: number, reserved_ids?: ReadonlySet<string>) => {
    const rail = youtubeV2RecommendationRails({
      shuffle_epoch: epoch,
      reserved_ids,
    }).find((entry) => entry.rail_id === 'frequently_watched');
    assert.ok(rail);
    assert.equal(rail.items.length, 4);
    return rail.items;
  };
  for (let epoch = 0; epoch < 24; epoch += 1) {
    const cards = slate(epoch);
    const key = cards.map((item) => item.id).join(',');
    if (epoch > 0 && key !== previous) changed += 1;
    previous = key;
    cards.forEach((item) => unique.add(item.id));
    assert.ok(cards.some((item) => item.id.startsWith('rewatch-')));
    assert.ok(cards.some((item) => item.id.startsWith('frequent-')));
  }
  assert.ok(unique.size > 4, `unique regulars ids=${unique.size}`);
  assert.ok(changed >= 16, `slate changes=${changed}`);
  const stolen = slate(0).map((item) => item.id);
  const afterTheft = slate(0, new Set(stolen));
  assert.equal(afterTheft.some((item) => stolen.includes(item.id)), false);
}));

test('Not-for-me applies a decaying channel penalty while exact video veto stays', () => withTempState(() => {
  const now = Date.now();
  const seed = video('PenaltySeed', 'Penalty seed documentary', 'penalty-seed');
  const sameChannel = video('PenaltySame', 'Penalty same-channel documentary', 'penalty-channel');
  const other = video('PenaltyOther', 'Penalty other documentary', 'other-channel');
  const hidden = video('PenaltyHidden', 'Penalty hidden documentary', 'penalty-channel');
  upsertYoutubeItems([seed, sameChannel, other, hidden]);
  importOfficialHistory([seed], now, 'penalty-history');
  setLibraryFeedback({
    source: 'youtube', type: 'youtube_video', id: hidden.id, title: hidden.title,
    tab: 'youtube', feedback: 'not_interested', created_at: now,
  });
  upsertYoutubeV2CandidateProvenance([
    {
      item: sameChannel, provenance: 'history_topic', provenance_ref: seed.id,
      source_generation: 'penalty-same', acquired_at: now, expires_at: now + 1_000_000,
      relation_type: 'same_topic', source_rank: 0,
    },
    {
      item: other, provenance: 'history_topic', provenance_ref: seed.id,
      source_generation: 'penalty-other', acquired_at: now, expires_at: now + 1_000_000,
      relation_type: 'same_topic', source_rank: 0,
    },
    {
      item: hidden, provenance: 'history_topic', provenance_ref: seed.id,
      source_generation: 'penalty-hidden', acquired_at: now, expires_at: now + 1_000_000,
      relation_type: 'same_topic', source_rank: 0,
    },
  ]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const scores = new Map(generation.items.filter((item) => item.rail_id === 'for_you').map((item) => [item.id, item.score]));
  assert.equal(scores.has(hidden.id), false);
  assert.ok(scores.get(other.id)! > scores.get(sameChannel.id)!);
  assert.ok(generation.items.some((item) => item.score_breakdown && item.score_breakdown.penalty < 1));
}));

test('v3 diagnostics keep impression-free sampling and embeddings off by default', () => withTempState(() => {
  seedV2();
  rebuildYoutubeV2Generation({ force: true });
  const diagnostics = youtubeV2Diagnostics();
  assert.equal(diagnostics.model_version, 'youtube-household-v3.0');
  assert.deepEqual(diagnostics.sampling, {
    policy: 'independent_weighted_v1',
    independent_epoch_draws: true,
    without_replacement_scope: 'visible_slate',
    impression_aware: false,
    recent_slate_state: false,
  });
  assert.equal((diagnostics.sources as Record<string, unknown>).recommendation_history_policy, 'takeout_and_local_meaningful');
  assert.equal((diagnostics.embeddings as Record<string, unknown>).enabled, false);
  assert.ok('frequently_watched' in (diagnostics.reserve_depths as Record<string, unknown>));
}));

test('offline holdout eval is deterministic across identical rebuilds', () => withTempState(() => {
  seedV2();
  const first = evaluateYoutubeVariants(1_700_000_000_000);
  const second = evaluateYoutubeVariants(1_700_000_000_000);
  assert.deepEqual(first.variants, second.variants);
  assert.equal((first.variants as Array<{ variant: string }>).map((row) => row.variant).join(','), 'legacy,v3,v3-embed');
}));

