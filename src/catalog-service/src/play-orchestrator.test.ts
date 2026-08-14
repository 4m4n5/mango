import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import type { Stream } from './core.js';
import { playWithLadder, probeWithLadder } from './play-orchestrator.js';
import { defaultPlayLadder, splitLegacyPlayLadder } from './play-ladder.js';
import { resetPlayabilityDbForTests } from './playability/db.js';
import { defaultFilterConfig, mergeFilterConfig, streamUrlHash } from './stream-filters.js';
import { clearStreamBadCache, isStreamUrlBad, markStreamUrlBad } from './stream-bad-cache.js';

let testDbDir = '';

before(async () => {
  testDbDir = await mkdtemp(join(tmpdir(), 'mango-play-orchestrator-'));
  process.env.MANGO_PLAYABILITY_DB = join(testDbDir, 'playability.db');
  resetPlayabilityDbForTests();
});

beforeEach(() => {
  clearStreamBadCache();
});

after(async () => {
  resetPlayabilityDbForTests();
  delete process.env.MANGO_PLAYABILITY_DB;
  await rm(testDbDir, { recursive: true, force: true });
});

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

test('playWithLadder freshly safety-probes a matching verified hint', async () => {
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
      return { ok: true, ttff_ms: 3210, duration_sec: 5400 };
    },
    play: async (_url, timeoutMs) => {
      playTimeout = timeoutMs ?? 0;
      return { ok: true, ttff_ms: 812 };
    },
  });

  assert.equal(probeCalls, 1);
  assert.equal(result.win_ladder_step, 'ideal');
  assert.equal(result.probe_ms, 3210);
  // Phase A wall reserves obligation budget (default 20s), so play timeout is
  // under the full auto_play_wall_ms but still most of the wall.
  assert.ok(playTimeout > 60000);
  assert.ok(playTimeout <= 90000);
});

test('playWithLadder proceeds to probe when preflight returns error (NFO-only hard gate)', async () => {
  const stream = candidate('https://example.test/verified.mp4');
  let probeCalls = 0;
  let playCalls = 0;

  const result = await playWithLadder([stream], testConfig(), {
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
      return { ok: true, ttff_ms: 400 };
    },
    play: async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 812 };
    },
  });

  assert.equal(result.ok, true);
  // Sniff errors are soft, but the fresh safety probe still runs.
  assert.equal(probeCalls, 1);
  assert.equal(playCalls, 1);
});

test('a matching verified hint cannot bypass the feature-duration guard', async () => {
  const stream = candidate('https://example.test/rotated-short.mp4');
  let playCalls = 0;
  const error = await playWithLadder([stream], testConfig(), {
    contentType: 'movie',
    filterContext: { contentType: 'movie', metaRuntimeMinutes: 90 },
    verified_hint: {
      win_url_hash: streamUrlHash(stream.url),
      win_ladder_step: 'ideal',
      probe_ms: 500,
    },
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 500, duration_sec: 12 * 60 }),
    play: async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 812 };
    },
  }).catch((err) => err);

  assert.equal(playCalls, 0);
  assert.ok(error instanceof Error);
  const attempts = (error as { details?: { attempts?: Array<{ error?: string }> } }).details?.attempts ?? [];
  assert.match(attempts[0]?.error || '', /supplemental_or_short_release/);
});

test('playWithLadder rejects nfo sidecars before probing a verified hint', async () => {
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

test('playWithLadder skips nfo sidecars and reaches a later smooth candidate', async () => {
  const bad = candidate('https://example.test/bad.mkv');
  const good = candidate(
    'https://example.test/good.mkv',
    '[TB☁️⚡] Torrentio 1080p alternate',
  );
  good.description = '1080p HEVC encode';
  good.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|true|1080p-alt' };

  const result = await playWithLadder([bad, good], testConfig(), {
    verified_hint: {
      best_source: 'AIOStreams',
      cache_status: 'cached',
      debrid_service: 'torbox',
      win_url_hash: streamUrlHash(bad.url),
      win_ladder_step: 'ideal',
      probe_ms: 500,
    },
    preflight: async (url) => (url.includes('bad') ? 'nfo' : 'video'),
    probe: async () => ({ ok: true, ttff_ms: 500 }),
    play: async () => ({ ok: true, ttff_ms: 900 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.probe_ms, 500);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.ok, false);
  assert.match(result.attempts[0]?.error || '', /debrid_nfo_sidecar/);
  assert.equal(result.win_ladder_step, 'ideal');
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

test('W3: probeWithLadder reuses pre-expanded verification candidates', async () => {
  const prepared = candidate('https://example.test/pre-expanded.mkv');
  let probeCalls = 0;
  const result = await probeWithLadder([], testConfig(), {
    candidates: [{ stream: prepared, ladder_step: 'ideal' }],
    preflight: async () => 'video',
    probe: async (url) => {
      probeCalls += 1;
      assert.equal(url, prepared.url);
      return { ok: true, ttff_ms: 250 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate_count, 1);
  assert.equal(probeCalls, 1);
});

/** Narrow Phase A: cached TorBox only — retained TorBox uncached falls to the floor. */
function preferenceOnlyConfig() {
  const play_ladder = [
    {
      step: 'ideal',
      max_quality: '1080p' as const,
      exclude_remux: true,
      require_cache: 'cached' as const,
      debrid_services: ['torbox'],
      addons: ['AIOStreams'],
    },
  ];
  const split = splitLegacyPlayLadder(play_ladder);
  // Empty last-resort so auto mode reaches obligation floor for TorBox uncached.
  return mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: true,
    play_ladder,
    main_ladder: split.main_ladder,
    last_resort_ladder: [],
    auto_play_wall_ms: 90000,
    auto_play_probe_ms: 8000,
    auto_play_max_attempts: 4,
    stream_display_limit: 8,
  });
}

test('playWithLadder falls through to obligation floor when preference ladder candidates fail', async () => {
  // Preference ladder only matches cached TorBox; floor stream is uncached TB
  // so Phase A skips it and Phase B must still play it.
  const ladderOnly = candidate('https://example.test/ladder-hevc.mkv', '[TB☁️⚡] Torrentio 1080p HEVC');
  ladderOnly.description = 'WEB-DL 1080p x265';
  ladderOnly.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|true|1080p' };

  const floorOnly: Stream = {
    url: 'https://example.test/floor-x264.mkv',
    source: 'AIOStreams',
    name: '[TB⏳] Torrentio 720p',
    title: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
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
  assert.equal(result.win_on_main, false);
  assert.equal(result.obligation_floor_ran, true);
  assert.ok(result.attempts.some((attempt) => attempt.ok === false));
  assert.ok(result.attempts.some((attempt) => attempt.ok === true && attempt.ladder_step === 'obligation_floor'));
});

test('playWithLadder obligation floor still runs after verified-hint candidate fails', async () => {
  const hinted = candidate('https://example.test/hinted.mkv');
  const other: Stream = {
    url: 'https://example.test/other-floor.mkv',
    source: 'AIOStreams',
    name: '[TB⏳] Torrentio 720p',
    title: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
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

test('playWithLadder proceeds past preflight error to probe (not debrid_playback_unreadable)', async () => {
  const stream = candidate('https://example.test/unreadable.mp4');
  let probeCalls = 0;

  const result = await playWithLadder([stream], testConfig(), {
    preflight: async () => 'error',
    probe: async () => {
      probeCalls += 1;
      return { ok: true, ttff_ms: 400 };
    },
    play: async () => ({ ok: true, ttff_ms: 500 }),
  });

  assert.equal(result.ok, true);
  assert.equal(probeCalls, 1);
  assert.equal(isStreamUrlBad(streamUrlHash(stream.url)), false);
});

test('playWithLadder retries once on last-candidate transient probe failure', async () => {
  const stream = candidate('https://example.test/thin-only.mp4');
  let probeCalls = 0;

  const result = await playWithLadder([stream], testConfig(), {
    preflight: async () => 'video',
    probe: async () => {
      probeCalls += 1;
      if (probeCalls === 1) {
        throw new Error('mpv-play failed: timeout waiting for playback');
      }
      return { ok: true, ttff_ms: 350 };
    },
    play: async () => ({ ok: true, ttff_ms: 420 }),
  });

  assert.equal(result.ok, true);
  assert.equal(probeCalls, 2);
  assert.equal(isStreamUrlBad(streamUrlHash(stream.url)), false);
});

test('S3: picker attempts exactly one URL and passes its explicit ladder step to mpv', async () => {
  const picked = candidate('https://example.test/picker-exact.mkv', '[TB☁️⚡] Torrentio 2160p');
  picked.description = '2160p REMUX HEVC SDR';
  picked.ladder_step = 'stale_step';
  let playCalls = 0;
  let observedStep = '';
  const result = await playWithLadder([picked], testConfig(), {
    mode: 'picker',
    preferUrl: picked.url,
    preferLadderStep: '4k_sdr_remux_cached',
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 200 }),
    play: async (url, _timeout, options) => {
      playCalls += 1;
      assert.equal(url, picked.url);
      observedStep = options?.ladderStep ?? '';
      return { ok: true, ttff_ms: 300 };
    },
  });
  assert.equal(playCalls, 1);
  assert.equal(observedStep, '4k_sdr_remux_cached');
  assert.equal(result.win_ladder_step, '4k_sdr_remux_cached');
  assert.equal(result.win_on_main, false);
});

test('successful probe technical profile is threaded into play', async () => {
  const picked = candidate('https://example.test/probed.mkv');
  let seen: { width?: number; height?: number; fps?: number } | undefined;
  const result = await playWithLadder([picked], testConfig(), {
    preflight: async () => 'video',
    probe: async () => ({
      ok: true,
      ttff_ms: 120,
      duration_sec: 5400,
      technical: { width: 1920, height: 1080, fps: 24, codec: 'h264' },
    }),
    play: async (_url, _timeout, options) => {
      seen = options?.knownTechnical;
      return { ok: true, ttff_ms: 200 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen?.width, 1920);
  assert.equal(seen?.height, 1080);
  assert.equal(seen?.fps, 24);
});

test('S5: win_on_main is true for a main-ladder outcome', async () => {
  const main = candidate('https://example.test/main-win.mkv');
  const result = await playWithLadder([main], testConfig(), {
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 100 }),
    play: async () => ({ ok: true, ttff_ms: 100 }),
  });
  assert.equal(result.win_ladder_step, 'ideal');
  assert.equal(result.win_on_main, true);
});

test('S5: win_on_main is false for a last-resort outcome', async () => {
  const lastResort: Stream = {
    url: 'https://example.test/last-resort-win.mkv',
    source: 'AIOStreams',
    name: '[TB⏳] Torrentio 720p',
    description: '720p WEBRip x264',
    behaviorHints: {},
  };
  const main = [{
    step: 'main_tb_cached', max_quality: '1080p' as const, exclude_remux: true,
    require_cache: 'cached' as const, debrid_services: ['torbox'], addons: ['AIOStreams'], verified: true,
  }];
  const resort = [{
    step: 'last_resort', max_quality: '2160p' as const, exclude_remux: false,
    require_cache: 'any' as const, debrid_services: ['torbox'], addons: ['AIOStreams'], verified: false,
  }];
  const result = await playWithLadder([lastResort], testConfig({
    play_ladder: [...main, ...resort],
    main_ladder: main,
    last_resort_ladder: resort,
  }), {
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 100 }),
    play: async () => ({ ok: true, ttff_ms: 100 }),
  });
  assert.equal(result.win_ladder_step, 'last_resort');
  assert.equal(result.win_on_main, false);
});

test('S4: a 12-minute probe for a 90-minute movie fails before foreground play', async () => {
  const short = candidate('https://example.test/status-clip.mkv');
  let playCalls = 0;
  const error = await playWithLadder([short], testConfig(), {
    mode: 'picker',
    preferUrl: short.url,
    contentType: 'movie',
    filterContext: { contentType: 'movie', metaRuntimeMinutes: 90 },
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 200, duration_sec: 12 * 60 }),
    play: async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 300 };
    },
  }).catch((caught) => caught);
  assert.ok(error instanceof Error);
  assert.equal(playCalls, 0);
  const attempts = (error as { details?: { attempts?: Array<{ error?: string }> } }).details?.attempts ?? [];
  assert.match(attempts[0]?.error ?? '', /supplemental_or_short_release/);
});

test('S4: short bonus-episode duration remains eligible', async () => {
  const bonus = candidate('https://example.test/bonus-clip.mkv');
  let playCalls = 0;
  const result = await playWithLadder([bonus], testConfig(), {
    mode: 'picker',
    preferUrl: bonus.url,
    contentType: 'series',
    filterContext: { contentType: 'series', episodeRole: 'bonus' },
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 200, duration_sec: 2 * 60 }),
    play: async () => {
      playCalls += 1;
      return { ok: true, ttff_ms: 300 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(playCalls, 1);
});

test('playWithLadder Phase B keeps unattempted Phase A URLs eligible', async () => {
  // Two TorBox cached streams match Phase A. First fails; wall is tiny so the
  // second is never attempted in Phase A. Phase B must still be able to play it
  // (exclude attempted URLs only).
  const first = candidate('https://example.test/phase-a-first.mkv');
  const second = candidate('https://example.test/phase-a-second.mkv', '[TB☁️⚡] Torrentio 1080p B');
  const prevExtension = process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
  process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = '2000';
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
    if (prevExtension === undefined) delete process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
    else process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = prevExtension;
  }
});

test('probe-discovered known-risk stream is deferred without duplicate inspection', async () => {
  const apparent4k = candidate('https://example.test/apparent-sdr.mkv');
  apparent4k.description = '2160p HEVC SDR WEB-DL';
  const unknown = candidate('https://example.test/unknown.mkv');
  unknown.description = 'WEB-DL';
  unknown.title = 'WEB-DL';
  unknown.name = '[TB☁️⚡] Torrentio';
  const probeCalls: string[] = [];
  const playCalls: string[] = [];

  const result = await playWithLadder([apparent4k, unknown], testConfig({
    main_ladder: [{
      step: 'all',
      max_quality: '2160p',
      exclude_remux: false,
      require_cache: 'any',
      addons: ['AIOStreams'],
      debrid_services: ['torbox'],
      verified: true,
    }],
    last_resort_ladder: [],
  }), {
    preflight: async () => 'video',
    probe: async (url) => {
      probeCalls.push(url);
      return url === apparent4k.url
        ? {
          ok: true,
          ttff_ms: 100,
          duration_sec: 5400,
          technical: {
            width: 3840,
            height: 2160,
            codec: 'hevc',
            hdr: true,
            color_transfer: 'smpte2084',
          },
        }
        : { ok: true, ttff_ms: 100, duration_sec: 5400 };
    },
    play: async (url) => {
      playCalls.push(url);
      return { ok: true, ttff_ms: 200 };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(probeCalls, [apparent4k.url, unknown.url]);
  assert.deepEqual(playCalls, [unknown.url]);
  assert.equal(
    result.attempts.some((attempt) => attempt.error === 'deferred_known_risky_after_probe'),
    true,
  );
});

test('known-risk main candidate waits behind a smooth last-resort candidate', async () => {
  const risky4k = candidate('https://example.test/risky-main.mkv');
  risky4k.description = '2160p HEVC HDR DV WEB-DL';
  risky4k.cache_status = 'cached';
  const smooth1080 = candidate(
    'https://example.test/smooth-resort.mkv',
    '[TB⏳] Torrentio 1080p',
  );
  smooth1080.description = '1080p HEVC SDR WEB-DL';
  smooth1080.cache_status = 'uncached';
  smooth1080.behaviorHints = {
    bingeGroup: 'com.aiostreams|torbox|false|1080p',
  };
  const probeCalls: string[] = [];
  const playCalls: string[] = [];
  const main = [{
    step: 'risky_4k',
    min_quality: '2160p' as const,
    max_quality: '2160p' as const,
    exclude_remux: false,
    require_cache: 'any' as const,
    debrid_services: ['torbox'],
    addons: ['AIOStreams'],
    verified: true,
  }];
  const resort = [{
    step: 'smooth_1080',
    max_quality: '1080p' as const,
    exclude_remux: false,
    require_cache: 'cached_or_uncached' as const,
    debrid_services: ['torbox'],
    addons: ['AIOStreams'],
    verified: false,
  }];

  const result = await playWithLadder([risky4k, smooth1080], testConfig({
    play_ladder: [...main, ...resort],
    main_ladder: main,
    last_resort_ladder: resort,
  }), {
    preflight: async () => 'video',
    probe: async (url) => {
      probeCalls.push(url);
      return { ok: true, ttff_ms: 100, duration_sec: 5400 };
    },
    play: async (url) => {
      playCalls.push(url);
      return { ok: true, ttff_ms: 200 };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(probeCalls, [smooth1080.url]);
  assert.deepEqual(playCalls, [smooth1080.url]);
});

test('pipeline-fatal handoff failure aborts fallthrough without bad-caching the stream', async () => {
  const first = candidate('https://example.test/pipeline-fatal-first.mkv');
  const second = candidate(
    'https://example.test/pipeline-fatal-second.mkv',
    '[TB☁️⚡] Torrentio 1080p alternate',
  );
  const playCalls: string[] = [];

  const error = await playWithLadder([first, second], testConfig({
    auto_play_max_attempts: 4,
  }), {
    verified_hint: {
      win_url_hash: streamUrlHash(first.url),
      win_ladder_step: 'ideal',
      probe_ms: 100,
    },
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 100, duration_sec: 5400 }),
    play: async (url) => {
      playCalls.push(url);
      if (url === first.url) {
        throw new Error('mpv-play failed: mpv handoff failed');
      }
      return { ok: true, ttff_ms: 200 };
    },
  }).catch((caught) => caught);

  assert.ok(error instanceof Error);
  assert.equal(error.message, 'playback_pipeline_failed');
  assert.deepEqual(playCalls, [first.url]);
  assert.equal(isStreamUrlBad(streamUrlHash(first.url)), false);
});

test('wrapper-reported cancellation aborts fallthrough without bad-caching the stream', async () => {
  const first = candidate('https://example.test/cancelled-first.mkv');
  const second = candidate(
    'https://example.test/cancelled-second.mkv',
    '[TB☁️⚡] Torrentio 1080p alternate',
  );
  const playCalls: string[] = [];

  const error = await playWithLadder([first, second], testConfig({
    auto_play_max_attempts: 4,
  }), {
    verified_hint: {
      win_url_hash: streamUrlHash(first.url),
      win_ladder_step: 'ideal',
      probe_ms: 100,
    },
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 100, duration_sec: 5400 }),
    play: async (url) => {
      playCalls.push(url);
      throw new Error('mpv-play failed: play cancelled');
    },
  }).catch((caught) => caught);

  assert.ok(error instanceof Error);
  assert.equal(error.message, 'playback_pipeline_failed');
  assert.deepEqual(playCalls, [first.url]);
  assert.equal(isStreamUrlBad(streamUrlHash(first.url)), false);
});

test('probeWithLadder aborts on pipeline-fatal ownership failure', async () => {
  const first = candidate('https://example.test/probe-fatal-first.mkv');
  const second = candidate(
    'https://example.test/probe-fatal-second.mkv',
    '[TB☁️⚡] Torrentio 1080p alternate',
  );
  const probeCalls: string[] = [];

  const error = await probeWithLadder([first, second], testConfig(), {
    preflight: async () => 'video',
    probe: async (url) => {
      probeCalls.push(url);
      throw new Error('mpv-play failed: foreground_playback_busy');
    },
  }).catch((caught) => caught);

  assert.ok(error instanceof Error);
  assert.equal(error.message, 'playback_pipeline_failed');
  assert.deepEqual(probeCalls, [first.url]);
  assert.equal(isStreamUrlBad(streamUrlHash(first.url)), false);
});

test('ordinary candidate failure still falls through to the next stream', async () => {
  const first = candidate('https://example.test/ordinary-first.mkv');
  const second = candidate(
    'https://example.test/ordinary-second.mkv',
    '[TB☁️⚡] Torrentio 1080p alternate',
  );
  const playCalls: string[] = [];

  const result = await playWithLadder([first, second], testConfig({
    auto_play_max_attempts: 2,
  }), {
    verified_hint: {
      win_url_hash: streamUrlHash(first.url),
      win_ladder_step: 'ideal',
      probe_ms: 100,
    },
    preflight: async () => 'video',
    probe: async () => ({ ok: true, ttff_ms: 100, duration_sec: 5400 }),
    play: async (url) => {
      playCalls.push(url);
      if (url === first.url) {
        throw new Error('mpv-play failed: HTTP error 403');
      }
      return { ok: true, ttff_ms: 200 };
    },
  });

  assert.deepEqual(playCalls, [first.url, second.url]);
  assert.equal(result.stream.title, second.title);
  assert.equal(result.attempts.length, 2);
});

test('auto_play_max_attempts is global across main and last-resort phases', async () => {
  const main = candidate('https://example.test/global-main.mkv');
  const resortOne = candidate('https://example.test/global-resort-one.mkv', '[TB⏳] Torrentio 720p A');
  resortOne.cache_status = 'uncached';
  resortOne.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|false|720p-a' };
  resortOne.description = '720p WEBRip x264';
  const resortTwo = candidate('https://example.test/global-resort-two.mkv', '[TB⏳] Torrentio 720p B');
  resortTwo.cache_status = 'uncached';
  resortTwo.behaviorHints = { bingeGroup: 'com.aiostreams|torbox|false|720p-b' };
  resortTwo.description = '720p WEBRip x264';
  const mainLadder = [{
    step: 'main_cached',
    max_quality: '1080p' as const,
    exclude_remux: true,
    require_cache: 'cached' as const,
    debrid_services: ['torbox'],
    addons: ['AIOStreams'],
    verified: true,
  }];
  const lastResortLadder = [{
    step: 'last_resort',
    max_quality: '1080p' as const,
    exclude_remux: true,
    require_cache: 'any' as const,
    debrid_services: ['torbox'],
    addons: ['AIOStreams'],
    verified: false,
  }];
  const probeCalls: string[] = [];

  const error = await playWithLadder([main, resortOne, resortTwo], testConfig({
    play_ladder: [...mainLadder, ...lastResortLadder],
    main_ladder: mainLadder,
    last_resort_ladder: lastResortLadder,
    auto_play_max_attempts: 2,
  }), {
    preflight: async () => 'video',
    probe: async (url) => {
      probeCalls.push(url);
      throw new Error('candidate transport rejected');
    },
    play: async () => ({ ok: true, ttff_ms: 100 }),
  }).catch((caught) => caught);

  assert.ok(error instanceof Error);
  assert.equal(error.message, 'no_playable_stream');
  assert.equal(probeCalls.length, 2);
  assert.equal((error as { details?: { attempts?: unknown[] } }).details?.attempts?.length, 2);
});

test('thin retry consumes the global auto_play_max_attempts budget', async () => {
  const stream = candidate('https://example.test/retry-budget.mkv');
  let probeCalls = 0;

  const error = await playWithLadder([stream], testConfig({
    auto_play_max_attempts: 1,
  }), {
    preflight: async () => 'video',
    probe: async () => {
      probeCalls += 1;
      throw new Error('mpv-play failed: timeout waiting for playback');
    },
    play: async () => ({ ok: true, ttff_ms: 100 }),
  }).catch((caught) => caught);

  assert.ok(error instanceof Error);
  assert.equal(error.message, 'no_playable_stream');
  assert.equal(probeCalls, 1);
  assert.equal((error as { details?: { attempts?: unknown[] } }).details?.attempts?.length, 1);
});

test('cached-bad zero-I/O skip does not consume auto_play_max_attempts', async () => {
  const cachedBad = candidate('https://example.test/cached-bad-skip.mkv');
  const valid = candidate(
    'https://example.test/valid-after-cached-bad.mkv',
    '[TB☁️⚡] Torrentio 1080p alternate',
  );
  markStreamUrlBad(streamUrlHash(cachedBad.url));
  const probeCalls: string[] = [];

  const result = await playWithLadder([cachedBad, valid], testConfig({
    auto_play_max_attempts: 1,
  }), {
    verified_hint: {
      win_url_hash: streamUrlHash(cachedBad.url),
      win_ladder_step: 'ideal',
      probe_ms: 100,
    },
    preflight: async () => 'video',
    probe: async (url) => {
      probeCalls.push(url);
      return { ok: true, ttff_ms: 100, duration_sec: 5400 };
    },
    play: async () => ({ ok: true, ttff_ms: 200 }),
  });

  assert.deepEqual(probeCalls, [valid.url]);
  assert.equal(result.stream.title, valid.title);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.error, 'stream_url_bad_cached');
  assert.equal(result.attempts[1]?.ok, true);
});

test('Phase A uses the full play wall without an obligation reserve', async () => {
  const prevExtension = process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
  process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = '0';
  const first = candidate('https://example.test/full-wall-a.mkv');
  const second = candidate('https://example.test/full-wall-b.mkv', '[TB☁️⚡] Torrentio 1080p B');
  const third = candidate('https://example.test/full-wall-c.mkv', '[TB☁️⚡] Torrentio 1080p C');
  let probeCalls = 0;
  try {
    await playWithLadder([first, second, third], testConfig({
      auto_play_wall_ms: 1200,
      auto_play_probe_ms: 400,
      auto_play_max_attempts: 8,
      last_resort_ladder: [],
    }), {
      preflight: async () => 'video',
      probe: async () => {
        probeCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 400));
        throw new Error('mpv-play failed: expected wall exhaustion');
      },
      play: async () => ({ ok: true, ttff_ms: 100 }),
    });
  } catch {
    // expected: no playable stream
  } finally {
    if (prevExtension === undefined) delete process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
    else process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = prevExtension;
  }
  // Full 1200ms wall fits two 400ms probes (remaining after two is ~400 < 500).
  // A 20s upfront reserve would have collapsed this short wall to 500ms (one probe).
  assert.equal(probeCalls, 2);
});

test('hard title with floor candidates gets the Phase B extension', async () => {
  const prevExtension = process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
  process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = '800';
  const ladderOnly = candidate('https://example.test/extend-ladder.mkv', '[TB☁️⚡] Torrentio 1080p HEVC');
  ladderOnly.description = 'WEB-DL 1080p x265';
  const floorOnly: Stream = {
    url: 'https://example.test/extend-floor.mkv',
    source: 'AIOStreams',
    name: '[TB⏳] Torrentio 720p',
    title: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  };
  try {
    const result = await playWithLadder([ladderOnly, floorOnly], {
      ...preferenceOnlyConfig(),
      auto_play_wall_ms: 500,
      auto_play_probe_ms: 400,
      auto_play_max_attempts: 8,
    }, {
      preflight: async () => 'video',
      probe: async (url) => {
        if (url.includes('extend-ladder')) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          throw new Error('mpv-play failed: expected');
        }
        return { ok: true, ttff_ms: 120, duration_sec: 5400 };
      },
      play: async (url) => {
        assert.ok(url.includes('extend-floor'));
        return { ok: true, ttff_ms: 200 };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.win_ladder_step, 'obligation_floor');
  } finally {
    if (prevExtension === undefined) delete process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
    else process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = prevExtension;
  }
});

test('Phase B does not extend when there are no obligation candidates', async () => {
  const prevExtension = process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
  process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = '5000';
  const only = candidate('https://example.test/no-floor.mkv');
  let probeCalls = 0;
  try {
    await playWithLadder([only], testConfig({
      auto_play_wall_ms: 800,
      auto_play_max_attempts: 4,
      last_resort_ladder: [],
    }), {
      preflight: async () => 'video',
      probe: async () => {
        probeCalls += 1;
        throw new Error('mpv-play failed: expected');
      },
      play: async () => ({ ok: true, ttff_ms: 100 }),
    });
  } catch {
    // expected
  } finally {
    if (prevExtension === undefined) delete process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
    else process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = prevExtension;
  }
  assert.equal(probeCalls, 1);
});

test('Phase B extension never exceeds the server deadline', async () => {
  const prevExtension = process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
  process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = '30000';
  const ladderOnly = candidate('https://example.test/cap-ladder.mkv', '[TB☁️⚡] Torrentio 1080p HEVC');
  ladderOnly.description = 'WEB-DL 1080p x265';
  const floors: Stream[] = [1, 2, 3].map((index) => ({
    url: `https://example.test/cap-floor-${index}.mkv`,
    source: 'AIOStreams',
    name: `[TB⏳] Torrentio 720p ${index}`,
    title: `[TB⏳] Torrentio 720p ${index}`,
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  }));
  let floorProbes = 0;
  const started = Date.now();
  try {
    await playWithLadder([ladderOnly, ...floors], {
      ...preferenceOnlyConfig(),
      auto_play_wall_ms: 400,
      auto_play_probe_ms: 300,
      auto_play_max_attempts: 8,
    }, {
      startedAtMs: started,
      deadlineAtMs: started + 900,
      preflight: async () => 'video',
      probe: async (url) => {
        if (url.includes('cap-ladder')) {
          throw new Error('mpv-play failed: expected');
        }
        floorProbes += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
        throw new Error('mpv-play failed: expected floor miss');
      },
      play: async () => ({ ok: true, ttff_ms: 100 }),
    });
  } catch {
    // expected
  } finally {
    if (prevExtension === undefined) delete process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
    else process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS = prevExtension;
  }
  // Server wall is 900ms. Uncapped +30s would attempt all three floor streams.
  assert.ok(floorProbes >= 1 && floorProbes <= 2, `floorProbes=${floorProbes}`);
  assert.ok(Date.now() - started < 2500);
});
