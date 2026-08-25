import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyYtDlpError,
  effectiveYoutubeFormat,
  isHlsYoutubeFormat,
  isMuxedOnlyYoutubeFormat,
  isTransientYoutubeResolveError,
  isYoutubeLiveStatus,
  parseYoutubeResolveMeta,
  parseYtDlpResolvedUrls,
  preferAdaptiveYoutubeFormat,
  publicYoutubePlayFailureDetails,
  resetYoutubePlaybackStateForTest,
  resolveYoutubePlayback,
  setYoutubeCommandRunnerForTest,
  shouldRefreshYoutubeTransport,
  youtubeJsRuntimeArgs,
  youtubeJsRuntimeAvailable,
  youtubeMpvFailureKind,
  youtubePlayStartDisposition,
  youtubeSocketTimeoutSec,
  youtubeYtDlpResolveArgs,
  ytDlpFormatCandidates,
  YOUTUBE_ADAPTIVE_FORMAT,
  YOUTUBE_FORMAT_SORT,
  YOUTUBE_LIVE_FORMAT,
  YOUTUBE_MAX_HEIGHT,
  YOUTUBE_PLAYER_CLIENT_POLICY,
  YOUTUBE_SOCKET_TIMEOUT_SEC,
} from './playback.js';
import { CatalogError } from '../catalog-errors.js';
import { PlayCancelledError } from '../play-cancel.js';
import type { YoutubeConfig } from './config.js';

function resolverConfig(overrides: Partial<YoutubeConfig> = {}): YoutubeConfig {
  return {
    enabled: true,
    db_path: '/tmp/youtube-test.db',
    api_key: null,
    api_key_file: '/tmp/youtube-api.key',
    oauth_client_file: '/tmp/youtube-oauth.json',
    auth_token_file: '/tmp/youtube-auth.json',
    region_code: 'IN',
    relevance_language: 'en',
    max_results: 25,
    exclude_shorts: true,
    stale_after_ms: 1,
    yt_dlp_command: '/tmp/yt-dlp',
    yt_dlp_format: YOUTUBE_ADAPTIVE_FORMAT,
    yt_dlp_cookies: null,
    yt_dlp_cookies_from_browser: null,
    ...overrides,
  };
}

test('parseYtDlpResolvedUrls supports separate video and audio URLs', () => {
  assert.deepEqual(
    parseYtDlpResolvedUrls('https://video.example/stream.m3u8\nhttps://audio.example/stream.m3u8\n'),
    {
      url: 'https://video.example/stream.m3u8',
      audio_url: 'https://audio.example/stream.m3u8',
    },
  );
});

test('parseYtDlpResolvedUrls supports a single combined URL', () => {
  assert.deepEqual(
    parseYtDlpResolvedUrls('noise\nhttps://combined.example/stream.mp4\n'),
    {
      url: 'https://combined.example/stream.mp4',
      audio_url: undefined,
    },
  );
});

test('preferAdaptiveYoutubeFormat strips muxed progressive from a DASH selector', () => {
  assert.equal(
    preferAdaptiveYoutubeFormat('bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'),
    'bestvideo[height<=1080]+bestaudio',
  );
  assert.equal(preferAdaptiveYoutubeFormat('bv*+ba/b'), 'bv*+ba');
  assert.equal(isMuxedOnlyYoutubeFormat('best[height<=1080]'), true);
  assert.equal(isMuxedOnlyYoutubeFormat('bv*+ba'), false);
  assert.equal(isMuxedOnlyYoutubeFormat('b[height<=2160][protocol^=m3u8]'), false);
});

test('legacy muxed-first config upgrades to DASH-first adaptive', () => {
  assert.equal(
    effectiveYoutubeFormat('bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'),
    YOUTUBE_ADAPTIVE_FORMAT,
  );
  assert.equal(effectiveYoutubeFormat('best'), YOUTUBE_ADAPTIVE_FORMAT);
  assert.equal(effectiveYoutubeFormat('bv*[height<=2160]+ba'), YOUTUBE_ADAPTIVE_FORMAT);
  assert.equal(
    effectiveYoutubeFormat('bv*[height<=720]+ba/b'),
    'bv*[height<=720][protocol=https]+ba[protocol=https]/bv*[height<=720][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=720][protocol^=m3u8]',
  );
});

test('ytDlpFormatCandidates never admits muxed progressive', () => {
  for (const configured of [
    'best',
    'best[height<=1080]/best',
    'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    'bv*[height<=720]+ba/b',
    'b',
  ]) {
    const formats = ytDlpFormatCandidates(configured);
    assert.ok(formats.length > 0);
    assert.ok(formats.every((format) => !isMuxedOnlyYoutubeFormat(format)));
    assert.ok(formats.every((format) => /^bv\*\[height<=\d+\]\[protocol=https\]\+ba\[protocol=https\]\//.test(format)));
    assert.ok(formats.every((format) => isHlsYoutubeFormat(format)));
    assert.ok((formats[0] || '').includes('+'));
  }
});

test('a tighter operator cap stays at that height with DASH then HLS', () => {
  const formats = ytDlpFormatCandidates('bv*[height<=720]+ba/b');
  assert.deepEqual(formats, [
    'bv*[height<=720][protocol=https]+ba[protocol=https]/bv*[height<=720][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=720][protocol^=m3u8]',
  ]);
});

test('live format candidates exclude DASH while preserving the configured cap', () => {
  const formats = ytDlpFormatCandidates(
    'bv*[height<=720]+ba/b',
    [],
    { live: true },
  );
  assert.deepEqual(formats, [
    'bv*[height<=720][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=720][protocol^=m3u8]',
  ]);
  assert.doesNotMatch(formats[0] || '', /protocol=https/);
});

test('YouTube format policy enforces a hard 1080p ceiling', () => {
  assert.deepEqual(
    ytDlpFormatCandidates('bv*[height<=1080]+ba'),
    ['bv*[height<=1080][protocol=https]+ba[protocol=https]/bv*[height<=1080][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=1080][protocol^=m3u8]'],
  );
  assert.deepEqual(
    ytDlpFormatCandidates(
      'bv*[height<=2160][protocol^=m3u8]+ba[protocol^=m3u8]/bv*[height<=2160]+ba/b[height<=2160][protocol^=m3u8]',
    ),
    [YOUTUBE_ADAPTIVE_FORMAT],
  );
  assert.equal(YOUTUBE_MAX_HEIGHT, 1080);
  assert.match(YOUTUBE_FORMAT_SORT, /^res:1080,/);
  assert.doesNotMatch(YOUTUBE_ADAPTIVE_FORMAT, /height<=1(?:440|[5-9]\d{2})|height<=[2-9]\d{3}/);
});

test('ytDlpFormatCandidates is a single DASH-then-HLS selector, not a height ladder', () => {
  const formats = ytDlpFormatCandidates('best');
  assert.deepEqual(formats, [YOUTUBE_ADAPTIVE_FORMAT]);
  assert.match(formats[0] || '', /^bv\*\[height<=1080\]\[protocol=https\]\+ba\[protocol=https\]\//);
  assert.match(formats[0] || '', /protocol\^=m3u8/);
  assert.match(formats[0] || '', /\/bv\*\[height<=1080\]\[protocol\^=m3u8\]\+ba\[protocol\^=m3u8\]\//);
});

test('ytDlpFormatCandidates drops an already failed transport format', () => {
  assert.deepEqual(
    ytDlpFormatCandidates(YOUTUBE_ADAPTIVE_FORMAT, [YOUTUBE_ADAPTIVE_FORMAT]),
    [],
  );
});

test('yt-dlp resolve uses maintained upstream clients and bundled EJS', () => {
  const previousDeno = process.env.MANGO_DENO;
  const previousRuntimes = process.env.MANGO_YTDLP_JS_RUNTIMES;
  const previousRemote = process.env.MANGO_YTDLP_REMOTE_COMPONENTS;
  const previousExtractor = process.env.MANGO_YTDLP_EXTRACTOR_ARGS;
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  delete process.env.MANGO_DENO;
  delete process.env.MANGO_YTDLP_JS_RUNTIMES;
  delete process.env.MANGO_YTDLP_REMOTE_COMPONENTS;
  delete process.env.MANGO_YTDLP_EXTRACTOR_ARGS;
  delete process.env.MANGO_YOUTUBE_POT;
  try {
    const args = youtubeYtDlpResolveArgs({}, YOUTUBE_ADAPTIVE_FORMAT, 'dQw4w9WgXcQ');
    const runtimes: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--js-runtimes' && args[i + 1]) {
        runtimes.push(args[i + 1]);
        i += 1;
      }
    }
    assert.equal(args[args.indexOf('-f') + 1], YOUTUBE_ADAPTIVE_FORMAT);
    assert.equal(args[args.indexOf('--format-sort') + 1], YOUTUBE_FORMAT_SORT);
    assert.ok(args.includes('--ignore-config'));
    assert.equal(runtimes.length, 2);
    assert.match(runtimes[0], /^deno(?::.+)?$/);
    assert.equal(runtimes[1], 'node');
    assert.equal(args[args.indexOf('--socket-timeout') + 1], String(YOUTUBE_SOCKET_TIMEOUT_SEC));
    assert.equal(args.includes('--remote-components'), false);
    assert.equal(
      args[args.indexOf('--extractor-args') + 1],
      'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
    );
    assert.equal(
      args.some((arg) => /player_client|web_safari|tv_simply/.test(arg)),
      false,
    );
    assert.equal(YOUTUBE_PLAYER_CLIENT_POLICY, 'upstream_default');
    assert.ok(args.includes('-g'));
    assert.equal(
      args[args.indexOf('--print') + 1],
      'MANGO_META:%(live_status)s|%(duration)s|%(protocol)s|%(height)s|%(fps)s',
    );
    assert.match(YOUTUBE_FORMAT_SORT, /vcodec:vp9:vp9\.2/);
    assert.match(YOUTUBE_FORMAT_SORT, /^res:1080,/);
    assert.doesNotMatch(YOUTUBE_FORMAT_SORT, /hdr:12/);
  } finally {
    if (previousDeno === undefined) delete process.env.MANGO_DENO;
    else process.env.MANGO_DENO = previousDeno;
    if (previousRuntimes === undefined) delete process.env.MANGO_YTDLP_JS_RUNTIMES;
    else process.env.MANGO_YTDLP_JS_RUNTIMES = previousRuntimes;
    if (previousRemote === undefined) delete process.env.MANGO_YTDLP_REMOTE_COMPONENTS;
    else process.env.MANGO_YTDLP_REMOTE_COMPONENTS = previousRemote;
    if (previousExtractor === undefined) delete process.env.MANGO_YTDLP_EXTRACTOR_ARGS;
    else process.env.MANGO_YTDLP_EXTRACTOR_ARGS = previousExtractor;
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
  }
});

test('yt-dlp resolve is anonymous by default and adds cookies only for auth fallback', () => {
  const config = {
    yt_dlp_cookies: '/tmp/youtube-cookies.txt',
    yt_dlp_cookies_from_browser: 'chromium',
  };
  const anonymous = youtubeYtDlpResolveArgs(
    config,
    YOUTUBE_ADAPTIVE_FORMAT,
    'dQw4w9WgXcQ',
  );
  assert.equal(anonymous.includes('--cookies'), false);
  assert.equal(anonymous.includes('--cookies-from-browser'), false);

  const authenticated = youtubeYtDlpResolveArgs(
    config,
    YOUTUBE_ADAPTIVE_FORMAT,
    'dQw4w9WgXcQ',
    { includeCookies: true },
  );
  assert.equal(authenticated[authenticated.indexOf('--cookies') + 1], config.yt_dlp_cookies);
  assert.equal(
    authenticated[authenticated.indexOf('--cookies-from-browser') + 1],
    config.yt_dlp_cookies_from_browser,
  );
});

test('yt-dlp resolve pins an existing Mango Deno binary', () => {
  const previousDeno = process.env.MANGO_DENO;
  const previousRuntimes = process.env.MANGO_YTDLP_JS_RUNTIMES;
  delete process.env.MANGO_YTDLP_JS_RUNTIMES;
  process.env.MANGO_DENO = process.execPath;
  try {
    const args = youtubeJsRuntimeArgs();
    assert.deepEqual(args, ['--js-runtimes', `deno:${process.execPath}`, '--js-runtimes', 'node']);
    assert.equal(youtubeJsRuntimeAvailable(), true);
  } finally {
    if (previousDeno === undefined) {
      delete process.env.MANGO_DENO;
    } else {
      process.env.MANGO_DENO = previousDeno;
    }
    if (previousRuntimes === undefined) {
      delete process.env.MANGO_YTDLP_JS_RUNTIMES;
    } else {
      process.env.MANGO_YTDLP_JS_RUNTIMES = previousRuntimes;
    }
  }
});

test('yt-dlp resolve omits JS runtime when the operator disables it', () => {
  const previous = process.env.MANGO_YTDLP_JS_RUNTIMES;
  process.env.MANGO_YTDLP_JS_RUNTIMES = 'none';
  try {
    const args = youtubeYtDlpResolveArgs({}, YOUTUBE_ADAPTIVE_FORMAT, 'dQw4w9WgXcQ');
    assert.equal(args.includes('--js-runtimes'), false);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_YTDLP_JS_RUNTIMES;
    } else {
      process.env.MANGO_YTDLP_JS_RUNTIMES = previous;
    }
  }
});

test('yt-dlp resolve uses loopback POT plus any operator extractor override', () => {
  const previous = process.env.MANGO_YTDLP_EXTRACTOR_ARGS;
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  process.env.MANGO_YTDLP_EXTRACTOR_ARGS = 'youtube:player_client=android_vr';
  process.env.MANGO_YOUTUBE_POT = '1';
  try {
    const args = youtubeYtDlpResolveArgs({}, YOUTUBE_ADAPTIVE_FORMAT, 'dQw4w9wgGcQ');
    const extractorArgs: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--extractor-args' && args[i + 1]) {
        extractorArgs.push(args[i + 1]);
        i += 1;
      }
    }
    assert.deepEqual(extractorArgs, [
      'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      'youtube:player_client=android_vr',
    ]);
  } finally {
    if (previous === undefined) delete process.env.MANGO_YTDLP_EXTRACTOR_ARGS;
    else process.env.MANGO_YTDLP_EXTRACTOR_ARGS = previous;
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
  }
});

test('yt-dlp resolve omits the loopback POT provider only when explicitly disabled', () => {
  const previous = process.env.MANGO_YOUTUBE_POT;
  process.env.MANGO_YOUTUBE_POT = '0';
  try {
    const args = youtubeYtDlpResolveArgs({}, YOUTUBE_ADAPTIVE_FORMAT, 'dQw4w9wgGcQ');
    assert.equal(
      args.some((arg) => arg.startsWith('youtubepot-bgutilhttp:')),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previous;
  }
});

test('yt-dlp resolve refuses a non-loopback POT provider URL', () => {
  const previousPot = process.env.MANGO_YOUTUBE_POT;
  const previousUrl = process.env.MANGO_YOUTUBE_POT_URL;
  process.env.MANGO_YOUTUBE_POT = '1';
  process.env.MANGO_YOUTUBE_POT_URL = 'https://example.com:4416';
  try {
    const args = youtubeYtDlpResolveArgs({}, YOUTUBE_ADAPTIVE_FORMAT, 'dQw4w9wgGcQ');
    assert.equal(
      args[args.indexOf('--extractor-args') + 1],
      'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
    );
  } finally {
    if (previousPot === undefined) delete process.env.MANGO_YOUTUBE_POT;
    else process.env.MANGO_YOUTUBE_POT = previousPot;
    if (previousUrl === undefined) delete process.env.MANGO_YOUTUBE_POT_URL;
    else process.env.MANGO_YOUTUBE_POT_URL = previousUrl;
  }
});

test('resolver falls back once to the previous canaried slot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mango-ytdlp-slots-'));
  const previousRoot = join(root, 'previous/venv/bin');
  mkdirSync(previousRoot, { recursive: true });
  writeFileSync(join(previousRoot, 'yt-dlp'), '');
  writeFileSync(join(root, 'previous/meta.json'), JSON.stringify({
    revision: 'previous-test',
    channel: 'nightly',
    ejs: true,
    js_runtime: 'deno',
    canary: 'pass',
    canary_result: {
      ok: true,
      transport: true,
      total: 7,
      passed: 6,
      required_total: 6,
      required_passed: 6,
      dynamic_total: 3,
      dynamic_passed: 3,
    },
  }));
  const previousSlotRoot = process.env.MANGO_YTDLP_SLOT_ROOT;
  process.env.MANGO_YTDLP_SLOT_ROOT = root;
  const slots: string[] = [];
  const timeouts: number[] = [];
  setYoutubeCommandRunnerForTest(async (_command, _args, options) => {
    const slot = options.env.MANGO_YTDLP_SLOT || '';
    slots.push(slot);
    timeouts.push(options.timeout);
    if (slot === 'active') {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      throw new Error('ERROR: Requested format is not available');
    }
    return {
      stdout: 'MANGO_META:not_live|60|https|1080|30\nhttps://video.example/v\nhttps://audio.example/a\n',
      stderr: '',
    };
  });
  try {
    const resolved = await resolveYoutubePlayback(
      resolverConfig({ yt_dlp_command: '/tmp/youtube-yt-dlp.sh' }),
      'dQw4w9WgXcQ',
    );
    assert.deepEqual(slots, ['active', 'previous']);
    assert.ok(timeouts[1] < timeouts[0], JSON.stringify(timeouts));
    assert.equal(resolved.resolver_slot, 'previous');
    assert.equal(resolved.resolver_auth, 'anonymous');
  } finally {
    resetYoutubePlaybackStateForTest();
    rmSync(root, { recursive: true, force: true });
    if (previousSlotRoot === undefined) delete process.env.MANGO_YTDLP_SLOT_ROOT;
    else process.env.MANGO_YTDLP_SLOT_ROOT = previousSlotRoot;
  }
});

test('resolver re-resolves a live result under the HLS-only policy', async () => {
  const formats: string[] = [];
  setYoutubeCommandRunnerForTest(async (_command, args) => {
    formats.push(args[args.indexOf('-f') + 1] || '');
    return formats.length === 1
      ? {
          stdout: 'MANGO_META:is_live||https|1080|30\nhttps://video.example/dash\nhttps://audio.example/dash\n',
          stderr: '',
        }
      : {
          stdout: 'MANGO_META:is_live||m3u8_native|1080|30\nhttps://video.example/live.m3u8\n',
          stderr: '',
        };
  });
  try {
    const resolved = await resolveYoutubePlayback(
      resolverConfig(),
      'dQw4w9WgXcQ',
    );
    assert.deepEqual(formats, [YOUTUBE_ADAPTIVE_FORMAT, YOUTUBE_LIVE_FORMAT]);
    assert.equal(resolved.format, YOUTUBE_LIVE_FORMAT);
    assert.equal(resolved.live, true);
    assert.equal(resolved.url, 'https://video.example/live.m3u8');
  } finally {
    resetYoutubePlaybackStateForTest();
  }
});

test('resolver uses configured cookies only after an account-required response', async () => {
  const attempts: boolean[] = [];
  setYoutubeCommandRunnerForTest(async (_command, args) => {
    const authenticated = args.includes('--cookies');
    attempts.push(authenticated);
    if (!authenticated) {
      throw new Error('ERROR: Sign in to confirm your age');
    }
    return {
      stdout: 'MANGO_META:not_live|60|https|720|30\nhttps://video.example/v\nhttps://audio.example/a\n',
      stderr: '',
    };
  });
  try {
    const resolved = await resolveYoutubePlayback(
      resolverConfig({ yt_dlp_cookies: '/tmp/youtube-cookies.txt' }),
      'dQw4w9WgXcQ',
    );
    assert.deepEqual(attempts, [false, true]);
    assert.equal(resolved.resolver_auth, 'cookies');
  } finally {
    resetYoutubePlaybackStateForTest();
  }
});

test('resolver uses configured cookies after an explicit YouTube bot sign-in challenge', async () => {
  const attempts: boolean[] = [];
  setYoutubeCommandRunnerForTest(async (_command, args) => {
    const authenticated = args.includes('--cookies');
    attempts.push(authenticated);
    if (!authenticated) {
      throw new Error('ERROR: Sign in to confirm you’re not a bot');
    }
    return {
      stdout: 'MANGO_META:not_live|60|https|720|30\nhttps://video.example/v\nhttps://audio.example/a\n',
      stderr: '',
    };
  });
  try {
    const resolved = await resolveYoutubePlayback(
      resolverConfig({ yt_dlp_cookies: '/tmp/youtube-cookies.txt' }),
      'dQw4w9WgXcQ',
    );
    assert.deepEqual(attempts, [false, true]);
    assert.equal(resolved.resolver_auth, 'cookies');
  } finally {
    resetYoutubePlaybackStateForTest();
  }
});

test('classifyYtDlpError does not call requested format failure a removed video', () => {
  assert.deepEqual(
    classifyYtDlpError('ERROR: Requested format is not available. Use --list-formats for a list of available formats'),
    {
      status: 502,
      kind: 'format_unavailable',
      message: 'YouTube playback format unavailable — try another YouTube video',
    },
  );
});

test('classifyYtDlpError treats stalls as timeouts, not digit-matching HTTP codes', () => {
  const stalled = classifyYtDlpError(
    'ERROR: [youtube] abc429def: Unable to download webpage: The read operation timed out https://rr5---sn-xxx.googlevideo.com/videoplayback?ei=n403token',
  );
  assert.equal(stalled.status, 502);
  assert.equal(stalled.kind, 'timeout');

  const rateLimited = classifyYtDlpError('ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 429: Too Many Requests');
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.kind, 'bot_check');

  const botCheck = classifyYtDlpError("ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot");
  assert.equal(botCheck.status, 429);
  assert.equal(botCheck.kind, 'bot_check');

  const ageGate = classifyYtDlpError('ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm your age');
  assert.equal(ageGate.status, 403);
  assert.equal(ageGate.kind, 'blocked');

  const forbidden = classifyYtDlpError('ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 403: Forbidden');
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.kind, 'blocked');

  const missingJs = classifyYtDlpError('WARNING: No supported JavaScript runtime could be found. Only deno is enabled by default');
  assert.equal(missingJs.status, 503);
  assert.equal(missingJs.kind, 'js_runtime');

  const nsig = classifyYtDlpError('WARNING: [youtube] dQw4w9WgXcQ: n challenge solving failed: Some formats may be missing');
  assert.equal(nsig.status, 503);
  assert.equal(nsig.kind, 'js_runtime');

  const digitsOnly = classifyYtDlpError(
    'ERROR: [youtube] watch?v=abc429xyz: Unable to extract player response',
  );
  assert.equal(digitsOnly.status, 502);
  assert.equal(digitsOnly.kind, 'other');
});

test('transient YouTube resolve errors retry; blocked and bot-check do not', () => {
  const timeout = new CatalogError(502, 'YouTube playback could not be resolved', {
    playback_stage: 'resolve',
    failure_kind: 'timeout',
    yt_dlp: 'The read operation timed out',
  });
  assert.equal(isTransientYoutubeResolveError(timeout), true);

  const blocked = new CatalogError(403, 'YouTube blocked this video for this account or device', {
    playback_stage: 'resolve',
    failure_kind: 'blocked',
  });
  assert.equal(isTransientYoutubeResolveError(blocked), false);

  const botCheck = new CatalogError(429, 'YouTube playback resolve is cooling down', {
    playback_stage: 'resolve',
    failure_kind: 'bot_check',
  });
  assert.equal(isTransientYoutubeResolveError(botCheck), false);

  const format = new CatalogError(502, 'YouTube playback format unavailable — try another YouTube video', {
    playback_stage: 'resolve',
    failure_kind: 'format_unavailable',
  });
  assert.equal(isTransientYoutubeResolveError(format), false);

  const missingJs = new CatalogError(503, 'YouTube playback is missing a JavaScript runtime', {
    playback_stage: 'resolve',
    failure_kind: 'js_runtime',
  });
  assert.equal(isTransientYoutubeResolveError(missingJs), false);
});

test('mpv start failures classify handoff separately from generic start errors', () => {
  assert.equal(youtubeMpvFailureKind('FAIL: mpv vo not ready after display enable'), 'mpv_handoff');
  assert.equal(youtubeMpvFailureKind('FAIL: mpv handoff failed'), 'mpv_handoff');
  assert.equal(youtubeMpvFailureKind('FAIL: HTTP error 403'), 'blocked');
  assert.equal(youtubeMpvFailureKind('FAIL: mpv did not start playback within 90000ms'), 'timeout');
});

test('socket-timeout env override is clamped to a sane range', () => {
  const previous = process.env.MANGO_YTDLP_SOCKET_TIMEOUT;
  try {
    delete process.env.MANGO_YTDLP_SOCKET_TIMEOUT;
    assert.equal(youtubeSocketTimeoutSec(), YOUTUBE_SOCKET_TIMEOUT_SEC);
    process.env.MANGO_YTDLP_SOCKET_TIMEOUT = '8';
    assert.equal(youtubeSocketTimeoutSec(), 8);
    process.env.MANGO_YTDLP_SOCKET_TIMEOUT = '0';
    assert.equal(youtubeSocketTimeoutSec(), YOUTUBE_SOCKET_TIMEOUT_SEC);
    process.env.MANGO_YTDLP_SOCKET_TIMEOUT = 'nope';
    assert.equal(youtubeSocketTimeoutSec(), YOUTUBE_SOCKET_TIMEOUT_SEC);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_YTDLP_SOCKET_TIMEOUT;
    } else {
      process.env.MANGO_YTDLP_SOCKET_TIMEOUT = previous;
    }
  }
});

test('YouTube play start refreshes expired transports once and propagates cancel', () => {
  assert.equal(youtubePlayStartDisposition(new Error('mpv-play failed: HTTP error 403')), 'refresh');
  assert.equal(youtubePlayStartDisposition(new Error('signed URL expired')), 'refresh');
  assert.equal(youtubePlayStartDisposition(new PlayCancelledError()), 'cancel');
  assert.equal(youtubePlayStartDisposition(new Error('FAIL: mpv vo not ready after display enable')), 'fail');
  assert.equal(youtubePlayStartDisposition(new Error('YouTube is asking for browser verification')), 'fail');
});

test('YouTube refreshes only expired direct transports, not policy failures', () => {
  assert.equal(shouldRefreshYoutubeTransport('mpv-play failed: HTTP error 403'), true);
  assert.equal(shouldRefreshYoutubeTransport('signed URL expired'), true);
  assert.equal(shouldRefreshYoutubeTransport('mpv-play did not start playback'), true);
  assert.equal(shouldRefreshYoutubeTransport('YouTube is asking for browser verification — 429'), false);
  assert.equal(shouldRefreshYoutubeTransport('this YouTube video is unavailable'), false);
  assert.equal(shouldRefreshYoutubeTransport('play cancelled'), false);
});

test('resolver meta marks live independently of a stub cache row', () => {
  assert.deepEqual(
    parseYoutubeResolveMeta('MANGO_META:live|0|m3u8\nhttps://video.example/live.m3u8\n'),
    {
      live: true,
      live_status: 'live',
      duration_sec: null,
      height: null,
      fps: null,
    },
  );
  assert.deepEqual(
    parseYoutubeResolveMeta('MANGO_META:not_live|600|https|1080|60\nhttps://video.example/vod.mp4\n'),
    {
      live: false,
      live_status: 'not_live',
      duration_sec: 600,
      height: 1080,
      fps: 60,
    },
  );
  assert.equal(isYoutubeLiveStatus('is_live'), true);
  assert.equal(isYoutubeLiveStatus('was_live'), false);
});

test('public YouTube play failures drop URLs and stderr', () => {
  const details = publicYoutubePlayFailureDetails({
    playback_stage: 'play_start',
    failure_kind: 'blocked',
    category: 'player_failure',
    attempt_count: 1,
    resolve_ms: 12,
    mpv: 'mpv-play failed: googlevideo.com/videoplayback?expire=secret',
    yt_dlp: 'ERROR: https://youtube.com/watch?v=secret',
  });
  assert.deepEqual(details, {
    failure_kind: 'blocked',
    playback_stage: 'play_start',
    category: 'player_failure',
    attempt_count: 1,
    resolve_ms: 12,
  });
  assert.equal(JSON.stringify(details).includes('secret'), false);
});
