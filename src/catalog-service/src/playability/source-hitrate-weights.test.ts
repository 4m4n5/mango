import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHitrateMultipliers,
  effectiveSourceWeight,
  type SourceHitrateReport,
} from './source-hitrate-weights.js';

test('buildHitrateMultipliers scales weights from stream rate vs min_rate', () => {
  const report: SourceHitrateReport = {
    ts: Date.now(),
    min_rate: 0.5,
    sources: [
      {
        source_key: 'AIOMetadata|mdblist.1|movie',
        addon: 'AIOMetadata',
        catalog: 'mdblist.1',
        content_type: 'movie',
        sampled: 5,
        stream_rate: 1.0,
      },
      {
        source_key: 'AIOMetadata|mdblist.2|movie',
        addon: 'AIOMetadata',
        catalog: 'mdblist.2',
        content_type: 'movie',
        sampled: 5,
        stream_rate: 0.25,
      },
      {
        source_key: 'Cinemeta|top|series',
        addon: 'Cinemeta',
        catalog: 'top',
        content_type: 'series',
        sampled: 5,
        stream_rate: 0.8,
        // different content type — ignored for movie
      },
    ],
  };

  const multipliers = buildHitrateMultipliers(report, 'movie');
  assert.equal(multipliers.get('AIOMetadata:mdblist.1'), 2);
  assert.equal(multipliers.get('AIOMetadata:mdblist.2'), 0.5);
  assert.equal(multipliers.has('Cinemeta:top'), false);
});

test('effectiveSourceWeight applies multiplier to base yaml weight', () => {
  const multipliers = new Map([['AIOMetadata:mdblist.1', 2]]);
  assert.equal(effectiveSourceWeight('AIOMetadata', 'mdblist.1', 0.5, multipliers), 1);
  assert.equal(effectiveSourceWeight('AIOMetadata', 'mdblist.9', 1, multipliers), 1);
});
