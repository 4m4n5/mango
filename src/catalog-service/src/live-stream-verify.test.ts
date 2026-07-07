import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { isBlockedLiveStreamUrl, isBlockedLiveChannel, probeStreamReachability } from './live-stream-verify.js';

test('isBlockedLiveStreamUrl rejects rate-limit placeholders', () => {
  assert.equal(isBlockedLiveStreamUrl('https://example.com/ratelimited'), true);
  assert.equal(isBlockedLiveStreamUrl('http://cf.4kiptvusa.cyou/live/user/pass/1.m3u8'), false);
});

test('isBlockedLiveChannel rejects rate-limit catalog metas', () => {
  assert.equal(isBlockedLiveChannel({
    id: 'ratelimit_error',
    name: 'Rate limit exceeded — please wait',
  }), true);
  assert.equal(isBlockedLiveChannel({
    id: 'x1',
    name: 'PRIME: F1 TV',
  }), false);
});

test('probeStreamReachability accepts HTTP 302 redirects (Xtream live URLs)', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://cdn.example/stream.ts' });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  try {
    const ok = await probeStreamReachability(`http://127.0.0.1:${port}/live/user/pass/1.ts`, 3000);
    assert.equal(ok, true);
  } finally {
    server.close();
  }
});
