import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initLibraryDb,
  resetLibraryDbForTests,
  saveLibraryItem,
} from '../library/db.js';
import { loadYoutubeConfig } from './config.js';
import { resetYoutubeDbForTests, upsertYoutubeItems } from './db.js';
import type { YoutubeItem } from './types.js';
import { YoutubeService, youtubeItemToLibraryInput } from './service.js';

const video: YoutubeItem = {
  id: 'LegacyVideoCase',
  kind: 'video',
  title: 'Legacy video',
  subtitle: 'Legacy channel',
  description: null,
  thumbnail: null,
  channel_id: 'legacy-channel',
  channel_title: 'Legacy channel',
  published_at: '2026-01-01T00:00:00Z',
  duration_sec: 600,
  live_status: 'none',
  playlist_id: null,
  updated_at: 1,
};

test('YouTube playback keeps transport separate from its durable library source', () => {
  assert.deepEqual(youtubeItemToLibraryInput(video, 'mango'), {
    source: 'mango',
    type: 'youtube_video',
    id: 'LegacyVideoCase',
    title: 'Legacy video',
    poster: null,
    description: null,
    tab: 'youtube',
  });
  assert.equal(youtubeItemToLibraryInput(video).source, 'youtube');
  assert.equal(youtubeItemToLibraryInput(video, '  ').source, 'youtube');
  assert.equal(youtubeItemToLibraryInput(video, ' MANGO ').source, 'mango');
});

test('Search and Detail return the durable source for a legacy Saved video', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-library-source-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_YOUTUBE_RECS_V2 = 'off';
  resetLibraryDbForTests();
  resetYoutubeDbForTests();
  try {
    initLibraryDb();
    saveLibraryItem({
      source: 'mango',
      type: 'youtube_video',
      id: video.id,
      title: video.title,
      tab: 'series',
      saved_at: 1,
      profile_id: 'household',
    });
    const channel: YoutubeItem = {
      ...video,
      id: 'legacy-channel',
      kind: 'channel',
      title: 'Legacy channel',
      channel_id: null,
      channel_title: null,
      duration_sec: null,
    };
    upsertYoutubeItems([video, channel]);
    const service = new YoutubeService({
      ...loadYoutubeConfig(),
      db_path: process.env.MANGO_YOUTUBE_DB_PATH,
      api_key: null,
    });

    const search = await service.search('Legacy video', 50, {
      cache_only: true,
      record_recent: false,
    }) as { groups: { videos: YoutubeItem[] } };
    assert.equal(search.groups.videos.find((item) => item.id === video.id)?.library_source, 'mango');

    const detail = await service.detail('video', video.id) as {
      item: YoutubeItem;
      state: { source: string; item_key: string; saved: boolean };
    };
    assert.equal(detail.item.library_source, 'mango');
    assert.equal(detail.state.source, 'mango');
    assert.equal(detail.state.item_key, 'mango:youtube_video:LegacyVideoCase');
    assert.equal(detail.state.saved, true);

    const channelDetail = await service.detail('channel', channel.id) as { items: YoutubeItem[] };
    assert.equal(
      channelDetail.items.find((item) => item.id === video.id)?.library_source,
      'mango',
    );
  } finally {
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_YOUTUBE_RECS_V2;
    rmSync(dir, { recursive: true, force: true });
  }
});
