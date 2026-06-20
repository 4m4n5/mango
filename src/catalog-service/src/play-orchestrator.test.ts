import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import { playWithLadder } from './play-orchestrator.js';
import { defaultPlayLadder } from './play-ladder.js';
import { defaultFilterConfig, mergeFilterConfig, streamUrlHash } from './stream-filters.js';

function testConfig() {
  return mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: false,
    play_ladder: defaultPlayLadder(),
    auto_play_wall_ms: 90000,
    auto_play_probe_ms: 8000,
    auto_play_max_attempts: 12,
    stream_display_limit: 8,
  });
}

function candidate(url: string, name = '[TB☁️⚡] Torrentio 1080p'): Stream {
  return {
    url,
    source: 'AIOStreams',
    name,
    title: name,
    description: 'WEB-DL 1080p',
    behaviorHints: {
      bingeGroup: 'com.aiostreams|torbox|true|1080p',
    },
  };
}

test('playWithLadder reuses verified probe for matching hash and ladder step', async () => {
  const stream = candidate('https://example.test/verified.mp4');
  let probeCalls = 0;
  let playTimeout = 0;

  const result = await playWithLadder([stream], testConfig(), {
    verified_hint: {
      best_source: 'AIOStreams',
      cache_status: 'cached',
      debrid_service: 'torbox',
      win_url_hash: streamUrlHash(stream.url),
      win_ladder_step: 'ideal',
      probe_ms: 3210,
    },
    preflight: async () => 'video',
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
  assert.equal(result.win_ladder_step, 'ideal');
  assert.equal(result.attempts[0]?.probe_reused, true);
  assert.ok(playTimeout > 80000);
});

test('playWithLadder skips nfo sidecars and reaches a later ladder step', async () => {
  const bad = candidate('https://example.test/bad.mkv');
  const good = candidate(
    'https://example.test/good.mkv',
    '[TB⚡] Torrentio 2160p',
  );
  good.description = '2160p HEVC encode';
  good.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|false|2160p' };

  const result = await playWithLadder([bad, good], testConfig(), {
    preflight: async (url) => (url.includes('bad') ? 'nfo' : 'video'),
    probe: async () => ({ ok: true, ttff_ms: 500 }),
    play: async () => ({ ok: true, ttff_ms: 900 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.ok, false);
  assert.match(result.attempts[0]?.error || '', /debrid_nfo_sidecar/);
  assert.equal(result.win_ladder_step, '2160p_encode');
});
