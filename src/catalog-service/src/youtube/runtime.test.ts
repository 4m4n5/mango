import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { probeYoutubePotReady, youtubePotBaseUrl } from './runtime.js';

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

test('POT readiness probe uses loopback HTTP instead of the mutable global fetch shim', async () => {
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  const previousUrl = process.env.MANGO_YOUTUBE_POT_URL;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('core global fetch shim should not handle POT readiness');
  }) as typeof fetch;
  process.env.MANGO_YOUTUBE_POT = '1';
  try {
    await withServer((req, res) => {
      if (req.url === '/ping') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      res.writeHead(404);
      res.end();
    }, async (baseUrl) => {
      process.env.MANGO_YOUTUBE_POT_URL = baseUrl;
      assert.equal(await probeYoutubePotReady(250), true);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
    if (previousUrl === undefined) delete process.env.MANGO_YOUTUBE_POT_URL;
    else process.env.MANGO_YOUTUBE_POT_URL = previousUrl;
  }
});

test('POT readiness probe falls back to base path and respects explicit disable', async () => {
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  const previousUrl = process.env.MANGO_YOUTUBE_POT_URL;
  try {
    await withServer((req, res) => {
      if (req.url === '/ping') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(204);
      res.end();
    }, async (baseUrl) => {
      process.env.MANGO_YOUTUBE_POT = '1';
      process.env.MANGO_YOUTUBE_POT_URL = baseUrl;
      assert.equal(await probeYoutubePotReady(250), true);

      process.env.MANGO_YOUTUBE_POT = '0';
      assert.equal(await probeYoutubePotReady(250), false);
    });
  } finally {
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
    if (previousUrl === undefined) delete process.env.MANGO_YOUTUBE_POT_URL;
    else process.env.MANGO_YOUTUBE_POT_URL = previousUrl;
  }
});

test('POT readiness probe fails within the total deadline on a hanging response', async () => {
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  const previousUrl = process.env.MANGO_YOUTUBE_POT_URL;
  try {
    await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
    }, async (baseUrl) => {
      process.env.MANGO_YOUTUBE_POT = '1';
      process.env.MANGO_YOUTUBE_POT_URL = baseUrl;
      const started = Date.now();
      assert.equal(await probeYoutubePotReady(40), false);
      assert.ok(Date.now() - started < 500);
    });
  } finally {
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
    if (previousUrl === undefined) delete process.env.MANGO_YOUTUBE_POT_URL;
    else process.env.MANGO_YOUTUBE_POT_URL = previousUrl;
  }
});

test('POT readiness probe rejects truncated 200 responses as unhealthy', async () => {
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  const previousUrl = process.env.MANGO_YOUTUBE_POT_URL;
  try {
    await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
      res.destroy();
    }, async (baseUrl) => {
      process.env.MANGO_YOUTUBE_POT = '1';
      process.env.MANGO_YOUTUBE_POT_URL = baseUrl;
      assert.equal(await probeYoutubePotReady(250), false);
    });
  } finally {
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
    if (previousUrl === undefined) delete process.env.MANGO_YOUTUBE_POT_URL;
    else process.env.MANGO_YOUTUBE_POT_URL = previousUrl;
  }
});

test('POT readiness probe fails when both ping and fallback return HTTP errors', async () => {
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  const previousUrl = process.env.MANGO_YOUTUBE_POT_URL;
  try {
    await withServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('not ready');
    }, async (baseUrl) => {
      process.env.MANGO_YOUTUBE_POT = '1';
      process.env.MANGO_YOUTUBE_POT_URL = baseUrl;
      assert.equal(await probeYoutubePotReady(250), false);
    });
  } finally {
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
    if (previousUrl === undefined) delete process.env.MANGO_YOUTUBE_POT_URL;
    else process.env.MANGO_YOUTUBE_POT_URL = previousUrl;
  }
});

test('POT URL sanitizer rejects non-loopback and HTTPS targets before probing them', async () => {
  const previousUrl = process.env.MANGO_YOUTUBE_POT_URL;
  try {
    process.env.MANGO_YOUTUBE_POT_URL = 'http://192.0.2.1:4416';
    assert.equal(youtubePotBaseUrl(), 'http://127.0.0.1:4416');
    process.env.MANGO_YOUTUBE_POT_URL = 'https://localhost:4416';
    assert.equal(youtubePotBaseUrl(), 'http://127.0.0.1:4416');
    process.env.MANGO_YOUTUBE_POT_URL = 'http://user:pass@127.0.0.1:4416';
    assert.equal(youtubePotBaseUrl(), 'http://127.0.0.1:4416');
  } finally {
    if (previousUrl === undefined) delete process.env.MANGO_YOUTUBE_POT_URL;
    else process.env.MANGO_YOUTUBE_POT_URL = previousUrl;
  }
});
