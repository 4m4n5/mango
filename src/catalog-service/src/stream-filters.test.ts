import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  defaultFilterConfig,
  filterStreamsForPlay,
  mergeFilterConfig,
  parseFilterOverridesFromQuery,
} from './stream-filters.js';

function stream(description: string, url: string): Stream {
  return {
    url,
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 1080p',
    title: '[TB⚡] Torrentio 1080p',
    description,
    behaviorHints: {
      bingeGroup: 'com.aiostreams|torbox|true|1080p',
    },
  };
}

const englishStream = stream(`🎥 BluRay 🎞️ HEVC 🏷️ SM737
📦 8.98 GB
🌐 🇬🇧`, 'https://example.test/english.mp4');

const hindiStream = stream(`🎥 BluRay 🎞️ HEVC 🏷️ LAMA
📦 3.02 GB
🌐 🇮🇳 / 🇬🇧`, 'https://example.test/hindi.mp4');

function testConfig(overrides = {}) {
  return mergeFilterConfig({
    ...defaultFilterConfig(),
    exclude_uncached_debrid: false,
    strict_unknown_cache: false,
    exclude_remux: false,
    max_quality: '1080p',
    stream_display_limit: 8,
  }, overrides);
}

test('parseFilterOverridesFromQuery splits hard language from soft preference', () => {
  const overrides = parseFilterOverridesFromQuery(new URLSearchParams('language=Hindi&preferred_language=English'));
  assert.equal(overrides.hard_language, 'Hindi');
  assert.equal(overrides.preferred_language, 'English');
});

test('preferred_language boosts matching streams without excluding non-matches', () => {
  const result = filterStreamsForPlay(
    [englishStream, hindiStream],
    testConfig({ preferred_language: 'Hindi' }),
  );
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams[0]?.url, hindiStream.url);
  assert.equal(result.meta.excluded.language_mismatch, 0);
});

test('hard_language excludes non-matching streams', () => {
  const result = filterStreamsForPlay(
    [englishStream, hindiStream],
    testConfig({ hard_language: 'Hindi' }),
  );
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0]?.url, hindiStream.url);
  assert.equal(result.meta.excluded.language_mismatch, 1);
});

test('hard_language does not match arbitrary haystack text when languages are parsed', () => {
  const result = filterStreamsForPlay(
    [
      stream(`🎥 BluRay 🎞️ HEVC 🏷️ SM737
📦 8.98 GB
🌐 🇬🇧
Subtitles: Klingon`, 'https://example.test/subtitle-noise.mp4'),
    ],
    testConfig({ hard_language: 'Klingon' }),
  );
  assert.equal(result.streams.length, 0);
  assert.equal(result.meta.excluded.language_mismatch, 1);
});

test('title relaxation keeps hard_language filter', () => {
  const result = filterStreamsForPlay(
    [englishStream, hindiStream],
    testConfig({ hard_language: 'Hindi' }),
    { metaTitle: 'The Shawshank Redemption', metaId: 'tt0111161' },
  );
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0]?.url, hindiStream.url);
  assert.equal(result.meta.title_filter_relaxed, true);
});
