import assert from 'node:assert/strict';
import test from 'node:test';
import {
  couchPlayFailureMessage,
  couchSafeCatalogMessage,
  isBlockedCatalogMeta,
  isBlockedCatalogText,
  isAddonRateLimitMessage,
  isRateLimitedStreamUrl,
} from './catalog-errors.js';

test('isBlockedCatalogText catches rate-limit copy', () => {
  assert.equal(isBlockedCatalogText('Rate limit exceeded'), true);
  assert.equal(isBlockedCatalogText('rate-limit exceeded'), true);
  assert.equal(isBlockedCatalogText('Too many requests'), true);
  assert.equal(isBlockedCatalogText('Breaking Bad'), false);
});

test('isBlockedCatalogMeta rejects error metas', () => {
  assert.equal(isBlockedCatalogMeta({
    id: 'tt0111161',
    name: 'Rate limit exceeded',
    description: 'Please wait',
  }), true);
  assert.equal(isBlockedCatalogMeta({
    id: 'tt0111161',
    name: 'The Shawshank Redemption',
    description: 'Two imprisoned men bond over years.',
  }), false);
});

test('isAddonRateLimitMessage still matches HTTP-style errors', () => {
  assert.equal(isAddonRateLimitMessage('HTTP 429'), true);
  assert.equal(isAddonRateLimitMessage('catalog ok'), false);
});

test('isRateLimitedStreamUrl ignores opaque tokens containing 429 digits', () => {
  assert.equal(isRateLimitedStreamUrl('https://aio.example/rate-limit-exceeded'), true);
  assert.equal(
    isRateLimitedStreamUrl(
      'https://mediafusion.example/streaming_provider/D-abcRL429w3jsewvts/playback/file.mp4',
    ),
    false,
  );
});

test('couchPlayFailureMessage differentiates debrid transient and exhausted cases', () => {
  assert.equal(couchPlayFailureMessage([], { candidates: 0 }), 'no streams found for this title');
  assert.equal(
    couchPlayFailureMessage(
      [{ error: 'debrid_nfo_sidecar', debrid_service: 'torbox' }],
      { candidates: 3 },
    ),
    'stream not ready on TorBox — try again in a few minutes',
  );
  assert.equal(
    couchPlayFailureMessage(
      [
        { error: 'debrid_nfo_sidecar', debrid_service: 'torbox' },
        { error: 'debrid_status_clip', debrid_service: 'realdebrid' },
      ],
      { candidates: 4 },
    ),
    "couldn't find a ready stream right now — try again in a few minutes",
  );
  assert.equal(
    couchPlayFailureMessage(
      [
        { error: 'debrid_playback_unreadable', debrid_service: 'torbox' },
        { error: 'debrid_status_clip', debrid_service: 'torbox' },
      ],
      { candidates: 2 },
    ),
    'streams are still preparing — try again in a few minutes',
  );
  assert.equal(
    couchPlayFailureMessage(
      [{ error: 'debrid_copyright_block', debrid_service: 'realdebrid' }],
      { candidates: 2 },
    ),
    'streams are still preparing — try again in a few minutes',
  );
  assert.equal(
    couchPlayFailureMessage(
      [{ error: 'mpv-play failed: File was removed due to copyright infringement' }],
      { candidates: 1 },
    ),
    'streams are still preparing — try again in a few minutes',
  );
  assert.equal(
    couchPlayFailureMessage([{ error: 'mpv exited before playback started' }]),
    'stream did not start — try another option',
  );
});

test('couchSafeCatalogMessage keeps provider failures as catalog failures', () => {
  assert.equal(couchSafeCatalogMessage('AIOStreams: fetch failed'), 'catalog temporarily unavailable');
  assert.equal(couchSafeCatalogMessage('AIOStreams: timeout after 12000ms'), 'catalog timed out — try again');
});
