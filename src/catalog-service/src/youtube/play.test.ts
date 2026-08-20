import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CatalogError } from '../catalog-errors.js';
import { initLibraryDb, resetLibraryDbForTests } from '../library/db.js';
import { PlayCancelledError, resetPlayEpochForTest } from '../play-cancel.js';
import { initProgressDb, resetProgressDbForTests, upsertWatchProgressDetailed } from '../progress/db.js';
import { resetWatchWatcherForTests } from '../progress/watcher.js';
import { resetJournalForTests } from '../companion/journal.js';
import { loadYoutubeConfig } from './config.js';
import { resetYoutubeDbForTests, upsertYoutubeItems } from './db.js';
import { resetYoutubePlaybackStateForTest, setYoutubeCommandRunnerForTest } from './playback.js';
import { setYoutubePlayUrlForTest, YoutubeService } from './service.js';
import type { YoutubeItem } from './types.js';

const video: YoutubeItem = {
  id: 'PlayableVideo',
  kind: 'video',
  title: 'Playable',
  subtitle: 'Channel',
  description: null,
  thumbnail: null,
  channel_id: 'channel',
  channel_title: 'Channel',
  published_at: '2026-01-01T00:00:00Z',
  duration_sec: 600,
  live_status: 'none',
  playlist_id: null,
  updated_at: 1,
};

async function withPlayHarness<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-play-'));
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  process.env.MANGO_PROGRESS_DB_PATH = join(dir, 'progress.db');
  process.env.MANGO_PLAY_CANCEL_PATH = join(dir, 'play-cancel.epoch');
  process.env.MANGO_COMPANION_DIR = join(dir, 'companion');
  process.env.MANGO_YTDLP_COMMAND = 'yt-dlp';
  process.env.MANGO_YOUTUBE_RECS_V2 = 'off';
  process.env.MANGO_YOUTUBE_POT = '0';
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  resetProgressDbForTests();
  resetWatchWatcherForTests();
  resetJournalForTests();
  resetYoutubePlaybackStateForTest();
  await resetPlayEpochForTest(1);
  initLibraryDb();
  await initProgressDb();
  try {
    return await fn();
  } finally {
    resetWatchWatcherForTests();
    resetJournalForTests();
    resetYoutubePlaybackStateForTest();
    setYoutubePlayUrlForTest(null);
    setYoutubeCommandRunnerForTest(null);
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    resetProgressDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    delete process.env.MANGO_PROGRESS_DB_PATH;
    delete process.env.MANGO_PLAY_CANCEL_PATH;
    delete process.env.MANGO_COMPANION_DIR;
    delete process.env.MANGO_YTDLP_COMMAND;
    delete process.env.MANGO_YOUTUBE_RECS_V2;
    delete process.env.MANGO_YOUTUBE_POT;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('YoutubeService.play starts mpv once and records history without leaking URLs', async () => {
  await withPlayHarness(async () => {
    upsertYoutubeItems([video]);
    let playCalls = 0;
    setYoutubeCommandRunnerForTest(async () => ({
      stdout: 'MANGO_META:none|600|https\nhttps://video.example/watch?token=secret\n',
      stderr: '',
    }));
    setYoutubePlayUrlForTest(async (url, _timeout, options) => {
      playCalls += 1;
      assert.equal(url, 'https://video.example/watch?token=secret');
      assert.equal(options?.startSec, 0);
      return { ok: true, ttff_ms: 1200 };
    });
    const result = await new YoutubeService({
      ...loadYoutubeConfig(),
      db_path: process.env.MANGO_YOUTUBE_DB_PATH!,
      api_key: null,
    }).play({ id: video.id, library_source: 'mango' }, { playEpoch: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.live, false);
    assert.equal(playCalls, 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });
});

test('YoutubeService.play resumes from durable progress and treats uncached live as live', async () => {
  await withPlayHarness(async () => {
    upsertWatchProgressDetailed({
      type: 'youtube_video',
      id: 'UncachedLive',
      play_id: 'UncachedLive',
      title: 'Live now',
      position_sec: 90,
      duration_sec: 600,
    });
    const starts: number[] = [];
    setYoutubeCommandRunnerForTest(async () => ({
      stdout: 'MANGO_META:live|0|m3u8\nhttps://video.example/live.m3u8\n',
      stderr: '',
    }));
    setYoutubePlayUrlForTest(async (_url, _timeout, options) => {
      starts.push(options?.startSec ?? 0);
      assert.equal(options?.live, true);
      return { ok: true, ttff_ms: 800 };
    });
    const result = await new YoutubeService({
      ...loadYoutubeConfig(),
      db_path: process.env.MANGO_YOUTUBE_DB_PATH!,
      api_key: null,
    }).play({ id: 'UncachedLive', title: 'Live now' }, { playEpoch: 1 });
    assert.equal(result.live, true);
    assert.deepEqual(starts, [0]);
  });
});

test('YoutubeService.play resumes a partially watched VOD near its stored position', async () => {
  await withPlayHarness(async () => {
    upsertYoutubeItems([video]);
    upsertWatchProgressDetailed({
      type: 'youtube_video',
      id: video.id,
      play_id: video.id,
      title: video.title,
      position_sec: 120,
      duration_sec: 600,
    });
    setYoutubeCommandRunnerForTest(async () => ({
      stdout: 'MANGO_META:none|600|https\nhttps://video.example/vod.mp4\n',
      stderr: '',
    }));
    let startSec = 0;
    setYoutubePlayUrlForTest(async (_url, _timeout, options) => {
      startSec = options?.startSec ?? 0;
      return { ok: true, ttff_ms: 400 };
    });
    await new YoutubeService({
      ...loadYoutubeConfig(),
      db_path: process.env.MANGO_YOUTUBE_DB_PATH!,
      api_key: null,
    }).play({ id: video.id }, { playEpoch: 1 });
    assert.equal(startSec, 120);
  });
});

test('YoutubeService.play does not start mpv after cancellation', async () => {
  await withPlayHarness(async () => {
    upsertYoutubeItems([video]);
    setYoutubeCommandRunnerForTest(async () => {
      throw new PlayCancelledError();
    });
    let playCalls = 0;
    setYoutubePlayUrlForTest(async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 1 };
    });
    await assert.rejects(
      () => new YoutubeService({
        ...loadYoutubeConfig(),
        db_path: process.env.MANGO_YOUTUBE_DB_PATH!,
        api_key: null,
      }).play({ id: video.id }, { playEpoch: 1 }),
      PlayCancelledError,
    );
    assert.equal(playCalls, 0);
  });
});

test('YoutubeService.play sanitizes player failures', async () => {
  await withPlayHarness(async () => {
    upsertYoutubeItems([video]);
    setYoutubeCommandRunnerForTest(async () => ({
      stdout: 'MANGO_META:none|600|https\nhttps://video.example/vod.mp4\n',
      stderr: '',
    }));
    setYoutubePlayUrlForTest(async () => {
      throw new Error('mpv-play failed: googlevideo.com/videoplayback?expire=secret');
    });
    await assert.rejects(
      () => new YoutubeService({
        ...loadYoutubeConfig(),
        db_path: process.env.MANGO_YOUTUBE_DB_PATH!,
        api_key: null,
      }).play({ id: video.id }, { playEpoch: 1 }),
      (error: unknown) => error instanceof CatalogError
        && error.status === 502
        && error.details?.category === 'player_failure'
        && !JSON.stringify(error).includes('secret'),
    );
  });
});
