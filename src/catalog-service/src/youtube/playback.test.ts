import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyYtDlpError,
  parseYtDlpResolvedUrls,
  shouldRefreshYoutubeTransport,
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

test('ytDlpFormatCandidates keeps configured format first and de-dupes fallbacks', () => {
  const formats = ytDlpFormatCandidates('best');
  assert.equal(formats[0], 'best');
  assert.equal(formats.filter((format) => format === 'best').length, 1);
  assert.ok(formats.includes('bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'));
});

test('ytDlpFormatCandidates advances past an already failed transport format', () => {
  const configured = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
  const formats = ytDlpFormatCandidates(configured, [configured]);
  assert.equal(formats.includes(configured), false);
  assert.equal(formats[0], 'best[height<=1080]/best');
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
