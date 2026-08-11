import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetLibraryDbForTests, saveLibraryItem } from '../library/db.js';
import {
  recordVerifyResult,
  resetPlayabilityDbForTests,
  upsertRailPoolTitle,
} from '../playability/db.js';
import { resetYoutubeDbForTests, upsertYoutubeItems } from '../youtube/db.js';
import type { YoutubeSearchGroups } from '../youtube/types.js';
import { UnifiedSearchService } from './service.js';

const EMPTY_GROUPS: YoutubeSearchGroups = {
  videos: [],
  channels: [],
  playlists: [],
};

function withSearchServiceTest(
  run: (service: UnifiedSearchService) => Promise<void>,
  search: () => Promise<Record<string, unknown>> = async () => ({ groups: EMPTY_GROUPS }),
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-unified-search-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live.json');
  resetLibraryDbForTests();
  resetPlayabilityDbForTests();
  resetYoutubeDbForTests();
  const service = new UnifiedSearchService(
    {} as never,
    { search } as never,
  );
  return run(service).then(async () => {
    const indexFlight = (service as unknown as { indexFlight: Promise<void> | null }).indexFlight;
    if (indexFlight) await indexFlight;
  }).finally(() => {
    resetLibraryDbForTests();
    resetPlayabilityDbForTests();
    resetYoutubeDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_PLAYABILITY_DB;
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIVE_RAILS_CACHE;
    rmSync(dir, { recursive: true, force: true });
  });
}

test('diagnostic Search completes cache-only without recording activity', () => withSearchServiceTest(async (service) => {
  const initial = await service.startQuery({
    query: 'dune',
    scope: 'all',
    diagnostic: true,
  });
  let complete = initial;
  while (!complete.complete) {
    const next = await service.waitForSnapshot(complete.search_id, complete.revision, 1_000);
    assert.ok(next);
    complete = next;
  }
  assert.equal(complete?.complete, true);
  assert.equal(complete?.phases.external.status, 'skipped');
  assert.equal(complete?.phases.live.status, 'skipped');
  assert.equal(complete?.phases.ai.status, 'skipped');
  assert.equal(complete?.phases.youtube.status, 'empty');
  assert.deepEqual((await service.state()).recents, []);
}));

test('cancel marks pending phases skipped and ignores late source completion', () => {
  let resolveSearch: ((value: Record<string, unknown>) => void) | undefined;
  const pendingSearch = () => new Promise<Record<string, unknown>>((resolve) => {
    resolveSearch = resolve;
  });
  return withSearchServiceTest(async (service) => {
    const initial = await service.startQuery({
      query: 'arrival',
      scope: 'youtube',
      diagnostic: true,
    });
    assert.equal(service.cancel(initial.search_id), true);
    const cancelled = service.snapshot(initial.search_id);
    assert.equal(cancelled?.complete, true);
    assert.equal(cancelled?.phases.youtube.status, 'skipped');
    resolveSearch?.({ groups: EMPTY_GROUPS });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(service.snapshot(initial.search_id)?.phases.youtube.status, 'skipped');
  }, pendingSearch);
});

test('index invalidation swaps in newly cached YouTube metadata atomically', () => withSearchServiceTest(async (service) => {
  const emptyState = await service.state() as { index: { items: number } };
  assert.equal(emptyState.index.items, 0);
  upsertYoutubeItems([{
    id: 'video-1',
    kind: 'video',
    title: 'Dune production design',
    subtitle: 'Film Craft',
    description: null,
    thumbnail: null,
    channel_id: 'channel-1',
    channel_title: 'Film Craft',
    published_at: '2026-07-01T00:00:00Z',
    duration_sec: 900,
    live_status: 'none',
    playlist_id: null,
    updated_at: Date.now(),
  }]);
  (service as unknown as { generationCheckedAt: number }).generationCheckedAt = 0;
  await service.state();
  const flight = (service as unknown as { indexFlight: Promise<void> | null }).indexFlight;
  if (flight) await flight;
  const nextState = await service.state() as { index: { items: number } };
  assert.equal(nextState.index.items, 1);
  assert.equal((await service.suggestions('dune', 'youtube', 9))[0]?.id, 'video-1');
}));

test('Unified Search preserves a legacy Saved YouTube source before and after async completion', () => {
  let resolveSearch: ((value: Record<string, unknown>) => void) | undefined;
  const pendingSearch = () => new Promise<Record<string, unknown>>((resolve) => {
    resolveSearch = resolve;
  });
  return withSearchServiceTest(async (service) => {
    process.env.MANGO_YOUTUBE_RECS_V2 = 'serve';
    const item = {
      id: 'legacy-search-video',
      kind: 'video' as const,
      title: 'Legacy Search Video',
      subtitle: 'Film Craft',
      description: null,
      thumbnail: null,
      channel_id: 'legacy-channel',
      channel_title: 'Film Craft',
      published_at: '2026-07-01T00:00:00Z',
      duration_sec: 900,
      live_status: 'none' as const,
      playlist_id: null,
      updated_at: Date.now(),
    };
    upsertYoutubeItems([item]);
    saveLibraryItem({
      source: 'mango',
      type: 'youtube_video',
      id: item.id,
      title: item.title,
      tab: 'series',
      profile_id: 'household',
    });
    (service as unknown as { generationCheckedAt: number }).generationCheckedAt = 0;
    await service.state();
    const flight = (service as unknown as { indexFlight: Promise<void> | null }).indexFlight;
    if (flight) await flight;

    let snapshot = await service.startQuery({
      query: 'legacy search video',
      scope: 'youtube',
      diagnostic: true,
    });
    assert.equal(
      snapshot.groups.find((group) => group.id === 'youtube')?.items[0]?.library_source,
      'mango',
    );
    resolveSearch?.({
      groups: {
        videos: [{ ...item, library_source: 'mango' }],
        channels: [],
        playlists: [],
      },
    });
    while (!snapshot.complete) {
      const next = await service.waitForSnapshot(snapshot.search_id, snapshot.revision, 1_000);
      assert.ok(next);
      snapshot = next;
    }
    assert.equal(
      snapshot.groups.find((group) => group.id === 'youtube')?.items[0]?.library_source,
      'mango',
    );
  }, pendingSearch).finally(() => {
    delete process.env.MANGO_YOUTUBE_RECS_V2;
  });
});

test('verified Search metadata prefers a duplicate pool row with artwork', () => withSearchServiceTest(async (service) => {
  await recordVerifyResult({
    type: 'movie',
    id: 'tt1234567',
    status: 'verified',
    expires_at: Date.now() + 60_000,
  });
  await upsertRailPoolTitle({
    rail_id: 'movies-first',
    type: 'movie',
    id: 'tt1234567',
    score: 100,
    title: 'Artwork Choice',
  });
  await upsertRailPoolTitle({
    rail_id: 'movies-second',
    type: 'movie',
    id: 'tt1234567',
    score: 90,
    title: 'Artwork Choice',
    poster_url: 'https://cdn.example/artwork-choice.jpg',
  });

  const results = await service.suggestions('artwork choice', 'movies', 9);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.poster, 'https://cdn.example/artwork-choice.jpg');
}));

test('YouTube retry updates only a completed degraded Search job', () => {
  let calls = 0;
  const search = async (): Promise<Record<string, unknown>> => {
    calls += 1;
    if (calls === 1) return { groups: EMPTY_GROUPS, api_error: 'temporary failure' };
    return {
      groups: {
        videos: [{
          id: 'retry-video',
          kind: 'video',
          title: 'Retry Video',
          subtitle: 'Channel',
          description: null,
          thumbnail: null,
          channel_id: 'channel-1',
          channel_title: 'Channel',
          published_at: '2026-07-01T00:00:00Z',
          duration_sec: 600,
          live_status: 'none',
          playlist_id: null,
          library_source: 'mango',
          updated_at: Date.now(),
        }],
        channels: [],
        playlists: [],
      },
    };
  };
  return withSearchServiceTest(async (service) => {
    let snapshot = await service.startQuery({
      query: 'retry video',
      scope: 'youtube',
      diagnostic: true,
    });
    while (!snapshot.complete) {
      const next = await service.waitForSnapshot(snapshot.search_id, snapshot.revision, 1_000);
      assert.ok(next);
      snapshot = next;
    }
    assert.equal(snapshot.phases.youtube.status, 'degraded');
    const retried = await service.retryYoutube(snapshot.search_id);
    assert.equal(calls, 2);
    assert.equal(retried?.phases.youtube.status, 'ready');
    assert.deepEqual(retried?.groups.find((group) => group.id === 'youtube')?.items.map((item) => item.id), [
      'retry-video',
    ]);
    assert.equal(
      retried?.groups.find((group) => group.id === 'youtube')?.items[0]?.library_source,
      'mango',
    );
    assert.equal(retried?.phases.external.status, 'skipped');
    assert.equal(retried?.phases.live.status, 'skipped');
    assert.equal(retried?.phases.ai.status, 'skipped');
  }, search);
});
