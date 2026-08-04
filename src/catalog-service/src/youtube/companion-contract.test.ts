import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetYoutubeDbForTests, setYoutubeState } from './db.js';
import {
  YoutubeService,
  youtubeCompanionAuthPollResponse,
  youtubeCompanionAuthStartResponse,
} from './service.js';

function withCompanionState<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-companion-'));
  const oauthClientFile = join(dir, 'youtube-oauth-client.json');
  const authTokenFile = join(dir, 'youtube-auth.json');
  mkdirSync(dir, { recursive: true });
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_YOUTUBE_API_KEY = 'secret-api-key';
  process.env.MANGO_YOUTUBE_API_KEY_FILE = join(dir, 'youtube-api.key');
  process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE = oauthClientFile;
  process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE = authTokenFile;
  writeFileSync(oauthClientFile, JSON.stringify({
    installed: { client_id: 'oauth-client-id', client_secret: 'oauth-client-secret' },
  }));
  writeFileSync(authTokenFile, JSON.stringify({
    access_token: 'secret-access-token',
    refresh_token: 'secret-refresh-token',
    expires_at: 4_200_000,
    scope: 'https://www.googleapis.com/auth/youtube.readonly private-scope',
  }));
  resetYoutubeDbForTests();

  const cleanup = () => {
    resetYoutubeDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_YOUTUBE_API_KEY;
    delete process.env.MANGO_YOUTUBE_API_KEY_FILE;
    delete process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE;
    delete process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE;
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

test('companion status exposes only the four fields consumed by the phone UI', () => (
  withCompanionState(() => {
    setYoutubeState('last_error', 'provider temporarily unavailable');
    const service = new YoutubeService();

    const status = service.companionStatus();
    assert.deepEqual(status, {
      api_key_configured: true,
      oauth_configured: true,
      authenticated: true,
      needs_attention: true,
    });
    assert.deepEqual(service.disconnectCompanionAuth(), { ok: true });

    const serialized = JSON.stringify(status);
    for (const forbidden of [
      'secret-api-key',
      'oauth-client-id',
      'oauth-client-secret',
      'secret-access-token',
      'secret-refresh-token',
      'youtube-auth.json',
      'token_file',
      'scopes',
      'expires_at',
      'yt_dlp_command',
      'quota_used_today',
      'search_calls_today',
      'api_calls_today',
      'phase_results',
      'cache',
      'provider temporarily unavailable',
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  })
));

test('companion auth wrappers strip operator auth summaries and retain device-flow fields', () => {
  const started = youtubeCompanionAuthStartResponse({
    ok: true,
    session_id: 'session-123',
    user_code: 'ABCD-EFGH',
    verification_url: 'https://www.google.com/device',
    verification_url_complete: 'https://www.google.com/device?user_code=ABCD-EFGH',
    expires_at: 9_999,
    interval_sec: 5,
  });
  assert.deepEqual(started, {
    session_id: 'session-123',
    user_code: 'ABCD-EFGH',
    verification_url: 'https://www.google.com/device',
    verification_url_complete: 'https://www.google.com/device?user_code=ABCD-EFGH',
    interval_sec: 5,
  });

  const poll = youtubeCompanionAuthPollResponse({
    ok: true,
    status: 'authenticated',
    auth: {
      configured: true,
      authenticated: true,
      token_file: '/etc/mango/youtube-auth.json',
      expires_at: 4_200_000,
      scopes: ['https://www.googleapis.com/auth/youtube.readonly', 'private-scope'],
    },
  });
  assert.deepEqual(poll, { status: 'authenticated' });

  const pending = youtubeCompanionAuthPollResponse({
    ok: true,
    status: 'pending',
    interval_sec: 10,
  });
  assert.deepEqual(pending, { status: 'pending', interval_sec: 10 });

  const serialized = JSON.stringify({ started, poll, pending });
  for (const forbidden of [
    '"ok"',
    'token_file',
    'youtube-auth.json',
    'expires_at',
    'scopes',
    'private-scope',
    'authenticated":true',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
