import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  defaultFilterConfig,
  filterStreamsForPlay,
  mergeFilterConfig,
  parseFilterOverridesFromQuery,
  selectAutoPlayCandidates,
  streamMatchesMetaTitle,
  streamUrlHash,
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

function candidate(
  source: string,
  service: string,
  cached: 'true' | 'false' | 'unknown',
  url: string,
): Stream {
  return {
    url,
    source,
    name: `${source} 1080p`,
    title: `${source} 1080p`,
    description: 'BluRay HEVC 1080p',
    behaviorHints: {
      bingeGroup: `com.aiostreams|${service}|${cached}|1080p`,
    },
  };
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

test('Indias Got Latent releases pass title relevance filter', () => {
  const iglStream = stream(
    "India's Got Latent S01E01 WEB-DL 1080p",
    'https://example.test/igl.mp4',
  );
  assert.equal(
    streamMatchesMetaTitle(iglStream, "India's Got Latent", 'tt33094114:1:1'),
    true,
  );
  const result = filterStreamsForPlay(
    [iglStream],
    testConfig(),
    { contentType: 'series', metaTitle: "India's Got Latent", metaId: 'tt33094114:1:1' },
  );
  assert.equal(result.streams.length, 1);
  assert.equal(result.meta.excluded.title_mismatch, 0);
});

test('selectAutoPlayCandidates honors configured tier order before score order', () => {
  const config = {
    ...testConfig(),
    auto_play_max_attempts: 5,
    auto_play_tiers: [
      { addons: ['AIOStreams'], require_cache: 'cached' as const, debrid_services: ['realdebrid'] },
      { addons: ['AIOStreams'], require_cache: 'cached' as const, debrid_services: ['torbox'] },
    ],
  };
  const torbox = candidate('AIOStreams | TorBox', 'torbox', 'true', 'https://example.test/tb.mp4');
  const rd = candidate('AIOStreams | RealDebrid', 'realdebrid', 'true', 'https://example.test/rd.mp4');
  const selected = selectAutoPlayCandidates([torbox, rd], config);
  assert.deepEqual(selected.map((item) => item.url), [rd.url, torbox.url]);
});

test('selectAutoPlayCandidates keeps standalone Torrentio out of default autoplay', () => {
  const config = testConfig();
  const selected = selectAutoPlayCandidates([
    candidate('Torrentio RD', 'realdebrid', 'true', 'https://example.test/torrentio.mp4'),
  ], config);
  assert.equal(selected.length, 0);
});

test('selectAutoPlayCandidates applies strict unknown cache inside cached_or_unknown tiers', () => {
  const strictConfig = {
    ...testConfig(),
    strict_unknown_cache: true,
    auto_play_tiers: [
      { addons: ['AIOStreams'], require_cache: 'cached_or_unknown' as const, debrid_services: ['torbox'] },
    ],
  };
  const looseConfig = {
    ...testConfig(),
    strict_unknown_cache: false,
    auto_play_tiers: [
      { addons: ['AIOStreams'], require_cache: 'cached_or_unknown' as const, debrid_services: ['torbox'] },
    ],
  };
  const unknown = candidate('AIOStreams | TorBox', 'torbox', 'unknown', 'https://example.test/unknown.mp4');
  assert.equal(selectAutoPlayCandidates([unknown], strictConfig).length, 0);
  assert.equal(selectAutoPlayCandidates([unknown], looseConfig).length, 1);
});

test('selectAutoPlayCandidates locks verified titles to the winning URL hash', () => {
  const config = testConfig();
  const winner = candidate('AIOStreams | TorBox', 'torbox', 'unknown', 'https://example.test/winner.mp4');
  const other = candidate('AIOStreams | TorBox', 'torbox', 'unknown', 'https://example.test/other.mp4');
  const selected = selectAutoPlayCandidates([other, winner], config, {
    verified_hint: {
      best_source: 'AIOStreams',
      cache_status: 'unknown',
      debrid_service: 'torbox',
      win_url_hash: streamUrlHash(winner.url),
      probe_ms: 2800,
    },
  });
  assert.deepEqual(selected.map((item) => item.url), [winner.url]);
  assert.equal(
    selectAutoPlayCandidates([other], config, {
      verified_hint: {
        best_source: 'AIOStreams',
        win_url_hash: streamUrlHash(winner.url),
      },
    }).length,
    0,
  );
});
