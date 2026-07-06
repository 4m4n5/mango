import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  defaultPlayLadder,
  expandPlayLadder,
  injectPreferredPlayCandidate,
  parsePlayLadder,
  streamMatchesLadderStep,
} from './play-ladder.js';
import { streamUrlHash } from './stream-filters.js';

function stream(partial: Partial<Stream> & { url: string }): Stream {
  return {
    source: 'AIOStreams',
    name: partial.name ?? '[TB☁️⚡] Torrentio 1080p',
    title: partial.title ?? '',
    description: partial.description ?? '',
    ...partial,
  };
}

test('parsePlayLadder falls back to default when config empty', () => {
  const ladder = parsePlayLadder([]);
  assert.equal(ladder.length, defaultPlayLadder().length);
  assert.equal(ladder[0]?.step, 'ideal');
});

test('streamMatchesLadderStep rejects uncached streams on ideal step', () => {
  const ideal = defaultPlayLadder()[0];
  const cached = stream({
    url: 'https://example.test/cached.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const uncached = stream({
    url: 'https://example.test/uncached.mkv',
    name: '[TB⚡] Torrentio 1080p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|false|1080p' },
  });
  assert.equal(streamMatchesLadderStep(cached, ideal), true);
  assert.equal(streamMatchesLadderStep(uncached, ideal), false);
});

test('streamMatchesLadderStep rejects 1440p when capped to 1080p', () => {
  const safe1080 = {
    ...defaultPlayLadder()[0],
    max_quality: '1080p' as const,
  };
  const highResolution = stream({
    url: 'https://example.test/1440p.mkv',
    name: '[TB⚡] Torrentio 1440p',
    title: '[TB⚡] Torrentio 1440p',
    description: 'WEB-DL HEVC 1440p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1440p' },
  });

  assert.equal(streamMatchesLadderStep(highResolution, safe1080), false);
});

test('streamMatchesLadderStep honors min_quality for 4k-only steps', () => {
  const fourKOnly = {
    ...defaultPlayLadder()[0],
    step: '4k_hevc_cached',
    max_quality: '2160p' as const,
    min_quality: '2160p' as const,
  };
  const hd = stream({
    url: 'https://example.test/1080p.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const uhd = stream({
    url: 'https://example.test/2160p.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });

  assert.equal(streamMatchesLadderStep(hd, fourKOnly), false);
  assert.equal(streamMatchesLadderStep(uhd, fourKOnly), true);
});

test('streamMatchesLadderStep rejects non-HEVC above 1080p when require_hevc is set', () => {
  const fourKHevcOnly = {
    ...defaultPlayLadder()[0],
    step: '4k_hevc_remux_cached',
    max_quality: '2160p' as const,
    min_quality: '2160p' as const,
    exclude_remux: false,
    require_hevc: true,
  };
  const uhdHevc = stream({
    url: 'https://example.test/2160p-hevc.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p REMUX HEVC BL+RPU HDR10',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const uhdAv1 = stream({
    url: 'https://example.test/2160p-av1.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL AV1 10bit',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const uhdH264 = stream({
    url: 'https://example.test/2160p-h264.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p REMUX AVC h264',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });

  assert.equal(streamMatchesLadderStep(uhdHevc, fourKHevcOnly), true);
  assert.equal(streamMatchesLadderStep(uhdAv1, fourKHevcOnly), false);
  assert.equal(streamMatchesLadderStep(uhdH264, fourKHevcOnly), false);
});

test('streamMatchesLadderStep allows non-HEVC at 1080p even when require_hevc is set', () => {
  const step = {
    ...defaultPlayLadder()[0],
    step: '1080p_any_codec',
    max_quality: '1080p' as const,
    require_hevc: true,
  };
  const hd264 = stream({
    url: 'https://example.test/1080p-h264.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: '1080p BluRay x264',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });

  assert.equal(streamMatchesLadderStep(hd264, step), true);
});

test('parsePlayLadder reads require_hevc flag', () => {
  const ladder = parsePlayLadder([
    { step: 'four_k', max_quality: '2160p', require_hevc: true, require_cache: 'cached' },
    { step: 'ten_eighty', max_quality: '1080p', require_cache: 'cached' },
  ]);
  assert.equal(ladder[0]?.require_hevc, true);
  assert.equal(ladder[1]?.require_hevc, false);
});

test('streamMatchesLadderStep drops HDR above 1080p when exclude_hdr is set', () => {
  const sdr4kStep = {
    ...defaultPlayLadder()[0],
    step: '4k_sdr_cached',
    max_quality: '2160p' as const,
    min_quality: '2160p' as const,
    exclude_remux: false,
    require_hevc: true,
    exclude_hdr: true,
  };
  const uhdSdr = stream({
    url: 'https://example.test/2160p-sdr.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p REMUX HEVC SDR',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const uhdHdr = stream({
    url: 'https://example.test/2160p-hdr.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p REMUX HEVC HDR10 DV',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });

  assert.equal(streamMatchesLadderStep(uhdSdr, sdr4kStep), true);
  assert.equal(streamMatchesLadderStep(uhdHdr, sdr4kStep), false);
});

test('streamMatchesLadderStep allows HDR at 1080p even when exclude_hdr is set', () => {
  const step = {
    ...defaultPlayLadder()[0],
    step: '1080p_hdr_ok',
    max_quality: '1080p' as const,
    exclude_hdr: true,
  };
  const hdHdr = stream({
    url: 'https://example.test/1080p-hdr.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: '1080p BluRay x265 HDR10',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });

  assert.equal(streamMatchesLadderStep(hdHdr, step), true);
});

test('expandPlayLadder returns empty when only HDR 4K streams exist on SDR-only ladder', () => {
  const ladder = parsePlayLadder([
    {
      step: '4k_sdr_remux_cached',
      max_quality: '2160p',
      min_quality: '2160p',
      exclude_remux: false,
      require_hevc: true,
      exclude_hdr: true,
      require_cache: 'cached',
    },
    {
      step: '1080p_uncached_fallback',
      max_quality: '1080p',
      exclude_remux: true,
      require_cache: 'cached_or_uncached',
    },
  ]);
  const hdrRemux = stream({
    url: 'https://example.test/dark-knight.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p BluRay HEVC DV HDR10 REMUX',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const ranked = expandPlayLadder([hdrRemux], ladder, { contentType: 'movie' }, {
    strict_unknown_cache: true,
  });
  assert.equal(ranked.length, 0);
});

test('expandPlayLadder walks steps after ideal failures', () => {
  const ladder = defaultPlayLadder();
  const streams = [
    stream({
      url: 'https://example.test/bad.mkv',
      name: '[TB☁️⚡] Torrentio 1080p',
      description: 'SM737 x265',
    }),
    stream({
      url: 'https://example.test/good.mkv',
      name: '[TB⚡] Torrentio 2160p',
      description: 'IAMABLE x265 encode',
      behaviorHints: { bingeGroup: 'aiostreams|torbox|false|2160p' },
    }),
  ];

  const ranked = expandPlayLadder(streams, ladder, { contentType: 'movie' }, {
    max_candidates: 6,
  });

  assert.ok(ranked.some((item) => item.ladder_step === 'ideal'));
  assert.ok(ranked.some((item) => item.ladder_step === '2160p_encode'));
});

test('expandPlayLadder can exclude uncached candidates for durable verification', () => {
  const ladder = defaultPlayLadder();
  const cached = stream({
    url: 'https://example.test/cached.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const uncached = stream({
    url: 'https://example.test/uncached.mkv',
    name: '[TB⚡] Torrentio 2160p',
    description: '2160p HEVC encode',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|false|2160p' },
  });

  const ranked = expandPlayLadder([uncached, cached], ladder, { contentType: 'movie' }, {
    include_uncached: false,
    max_candidates: 6,
  });

  assert.deepEqual(ranked.map((item) => item.stream.url), [cached.url]);
  assert.equal(ranked[0]?.ladder_step, 'ideal');
});

test('expandPlayLadder prefers picker win_url_hash on ideal step', () => {
  const ladder = defaultPlayLadder();
  const picked = stream({
    url: 'https://example.test/picked.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: 'FLUX x265',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const other = stream({
    url: 'https://example.test/other.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: 'SM737 x265',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });

  const ranked = expandPlayLadder([other, picked], ladder, { contentType: 'movie' }, {
    verified_hint: { win_url_hash: streamUrlHash(picked.url), win_ladder_step: 'ideal' },
    prefer_ladder_step: 'ideal',
    max_candidates: 4,
  });

  assert.equal(ranked[0]?.stream.url, picked.url);
  assert.equal(ranked[0]?.ladder_step, 'ideal');
});

test('injectPreferredPlayCandidate forces a picker URL ahead of ladder expansion', () => {
  const picked = stream({
    url: 'https://example.test/picked-4k.mkv',
    name: '[TB⚡] Torrentio 2160p',
    description: '2160p REMUX HEVC SDR',
    ladder_step: '4k_sdr_remux_cached',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const ranked = injectPreferredPlayCandidate(
    [picked],
    [],
    picked.url,
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.ladder_step, '4k_sdr_remux_cached');
  assert.equal(ranked[0]?.stream.url, picked.url);
});
