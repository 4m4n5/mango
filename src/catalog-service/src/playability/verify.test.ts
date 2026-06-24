import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogCore } from '../core.js';
import { prepareVerifyTitle } from './verify.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

test('prepareVerifyTitle passes bounded series cross-probe budget and classifies 429s', async () => {
  process.env.MANGO_PLAYABILITY_SERIES_CROSS_PROBE_LIMIT = '2';
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
  assert.deepEqual(options, { seriesCrossProbeLimit: 2 });
});
