import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  defaultPlayLadder,
  expandPlayLadder,
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
