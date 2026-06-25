import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogCore } from '../core.js';
import { failedLadderReason, prepareVerifyTitle } from './verify.js';

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
    seriesCrossProbeLimit: 1,
    zeroStreamRetryAttempts: 0,
    zeroStreamRetryDelayMs: 0,
  });
});

test('failedLadderReason classifies zero-candidate ladder failures as no_stream', () => {
  assert.equal(failedLadderReason({ attempts: [], candidate_count: 0 }), 'no_stream');
  assert.equal(failedLadderReason({ attempts: [], candidate_count: 2 }), 'probe_failed');
  assert.equal(
    failedLadderReason({ attempts: [{ error: '429 Too Many Requests' }], candidate_count: 2 }),
    'rate_limited',
  );
  assert.equal(
    failedLadderReason({ attempts: [{ error: 'no HTTP streams for series/tt123' }], candidate_count: 2 }),
    'no_stream',
  );
});
