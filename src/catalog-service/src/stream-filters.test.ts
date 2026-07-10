import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  defaultFilterConfig,
  filterAndRankStreams,
  hasCacheableStream,
  isCacheableStream,
  mergeFilterConfig,
  parseDebridCacheStatus,
  parseFilterOverridesFromQuery,
  streamHardwareDecodeSmooth,
  streamMatchesMetaTitle,
  isSupplementalRelease,
  isPlausibleFeatureDuration,
  playMinDurationSec,
  parseRuntimeMinutes,
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

test('parseDebridCacheStatus reads current AIOStreams cache badges when bingeGroup is missing', () => {
  const torbox: Stream = {
    url: 'https://example.test/torbox.mp4',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 1080p',
    title: '[TB⚡] Torrentio 1080p',
  };
  const realDebrid: Stream = {
    url: 'https://example.test/rd.mp4',
    source: 'AIOStreams',
    name: '[RD✔] Torrentio 1080p',
    title: '[RD✔] Torrentio 1080p',
  };
  assert.equal(parseDebridCacheStatus(torbox), 'cached');
  assert.equal(parseDebridCacheStatus(realDebrid), 'cached');
});

test('parseDebridCacheStatus trusts explicit AIOStreams bingeGroup over display badge', () => {
  const uncached: Stream = {
    url: 'https://example.test/explicit-uncached.mp4',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 1080p',
    title: '[TB⚡] Torrentio 1080p',
    behaviorHints: {
      bingeGroup: 'com.aiostreams|torbox|false|1080p',
    },
  };
  assert.equal(parseDebridCacheStatus(uncached), 'uncached');
});

test('parseFilterOverridesFromQuery splits hard language from soft preference', () => {
  const overrides = parseFilterOverridesFromQuery(new URLSearchParams('language=Hindi&preferred_language=English'));
  assert.equal(overrides.hard_language, 'Hindi');
  assert.equal(overrides.preferred_language, 'English');
});

test('preferred_language boosts matching streams without excluding non-matches', () => {
  const config = testConfig({ preferred_language: 'Hindi' });
  const result = filterAndRankStreams(
    [englishStream, hindiStream],
    config,
    {},
    { preferred_language: config.preferred_language },
  );
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams[0]?.url, hindiStream.url);
  assert.equal(result.meta.excluded.language_mismatch, 0);
});

test('preferred_hdr_tags boosts HDR-capable 2160p streams without requiring HDR', () => {
  const sdr: Stream = {
    url: 'https://example.test/sdr.mkv',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p',
    title: '[TB⚡] Torrentio 2160p',
    description: 'WEB-DL 2160p HEVC',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const hdr: Stream = {
    url: 'https://example.test/hdr.mkv',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p',
    title: '[TB⚡] Torrentio 2160p',
    description: 'WEB-DL 2160p HEVC HDR10',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const config = {
    ...testConfig({ max_quality: '2160p' }),
    preferred_quality: '2160p' as const,
    preferred_hdr_tags: ['hdr10', 'hdr'],
  };
  const result = filterAndRankStreams([sdr, hdr], config);
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams[0]?.url, hdr.url);
});

test('preferred_hdr_tags does not boost DV-only streams unless configured', () => {
  const hdr10: Stream = {
    url: 'https://example.test/hdr10.mkv',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p',
    title: '[TB⚡] Torrentio 2160p',
    description: 'WEB-DL 2160p HEVC HDR10',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const dv: Stream = {
    url: 'https://example.test/dv.mkv',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p',
    title: '[TB⚡] Torrentio 2160p',
    description: 'WEB-DL 2160p HEVC DV',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const config = {
    ...testConfig({ max_quality: '2160p' }),
    preferred_quality: '2160p' as const,
    preferred_hdr_tags: ['hdr10', 'hdr'],
  };
  const result = filterAndRankStreams([dv, hdr10], config);
  assert.equal(result.streams[0]?.url, hdr10.url);
});

test('preferred_video_codecs boosts 2160p HEVC over CPU-hostile AVC', () => {
  const avc: Stream = {
    url: 'https://example.test/avc.mkv',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p',
    title: '[TB⚡] Torrentio 2160p',
    description: 'WEB-DL 2160p AVC',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const hevc: Stream = {
    url: 'https://example.test/hevc.mkv',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p',
    title: '[TB⚡] Torrentio 2160p',
    description: 'WEB-DL 2160p HEVC',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const config = {
    ...testConfig({ max_quality: '2160p' }),
    preferred_quality: '2160p' as const,
    preferred_video_codecs: ['hevc', 'x265', 'h265'],
  };
  const result = filterAndRankStreams([avc, hevc], config);
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams[0]?.url, hevc.url);
});

test('streamHardwareDecodeSmooth: HEVC any-res smooth, non-HEVC only <=1080p', () => {
  const hevc4k: Stream = {
    url: 'https://example.test/hevc4k.mkv', source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p', title: '[TB⚡] Torrentio 2160p', description: 'WEB-DL 2160p HEVC',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const av14k: Stream = {
    url: 'https://example.test/av14k.mkv', source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p', title: '[TB⚡] Torrentio 2160p', description: 'WEB-DL 2160p AV1',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const avc1080: Stream = {
    url: 'https://example.test/avc1080.mkv', source: 'AIOStreams',
    name: '[TB⚡] Torrentio 1080p', title: '[TB⚡] Torrentio 1080p', description: 'WEB-DL 1080p AVC',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|1080p' },
  };
  const unknownRes: Stream = {
    url: 'https://example.test/unknown.mkv', source: 'AIOStreams',
    name: 'Torrentio', title: 'Torrentio', description: 'WEB-DL AV1',
  };
  assert.equal(streamHardwareDecodeSmooth(hevc4k), true);
  assert.equal(streamHardwareDecodeSmooth(av14k), false);
  assert.equal(streamHardwareDecodeSmooth(avc1080), true);
  assert.equal(streamHardwareDecodeSmooth(unknownRes), true);
});

test('hardware-decode tiebreak ranks 4K HEVC over 4K AV1 with no preferred codec set', () => {
  const av14k: Stream = {
    url: 'https://example.test/av14k.mkv', source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p', title: '[TB⚡] Torrentio 2160p', description: 'WEB-DL 2160p AV1',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const hevc4k: Stream = {
    url: 'https://example.test/hevc4k.mkv', source: 'AIOStreams',
    name: '[TB⚡] Torrentio 2160p', title: '[TB⚡] Torrentio 2160p', description: 'WEB-DL 2160p HEVC',
    behaviorHints: { bingeGroup: 'com.aiostreams|torbox|true|2160p' },
  };
  const config = {
    ...testConfig({ max_quality: '2160p' }),
    preferred_quality: '2160p' as const,
    preferred_video_codecs: [] as string[],
  };
  const result = filterAndRankStreams([av14k, hevc4k], config);
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams[0]?.url, hevc4k.url);
});

test('hard_language excludes non-matching streams', () => {
  const result = filterAndRankStreams(
    [englishStream, hindiStream],
    testConfig({ hard_language: 'Hindi' }),
    {},
    { hard_language: 'Hindi' },
  );
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0]?.url, hindiStream.url);
  assert.equal(result.meta.excluded.language_mismatch, 1);
});

test('hard_language does not match arbitrary haystack text when languages are parsed', () => {
  const result = filterAndRankStreams(
    [
      stream(`🎥 BluRay 🎞️ HEVC 🏷️ SM737
📦 8.98 GB
🌐 🇬🇧
Subtitles: Klingon`, 'https://example.test/subtitle-noise.mp4'),
    ],
    testConfig({ hard_language: 'Klingon' }),
    {},
    { hard_language: 'Klingon' },
  );
  assert.equal(result.streams.length, 0);
  assert.equal(result.meta.excluded.language_mismatch, 1);
});

test('Indias Got Latent releases pass title relevance filter', () => {
  const iglStream = stream(
    "India's Got Latent S01E01 WEB-DL 1080p",
    'https://example.test/igl.mp4',
  );
  assert.equal(
    streamMatchesMetaTitle(iglStream, "India's Got Latent", 'tt33094114:1:1'),
    true,
  );
  const result = filterAndRankStreams(
    [iglStream],
    testConfig(),
    { contentType: 'series', metaTitle: "India's Got Latent", metaId: 'tt33094114:1:1' },
  );
  assert.equal(result.streams.length, 1);
  assert.equal(result.meta.excluded.title_mismatch, 0);
});

test('isSupplementalRelease drops BTS and featurette labels for movies', () => {
  assert.equal(isSupplementalRelease(stream('Behind the Scenes', 'https://example.test/bts.mp4'), 'movie'), true);
  assert.equal(isSupplementalRelease(stream('Featurette: Making Of', 'https://example.test/ft.mp4'), 'movie'), true);
  assert.equal(isSupplementalRelease(stream('1080p BluRay', 'https://example.test/main.mp4'), 'movie'), false);
});

test('isSupplementalRelease keeps bonus-labeled series torrents (indexer mislabels)', () => {
  const iglBonus = stream('Igl Bonus E01 WEB-DL 1080p', 'https://example.test/igl-bonus.mp4');
  assert.equal(isSupplementalRelease(iglBonus, 'series'), false);
  assert.equal(isSupplementalRelease(iglBonus, 'movie'), true);
});

test('isPlausibleFeatureDuration rejects short probes for movies', () => {
  assert.equal(parseRuntimeMinutes('2h30min'), 150);
  assert.equal(isPlausibleFeatureDuration(12, 'movie', 150), false);
  assert.equal(isPlausibleFeatureDuration(120, 'movie', 150), true);
  assert.equal(isPlausibleFeatureDuration(45, 'movie', null), true);
});

test('isPlausibleFeatureDuration allows short bonus clips', () => {
  assert.equal(isPlausibleFeatureDuration(3, 'series', null, { episodeRole: 'bonus' }), true);
  assert.equal(isPlausibleFeatureDuration(0.4, 'series', null, { episodeRole: 'bonus' }), false);
  assert.equal(isPlausibleFeatureDuration(3, 'series', null), false);
});

test('playMinDurationSec is lower for bonus than main series or movies', () => {
  assert.equal(playMinDurationSec({ contentType: 'series', episodeRole: 'bonus' }), 30);
  assert.equal(playMinDurationSec({ contentType: 'series', episodeRole: 'main' }), 120);
  assert.equal(playMinDurationSec({ contentType: 'movie' }), 600);
});

test('movie filename integrity rejects mislabeled torrent descriptions', () => {
  const mislabeled: Stream = {
    url: 'https://example.test/bad.mkv',
    source: 'AIOStreams',
    name: '[TB☁️⚡] Torrentio 1080p',
    title: '[TB☁️⚡] Torrentio 1080p',
    description: '📁 The Shawshank Redemption (1994)\n🎥 BluRay 🎞️ HEVC',
    behaviorHints: { filename: '3x2 a New Conversation.mkv', videoSize: 460_000_000 },
    size_gb: 0.45,
  };
  const good: Stream = {
    ...mislabeled,
    url: 'https://example.test/good.mkv',
    behaviorHints: {
      filename: 'The.Shawshank.Redemption.1994.1080p.BluRay.x265.mkv',
      videoSize: 9_000_000_000,
    },
    size_gb: 9,
  };
  assert.equal(
    streamMatchesMetaTitle(mislabeled, 'The Shawshank Redemption', 'tt0111161', { contentType: 'movie' }),
    false,
  );
  assert.equal(
    streamMatchesMetaTitle(good, 'The Shawshank Redemption', 'tt0111161', { contentType: 'movie' }),
    true,
  );
  const result = filterAndRankStreams(
    [mislabeled, good],
    testConfig({ exclude_uncached_debrid: false }),
    { contentType: 'movie', metaTitle: 'The Shawshank Redemption', metaId: 'tt0111161', metaRuntimeMinutes: 142 },
  );
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0]?.url, good.url);
});

test('isCacheableStream rejects rate-limit placeholders', () => {
  const good = stream('BluRay 1080p', 'https://example.test/play.mp4');
  const rateLimitUrl = stream('rate limit', 'https://aiostreams.example/rate-limit-exceeded');
  const errorLabel = stream('rate limit exceeded', 'https://example.test/placeholder.mp4');
  assert.equal(isCacheableStream(good), true);
  assert.equal(isCacheableStream(rateLimitUrl), false);
  assert.equal(isCacheableStream(errorLabel), false);
  assert.equal(hasCacheableStream([errorLabel, rateLimitUrl]), false);
  assert.equal(hasCacheableStream([errorLabel, good]), true);
});
