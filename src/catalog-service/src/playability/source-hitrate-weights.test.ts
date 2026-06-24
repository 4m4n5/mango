import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildHitrateMultipliers,
  buildRailSourceGrowMultipliers,
  buildSourceGrowMultipliers,
  effectiveSourceWeight,
  loadSourceHitrateReport,
  loadSourceGrowReport,
  recordSourceGrowOutcome,
  sourceGrowProbationMinSamples,
  sourceGrowProbationMultiplier,
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

test('loadSourceHitrateReport accepts source-hitrate seconds timestamps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-source-hitrate-'));
  const previousOut = process.env.MANGO_SOURCE_HITRATE_OUT;
  process.env.MANGO_SOURCE_HITRATE_OUT = join(dir, 'latest.json');
  try {
    writeFileSync(process.env.MANGO_SOURCE_HITRATE_OUT, JSON.stringify({
      ts: 1_782_300_000,
      sources: [],
    }), 'utf8');
    assert.ok(loadSourceHitrateReport(1_782_300_000_000 + 1000));
    assert.equal(loadSourceHitrateReport(1_782_300_000_000 + 8 * 24 * 60 * 60 * 1000), null);
  } finally {
    if (previousOut === undefined) {
      delete process.env.MANGO_SOURCE_HITRATE_OUT;
    } else {
      process.env.MANGO_SOURCE_HITRATE_OUT = previousOut;
    }
    rmSync(dir, { recursive: true, force: true });
  }
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
  assert.equal(multipliers.get('AIOMetadata:bad'), sourceGrowProbationMultiplier());
});

test('buildSourceGrowMultipliers reapplies current probation policy to stored reports', () => {
  const report: SourceGrowReport = {
    ts: Date.now(),
    sources: [
      {
        source_key: 'AIOMetadata:old-bad',
        source_label: 'AIOMetadata/old-bad',
        content_type: 'series',
        scanned: 120,
        fresh_queued: 120,
        skipped_verified: 0,
        skipped_recent_failed: 0,
        linked_verified_seen: 0,
        requested: 120,
        returned: 120,
        catalog_errors: 0,
        rate_limited: 0,
        exhausted: true,
        verified: 0,
        failed: 56,
        theme_rejected: 36,
        runs: 1,
        multiplier: 0.33,
        last_ts: Date.now(),
      },
      {
        source_key: 'AIOMetadata:rollback',
        source_label: 'AIOMetadata/rollback',
        content_type: 'series',
        scanned: 120,
        fresh_queued: 120,
        skipped_verified: 0,
        skipped_recent_failed: 0,
        linked_verified_seen: 0,
        requested: 120,
        returned: 120,
        catalog_errors: 0,
        rate_limited: 0,
        exhausted: true,
        verified: 0,
        failed: 56,
        theme_rejected: 36,
        runs: 1,
        multiplier: 1,
        rollback_reason: 'rail regressed after weighted success',
        last_ts: Date.now(),
      },
    ],
  };

  const multipliers = buildSourceGrowMultipliers(report, 'series');
  assert.equal(multipliers.get('AIOMetadata:old-bad'), sourceGrowProbationMultiplier());
  assert.equal(multipliers.get('AIOMetadata:rollback'), 1);
});

test('buildSourceGrowMultipliers applies rail-specific source outcomes over global outcomes', () => {
  const report: SourceGrowReport = {
    ts: Date.now(),
    sources: [
      {
        source_key: 'AIOMetadata:shared',
        source_label: 'AIOMetadata/shared',
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
        runs: 2,
        multiplier: 1.8,
        last_ts: Date.now(),
      },
    ],
    rail_sources: {
      'movies-india-trending': [
        {
          source_key: 'AIOMetadata:shared',
          source_label: 'AIOMetadata/shared',
          rail_id: 'movies-india-trending',
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
          verified: 0,
          failed: 2,
          theme_rejected: 18,
          runs: 1,
          multiplier: 0.2,
          last_ts: Date.now(),
        },
      ],
    },
  };

  assert.equal(buildSourceGrowMultipliers(report, 'movie').get('AIOMetadata:shared'), 1.8);
  assert.ok((buildSourceGrowMultipliers(report, 'movie', 'movies-india-trending').get('AIOMetadata:shared') ?? 0) < 1);
  assert.equal(
    buildRailSourceGrowMultipliers(report, 'movies-india-trending', 'movie').get('AIOMetadata:shared'),
    0.2,
  );
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
    ], { growTargetMet: true, weighted: true, now: 1000, elapsedMs: 60_000 });
    let report = loadSourceGrowReport(1000);
    assert.ok(report);
    assert.equal(report.sources[0]?.source_key, 'AIOMetadata:good');
    assert.ok((report.sources[0]?.multiplier ?? 0) > 1);
    assert.equal(report.rail_sources?.['movies-test']?.[0]?.rail_id, 'movies-test');
    assert.equal(report.rail_sources?.['movies-test']?.[0]?.elapsed_ms, 60_000);

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
    ], { growTargetMet: false, weighted: true, now: 2000, elapsedMs: 60_000 });
    report = loadSourceGrowReport(2000);
    assert.ok(report);
    assert.equal(report.sources[0]?.multiplier, 1);
    assert.match(report.sources[0]?.rollback_reason ?? '', /regressed/);
    assert.equal(report.rail_sources?.['movies-test']?.[0]?.multiplier, 1);
    assert.match(report.rail_sources?.['movies-test']?.[0]?.rollback_reason ?? '', /regressed/);
  } finally {
    if (previousOut === undefined) {
      delete process.env.MANGO_SOURCE_GROW_OUT;
    } else {
      process.env.MANGO_SOURCE_GROW_OUT = previousOut;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordSourceGrowOutcome sends catastrophic zero-yield sources to probation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-source-grow-'));
  const previousOut = process.env.MANGO_SOURCE_GROW_OUT;
  process.env.MANGO_SOURCE_GROW_OUT = join(dir, 'latest.json');
  try {
    recordSourceGrowOutcome('series-india-picks', 'series', [
      {
        source_key: 'AIOMetadata:mdblist.181302',
        source_label: 'AIOMetadata/mdblist.181302',
        content_type: 'series',
        scanned: 120,
        fresh_queued: 120,
        skipped_verified: 0,
        skipped_recent_failed: 0,
        linked_verified_seen: 0,
        requested: 120,
        returned: 120,
        catalog_errors: 0,
        rate_limited: 0,
        exhausted: true,
        verified: 0,
        failed: 56,
        theme_rejected: 36,
      },
    ], { growTargetMet: false, weighted: true, now: Date.now(), elapsedMs: 60_000 });
    const report = loadSourceGrowReport();
    assert.ok(report);
    assert.equal(report.sources[0]?.multiplier, sourceGrowProbationMultiplier());
    assert.equal(report.sources[0]?.probation, true);
    assert.equal(
      report.rail_sources?.['series-india-picks']?.[0]?.multiplier,
      sourceGrowProbationMultiplier(),
    );
  } finally {
    if (previousOut === undefined) {
      delete process.env.MANGO_SOURCE_GROW_OUT;
    } else {
      process.env.MANGO_SOURCE_GROW_OUT = previousOut;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sourceGrowProbationMultiplier is explicit and bounded to 5-10%', () => {
  const prev = process.env.MANGO_GROW_SOURCE_PROBATION_MULTIPLIER;
  try {
    delete process.env.MANGO_GROW_SOURCE_PROBATION_MULTIPLIER;
    assert.equal(sourceGrowProbationMultiplier(), 0.08);
    process.env.MANGO_GROW_SOURCE_PROBATION_MULTIPLIER = '0.05';
    assert.equal(sourceGrowProbationMultiplier(), 0.05);
    process.env.MANGO_GROW_SOURCE_PROBATION_MULTIPLIER = '0.20';
    assert.equal(sourceGrowProbationMultiplier(), 0.08);
  } finally {
    if (prev === undefined) {
      delete process.env.MANGO_GROW_SOURCE_PROBATION_MULTIPLIER;
    } else {
      process.env.MANGO_GROW_SOURCE_PROBATION_MULTIPLIER = prev;
    }
  }
});

test('sourceGrowProbationMinSamples is explicit and bounded', () => {
  const prev = process.env.MANGO_GROW_SOURCE_PROBATION_MIN_SAMPLES;
  try {
    delete process.env.MANGO_GROW_SOURCE_PROBATION_MIN_SAMPLES;
    assert.equal(sourceGrowProbationMinSamples(), 12);
    process.env.MANGO_GROW_SOURCE_PROBATION_MIN_SAMPLES = '5';
    assert.equal(sourceGrowProbationMinSamples(), 5);
    process.env.MANGO_GROW_SOURCE_PROBATION_MIN_SAMPLES = '2';
    assert.equal(sourceGrowProbationMinSamples(), 12);
  } finally {
    if (prev === undefined) {
      delete process.env.MANGO_GROW_SOURCE_PROBATION_MIN_SAMPLES;
    } else {
      process.env.MANGO_GROW_SOURCE_PROBATION_MIN_SAMPLES = prev;
    }
  }
});
