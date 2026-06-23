import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildHitrateMultipliers,
  buildSourceGrowMultipliers,
  effectiveSourceWeight,
  loadSourceGrowReport,
  recordSourceGrowOutcome,
  type SourceGrowReport,
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

test('buildSourceGrowMultipliers uses runtime grow outcomes', () => {
  const report: SourceGrowReport = {
    ts: Date.now(),
    sources: [
      {
        source_key: 'AIOMetadata:good',
        source_label: 'AIOMetadata/good',
        content_type: 'movie',
        scanned: 20,
        fresh_queued: 20,
        skipped_verified: 0,
        skipped_recent_failed: 0,
        linked_verified_seen: 2,
        requested: 30,
        returned: 25,
        catalog_errors: 0,
        rate_limited: 0,
        exhausted: false,
        verified: 12,
        failed: 4,
        theme_rejected: 0,
        runs: 2,
        multiplier: 1.6,
        last_ts: Date.now(),
      },
      {
        source_key: 'AIOMetadata:bad',
        source_label: 'AIOMetadata/bad',
        content_type: 'movie',
        scanned: 20,
        fresh_queued: 20,
        skipped_verified: 0,
        skipped_recent_failed: 0,
        linked_verified_seen: 0,
        requested: 30,
        returned: 20,
        catalog_errors: 1,
        rate_limited: 1,
        exhausted: true,
        verified: 0,
        failed: 14,
        theme_rejected: 3,
        runs: 2,
        multiplier: 0.1,
        last_ts: Date.now(),
      },
    ],
  };
  const multipliers = buildSourceGrowMultipliers(report, 'movie');
  assert.equal(multipliers.get('AIOMetadata:good'), 1.6);
  assert.equal(multipliers.get('AIOMetadata:bad'), 0.1);
});

test('recordSourceGrowOutcome writes runtime cache and rolls back weighted regressions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-source-grow-'));
  const previousOut = process.env.MANGO_SOURCE_GROW_OUT;
  process.env.MANGO_SOURCE_GROW_OUT = join(dir, 'latest.json');
  try {
    recordSourceGrowOutcome('movies-test', 'movie', [
      {
        source_key: 'AIOMetadata:good',
        source_label: 'AIOMetadata/good',
        content_type: 'movie',
        scanned: 20,
        fresh_queued: 20,
        skipped_verified: 0,
        skipped_recent_failed: 0,
        linked_verified_seen: 0,
        requested: 20,
        returned: 20,
        catalog_errors: 0,
        rate_limited: 0,
        exhausted: false,
        verified: 12,
        failed: 2,
        theme_rejected: 0,
      },
    ], { growTargetMet: true, weighted: true, now: 1000 });
    let report = loadSourceGrowReport(1000);
    assert.ok(report);
    assert.equal(report.sources[0]?.source_key, 'AIOMetadata:good');
    assert.ok((report.sources[0]?.multiplier ?? 0) > 1);

    recordSourceGrowOutcome('movies-test', 'movie', [
      {
        source_key: 'AIOMetadata:good',
        source_label: 'AIOMetadata/good',
        content_type: 'movie',
        scanned: 20,
        fresh_queued: 20,
        skipped_verified: 0,
        skipped_recent_failed: 0,
        linked_verified_seen: 0,
        requested: 20,
        returned: 20,
        catalog_errors: 0,
        rate_limited: 0,
        exhausted: true,
        verified: 0,
        failed: 12,
        theme_rejected: 0,
      },
    ], { growTargetMet: false, weighted: true, now: 2000 });
    report = loadSourceGrowReport(2000);
    assert.ok(report);
    assert.equal(report.sources[0]?.multiplier, 1);
    assert.match(report.sources[0]?.rollback_reason ?? '', /regressed/);
  } finally {
    if (previousOut === undefined) {
      delete process.env.MANGO_SOURCE_GROW_OUT;
    } else {
      process.env.MANGO_SOURCE_GROW_OUT = previousOut;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
