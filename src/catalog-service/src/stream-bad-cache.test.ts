import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearStreamBadCache,
  isBadStreamError,
  isStreamUrlBad,
  markStreamUrlBad,
  streamBadCacheSize,
} from './stream-bad-cache.js';
import { playWithLadder } from './play-orchestrator.js';
import { defaultPlayLadder, splitLegacyPlayLadder, streamReleaseFingerprint } from './play-ladder.js';
import { defaultFilterConfig, mergeFilterConfig, streamUrlHash } from './stream-filters.js';
import type { Stream } from './core.js';

function testConfig(overrides: Record<string, unknown> = {}) {
  const play_ladder = (overrides.play_ladder as ReturnType<typeof defaultPlayLadder>)
    ?? defaultPlayLadder();
  const split = splitLegacyPlayLadder(play_ladder);
  return mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: false,
    auto_play_wall_ms: 90000,
    auto_play_probe_ms: 8000,
    auto_play_max_attempts: 12,
    stream_display_limit: 8,
    ...overrides,
    play_ladder,
    main_ladder: (overrides.main_ladder as typeof split.main_ladder) ?? split.main_ladder,
    last_resort_ladder: (overrides.last_resort_ladder as typeof split.last_resort_ladder)
      ?? split.last_resort_ladder,
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

test('isBadStreamError matches copyright / status / nfo taxonomy', () => {
  assert.equal(isBadStreamError('debrid_copyright_block'), true);
  assert.equal(isBadStreamError('mpv-play failed: debrid_status_clip duration=12'), true);
  assert.equal(isBadStreamError('debrid_nfo_sidecar'), true);
  assert.equal(isBadStreamError('debrid_playback_unreadable'), false);
  assert.equal(isBadStreamError('timeout'), false);
});

test('markStreamUrlBad skips the same hash until TTL expiry', () => {
  clearStreamBadCache();
  const hash = streamUrlHash('https://example.test/bad.mp4');
  markStreamUrlBad(hash, 60_000);
  assert.equal(isStreamUrlBad(hash), true);
  assert.equal(isStreamUrlBad(streamUrlHash('https://example.test/good.mp4')), false);
  assert.equal(streamBadCacheSize(), 1);
  clearStreamBadCache();
  assert.equal(streamBadCacheSize(), 0);
});

test('playWithLadder skips a previously copyright-blocked URL and plays the next candidate', async () => {
  clearStreamBadCache();
  const bad = candidate('https://example.test/copyright.mp4');
  const good = candidate('https://example.test/good.mp4', '[TB☁️⚡] Torrentio 1080p B');
  let probeUrls: string[] = [];
  let playUrls: string[] = [];

  const first = await playWithLadder([bad, good], testConfig(), {
    preflight: async () => 'video',
    probe: async (url) => {
      probeUrls.push(url);
      if (url.includes('copyright')) {
        throw new Error('debrid_copyright_block');
      }
      return { ok: true, ttff_ms: 400 };
    },
    play: async (url) => {
      playUrls.push(url);
      return { ok: true, ttff_ms: 500 };
    },
  });

  assert.equal(first.ok, true);
  assert.equal(playUrls[0], good.url);
  assert.ok(first.attempts.some((a) => a.error?.includes('debrid_copyright_block')));
  assert.equal(isStreamUrlBad(streamUrlHash(bad.url)), true);

  probeUrls = [];
  playUrls = [];
  const second = await playWithLadder([bad, good], testConfig(), {
    preflight: async () => 'video',
    probe: async (url) => {
      probeUrls.push(url);
      return { ok: true, ttff_ms: 400 };
    },
    play: async (url) => {
      playUrls.push(url);
      return { ok: true, ttff_ms: 500 };
    },
  });

  assert.equal(second.ok, true);
  assert.ok(!probeUrls.includes(bad.url), 'bad URL must not be probed again');
  assert.equal(playUrls[0], good.url);
  assert.ok(second.attempts.some((a) => a.error === 'stream_url_bad_cached'));
  clearStreamBadCache();
});

test('playWithLadder never skips probe for Real-Debrid even when uncached', async () => {
  clearStreamBadCache();
  const rd: Stream = {
    url: 'https://example.test/rd-uncached.mp4',
    source: 'AIOStreams',
    name: '[RD⚡] Torrentio 1080p',
    title: '[RD⚡] Torrentio 1080p',
    description: 'BluRay x265',
    behaviorHints: {
      bingeGroup: 'com.aiostreams|realdebrid|false|1080p',
    },
  };
  let probeCalls = 0;
  const config = {
    ...testConfig(),
    include_uncached: true,
  };
  await playWithLadder([rd], config, {
    ladder: [
      {
        step: 'ideal',
        max_quality: '1080p',
        exclude_remux: true,
        require_cache: 'cached_or_uncached',
        debrid_services: ['torbox', 'realdebrid'],
        addons: ['AIOStreams'],
      },
    ],
    preflight: async () => 'video',
    probe: async () => {
      probeCalls += 1;
      return { ok: true, ttff_ms: 300 };
    },
    play: async () => ({ ok: true, ttff_ms: 400 }),
  });
  assert.equal(probeCalls, 1);
  clearStreamBadCache();
});

test('S5: confirmed NFO follows a stable release across rotated signed URLs', async () => {
  clearStreamBadCache();
  const first = candidate('https://example.test/release.mkv?token=one');
  first.behaviorHints = {
    infoHash: 'ABC123',
    bingeGroup: 'aiostreams|torbox|true|1080p',
  };
  const rotated = { ...first, url: 'https://example.test/release.mkv?token=two' };
  await playWithLadder([first], testConfig(), {
    mode: 'picker',
    preferUrl: first.url,
    preflight: async () => 'nfo',
    probe: async () => ({ ok: true, ttff_ms: 100 }),
    play: async () => ({ ok: true, ttff_ms: 100 }),
  }).catch(() => undefined);
  assert.equal(isStreamUrlBad(streamReleaseFingerprint(rotated)), true);
  let probeCalls = 0;
  const error = await playWithLadder([rotated], testConfig(), {
    mode: 'picker',
    preferUrl: rotated.url,
    preflight: async () => 'video',
    probe: async () => {
      probeCalls += 1;
      return { ok: true, ttff_ms: 100 };
    },
    play: async () => ({ ok: true, ttff_ms: 100 }),
  }).catch((caught) => caught);
  assert.ok(error instanceof Error);
  assert.equal(probeCalls, 0);
  clearStreamBadCache();
});

test('S5: TorBox transient does not hide the same infoHash on Real-Debrid', async () => {
  clearStreamBadCache();
  const torbox = candidate('https://example.test/tb-signed.mkv');
  torbox.behaviorHints = { infoHash: 'samehash', bingeGroup: 'aiostreams|torbox|true|1080p' };
  await playWithLadder([torbox], testConfig(), {
    mode: 'picker',
    preferUrl: torbox.url,
    preflight: async () => 'video',
    probe: async () => { throw new Error('timeout waiting for playback'); },
    play: async () => ({ ok: true, ttff_ms: 100 }),
  }).catch(() => undefined);
  assert.equal(isStreamUrlBad(streamReleaseFingerprint(torbox)), false);

  const realDebrid: Stream = {
    ...candidate('https://example.test/rd-signed.mkv', '[RD☁️⚡] Torrentio 1080p'),
    behaviorHints: { infoHash: 'samehash', bingeGroup: 'aiostreams|realdebrid|true|1080p' },
  };
  let playCalls = 0;
  const result = await playWithLadder([realDebrid], testConfig(), {
    mode: 'picker',
    preferUrl: realDebrid.url,
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 100 }),
    play: async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 100 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(playCalls, 1);
  clearStreamBadCache();
});
