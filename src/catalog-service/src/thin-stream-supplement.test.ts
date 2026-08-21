import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  countCacheableStreams,
  isMediaFusionAddon,
  mediaFusionStreamUrl,
  mergeUniqueStreams,
  notesIndicatePrimaryHardTimeout,
  shouldSkipThinSupplementAfterPrimaryTimeout,
  shouldSupplementThinStreams,
} from './thin-stream-supplement.js';
import { selectDisplayStreamCandidates } from './play-ladder.js';

function stream(url: string, name = 'ok'): Stream {
  return { url, name, source: 'test' };
}

test('shouldSupplementThinStreams when ≤1 cacheable and no direct MF', () => {
  assert.equal(
    shouldSupplementThinStreams([stream('https://a.test/1')], { hasDirectMediaFusion: false }),
    true,
  );
  assert.equal(
    shouldSupplementThinStreams([], { hasDirectMediaFusion: false }),
    true,
  );
  assert.equal(
    shouldSupplementThinStreams(
      [stream('https://a.test/1'), stream('https://a.test/2')],
      { hasDirectMediaFusion: false },
    ),
    false,
  );
  assert.equal(
    shouldSupplementThinStreams([stream('https://a.test/1')], { hasDirectMediaFusion: true }),
    false,
  );
});

test('countCacheableStreams ignores rate-limit placeholders', () => {
  assert.equal(
    countCacheableStreams([
      stream('https://aiostreams.example/rate-limit-exceeded', 'rate limit'),
      stream('https://ok.test/v.mkv'),
    ]),
    1,
  );
});

test('isMediaFusionAddon matches name or URL', () => {
  assert.equal(isMediaFusionAddon('MediaFusion', 'https://x.test/manifest.json'), true);
  assert.equal(isMediaFusionAddon('AIO', 'https://mediafusion.example/manifest.json'), true);
  assert.equal(isMediaFusionAddon('AIOStreams', 'https://aio.example/manifest.json'), false);
});

test('mediaFusionStreamUrl builds stream resource path', () => {
  const url = mediaFusionStreamUrl(
    'https://mf.example/abc/manifest.json',
    'movie',
    'tt32916440',
  );
  assert.equal(url, 'https://mf.example/abc/stream/movie/tt32916440.json');
});

test('mergeUniqueStreams dedupes by URL', () => {
  const merged = mergeUniqueStreams(
    [stream('https://a.test/1')],
    [stream('https://a.test/1'), stream('https://a.test/2')],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[1]?.url, 'https://a.test/2');
});

test('shouldSkipThinSupplementAfterPrimaryTimeout only when empty + hard timeout', () => {
  assert.equal(
    shouldSkipThinSupplementAfterPrimaryTimeout(
      [],
      [{ message: 'AIOStreams: timeout after 12000ms' }],
    ),
    true,
  );
  assert.equal(
    notesIndicatePrimaryHardTimeout([{ message: 'AIOStreams: timeout after 30000ms' }]),
    true,
  );
  assert.equal(
    shouldSkipThinSupplementAfterPrimaryTimeout(
      [stream('https://ok.test/v.mkv')],
      [{ message: 'AIOStreams: timeout after 12000ms' }],
    ),
    false,
  );
  assert.equal(
    shouldSkipThinSupplementAfterPrimaryTimeout(
      [],
      [{ message: 'AIOStreams: HTTP 502' }],
    ),
    false,
  );
});

test('S3: thin supplement with unknown metadata cannot enter a verified 4K step', () => {
  const thin = stream('https://mf.test/unknown.mkv', '[TB☁️⚡] MediaFusion');
  const merged = mergeUniqueStreams([], [thin]);
  const selected = selectDisplayStreamCandidates(merged, [{
    step: '4k_verified',
    max_quality: '2160p',
    min_quality: '2160p',
    exclude_remux: false,
    require_hevc: true,
    require_cache: 'cached',
    verified: true,
    addons: ['test'],
  }]);
  assert.notEqual(selected.source, 'preference_ladder');
  assert.ok(!selected.candidates.some((candidate) => candidate.ladder_step === '4k_verified'));
});
