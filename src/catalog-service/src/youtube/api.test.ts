import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { YoutubeApiClient } from './api.js';
import { resetYoutubeDbForTests } from './db.js';
import type { YoutubeConfig } from './config.js';

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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function withApiTest<T>(fn: (config: YoutubeConfig) => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-api-'));
  const originalFetch = globalThis.fetch;
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  resetYoutubeDbForTests();
  const cleanup = () => {
    globalThis.fetch = originalFetch;
    resetYoutubeDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn(testConfig(join(dir, 'youtube.db')));
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

test('subscriptions uses unread order and paginates channels', () => withApiTest(async (config) => {
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    assert.ok(url.pathname.endsWith('/subscriptions'));
    if (!url.searchParams.get('pageToken')) {
      return jsonResponse({
        nextPageToken: 'next',
        items: [{
          snippet: {
            title: 'Channel One',
            resourceId: { channelId: 'channel-1' },
          },
        }],
      });
    }
    return jsonResponse({
      items: [{
        snippet: {
          title: 'Channel Two',
          resourceId: { channelId: 'channel-2' },
        },
      }],
    });
  }) as typeof fetch;

  const api = new YoutubeApiClient(config);
  const channels = await api.subscriptions('token', 2, 'unread');
  assert.deepEqual(channels.map((channel) => channel.id), ['channel-1', 'channel-2']);
  assert.equal(calls[0]?.searchParams.get('order'), 'unread');
  assert.equal(calls[0]?.searchParams.get('maxResults'), '2');
  assert.equal(calls[1]?.searchParams.get('pageToken'), 'next');
}));

test('channelUploadPlaylists reads uploads playlist from channels contentDetails', () => withApiTest(async (config) => {
  let captured: URL | null = null;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    captured = url;
    assert.ok(url.pathname.endsWith('/channels'));
    return jsonResponse({
      items: [{
        id: 'channel-1',
        snippet: { title: 'Channel One' },
        contentDetails: { relatedPlaylists: { uploads: 'uploads-1' } },
      }],
    });
  }) as typeof fetch;

  const api = new YoutubeApiClient(config);
  const playlists = await api.channelUploadPlaylists(['channel-1'], 'token');
  assert.equal(playlists.get('channel-1'), 'uploads-1');
  assert.ok(captured);
  const capturedUrl = captured as URL;
  assert.equal(capturedUrl.searchParams.get('part'), 'snippet,contentDetails');
  assert.equal(capturedUrl.searchParams.get('id'), 'channel-1');
}));

test('playlistItems paginates uploads and enriches videos without search', () => withApiTest(async (config) => {
  const paths: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    paths.push(url.pathname.split('/').at(-1) || '');
    if (url.pathname.endsWith('/playlistItems')) {
      if (!url.searchParams.get('pageToken')) {
        return jsonResponse({
          nextPageToken: 'next',
          items: [{ contentDetails: { videoId: 'video-1' } }],
        });
      }
      return jsonResponse({
        items: [{ contentDetails: { videoId: 'video-2' } }],
      });
    }
    assert.ok(url.pathname.endsWith('/videos'));
    return jsonResponse({
      items: (url.searchParams.get('id') || '').split(',').map((id) => ({
        id,
        snippet: {
          title: `Video ${id}`,
          channelId: 'channel-1',
          channelTitle: 'Channel One',
          publishedAt: '2026-07-01T00:00:00Z',
        },
        contentDetails: { duration: 'PT10M' },
      })),
    });
  }) as typeof fetch;

  const api = new YoutubeApiClient(config);
  const videos = await api.playlistItems('uploads-1', 2, 'token');
  assert.deepEqual(videos.map((video) => video.id), ['video-1', 'video-2']);
  assert.deepEqual(paths, ['playlistItems', 'playlistItems', 'videos']);
}));
