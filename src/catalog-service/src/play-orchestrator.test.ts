import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { Stream } from './core.js';
import { playWithLadder, probeWithLadder } from './play-orchestrator.js';
import { defaultPlayLadder } from './play-ladder.js';
import { defaultFilterConfig, mergeFilterConfig, streamUrlHash } from './stream-filters.js';
import { clearStreamBadCache, isStreamUrlBad } from './stream-bad-cache.js';

beforeEach(() => {
  clearStreamBadCache();
});

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
  assert.equal(result.probe_ms, 3210);
  assert.equal(result.attempts[0]?.probe_reused, true);
  // Phase A wall reserves obligation budget (default 20s), so play timeout is
  // under the full auto_play_wall_ms but still most of the wall.
  assert.ok(playTimeout > 60000);
  assert.ok(playTimeout <= 90000);
});

test('playWithLadder still runs the byte-sniff and rejects unreadable bytes even when a verified hint would reuse the probe', async () => {
  const stream = candidate('https://example.test/verified.mp4');
  let probeCalls = 0;
  let playCalls = 0;

  await assert.rejects(
    playWithLadder([stream], testConfig(), {
      verified_hint: {
        best_source: 'AIOStreams',
        cache_status: 'cached',
        debrid_service: 'torbox',
        win_url_hash: streamUrlHash(stream.url),
        win_ladder_step: 'ideal',
        probe_ms: 3210,
      },
      preflight: async () => 'error',
      probe: async () => {
        probeCalls += 1;
        throw new Error('probe should not run');
      },
      play: async () => {
        playCalls += 1;
        return { ok: true, ttff_ms: 812 };
      },
    }),
  );

  assert.equal(probeCalls, 0);
  assert.equal(playCalls, 0);
});

test('playWithLadder still runs the byte-sniff and rejects nfo sidecars even when a verified hint would reuse the probe', async () => {
  const stream = candidate('https://example.test/verified.mp4');
  let playCalls = 0;

  const error = await playWithLadder([stream], testConfig(), {
    verified_hint: {
      best_source: 'AIOStreams',
      cache_status: 'cached',
      debrid_service: 'torbox',
      win_url_hash: streamUrlHash(stream.url),
      win_ladder_step: 'ideal',
      probe_ms: 3210,
    },
    preflight: async () => 'nfo',
    probe: async () => ({ ok: true, ttff_ms: 500 }),
    play: async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 812 };
    },
  }).catch((err) => err);

  assert.equal(playCalls, 0);
  assert.ok(error instanceof Error);
  const attempts = (error as { details?: { attempts?: Array<{ error?: string }> } }).details?.attempts ?? [];
  assert.match(attempts[0]?.error || '', /debrid_nfo_sidecar/);
});

test('playWithLadder surfaces mpv-play\'s real, sanitized failure reason instead of invocation params', async () => {
  const stream = candidate('https://example.test/movie.mkv?token=super-secret');

  const error = await playWithLadder([stream], testConfig(), {
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 500 }),
    play: async () => {
      throw new Error(
        'mpv-play failed: HTTP error 403 for https://example.test/movie.mkv?token=super-secret',
      );
    },
  }).catch((err) => err);

  assert.ok(error instanceof Error);
  const attempts = (error as { details?: { attempts?: Array<{ error?: string }> } }).details?.attempts ?? [];
  const attemptError = attempts[0]?.error || '';
  assert.match(attemptError, /mpv-play failed: HTTP error 403/);
  assert.doesNotMatch(attemptError, /mode=play/);
  assert.doesNotMatch(attemptError, /timeout_ms=/);
  assert.doesNotMatch(attemptError, /token=super-secret/);
  assert.match(attemptError, /http\(s\):\/\/<redacted>/);
});

test('playWithLadder skips nfo sidecars and reaches a later ladder step', async () => {
  const bad = candidate('https://example.test/bad.mkv');
  const good = candidate(
    'https://example.test/good.mkv',
    '[TB⚡] Torrentio 2160p',
  );
  good.description = '2160p HEVC encode';
  good.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|true|2160p' };

  const result = await playWithLadder([bad, good], testConfig(), {
    preflight: async (url) => (url.includes('bad') ? 'nfo' : 'video'),
    probe: async () => ({ ok: true, ttff_ms: 500 }),
    play: async () => ({ ok: true, ttff_ms: 900 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.probe_ms, 500);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.ok, false);
  assert.match(result.attempts[0]?.error || '', /debrid_nfo_sidecar/);
  assert.equal(result.win_ladder_step, '2160p_encode');
});

test('probeWithLadder can reject uncached fallback for durable verification', async () => {
  const stream = candidate(
    'https://example.test/uncached.mkv',
    '[TB⚡] Torrentio 1080p',
  );
  stream.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|false|1080p' };
  let probeCalls = 0;

  const result = await probeWithLadder([stream], testConfig(), {
    include_uncached: false,
    preflight: async () => 'video',
    probe: async () => {
      probeCalls += 1;
      return { ok: true, ttff_ms: 500 };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.candidate_count, 0);
  assert.equal(result.attempts.length, 0);
  assert.equal(probeCalls, 0);
});

/** Narrow Phase A: cached TorBox only — RD/uncached streams fall to obligation floor. */
function preferenceOnlyConfig() {
  return mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: true,
    play_ladder: [
      {
        step: 'ideal',
        max_quality: '1080p',
        exclude_remux: true,
        require_cache: 'cached',
        debrid_services: ['torbox'],
        addons: ['AIOStreams'],
      },
    ],
    auto_play_wall_ms: 90000,
    auto_play_probe_ms: 8000,
    auto_play_max_attempts: 4,
    stream_display_limit: 8,
  });
}

test('playWithLadder falls through to obligation floor when preference ladder candidates fail', async () => {
  // Preference ladder only matches cached TorBox; floor stream is uncached RD
  // so Phase A skips it and Phase B must still play it.
  const ladderOnly = candidate('https://example.test/ladder-hevc.mkv', '[TB☁️⚡] Torrentio 1080p HEVC');
  ladderOnly.description = 'WEB-DL 1080p x265';
  ladderOnly.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|true|1080p' };

  const floorOnly: Stream = {
    url: 'https://example.test/floor-x264.mkv',
    source: 'AIOStreams',
    name: '[RD⚡] Torrentio 720p',
    title: '[RD⚡] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: { bingeGroup: 'com.aiostreams|realdebrid|false|720p' },
  };

  const result = await playWithLadder([ladderOnly, floorOnly], preferenceOnlyConfig(), {
    preflight: async () => 'video',
    probe: async (url) => {
      if (url.includes('ladder-hevc')) {
        throw new Error('mpv-play failed: no error detail captured (exit 1)');
      }
      return { ok: true, ttff_ms: 400 };
    },
    play: async (url) => {
      if (url.includes('ladder-hevc')) {
        throw new Error('should not play ladder failure');
      }
      return { ok: true, ttff_ms: 700 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.win_ladder_step, 'obligation_floor');
  assert.equal(result.obligation_floor_ran, true);
  assert.ok(result.attempts.some((attempt) => attempt.ok === false));
  assert.ok(result.attempts.some((attempt) => attempt.ok === true && attempt.ladder_step === 'obligation_floor'));
});

test('playWithLadder obligation floor still runs after verified-hint candidate fails', async () => {
  const hinted = candidate('https://example.test/hinted.mkv');
  const other: Stream = {
    url: 'https://example.test/other-floor.mkv',
    source: 'AIOStreams',
    name: '[RD⚡] Torrentio 720p',
    title: '[RD⚡] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: { bingeGroup: 'com.aiostreams|realdebrid|false|720p' },
  };

  const result = await playWithLadder([hinted, other], preferenceOnlyConfig(), {
    verified_hint: {
      best_source: 'AIOStreams',
      cache_status: 'cached',
      debrid_service: 'torbox',
      win_url_hash: streamUrlHash(hinted.url),
      win_ladder_step: 'ideal',
      probe_ms: 2000,
    },
    preflight: async (url) => (url.includes('hinted') ? 'nfo' : 'video'),
    probe: async () => ({ ok: true, ttff_ms: 300 }),
    play: async (url) => {
      if (url.includes('hinted')) {
        throw new Error('should not play nfo');
      }
      return { ok: true, ttff_ms: 650 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.win_ladder_step, 'obligation_floor');
  assert.equal(result.obligation_floor_ran, true);
});

test('playWithLadder proceeds to probe when preflight times out', async () => {
  const stream = candidate('https://example.test/slow-preflight.mp4');
  let probeCalls = 0;
  let playCalls = 0;

  const result = await playWithLadder([stream], testConfig(), {
    preflight: async () => 'timeout',
    probe: async () => {
      probeCalls += 1;
      return { ok: true, ttff_ms: 400 };
    },
    play: async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 500 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(probeCalls, 1);
  assert.equal(playCalls, 1);
  assert.equal(isStreamUrlBad(streamUrlHash(stream.url)), false);
});

test('playWithLadder does not bad-cache debrid_playback_unreadable', async () => {
  const stream = candidate('https://example.test/unreadable.mp4');

  await assert.rejects(
    playWithLadder([stream], testConfig(), {
      preflight: async () => 'error',
      probe: async () => ({ ok: true, ttff_ms: 400 }),
      play: async () => ({ ok: true, ttff_ms: 500 }),
    }),
  );

  assert.equal(isStreamUrlBad(streamUrlHash(stream.url)), false);
});

test('playWithLadder Phase B keeps unattempted Phase A URLs eligible', async () => {
  // Two TorBox cached streams match Phase A. First fails; wall is tiny so the
  // second is never attempted in Phase A. Phase B must still be able to play it
  // (exclude attempted URLs only).
  const first = candidate('https://example.test/phase-a-first.mkv');
  const second = candidate('https://example.test/phase-a-second.mkv', '[TB☁️⚡] Torrentio 1080p B');
  const prevReserve = process.env.MANGO_PLAY_OBLIGATION_MIN_MS;
  process.env.MANGO_PLAY_OBLIGATION_MIN_MS = '0';
  try {
    const config = mergeFilterConfig({
      ...testConfig(),
      auto_play_wall_ms: 2500,
      auto_play_probe_ms: 2000,
      auto_play_max_attempts: 8,
    });
    const result = await playWithLadder([first, second], config, {
      preflight: async () => 'video',
      probe: async (url) => {
        if (url.includes('phase-a-first')) {
          // Burn most of the Phase A wall so the second candidate is skipped.
          await new Promise((r) => setTimeout(r, 1800));
          throw new Error('mpv-play failed: no error detail captured (exit 1)');
        }
        return { ok: true, ttff_ms: 200 };
      },
      play: async (url) => {
        if (url.includes('phase-a-first')) {
          throw new Error('should not play first');
        }
        return { ok: true, ttff_ms: 300 };
      },
    });
    assert.equal(result.ok, true);
    assert.ok(
      result.attempts.some((a) => a.url?.includes('phase-a-second') && a.ok),
      'second URL must play via Phase B after Phase A wall starvation',
    );
  } finally {
    if (prevReserve === undefined) delete process.env.MANGO_PLAY_OBLIGATION_MIN_MS;
    else process.env.MANGO_PLAY_OBLIGATION_MIN_MS = prevReserve;
  }
});
