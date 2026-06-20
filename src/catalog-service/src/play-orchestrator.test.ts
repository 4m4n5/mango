import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import { playWithFallback } from './play-orchestrator.js';
import { defaultFilterConfig, mergeFilterConfig, streamUrlHash } from './stream-filters.js';

function testConfig() {
  return mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: false,
    max_quality: '1080p',
    exclude_remux: false,
    auto_play_wall_ms: 15000,
    auto_play_probe_ms: 4000,
    auto_play_max_attempts: 5,
    stream_display_limit: 8,
  });
}

function candidate(url: string): Stream {
  return {
    url,
    source: 'AIOStreams',
    name: '[TB] Torrentio 1080p',
    title: '[TB] Torrentio 1080p',
    description: 'WEB-DL 1080p',
    behaviorHints: {
      bingeGroup: 'com.aiostreams|torbox|unknown|1080p',
    },
  };
}

test('playWithFallback reuses the verified winning probe for exact URL hash matches', async () => {
  const stream = candidate('https://example.test/verified.mp4');
  let probeCalls = 0;
  let playTimeout = 0;

  const result = await playWithFallback([stream], testConfig(), {
    verified_hint: {
      best_source: 'AIOStreams',
      cache_status: 'unknown',
      debrid_service: 'torbox',
      win_url_hash: streamUrlHash(stream.url),
      probe_ms: 3210,
    },
    probe: async () => {
      probeCalls += 1;
      throw new Error('probe should not run');
    },
    play: async (_url, timeoutMs) => {
      playTimeout = timeoutMs ?? 0;
      return { ok: true, ttff_ms: 812 };
    },
  });

  assert.equal(probeCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.attempts[0]?.probe_ms, 3210);
  assert.equal(result.attempts[0]?.probe_reused, true);
  assert.equal(result.ttff_ms, 812);
  assert.ok(playTimeout > 14000);
});

test('playWithFallback probes streams that do not match the verified URL hash', async () => {
  const stream = candidate('https://example.test/current.mp4');
  let probeCalls = 0;

  const result = await playWithFallback([stream], testConfig(), {
    verified_hint: {
      best_source: 'AIOStreams',
      cache_status: 'unknown',
      debrid_service: 'torbox',
      win_url_hash: streamUrlHash('https://example.test/old.mp4'),
      probe_ms: 3210,
    },
    probe: async () => {
      probeCalls += 1;
      return { ok: true, ttff_ms: 443 };
    },
    play: async () => ({ ok: true, ttff_ms: 901 }),
  });

  assert.equal(probeCalls, 1);
  assert.equal(result.attempts[0]?.probe_ms, 443);
  assert.equal(result.attempts[0]?.probe_reused, undefined);
});
