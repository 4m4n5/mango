import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CatalogCore } from '../core.js';
import { failedLadderReason, prepareVerifyTitle, verifyPreparedTitle } from './verify.js';
import { defaultFilterConfig, mergeFilterConfig } from '../stream-filters.js';
import { getTitlePlayability, recordVerifyResult, resetPlayabilityDbForTests } from './db.js';

const ENV = { ...process.env };

test.afterEach(() => {
  resetPlayabilityDbForTests();
  process.env = { ...ENV };
});

async function withTempPlayabilityDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-verify-status-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

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
    identityHint: { title: undefined, year: undefined },
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
    identityHint: { title: undefined, year: undefined },
  });
});

test('prepare verification carries immutable title/year identity into background resolution', async () => {
  let options: unknown;
  const core = {
    async resolveForPlay(_type: string, _id: string, _overrides: unknown, resolveOptions: unknown) {
      options = resolveOptions;
      throw new Error('identity_conflict');
    },
  } as unknown as CatalogCore;

  const result = await prepareVerifyTitle(core, 'movie', 'tt5787720', {
    title: 'Dead Silent',
    year: 2016,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'identity_conflict');
  assert.deepEqual(options, {
    seriesCrossProbeLimit: 0,
    zeroStreamRetryAttempts: 0,
    zeroStreamRetryDelayMs: 0,
    requestClass: 'background',
    identityHint: { title: 'Dead Silent', year: '2016' },
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

test('failed verification reports the actual preserved verified or stale status', async () => {
  await withTempPlayabilityDb(async () => {
    await recordVerifyResult({ type: 'movie', id: 'tt-preserved-verified', status: 'verified' });
    await recordVerifyResult({
      type: 'movie',
      id: 'tt-preserved-stale',
      status: 'stale',
      fail_reason: 'play_miss',
    });
    const preparedFailure = (id: string) => ({
      type: 'movie',
      id,
      ok: false as const,
      reason: 'no_stream',
      prepare_ms: 1,
      request: {
        request_id: `test:movie:${id}`,
        run_id: null,
        type: 'movie',
        requested_id: id,
        canonical_title_id: `movie:${id}`,
        verify_id: id,
        rail_id: null,
        source_key: null,
        title: null,
        year: null,
        season: null,
        episode: null,
        attempt_kind: 'main' as const,
      },
    });

    const verified = await verifyPreparedTitle(preparedFailure('tt-preserved-verified'));
    assert.equal(verified.ok, false);
    assert.equal(verified.status, 'verified');
    assert.equal(verified.exact_main_win, false);

    const stale = await verifyPreparedTitle(preparedFailure('tt-preserved-stale'));
    assert.equal(stale.ok, false);
    assert.equal(stale.status, 'stale');
    assert.equal(stale.exact_main_win, false);

    await recordVerifyResult({ type: 'movie', id: 'tt-identity-conflict', status: 'verified' });
    const conflict = await verifyPreparedTitle({
      ...preparedFailure('tt-identity-conflict'),
      reason: 'identity_conflict',
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.status, 'failed');
    assert.equal(conflict.identity_certifiable, false);
    assert.equal((await getTitlePlayability('movie', 'tt-identity-conflict'))?.fail_reason, 'identity_conflict');
  });
});
