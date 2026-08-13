import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyYtDlpError,
  effectiveYoutubeFormat,
  isMuxedOnlyYoutubeFormat,
  parseYtDlpResolvedUrls,
  preferAdaptiveYoutubeFormat,
  shouldRefreshYoutubeTransport,
  YOUTUBE_ADAPTIVE_FORMAT,
  YOUTUBE_COMPAT_ADAPTIVE_FORMAT,
  YOUTUBE_EXTRACTOR_ARGS,
  YOUTUBE_FORMAT_SORT,
  YOUTUBE_MUXED_FORMAT,
  youtubeYtDlpResolveArgs,
  ytDlpFormatCandidates,
} from './playback.js';

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

test('ytDlpFormatCandidates never prefers muxed progressive over adaptive', () => {
  for (const configured of [
    'best',
    'best[height<=1080]/best',
    'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    'bv*[height<=720]+ba/b',
  ]) {
    const formats = ytDlpFormatCandidates(configured);
    assert.equal(formats.includes(YOUTUBE_MUXED_FORMAT), true);
    assert.ok(!isMuxedOnlyYoutubeFormat(formats[0] || ''));
    assert.ok((formats[0] || '').includes('+'));
    assert.ok(formats.indexOf(YOUTUBE_MUXED_FORMAT) > 0);
  }
});

test('a tighter operator cap does not fall through to 1080p H.264', () => {
  const formats = ytDlpFormatCandidates('bv*[height<=720]+ba/b');
  assert.deepEqual(formats, ['bv*[height<=720]+ba', YOUTUBE_MUXED_FORMAT]);
});

test('ytDlpFormatCandidates keeps configured format first and de-dupes fallbacks', () => {
  const formats = ytDlpFormatCandidates('best');
  assert.equal(formats[0], YOUTUBE_ADAPTIVE_FORMAT);
  assert.equal(formats.filter((format) => format === YOUTUBE_ADAPTIVE_FORMAT).length, 1);
  assert.deepEqual(formats, [
    YOUTUBE_ADAPTIVE_FORMAT,
    YOUTUBE_COMPAT_ADAPTIVE_FORMAT,
    YOUTUBE_MUXED_FORMAT,
  ]);
});

test('ytDlpFormatCandidates advances past an already failed transport format', () => {
  const formats = ytDlpFormatCandidates(YOUTUBE_ADAPTIVE_FORMAT, [YOUTUBE_ADAPTIVE_FORMAT]);
  assert.equal(formats.includes(YOUTUBE_ADAPTIVE_FORMAT), false);
  assert.equal(formats[0], YOUTUBE_COMPAT_ADAPTIVE_FORMAT);
  assert.equal(formats.at(-1), YOUTUBE_MUXED_FORMAT);
});

test('yt-dlp resolve sorts by resolution and uses non-SABR player clients', () => {
  const args = youtubeYtDlpResolveArgs({}, YOUTUBE_ADAPTIVE_FORMAT, 'dQw4w9wgGcQ');
  assert.equal(args[args.indexOf('-f') + 1], YOUTUBE_ADAPTIVE_FORMAT);
  assert.equal(args[args.indexOf('--format-sort') + 1], YOUTUBE_FORMAT_SORT);
  assert.equal(args[args.indexOf('--extractor-args') + 1], YOUTUBE_EXTRACTOR_ARGS);
  assert.ok(args.includes('-g'));
});

test('classifyYtDlpError does not call requested format failure a removed video', () => {
  assert.deepEqual(
    classifyYtDlpError('ERROR: Requested format is not available. Use --list-formats for a list of available formats'),
    {
      status: 502,
      message: 'YouTube playback format unavailable — try another YouTube video',
    },
  );
});

test('YouTube refreshes only expired direct transports, not policy failures', () => {
  assert.equal(shouldRefreshYoutubeTransport('mpv-play failed: HTTP error 403'), true);
  assert.equal(shouldRefreshYoutubeTransport('signed URL expired'), true);
  assert.equal(shouldRefreshYoutubeTransport('mpv-play did not start playback'), true);
  assert.equal(shouldRefreshYoutubeTransport('YouTube is asking for browser verification — 429'), false);
  assert.equal(shouldRefreshYoutubeTransport('this YouTube video is unavailable'), false);
  assert.equal(shouldRefreshYoutubeTransport('play cancelled'), false);
});
