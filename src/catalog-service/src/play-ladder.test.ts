import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  defaultPlayLadder,
  expandPlayLadder,
  parsePlayLadder,
  streamMatchesLadderStep,
} from './play-ladder.js';

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
