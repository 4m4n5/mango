import assert from 'node:assert/strict';
import test from 'node:test';
import { isBlockedLiveStreamUrl, isBlockedLiveChannel } from './live-stream-verify.js';

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
