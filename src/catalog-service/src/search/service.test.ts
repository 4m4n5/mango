import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetLibraryDbForTests } from '../library/db.js';
import { resetPlayabilityDbForTests } from '../playability/db.js';
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
