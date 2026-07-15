import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogCore } from '../core.js';
import { failedLadderReason, prepareVerifyTitle } from './verify.js';
import { defaultFilterConfig, mergeFilterConfig } from '../stream-filters.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

test('prepareVerifyTitle passes bounded series cross-probe budget and classifies 429s', async () => {
  process.env.MANGO_PLAYABILITY_SERIES_CROSS_PROBE_LIMIT = '2';
  process.env.MANGO_PLAYABILITY_GROW_PASS = '1';
  let options: unknown;
  const core = {
    async resolveForPlay(_type: string, _id: string, _overrides: unknown, resolveOptions: unknown) {
      options = resolveOptions;
      throw new Error('429 - Too Many Requests');
    },
  } as unknown as CatalogCore;

  const result = await prepareVerifyTitle(core, 'series', 'tt18266602:1:14');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rate_limited');
  assert.deepEqual(options, {
    seriesCrossProbeLimit: 2,
    zeroStreamRetryAttempts: 1,
    zeroStreamRetryDelayMs: 1200,
    requestClass: 'background',
  });
});

test('prepareVerifyTitle does not retry zero-stream resolves outside grow unless configured', async () => {
  let options: unknown;
  const core = {
    async resolveForPlay(_type: string, _id: string, _overrides: unknown, resolveOptions: unknown) {
      options = resolveOptions;
      throw new Error('no HTTP streams for movie/tt123');
    },
  } as unknown as CatalogCore;

  const result = await prepareVerifyTitle(core, 'movie', 'tt123');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_stream');
  assert.deepEqual(options, {
    seriesCrossProbeLimit: 0,
    zeroStreamRetryAttempts: 0,
    zeroStreamRetryDelayMs: 0,
    requestClass: 'background',
  });
});

test('failedLadderReason classifies zero-candidate ladder failures as no_stream', () => {
  assert.equal(failedLadderReason({ attempts: [], candidate_count: 0 }), 'no_stream');
  assert.equal(failedLadderReason({ attempts: [], candidate_count: 2 }), 'probe_failed');
  assert.equal(
    failedLadderReason({ attempts: [{ error: 'debrid_nfo_sidecar' }], candidate_count: 2 }),
    'transient_upstream',
  );
  assert.equal(
    failedLadderReason({ attempts: [{ error: '429 Too Many Requests' }], candidate_count: 2 }),
    'rate_limited',
  );
  assert.equal(
    failedLadderReason({ attempts: [{ error: 'no HTTP streams for series/tt123' }], candidate_count: 2 }),
    'no_stream',
  );
});

test('S3: prepare verification never accepts a last-resort-only stream', async () => {
  const main = [{
    step: 'verified_1080',
    max_quality: '1080p' as const,
    min_quality: '1080p' as const,
    exclude_remux: true,
    require_cache: 'cached' as const,
    verified: true,
    addons: ['AIOStreams'],
    debrid_services: ['torbox'],
  }];
  const resort = [{
    step: 'last_resort',
    max_quality: '2160p' as const,
    exclude_remux: false,
    require_cache: 'any' as const,
    verified: false,
    addons: ['AIOStreams'],
    debrid_services: ['torbox'],
  }];
  const filters = mergeFilterConfig({
    ...defaultFilterConfig(),
    play_ladder: [...main, ...resort],
    main_ladder: main,
    last_resort_ladder: resort,
  });
  const core = {
    async resolveForPlay() {
      return {
        streams: [{
          url: 'https://example.test/only-last-resort.mkv',
          source: 'AIOStreams',
          name: '[TB⚡] Torrentio 720p',
          description: '720p WEBRip x264',
          behaviorHints: { bingeGroup: 'aiostreams|torbox|false|720p' },
        }],
        resolve_ms: 1,
        cached: false,
        filters,
        filterContext: { contentType: 'movie' },
      };
    },
  } as unknown as CatalogCore;

  const result = await prepareVerifyTitle(core, 'movie', 'tt-last-resort');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_stream');
});
