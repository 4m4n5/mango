import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  activateViewerProfile,
  clearWatchHistoryForSource,
  createViewerProfile,
  getPersonalizationState,
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
  replaceYoutubeV2Subscriptions,
  resetYoutubeDbForTests,
  upsertYoutubeItems,
  upsertYoutubeV2CandidateProvenance,
  upsertYoutubeV2ImportedHistory,
  youtubeRefreshStatus,
} from './db.js';
import {
  refreshYoutubeAfterTakeoutImport,
  YoutubeService,
  youtubeV2AcquisitionQueryBudget,
} from './service.js';
import {
  rebuildYoutubeV2Generation,
  youtubePublicPersonalizationPayload,
  youtubeRecommendationsV2Mode,
  youtubeV2HistoryItems,
  youtubeV2RecommendationRails,
  youtubeV2TopicSeed,
  weightedDailyHistorySeedId,
} from './v2.js';
import type { YoutubeItem, YoutubeRail } from './types.js';

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
  const channelVideos = Array.from({ length: 5 }, (_, index) => video(
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
  history.forEach((item, index) => recordLibraryWatch({
    profile_id: 'household',
    source: 'youtube',
    type: 'youtube_video',
    id: item.id,
    play_id: item.id,
    title: item.title,
    duration_sec: 600,
    position_sec: 600,
    event: 'finished',
    watched_at: now - index * 1_000,
  }));
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

test('triggered and nightly discovery query budgets honor 5 and 8/4 caps', () => {
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('meaningful_watch'), {
    more_like: 3, beyond: 2, total: 5,
  });
  assert.deepEqual(youtubeV2AcquisitionQueryBudget('nightly'), {
    more_like: 4, beyond: 8, total: 12,
  });
});

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

test('More Like and Beyond provenance generations coexist for the same video and source seed', () => withTempState(() => {
  const now = Date.now();
  const seed = video('LaneSeed', 'Lane seed documentary', 'lane-seed-channel');
  const candidate = video('LaneCandidate', 'Lane candidate documentary', 'lane-candidate-channel');
  upsertYoutubeItems([seed]);
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: seed.id,
    play_id: seed.id, title: seed.title, duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now,
  });
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
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: seed.id,
    play_id: seed.id, title: seed.title, duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now,
  });
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
    source: 'youtube', type: 'youtube_video', id: item.id, title: item.title,
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
}));

test('an authoritative empty source tombstone prevents stale ready fallback', () => withTempState(() => {
  seedV2();
  assert.ok(rebuildYoutubeV2Generation({ force: true }));
  clearWatchHistoryForSource('youtube');
  replaceYoutubeV2Subscriptions([], { source_generation: 'oauth-empty' });
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
  const allowed = new Set(['subscription_upload', 'subscription_live', 'history_channel', 'history_topic']);
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

test('lifetime watched and Saved exclusions are exhaustive beyond presentation limits', () => withTempState(() => {
  const now = Date.now();
  seedV2();
  const watchedTarget = video(
    'LifetimeWatched00000',
    'Old watched title outside the first five thousand',
    'subscribed-channel-0',
  );
  const imported = Array.from({ length: 5_001 }, (_, index) => ({
    video_id: index === 0 ? watchedTarget.id : `LifetimeWatched${String(index).padStart(5, '0')}`,
    title: `Lifetime watched ${index}`,
    title_url: null,
    channel_id: 'historical-channel',
    channel_title: 'Historical Channel',
    // Index zero is the one row excluded by the legacy 5,000-row read cap.
    watched_at: now - (5_001 - index) * 1_000,
  }));
  assert.equal(upsertYoutubeV2ImportedHistory(imported, {
    source_generation: 'takeout-over-five-thousand',
    imported_at: now,
  }).inserted, 5_001);
  assert.equal(listYoutubeV2ImportedHistory(5_000).some((row) => row.video_id === watchedTarget.id), false);

  const savedTarget = video(
    'LifetimeSaved00000',
    'Old Saved title outside the visible Saved query cap',
    'subscribed-channel-1',
  );
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: savedTarget.id,
    title: savedTarget.title, tab: 'youtube', saved_at: now - 100_000,
  });
  for (let index = 1; index <= 500; index += 1) {
    saveLibraryItem({
      source: 'youtube', type: 'youtube_video', id: `LifetimeSaved${String(index).padStart(5, '0')}`,
      title: `Lifetime Saved ${index}`, tab: 'youtube', saved_at: now + index,
    });
  }

  upsertYoutubeV2CandidateProvenance([
    watchedTarget,
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
  assert.equal(generation.items.some((item) => item.id === watchedTarget.id), false);
  assert.equal(generation.items.some((item) => item.id === savedTarget.id), false);
}));

test('meaningful Household watches use completion > Takeout partial > older evidence and ignore bare starts', () => withTempState(() => {
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
  })));
  const generation = rebuildYoutubeV2Generation({ force: true, at: now });
  assert.ok(generation);
  // History is a chronological utility rail, so the launch remains visible;
  // only recommendation seeds and exact lifetime exclusion require meaning.
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === bare.id), true);
  assert.equal(youtubeV2TopicSeed(now)?.provenance_ref, youtubeV2TopicSeed(now + 60_000)?.provenance_ref);
  const forYou = new Map(generation.items.filter((item) => item.rail_id === 'for_you').map((item) => [item.id, item.score]));
  assert.equal(forYou.has('BareCandidate'), false);
  assert.ok(forYou.get('CompleteCandidate')! > forYou.get('TakeoutRecentCandidate')!);
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
    { item: repeatedCandidate, provenance: 'history_topic', provenance_ref: repeated.id, source_generation: 'repeat-topic', acquired_at: now, expires_at: now + 1_000_000 },
    { item: singleCandidate, provenance: 'history_topic', provenance_ref: single.id, source_generation: 'single-topic', acquired_at: now, expires_at: now + 1_000_000 },
  ]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now })!;
  const scores = new Map(generation.items
    .filter((item) => item.rail_id === 'for_you')
    .map((item) => [item.id, item.score]));
  assert.ok(scores.get(repeatedCandidate.id)! > scores.get(singleCandidate.id)!);
  assert.equal(youtubeV2HistoryItems().filter((item) => item.id === repeated.id).length, 1);
}));

test('60/40 history/subscription affinity is renormalized without non-source influence', () => withTempState(() => {
  const now = Date.now();
  const seed = video('BlendSeed', 'Blend seed', 'watched-channel');
  const both = video('BlendBoth', 'Blend both', 'subscribed-channel');
  const historyOnly = video('BlendHistory', 'Blend history', 'history-channel');
  const subscriptionOnly = video('BlendSubscription', 'Blend subscription', 'subscribed-channel');
  upsertYoutubeItems([seed, both, historyOnly, subscriptionOnly]);
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: seed.id,
    play_id: seed.id, title: seed.title, duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now,
  });
  replaceYoutubeV2Subscriptions([{
    channel_key: 'subscribed-channel', channel_id: 'subscribed-channel',
    channel_title: 'Channel subscribed-channel', channel_url: null, source: 'oauth', subscribed_at: null,
  }], { source_generation: 'subscription-blend' });
  upsertYoutubeV2CandidateProvenance([
    { item: both, provenance: 'history_topic', provenance_ref: seed.id, source_generation: 'history', acquired_at: now, expires_at: now + 1_000_000 },
    { item: both, provenance: 'subscription_upload', provenance_ref: 'subscribed-channel', source_generation: 'subscription', acquired_at: now, expires_at: now + 1_000_000 },
    { item: historyOnly, provenance: 'history_topic', provenance_ref: seed.id, source_generation: 'history', acquired_at: now, expires_at: now + 1_000_000 },
    { item: subscriptionOnly, provenance: 'subscription_upload', provenance_ref: 'subscribed-channel', source_generation: 'subscription', acquired_at: now, expires_at: now + 1_000_000 },
  ]);
  const generation = rebuildYoutubeV2Generation({ force: true, at: now });
  assert.ok(generation);
  const scores = new Map(generation.items.filter((item) => item.rail_id === 'for_you').map((item) => [item.id, item.score]));
  assert.ok(scores.get(both.id)! > scores.get(historyOnly.id)!);
  assert.ok(scores.get(historyOnly.id)! > scores.get(subscriptionOnly.id)!);
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
      .map((item) => ({
        item,
        provenance: 'history_topic' as const,
        provenance_ref: `subscription:${channel}`,
        source_generation: `cold-topic:${channel}`,
        acquired_at: now,
        expires_at: now + 1_000_000,
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

test('From Your Subscriptions is newest-unwatched before stable fallback ordering', () => withTempState(() => {
  const now = Date.now();
  const items = [
    { item: video('LexicalZ', 'Old upload', 'newest-channel-0'), published: '2026-01-01T00:00:00Z' },
    { item: video('LexicalA', 'Newest upload', 'newest-channel-1'), published: '2026-06-01T00:00:00Z' },
    { item: video('LexicalY', 'Second newest', 'newest-channel-2'), published: '2026-05-01T00:00:00Z' },
    { item: video('LexicalB', 'Third newest', 'newest-channel-3'), published: '2026-04-01T00:00:00Z' },
    { item: video('LexicalX', 'Fourth newest', 'newest-channel-4'), published: '2026-03-01T00:00:00Z' },
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

test('five X presses perform no API, quota, or rank work and keep History and Saved stable', () => withTempState(async () => {
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true });
  const generation = latestYoutubeV2GenerationRecord()!.generation;
  const service = new YoutubeService();
  let apiCalls = 0;
  const api = (service as unknown as { api: Record<string, (...args: unknown[]) => Promise<unknown>> }).api;
  for (const method of ['search', 'subscriptions', 'channelUploadPlaylists', 'playlistItems', 'videos']) {
    api[method] = async () => { apiCalls += 1; throw new Error(`unexpected ${method}`); };
  }
  const initial = await service.rails() as { rails: YoutubeRail[] };
  const stable = (railId: string) => initial.rails.find((rail) => rail.rail_id === railId)?.items
    .map((item) => item.id) ?? [];
  const history = stable('history');
  const saved = stable('saved');
  const quotaBefore = youtubeRefreshStatus();
  for (let press = 0; press < 5; press += 1) {
    const response = await service.rails({ reshuffle: true }) as { rails: YoutubeRail[] };
    assert.deepEqual(response.rails.find((rail) => rail.rail_id === 'history')?.items.map((item) => item.id), history);
    assert.deepEqual(response.rails.find((rail) => rail.rail_id === 'saved')?.items.map((item) => item.id), saved);
  }
  const quotaAfter = youtubeRefreshStatus();
  assert.equal(apiCalls, 0);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, generation);
  assert.deepEqual(
    [quotaAfter.quota_used_today, quotaAfter.search_calls_today, quotaAfter.api_calls_today],
    [quotaBefore.quota_used_today, quotaBefore.search_calls_today, quotaBefore.api_calls_today],
  );
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
  recordLibraryWatch({
    profile_id: 'household', source: 'youtube', type: 'youtube_video', id: seed.id,
    play_id: seed.id, title: seed.title, duration_sec: 600, position_sec: 600,
    event: 'finished', watched_at: now,
  });
  replaceYoutubeV2Subscriptions([{
    channel_key: 'subscribed-channel', channel_id: 'subscribed-channel',
    channel_title: 'Channel subscribed-channel', channel_url: null, source: 'oauth', subscribed_at: null,
  }], { source_generation: 'oauth-complete', imported_at: now });
  const service = new YoutubeService();
  let searchCalls = 0;
  const api = (service as unknown as { api: {
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: (ids: string[]) => Promise<Map<string, string>>;
    playlistItems: (playlist: string) => Promise<YoutubeItem[]>;
    search: (query: string, options: { channelId?: string }) => Promise<{ videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[] }>;
  } }).api;
  api.subscriptions = async () => [{
    ...video('subscribed-channel', 'Channel subscribed-channel', 'subscribed-channel'),
    kind: 'channel',
  }];
  api.channelUploadPlaylists = async () => new Map([['subscribed-channel', 'uploads']]);
  api.playlistItems = async () => Array.from({ length: 8 }, (_, index) => video(
    `RefreshSubscription${index}`,
    `Fermentation subscription ${index}`,
    'subscribed-channel',
  ));
  api.search = async (_query, options) => {
    const call = searchCalls++;
    const channel = options.channelId || `refresh-topic-channel-${call}`;
    return {
      videos: [video(`RefreshHistory${call}`, `Fermentation science analysis ${call}`, channel)],
      channels: [],
      playlists: [],
    };
  };
  const result = await service.refresh('triggered');
  assert.equal(result.ok, true);
  assert.deepEqual(result.phases?.map((phase) => phase.phase), [
    'subscriptions', 'v2_subscription_acquisition', 'v2_history_metadata',
    'v2_history_acquisition', 'v2_live_acquisition', 'v2_publish',
  ]);
  assert.ok(searchCalls <= 5);
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
  assert.ok(acquisition.queries_attempted <= 5);
  assert.ok(acquisition.more_like_queries <= 3);
  assert.ok(acquisition.beyond_queries <= 2);
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
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    playlistItems: () => Promise<YoutubeItem[]>;
    search: () => Promise<{ videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[] }>;
    videos: () => Promise<YoutubeItem[]>;
  } }).api;
  api.subscriptions = async () => [{
    ...video('shadow-subscription', 'Shadow subscription', 'shadow-subscription'), kind: 'channel',
  }];
  api.channelUploadPlaylists = async () => new Map();
  api.playlistItems = async () => [];
  api.search = async () => ({ videos: [], channels: [], playlists: [] });
  api.videos = async () => [];

  const result = await service.refresh('triggered-shadow');
  assert.equal(result.ok, true);
  const phases = result.phases?.map((phase) => phase.phase) ?? [];
  assert.deepEqual(phases, [
    'subscriptions', 'v2_subscription_acquisition', 'v2_history_metadata',
    'v2_history_acquisition', 'v2_live_acquisition', 'v2_publish',
  ]);
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
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    search: () => Promise<{ videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[] }>;
  } }).api;
  api.subscriptions = async () => [...seedV2().subscriptionChannels].map((channel) => ({
    ...video(channel, `Channel ${channel}`, channel), kind: 'channel',
  }));
  api.channelUploadPlaylists = async () => new Map();
  api.search = async () => { throw new Error('search unavailable'); };
  const result = await service.refresh('triggered-failure');
  assert.equal(result.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_history_acquisition')?.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, false);
  assert.equal(latestYoutubeV2GenerationRecord()?.generation, published.generation);
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
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    search: (query: string, options: { eventType?: string; channelId?: string }) => Promise<{
      videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[];
    }>;
  } }).api;
  api.subscriptions = async () => channels.map((channel) => ({
    ...video(channel, `Channel ${channel}`, channel), kind: 'channel',
  }));
  api.channelUploadPlaylists = async () => new Map();
  api.search = async (_query, options) => {
    if (options.eventType !== 'live') return { videos: [], channels: [], playlists: [] };
    liveProbes += 1;
    probedChannels.push(options.channelId!);
    return {
      videos: [video(`LiveProbe${liveProbes}`, `Live probe ${liveProbes}`, options.channelId!, 'live')],
      channels: [], playlists: [],
    };
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
    subscriptions: () => Promise<YoutubeItem[]>;
  } }).api;
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

test('complete OAuth enumeration replaces membership even when upload acquisition fails', () => withTempState(async () => {
  seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  process.env.MANGO_YOUTUBE_API_KEY = 'test-key';
  writeFileSync(process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE!, JSON.stringify({
    access_token: 'test-access-token',
    expires_at: Date.now() + 60 * 60 * 1_000,
  }));
  const published = rebuildYoutubeV2Generation({ force: true })!;
  const service = new YoutubeService();
  const api = (service as unknown as { api: {
    subscriptions: () => Promise<YoutubeItem[]>;
    channelUploadPlaylists: () => Promise<Map<string, string>>;
    search: () => Promise<{ videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[] }>;
  } }).api;
  api.subscriptions = async () => [{
    ...video('new-subscription', 'New subscription', 'new-subscription'),
    kind: 'channel',
  }];
  api.channelUploadPlaylists = async () => { throw new Error('uploads unavailable'); };
  api.search = async () => ({ videos: [], channels: [], playlists: [] });

  const result = await service.refresh('partial-oauth-source');
  assert.equal(result.ok, true);
  assert.equal(result.phases?.find((phase) => phase.phase === 'subscriptions')?.ok, true);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_subscription_acquisition')?.ok, false);
  assert.equal(result.phases?.find((phase) => phase.phase === 'v2_publish')?.ok, true);
  assert.ok(latestYoutubeV2GenerationRecord()!.generation > published.generation);
  assert.deepEqual(listYoutubeV2Subscriptions().map((row) => row.channel_key), ['new-subscription']);
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
    search: () => Promise<{ videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[] }>;
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
  api.search = async () => ({ videos: [], channels: [], playlists: [] });
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
    search: () => Promise<{ videos: YoutubeItem[]; channels: YoutubeItem[]; playlists: YoutubeItem[] }>;
  } }).api;
  api.videos = async (ids) => {
    resolvedIds = ids;
    const resolved = [video('LocalNeedsMetadata', 'Local unresolved launch', 'local-resolved-channel')];
    upsertYoutubeItems(resolved);
    return resolved;
  };
  api.search = async () => ({ videos: [], channels: [], playlists: [] });
  await service.refresh('local-history-metadata');
  assert.deepEqual(resolvedIds, ['LocalNeedsMetadata']);
  assert.equal(youtubeV2HistoryItems().some((item) => item.id === 'LocalNeedsMetadata'), true);
}));

test('serve order, labels, card counts, creator caps, and global dedupe match the couch contract', () => withTempState(async () => {
  const seeded = seedV2();
  process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
  rebuildYoutubeV2Generation({ force: true });
  const response = await new YoutubeService().rails() as {
    recommendations_status: string;
    rails: YoutubeRail[];
  };
  assert.equal(response.recommendations_status, 'ready');
  assert.deepEqual(response.rails.map((rail) => [rail.rail_id, rail.label]), [
    ['for_you', 'For You'],
    ['beyond', 'Beyond Your Subscriptions'],
    ['more_like', `More from Channel ${seeded.watchedChannel}`],
    ['history', 'History'],
    ['saved', 'Saved'],
    ['new_from_subscriptions', 'From Your Subscriptions'],
    ['live_now', 'Live Now'],
  ]);
  for (const rail of response.rails) {
    if (rail.rail_id === 'live_now') assert.ok(rail.items.length >= 1 && rail.items.length <= 4);
    else assert.equal(rail.items.length, 4, rail.rail_id);
  }
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
