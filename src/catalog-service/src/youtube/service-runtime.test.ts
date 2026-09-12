import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resetLibraryDbForTests } from '../library/db.js';
import { resetYoutubeDbForTests } from './db.js';
import { resetYoutubeRuntimeDiagnosticsForTests, YoutubeService } from './service.js';

async function withServer(
  handler: http.RequestListener,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function withTempState<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-service-runtime-'));
  const previous = {
    youtubeDb: process.env.MANGO_YOUTUBE_DB_PATH,
    libraryDb: process.env.MANGO_LIBRARY_DB_PATH,
    userPinsPath: process.env.MANGO_USER_PINS_PATH,
    apiKeyFile: process.env.MANGO_YOUTUBE_API_KEY_FILE,
    oauthFile: process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE,
    tokenFile: process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE,
    pot: process.env.MANGO_YOUTUBE_POT,
    potUrl: process.env.MANGO_YOUTUBE_POT_URL,
    ytDlpCommand: process.env.MANGO_YTDLP_COMMAND,
  };
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'missing-pins.json');
  process.env.MANGO_YOUTUBE_API_KEY_FILE = join(dir, 'missing-api-key');
  process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE = join(dir, 'missing-oauth.json');
  process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE = join(dir, 'missing-auth.json');
  process.env.MANGO_YTDLP_COMMAND = '/custom/not-probed';
  resetYoutubeRuntimeDiagnosticsForTests();
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const cleanup = (): void => {
    resetYoutubeRuntimeDiagnosticsForTests();
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    const restore = (key: keyof typeof previous, envKey: string): void => {
      const value = previous[key];
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    };
    restore('youtubeDb', 'MANGO_YOUTUBE_DB_PATH');
    restore('libraryDb', 'MANGO_LIBRARY_DB_PATH');
    restore('userPinsPath', 'MANGO_USER_PINS_PATH');
    restore('apiKeyFile', 'MANGO_YOUTUBE_API_KEY_FILE');
    restore('oauthFile', 'MANGO_YOUTUBE_OAUTH_CLIENT_FILE');
    restore('tokenFile', 'MANGO_YOUTUBE_AUTH_TOKEN_FILE');
    restore('pot', 'MANGO_YOUTUBE_POT');
    restore('potUrl', 'MANGO_YOUTUBE_POT_URL');
    restore('ytDlpCommand', 'MANGO_YTDLP_COMMAND');
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

function blockEventLoop(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Intentionally empty: regression for synchronous state assembly delaying
    // the async POT probe's network callbacks.
  }
}

test('YouTube state POT probe starts after synchronous state assembly yields', async () => {
  await withTempState(async () => {
    await withServer((req, res) => {
      if (req.url === '/ping') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(400);
      res.end();
    }, async (baseUrl) => {
      process.env.MANGO_YOUTUBE_POT = '1';
      process.env.MANGO_YOUTUBE_POT_URL = baseUrl;
      const service = new YoutubeService();
      const first = service.state().configured as Record<string, unknown>;
      assert.equal(first.pot_server, false);
      assert.equal(first.pot_server_fresh, false);

      blockEventLoop(350);
      const deadline = Date.now() + 1000;
      let after: Record<string, unknown>;
      do {
        await new Promise((resolve) => setTimeout(resolve, 20));
        after = service.state().configured as Record<string, unknown>;
      } while (!after.pot_server_fresh && Date.now() < deadline);
      assert.equal(after.pot_server, true);
      assert.equal(after.pot_server_fresh, true);
    });
  });
});
