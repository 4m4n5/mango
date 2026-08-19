import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyYtDlpError,
  effectiveYoutubeFormat,
  isMuxedOnlyYoutubeFormat,
  isTransientYoutubeResolveError,
  parseYtDlpResolvedUrls,
  preferAdaptiveYoutubeFormat,
  shouldRefreshYoutubeTransport,
  youtubeJsRuntimeArgs,
  youtubeJsRuntimeAvailable,
  youtubeMpvFailureKind,
  youtubeSocketTimeoutSec,
  youtubeYtDlpResolveArgs,
  ytDlpFormatCandidates,
  YOUTUBE_ADAPTIVE_FORMAT,
  YOUTUBE_COMPAT_ADAPTIVE_FORMAT,
  YOUTUBE_FORMAT_SORT,
  YOUTUBE_MID_ADAPTIVE_FORMAT,
  YOUTUBE_SOCKET_TIMEOUT_SEC,
} from './playback.js';
import { CatalogError } from '../catalog-errors.js';

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
});

test('legacy muxed-first config upgrades to highest adaptive DASH', () => {
  assert.equal(
    effectiveYoutubeFormat('bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'),
    YOUTUBE_ADAPTIVE_FORMAT,
  );
  assert.equal(effectiveYoutubeFormat('best'), YOUTUBE_ADAPTIVE_FORMAT);
  assert.equal(effectiveYoutubeFormat('bv*[height<=720]+ba/b'), 'bv*[height<=720]+ba');
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
    assert.ok((formats[0] || '').includes('+'));
  }
});

test('a tighter operator cap does not fall through to 1080p H.264', () => {
  const formats = ytDlpFormatCandidates('bv*[height<=720]+ba/b');
  assert.deepEqual(formats, ['bv*[height<=720]+ba']);
});

test('a 1080 operator cap retries H.264, not 1440', () => {
  assert.deepEqual(
    ytDlpFormatCandidates('bv*[height<=1080]+ba'),
    ['bv*[height<=1080]+ba', YOUTUBE_COMPAT_ADAPTIVE_FORMAT],
  );
});

test('a 1440 operator cap does not climb to 4K', () => {
  assert.deepEqual(
    ytDlpFormatCandidates(YOUTUBE_MID_ADAPTIVE_FORMAT),
    [YOUTUBE_MID_ADAPTIVE_FORMAT, YOUTUBE_COMPAT_ADAPTIVE_FORMAT],
  );
});

test('ytDlpFormatCandidates keeps configured format first and de-dupes fallbacks', () => {
  const formats = ytDlpFormatCandidates('best');
  assert.equal(formats[0], YOUTUBE_ADAPTIVE_FORMAT);
  assert.equal(formats.filter((format) => format === YOUTUBE_ADAPTIVE_FORMAT).length, 1);
  assert.deepEqual(formats, [
    YOUTUBE_ADAPTIVE_FORMAT,
    YOUTUBE_MID_ADAPTIVE_FORMAT,
    YOUTUBE_COMPAT_ADAPTIVE_FORMAT,
  ]);
});

test('ytDlpFormatCandidates advances past an already failed transport format', () => {
  const formats = ytDlpFormatCandidates(YOUTUBE_ADAPTIVE_FORMAT, [YOUTUBE_ADAPTIVE_FORMAT]);
  assert.deepEqual(formats, [YOUTUBE_MID_ADAPTIVE_FORMAT, YOUTUBE_COMPAT_ADAPTIVE_FORMAT]);
});

test('ytDlpFormatCandidates keeps 1080p H.264 after 4K and 1440 both fail', () => {
  assert.deepEqual(
    ytDlpFormatCandidates(YOUTUBE_ADAPTIVE_FORMAT, [
      YOUTUBE_ADAPTIVE_FORMAT,
      YOUTUBE_MID_ADAPTIVE_FORMAT,
    ]),
    [YOUTUBE_COMPAT_ADAPTIVE_FORMAT],
  );
});

test('yt-dlp resolve prefers Deno then Node for YouTube JS challenges', () => {
  const previousDeno = process.env.MANGO_DENO;
  const previousRuntimes = process.env.MANGO_YTDLP_JS_RUNTIMES;
  delete process.env.MANGO_DENO;
  delete process.env.MANGO_YTDLP_JS_RUNTIMES;
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
    assert.equal(runtimes.length, 2);
    assert.match(runtimes[0], /^deno(?::.+)?$/);
    assert.equal(runtimes[1], 'node');
    assert.equal(args[args.indexOf('--socket-timeout') + 1], String(YOUTUBE_SOCKET_TIMEOUT_SEC));
    assert.equal(args.includes('--extractor-args'), false);
    assert.ok(args.includes('-g'));
    assert.match(YOUTUBE_FORMAT_SORT, /vcodec:vp9:vp9\.2/);
    assert.doesNotMatch(YOUTUBE_FORMAT_SORT, /hdr:12/);
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

test('yt-dlp resolve passes operator extractor-args only when set', () => {
  const previous = process.env.MANGO_YTDLP_EXTRACTOR_ARGS;
  process.env.MANGO_YTDLP_EXTRACTOR_ARGS = 'youtube:player_client=android_vr';
  try {
    const args = youtubeYtDlpResolveArgs({}, YOUTUBE_ADAPTIVE_FORMAT, 'dQw4w9wgGcQ');
    assert.equal(args[args.indexOf('--extractor-args') + 1], 'youtube:player_client=android_vr');
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_YTDLP_EXTRACTOR_ARGS;
    } else {
      process.env.MANGO_YTDLP_EXTRACTOR_ARGS = previous;
    }
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

test('YouTube refreshes only expired direct transports, not policy failures', () => {
  assert.equal(shouldRefreshYoutubeTransport('mpv-play failed: HTTP error 403'), true);
  assert.equal(shouldRefreshYoutubeTransport('signed URL expired'), true);
  assert.equal(shouldRefreshYoutubeTransport('mpv-play did not start playback'), true);
  assert.equal(shouldRefreshYoutubeTransport('YouTube is asking for browser verification — 429'), false);
  assert.equal(shouldRefreshYoutubeTransport('this YouTube video is unavailable'), false);
  assert.equal(shouldRefreshYoutubeTransport('play cancelled'), false);
});
