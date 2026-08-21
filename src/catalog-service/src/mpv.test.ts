import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMpvFailureReason, parseMpvSuccessOutput } from './mpv.js';

test('extractMpvFailureReason prefers the wrapper FAIL line over the invocation header', () => {
  const stdout = 'mpv-play: http(s)://example.test/<redacted> mode=play backend=mpv live=false timeout_ms=85019 min_duration_sec=600 hwdec=auto-safe audio=default video=unknown';
  const stderr = 'FAIL: mpv did not start playback within 85019ms';

  const reason = extractMpvFailureReason(stdout, stderr, 1);

  assert.equal(reason, 'mpv did not start playback within 85019ms');
});

test('extractMpvFailureReason finds FAIL line even when it is mixed with other stderr noise', () => {
  const stdout = 'mpv-play: http(s)://example.test/<redacted> mode=play backend=mpv';
  const stderr = 'handoff: ready_ms=1200\nFAIL: debrid_copyright_block';

  const reason = extractMpvFailureReason(stdout, stderr, 1);

  assert.equal(reason, 'debrid_copyright_block');
});

test('extractMpvFailureReason never falls back to the invocation header line', () => {
  const stdout = 'mpv-play: http(s)://example.test/<redacted> mode=play backend=mpv timeout_ms=85019';
  const stderr = '';

  const reason = extractMpvFailureReason(stdout, stderr, 1);

  assert.doesNotMatch(reason, /mode=play/);
  assert.doesNotMatch(reason, /timeout_ms=/);
});

test('extractMpvFailureReason falls back to a labeled unknown reason when nothing was captured', () => {
  const reason = extractMpvFailureReason('', '', 137);

  assert.equal(reason, 'no error detail captured (exit 137)');
});

test('S4: structured probe output preserves duration before teardown', () => {
  assert.deepEqual(
    parseMpvSuccessOutput('PASS: ttff_ms=321 duration_sec=720.5 failure_class=none', 999),
    { ok: true, ttff_ms: 321, duration_sec: 720.5 },
  );
});

test('parseMpvSuccessOutput ignores min_duration_sec preamble (not real duration)', () => {
  const output = [
    'mpv-play: http(s)://example.test/<redacted> mode=probe backend=mpv live=false timeout_ms=10000 min_duration_sec=600 hwdec=auto-safe audio=default video=unknown',
    'PASS: ttff_ms=3982 duration_sec=8552.744 failure_class=none',
  ].join('\n');
  assert.deepEqual(parseMpvSuccessOutput(output, 999), {
    ok: true,
    ttff_ms: 3982,
    duration_sec: 8552.744,
  });
});

test('parseMpvSuccessOutput decodes structured technical proof', () => {
  const technical = {
    width: 3840,
    height: 2160,
    fps: 23.976,
    codec: 'hevc',
    hwdec: 'drm',
    hdr: true,
    color_transfer: 'smpte2084',
    bitrate_bps: 19620000,
  };
  const encoded = Buffer.from(JSON.stringify(technical)).toString('base64url');
  assert.deepEqual(
    parseMpvSuccessOutput(
      `PASS: ttff_ms=410 duration_sec=1420 technical_b64=${encoded} failure_class=none`,
      999,
    ),
    {
      ok: true,
      ttff_ms: 410,
      duration_sec: 1420,
      technical,
    },
  );
});
