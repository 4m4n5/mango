import assert from 'node:assert/strict';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  classifyStreamCapability,
  compareStreamsForPlaybackPath,
} from './playback-capability.js';

function stream(url: string, description: string, cached = true): Stream {
  return {
    url,
    source: 'AIOStreams',
    title: description,
    description,
    behaviorHints: {
      bingeGroup: `com.aiostreams|torbox|${cached}|${url}`,
    },
  };
}

test('Pi X11 capability classification keeps HDR and software 4K as final fallback', () => {
  const hdr = stream('https://example.test/hdr', '2160p HEVC DV HDR10');
  const av1 = stream('https://example.test/av1', '2160p AV1 SDR');
  const hevc = stream('https://example.test/hevc', '2160p HEVC SDR');
  const hd = stream('https://example.test/hd', '1080p AVC SDR');

  assert.equal(classifyStreamCapability(hdr).capability_class, 'known_risky');
  assert.equal(classifyStreamCapability(av1).capability_class, 'known_risky');
  assert.equal(classifyStreamCapability(hevc).capability_class, 'proven_smooth');
  assert.equal(classifyStreamCapability(hd).capability_class, 'proven_smooth');
});

test('cache and verified hints cannot promote known-risk 4K above smooth 1080p', () => {
  const riskyCached = stream('https://example.test/risky', '2160p HEVC HDR10', true);
  const smoothUncached = stream('https://example.test/smooth', '1080p AVC SDR', false);
  const config = {
    preferred_quality: '2160p' as const,
    max_quality: null,
    preferred_hdr_tags: ['hdr10'],
    preferred_video_codecs: ['hevc'],
  };
  const compare = compareStreamsForPlaybackPath(riskyCached, smoothUncached, config, {
    verifiedHint: {
      win_url_hash: 'not-needed',
      best_source: 'AIOStreams',
      cache_status: 'cached',
      debrid_service: 'torbox',
    },
  });
  assert.ok(compare > 0, 'smooth 1080p must sort before known-risk 4K');
});
