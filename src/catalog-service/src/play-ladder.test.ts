import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  defaultPlayLadder,
  displayLadderFromPlayLadder,
  expandObligationFloor,
  expandPlayLadder,
  injectPreferredPlayCandidate,
  isVerifiedDisplayStep,
  parsePlayLadder,
  selectDisplayStreamCandidates,
  singlePickerCandidate,
  streamMatchesLadderStep,
} from './play-ladder.js';
import { debridServiceId, streamUrlHash } from './stream-filters.js';

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

test('W2: default couch ladder retains uncached TorBox and excludes uncached Real-Debrid', () => {
  const torbox: Stream = stream({
    url: 'https://example.test/tb-uncached.mkv',
    name: '[TB⏳] Torrentio 1080p',
    description: '1080p WEB-DL',
    behaviorHints: {},
  });
  const realDebrid: Stream = stream({
    url: 'https://example.test/rd-uncached.mkv',
    name: '[RD⏳] Torrentio 1080p',
    description: '1080p WEB-DL',
    behaviorHints: {},
  });

  const candidates = expandPlayLadder(
    [torbox, realDebrid],
    defaultPlayLadder(),
    { contentType: 'movie' },
    { max_candidates: 6 },
  );
  assert.deepEqual(candidates.map((candidate) => candidate.stream.url), [torbox.url]);
  assert.equal(candidates[0]?.ladder_step, '1080p_uncached');
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

test('Adarsh S01E03 keeps both 1080p releases and ranks them ahead of 4K HDR', () => {
  const context = {
    contentType: 'series',
    metaTitle: 'Adarsh Baal Vidyalaya',
    metaId: 'tt40856520:1:3',
    episodeTitle: "Teacher's Tribute",
  };
  const hdr4k = stream({
    url: 'https://example.test/adarsh-4k.mkv',
    title: 'Adarsh.Baal.Vidyalaya.S01E03.2160p.WEB-DL.DV.HDR10.HEVC',
    description: '📁 Adarsh.Baal.Vidyalaya.S01E03.2160p.WEB-DL.DV.HDR10.HEVC.mkv\n📦 5.01 GB',
    behaviorHints: { filename: 'Adarsh.Baal.Vidyalaya.S01E03.2160p.DV.HDR10.mkv' },
  });
  const localized1080 = stream({
    url: 'https://example.test/adarsh-guru-dakshina.mkv',
    title: 'Adarsh.Baal.Vidyalaya.S01E03.Guru.Dakshina.1080p.WEB-DL.AVC',
    description: '📁 Adarsh.Baal.Vidyalaya.S01E03.Guru.Dakshina.1080p.WEB-DL.AVC.mkv\n📦 1.39 GB',
    behaviorHints: { filename: 'Adarsh.Baal.Vidyalaya.S01E03.Guru.Dakshina.1080p.mkv' },
  });
  const bare1080 = stream({
    url: 'https://example.test/adarsh-e03.mkv',
    title: 'Adarsh.Baal.Vidyalaya.E03.1080p.WEB-DL.HEVC',
    description: '📁 Adarsh.Baal.Vidyalaya.E03.1080p.WEB-DL.HEVC.mkv\n📦 682 MB',
    behaviorHints: { filename: 'Adarsh.Baal.Vidyalaya.E03.1080p.HEVC.mkv' },
  });
  const ladder = parsePlayLadder([
    {
      step: 'all',
      max_quality: '2160p',
      exclude_remux: false,
      require_cache: 'any',
      debrid_services: [],
      addons: ['AIOStreams'],
    },
  ]);
  const candidates = expandPlayLadder(
    [hdr4k, bare1080, localized1080],
    ladder,
    context,
    { max_candidates: 10, strict_unknown_cache: false, preferred_quality: '2160p' },
  );

  assert.deepEqual(candidates.map((candidate) => candidate.stream.url), [
    localized1080.url,
    bare1080.url,
    hdr4k.url,
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.capability_class), [
    'proven_smooth',
    'proven_smooth',
    'known_risky',
  ]);
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

test('expandPlayLadder interleaves debrid services so flaky TorBox cannot starve RD within the attempt budget', () => {
  const ladder = defaultPlayLadder();
  // 8 TB streams eligible on the TB-only "ideal" step — enough alone to
  // exhaust an 8-attempt budget before the RD-inclusive "2160p_encode" step
  // is ever reached without service diversification.
  const tbStreams = Array.from({ length: 8 }, (_, i) => stream({
    url: `https://example.test/tb-${i + 1}.mkv`,
    name: '[TB☁️⚡] Torrentio 1080p',
    description: i === 0 ? '1080p WEB-DL HDR10' : '1080p WEB-DL',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  }));
  // 4 RD streams that only become eligible at the "2160p_encode" step.
  const rdStreams = Array.from({ length: 4 }, (_, i) => stream({
    url: `https://example.test/rd-${i + 1}.mkv`,
    name: '[RD☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL HEVC x265',
    behaviorHints: { bingeGroup: 'aiostreams|realdebrid|true|2160p' },
  }));

  const ranked = expandPlayLadder([...tbStreams, ...rdStreams], ladder, { contentType: 'movie' }, {
    max_candidates: 8,
    preferred_hdr_tags: ['hdr10'],
  });

  assert.equal(ranked.length, 8);
  const rdCount = ranked.filter((candidate) => debridServiceId(candidate.stream) === 'realdebrid').length;
  assert.ok(rdCount >= 2, `expected at least 2 RD candidates within the first 8, got ${rdCount}`);
});

test('expandPlayLadder applies fidelity ranking even when only one debrid service is present', () => {
  const ladder = defaultPlayLadder();
  const streams = [
    stream({
      url: 'https://example.test/tb-a.mkv',
      name: '[TB☁️⚡] Torrentio 1080p',
      description: '1080p WEB-DL',
      behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
    }),
    stream({
      url: 'https://example.test/tb-b.mkv',
      name: '[TB☁️⚡] Torrentio 1080p',
      description: '1080p WEB-DL',
      behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
    }),
    stream({
      url: 'https://example.test/tb-c.mkv',
      name: '[TB⚡] Torrentio 2160p',
      description: '2160p HEVC encode',
      behaviorHints: { bingeGroup: 'aiostreams|torbox|false|2160p' },
    }),
  ];

  const ranked = expandPlayLadder(streams, ladder, { contentType: 'movie' }, { max_candidates: 6 });

  assert.deepEqual(ranked.map((candidate) => candidate.stream.url), [
    'https://example.test/tb-c.mkv',
    'https://example.test/tb-a.mkv',
    'https://example.test/tb-b.mkv',
  ]);
  assert.ok(ranked.every((candidate) => debridServiceId(candidate.stream) === 'torbox'));
});

test('expandPlayLadder preserves within-service quality ranking after diversification', () => {
  const ladder = defaultPlayLadder();
  const tbStreams = Array.from({ length: 8 }, (_, i) => stream({
    url: `https://example.test/tb-${i + 1}.mkv`,
    name: '[TB☁️⚡] Torrentio 1080p',
    description: i === 0 ? '1080p WEB-DL HDR10' : '1080p WEB-DL',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  }));
  const rdStreams = Array.from({ length: 4 }, (_, i) => stream({
    url: `https://example.test/rd-${i + 1}.mkv`,
    name: '[RD☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL HEVC x265',
    behaviorHints: { bingeGroup: 'aiostreams|realdebrid|true|2160p' },
  }));

  const ranked = expandPlayLadder([...tbStreams, ...rdStreams], ladder, { contentType: 'movie' }, {
    max_candidates: 12,
    preferred_hdr_tags: ['hdr10'],
  });

  const tbOrder = ranked
    .filter((candidate) => debridServiceId(candidate.stream) === 'torbox')
    .map((candidate) => candidate.stream.url);
  const rdOrder = ranked
    .filter((candidate) => debridServiceId(candidate.stream) === 'realdebrid')
    .map((candidate) => candidate.stream.url);

  // tb-1 carries the HDR bonus so it ranks best; the rest are tied and keep
  // their original relative order. Diversification must not disturb this.
  assert.deepEqual(tbOrder, tbStreams.map((s) => s.url));
  assert.deepEqual(rdOrder, rdStreams.map((s) => s.url));
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

test('injectPreferredPlayCandidate uses expanded ladder step when resolve streams omit ladder_step', () => {
  const picked = stream({
    url: 'https://example.test/picked-4k.mkv',
    name: '[TB⚡] Torrentio 2160p',
    description: '2160p WEBRip HEVC SDR',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const expanded = expandPlayLadder([picked], defaultPlayLadder(), { contentType: 'movie' }, {
    max_candidates: 4,
  });
  const expandedStep = expanded.find((c) => c.stream.url === picked.url)?.ladder_step;
  assert.ok(expandedStep && expandedStep !== 'picker');

  const ranked = injectPreferredPlayCandidate([picked], expanded, picked.url);
  assert.equal(ranked[0]?.ladder_step, expandedStep);
  assert.notEqual(ranked[0]?.ladder_step, 'picker');
});

test('injectPreferredPlayCandidate prefers explicit prefer_ladder_step over picker fallback', () => {
  const picked = stream({
    url: 'https://example.test/picked-4k.mkv',
    name: '[TB⚡] Torrentio 2160p',
    description: '2160p WEBRip HEVC SDR',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const ranked = injectPreferredPlayCandidate([picked], [], picked.url, '2160p_encode');
  assert.equal(ranked[0]?.ladder_step, '2160p_encode');
});

test('S3: single picker preserves the explicit selected ladder step over stale stream metadata', () => {
  const picked = stream({
    url: 'https://example.test/picked-exact.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p HEVC SDR',
    ladder_step: 'stale_step',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  assert.equal(
    singlePickerCandidate([picked], picked.url, '4k_sdr_remux_cached')?.ladder_step,
    '4k_sdr_remux_cached',
  );
});

test('S3: hard language applies to main, last resort, and obligation floor', () => {
  const english = stream({
    url: 'https://example.test/english-only.mkv',
    description: '1080p WEB-DL\n🌐 🇬🇧',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|false|1080p' },
  });
  const hindi = stream({
    url: 'https://example.test/hindi.mkv',
    description: '1080p WEB-DL\n🌐 🇮🇳',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|false|1080p' },
  });
  const main = expandPlayLadder([english, hindi], defaultPlayLadder(), {}, { hard_language: 'Hindi' });
  const floor = expandObligationFloor([english, hindi], {}, { hard_language: 'Hindi' });
  assert.deepEqual(main.map((candidate) => candidate.stream.url), [hindi.url]);
  assert.deepEqual(floor.map((candidate) => candidate.stream.url), [hindi.url]);
});

test('S3: preferred language reorders without excluding other languages', () => {
  const english = stream({
    url: 'https://example.test/english-preference.mkv',
    description: '1080p WEB-DL\n🌐 🇬🇧',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const hindi = stream({
    url: 'https://example.test/hindi-preference.mkv',
    description: '1080p WEB-DL\n🌐 🇮🇳',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const ranked = expandPlayLadder([english, hindi], defaultPlayLadder(), {}, {
    preferred_language: 'Hindi',
  });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.stream.url, hindi.url);
});

test('S3: explicit quality/remux overrides produce the same picker and autoplay candidate set', () => {
  const remux4k = stream({
    url: 'https://example.test/remux-4k.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p REMUX HEVC',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const encode1080 = stream({
    url: 'https://example.test/encode-1080.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: '1080p WEB-DL HEVC',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const options = {
    min_quality: '2160p' as const,
    max_quality: '2160p' as const,
    exclude_remux: false,
    max_candidates: 8,
  };
  const autoplay = expandPlayLadder([encode1080, remux4k], defaultPlayLadder(), {}, options);
  const display = selectDisplayStreamCandidates(
    [encode1080, remux4k],
    defaultPlayLadder(),
    {},
    options,
  );
  assert.deepEqual(autoplay.map((candidate) => candidate.stream.url), [remux4k.url]);
  assert.deepEqual(display.candidates.map((candidate) => candidate.stream.url), [remux4k.url]);
});

test('expandObligationFloor keeps integrity-safe TorBox uncached streams without ladder quality/codec caps', () => {
  const uncached = stream({
    url: 'https://example.test/uncached-x264.mkv',
    name: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  });
  const cam = stream({
    url: 'https://example.test/cam.mkv',
    name: '[TB⚡] CAM 480p',
    description: 'CAMRip telesync',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|false|480p' },
  });
  const ranked = expandObligationFloor([uncached, cam], { contentType: 'movie' }, {
    maxCandidates: 6,
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.stream.url, uncached.url);
  assert.equal(ranked[0]?.ladder_step, 'obligation_floor');
});

test('W2: obligation floor defensively excludes uncached Real-Debrid', () => {
  const torbox = stream({
    url: 'https://example.test/tb-floor.mkv',
    name: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  });
  const realDebrid = stream({
    url: 'https://example.test/rd-floor.mkv',
    name: '[RD⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  });
  const ranked = expandObligationFloor([realDebrid, torbox], { contentType: 'movie' });
  assert.deepEqual(ranked.map((candidate) => candidate.stream.url), [torbox.url]);
});

test('expandObligationFloor excludes URLs already attempted in Phase A', () => {
  const first = stream({
    url: 'https://example.test/first.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: 'WEB-DL 1080p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const second = stream({
    url: 'https://example.test/second.mkv',
    name: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  });
  const ranked = expandObligationFloor([first, second], { contentType: 'movie' }, {
    excludeUrls: new Set([first.url]),
    maxCandidates: 6,
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.stream.url, second.url);
});

test('selectDisplayStreamCandidates uses preference ladder when Phase A has matches', () => {
  const cached = stream({
    url: 'https://example.test/cached-1080.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: 'WEB-DL 1080p',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const floorOnly = stream({
    url: 'https://example.test/floor-720.mkv',
    name: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  });
  const preferenceOnly = [{
    step: '1080p_cached',
    max_quality: '1080p' as const,
    min_quality: '1080p' as const,
    exclude_remux: true,
    require_cache: 'cached' as const,
    debrid_services: ['torbox', 'realdebrid'],
    addons: ['AIOStreams'],
  }];
  const selected = selectDisplayStreamCandidates(
    [cached, floorOnly],
    preferenceOnly,
    { contentType: 'movie' },
    { max_candidates: 6 },
  );
  assert.equal(selected.source, 'preference_ladder');
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.candidates[0]?.stream.url, cached.url);
  assert.notEqual(selected.candidates[0]?.ladder_step, 'obligation_floor');
});

test('selectDisplayStreamCandidates falls back to last-resort when main is empty', () => {
  const floorOnly = stream({
    url: 'https://example.test/floor-only.mkv',
    name: '[TB⏳] Torrentio 720p',
    description: 'WEBRip 720p x264',
    behaviorHints: {},
  });
  const preferenceOnly = [{
    step: '1080p_hevc_cached',
    max_quality: '1080p' as const,
    min_quality: '1080p' as const,
    exclude_remux: true,
    require_hevc: true,
    require_cache: 'cached' as const,
    debrid_services: ['torbox', 'realdebrid'],
    addons: ['AIOStreams'],
  }];
  const selected = selectDisplayStreamCandidates(
    [floorOnly],
    preferenceOnly,
    { contentType: 'movie' },
    { max_candidates: 6, include_uncached: false },
  );
  // Main empty → last_resort_ladder (or obligation floor) marked unverified.
  assert.ok(selected.source === 'last_resort' || selected.source === 'obligation_floor');
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.candidates[0]?.stream.url, floorOnly.url);
  assert.notEqual(selected.candidates[0]?.ladder_step, '1080p_hevc_cached');
});

test('selectDisplayStreamCandidates stays empty when neither phase has integrity-safe streams', () => {
  const cam = stream({
    url: 'https://example.test/cam-only.mkv',
    name: '[TB⚡] CAM 480p',
    description: 'CAMRip telesync',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|false|480p' },
  });
  const selected = selectDisplayStreamCandidates(
    [cam],
    defaultPlayLadder(),
    { contentType: 'movie' },
    { max_candidates: 6 },
  );
  assert.equal(selected.source, 'empty');
  assert.equal(selected.candidates.length, 0);
});

test('selectDisplayStreamCandidates excludes last_resort when verified smooth streams exist', () => {
  const smooth = stream({
    url: 'https://example.test/1080p-hevc.mkv',
    name: '[TB☁️⚡] Torrentio 1080p',
    description: 'WEB-DL 1080p HEVC',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const hdrLastResort = stream({
    url: 'https://example.test/2160p-hdr.mkv',
    name: '[TB☁️⚡] Torrentio 2160p HDR',
    description: '2160p BluRay HDR10 HEVC',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const ladder = [
    {
      step: '1080p_hevc_cached',
      max_quality: '1080p' as const,
      exclude_remux: true,
      require_cache: 'cached' as const,
      verified: true,
      debrid_services: ['torbox', 'realdebrid'],
      addons: ['AIOStreams'],
    },
    {
      step: 'last_resort',
      max_quality: '2160p' as const,
      exclude_remux: false,
      require_hevc: false,
      require_cache: 'any' as const,
      verified: false,
      debrid_services: ['torbox', 'realdebrid'],
      addons: ['AIOStreams'],
    },
  ];
  const selected = selectDisplayStreamCandidates(
    [smooth, hdrLastResort],
    ladder,
    { contentType: 'movie' },
    { max_candidates: 10 },
  );
  assert.equal(selected.source, 'preference_ladder');
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.candidates[0]?.stream.url, smooth.url);
  assert.equal(selected.candidates[0]?.ladder_step, '1080p_hevc_cached');
});

test('displayLadderFromPlayLadder keeps only verified steps', () => {
  const ladder = [
    { step: '4k_sdr_cached', max_quality: '2160p' as const, exclude_remux: true, require_cache: 'cached' as const, verified: true },
    { step: '4k_sdr_soft_cached', max_quality: '2160p' as const, exclude_remux: true, require_cache: 'cached' as const, verified: false },
    { step: '1080p_hevc_cached', max_quality: '1080p' as const, exclude_remux: true, require_cache: 'cached' as const, verified: true },
    { step: 'last_resort', max_quality: '2160p' as const, exclude_remux: false, require_cache: 'any' as const, verified: false },
  ];
  assert.deepEqual(
    displayLadderFromPlayLadder(ladder).map((s) => s.step),
    ['4k_sdr_cached', '1080p_hevc_cached'],
  );
  assert.equal(isVerifiedDisplayStep('last_resort'), false);
  assert.equal(isVerifiedDisplayStep('4k_sdr_soft_cached'), false);
  assert.equal(isVerifiedDisplayStep({ step: 'custom', max_quality: '1080p', exclude_remux: true, require_cache: 'cached', verified: false }), false);
});

// Smoothness-first: 4K HEVC → 1080p smooth → soft 4K AV1. Soft 4K is play fallback, not preferred over 1080p.
const HIFI_RANKED_LADDER = [
  {
    step: '4k_sdr_cached', max_quality: '2160p' as const, min_quality: '2160p' as const,
    exclude_remux: true, require_hevc: true, exclude_hdr: true, require_cache: 'cached' as const,
    verified: true,
    debrid_services: ['torbox', 'realdebrid'], addons: ['AIOStreams'],
  },
  {
    step: '1080p_cached', max_quality: '1080p' as const,
    exclude_remux: true, require_cache: 'cached' as const,
    verified: true,
    debrid_services: ['torbox', 'realdebrid'], addons: ['AIOStreams'],
  },
  {
    step: '4k_sdr_soft_cached', max_quality: '2160p' as const, min_quality: '2160p' as const,
    exclude_remux: true, require_hevc: false, exclude_hdr: true, require_cache: 'cached' as const,
    verified: false,
    debrid_services: ['torbox', 'realdebrid'], addons: ['AIOStreams'],
  },
];

test('hifi ladder ranks 4K HEVC > 1080p > 4K AV1 (smoothness-first)', () => {
  const uhdHevc = stream({
    url: 'https://example.test/2160p-hevc.mkv', name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL HEVC', behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const uhdAv1 = stream({
    url: 'https://example.test/2160p-av1.mkv', name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL AV1', behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const hd = stream({
    url: 'https://example.test/1080p-hevc.mkv', name: '[TB☁️⚡] Torrentio 1080p',
    description: '1080p WEB-DL HEVC', behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const candidates = expandPlayLadder([hd, uhdAv1, uhdHevc], HIFI_RANKED_LADDER, { contentType: 'series' });
  assert.deepEqual(candidates.map((c) => c.stream.url), [uhdHevc.url, hd.url, uhdAv1.url]);
});

test('hifi ladder still plays a title whose only stream is 4K AV1 (no exclusion)', () => {
  const uhdAv1Only = stream({
    url: 'https://example.test/only-2160p-av1.mkv', name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL AV1', behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const candidates = expandPlayLadder([uhdAv1Only], HIFI_RANKED_LADDER, { contentType: 'series' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.stream.url, uhdAv1Only.url);
  assert.equal(candidates[0]?.ladder_step, '4k_sdr_soft_cached');
});

test('hifi last-resort prefers smooth 1080p TorBox before soft 4K without dropping either', () => {
  const uncached1080 = stream({
    url: 'https://example.test/1080p-torbox-uncached.mkv',
    name: '[TB⏳] Torrentio 1080p',
    description: '1080p WEB-DL HEVC',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|false|1080p' },
  });
  const cached4kAv1 = stream({
    url: 'https://example.test/2160p-av1-cached.mkv',
    name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL AV1',
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const lastResort = [
    {
      step: '1080p_uncached_fallback', max_quality: '1080p' as const,
      exclude_remux: true, require_cache: 'cached_or_uncached' as const,
      verified: false,
      debrid_services: ['torbox', 'realdebrid'], addons: ['AIOStreams'],
    },
    {
      step: '4k_sdr_soft_cached', max_quality: '2160p' as const, min_quality: '2160p' as const,
      exclude_remux: true, require_hevc: false, exclude_hdr: true, require_cache: 'cached' as const,
      verified: false,
      debrid_services: ['torbox', 'realdebrid'], addons: ['AIOStreams'],
    },
  ];
  const candidates = expandPlayLadder(
    [cached4kAv1, uncached1080],
    lastResort,
    { contentType: 'movie' },
  );
  assert.deepEqual(candidates.map((candidate) => candidate.stream.url), [
    uncached1080.url,
    cached4kAv1.url,
  ]);
});

test('selectDisplayStreamCandidates hides soft 4K when 1080p verified exists', () => {
  const uhdAv1 = stream({
    url: 'https://example.test/2160p-av1.mkv', name: '[TB☁️⚡] Torrentio 2160p',
    description: '2160p WEB-DL AV1', behaviorHints: { bingeGroup: 'aiostreams|torbox|true|2160p' },
  });
  const hd = stream({
    url: 'https://example.test/1080p-hevc.mkv', name: '[TB☁️⚡] Torrentio 1080p',
    description: '1080p WEB-DL HEVC', behaviorHints: { bingeGroup: 'aiostreams|torbox|true|1080p' },
  });
  const selected = selectDisplayStreamCandidates(
    [uhdAv1, hd],
    HIFI_RANKED_LADDER,
    { contentType: 'series' },
    { max_candidates: 6 },
  );
  assert.equal(selected.source, 'preference_ladder');
  assert.deepEqual(selected.candidates.map((c) => c.stream.url), [hd.url]);
  assert.ok(!selected.candidates.some((c) => c.ladder_step === '4k_sdr_soft_cached'));
});
test('unknown-quality MediaFusion row matches soft 4K play step, not verified remux', () => {
  const mediafusion = stream({
    url: 'https://example.test/latent-e3.mkv',
    name: '[TB⚡] MediaFusion',
    description: "📁 India's Got Latent (2024) S01 • E03\n📦 61.3 GB 🔍 BT4G",
    behaviorHints: { bingeGroup: 'aiostreams|torbox|true' },
  });
  const ladder = [
    {
      step: '4k_sdr_remux_cached',
      max_quality: '2160p' as const,
      min_quality: '2160p' as const,
      exclude_remux: false,
      require_hevc: true,
      exclude_hdr: true,
      require_cache: 'cached' as const,
      verified: true,
      debrid_services: ['torbox', 'realdebrid'],
      addons: ['AIOStreams'],
    },
    {
      step: '4k_sdr_soft_cached',
      max_quality: '2160p' as const,
      exclude_remux: true,
      require_hevc: false,
      exclude_hdr: true,
      require_cache: 'cached' as const,
      verified: false,
      debrid_services: ['torbox', 'realdebrid'],
      addons: ['AIOStreams'],
    },
    {
      step: 'last_resort',
      max_quality: '2160p' as const,
      exclude_remux: false,
      require_hevc: false,
      require_cache: 'any' as const,
      verified: false,
      debrid_services: ['torbox', 'realdebrid'],
      addons: ['AIOStreams'],
    },
  ];
  const play = expandPlayLadder([mediafusion], ladder, { contentType: 'series' });
  assert.equal(play[0]?.ladder_step, '4k_sdr_soft_cached');
  const display = selectDisplayStreamCandidates([mediafusion], ladder, { contentType: 'series' });
  // Soft is last-resort — display shows it as unverified (not main).
  assert.equal(display.source, 'last_resort');
  assert.equal(display.candidates[0]?.ladder_step, '4k_sdr_soft_cached');
});
