import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPlayError,
  garbageKind,
  isGarbagePlayError,
  isTransientPlayError,
} from './play-error-classify.js';

test('classifyPlayError maps each class', () => {
  assert.equal(classifyPlayError('play cancelled'), 'cancelled');
  assert.equal(classifyPlayError('play epoch mismatch'), 'cancelled');
  assert.equal(classifyPlayError('PlayCancelledError'), 'cancelled');

  assert.equal(classifyPlayError('debrid_nfo_sidecar'), 'garbage');
  assert.equal(classifyPlayError('mpv-play failed: debrid_copyright_block'), 'garbage');
  assert.equal(classifyPlayError('debrid_status_clip duration=12'), 'garbage');

  assert.equal(classifyPlayError('rate limit exceeded'), 'rate_limited');
  assert.equal(classifyPlayError('HTTP 429 Too Many Requests'), 'rate_limited');
  assert.equal(classifyPlayError('https://aio/rate-limit-exceeded'), 'rate_limited');

  assert.equal(classifyPlayError('no_playable_stream'), 'no_stream');
  assert.equal(classifyPlayError('no HTTP streams for movie/tt1'), 'no_stream');

  assert.equal(classifyPlayError('debrid_playback_unreadable'), 'transient');
  assert.equal(classifyPlayError('preflight timeout'), 'transient');
  assert.equal(classifyPlayError('vo not ready'), 'transient');
  assert.equal(classifyPlayError('play budget exhausted'), 'transient');
  assert.equal(classifyPlayError('ECONNRESET'), 'transient');
  assert.equal(classifyPlayError('HTTP 503'), 'transient');
  assert.equal(classifyPlayError('supplemental_or_short_release'), 'transient');
  assert.equal(classifyPlayError('no error detail captured'), 'transient');
  assert.equal(classifyPlayError('stream_url_bad_cached'), 'transient');

  assert.equal(classifyPlayError('mpv-play failed: HTTP error 403'), 'unknown');
  assert.equal(classifyPlayError(''), 'unknown');
});

test('cancelled wins over garbage when both appear', () => {
  assert.equal(
    classifyPlayError('play cancelled after debrid_nfo_sidecar'),
    'cancelled',
  );
});

test('garbage wins over transient when both appear', () => {
  assert.equal(
    classifyPlayError('debrid_status_clip then timeout'),
    'garbage',
  );
  assert.equal(
    classifyPlayError('debrid_nfo_sidecar timeout'),
    'garbage',
  );
});

test('debrid_playback_unreadable is transient not garbage', () => {
  assert.equal(classifyPlayError('debrid_playback_unreadable'), 'transient');
  assert.equal(isGarbagePlayError('debrid_playback_unreadable'), false);
  assert.equal(isTransientPlayError('debrid_playback_unreadable'), true);
  assert.equal(garbageKind('debrid_playback_unreadable'), null);
});

test('isGarbagePlayError / isTransientPlayError helpers', () => {
  assert.equal(isGarbagePlayError('debrid_copyright_block'), true);
  assert.equal(isGarbagePlayError('timeout'), false);
  assert.equal(isTransientPlayError('timed out'), true);
  assert.equal(isTransientPlayError('debrid_nfo_sidecar'), false);
});

test('garbageKind differentiates nfo / copyright / status_clip', () => {
  assert.equal(garbageKind('debrid_nfo_sidecar'), 'nfo');
  assert.equal(garbageKind('FAIL: debrid_copyright_block'), 'copyright');
  assert.equal(garbageKind('debrid_status_clip'), 'status_clip');
  assert.equal(garbageKind('timeout'), null);
});
