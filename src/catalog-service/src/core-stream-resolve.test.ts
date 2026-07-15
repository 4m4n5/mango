import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasStreamResolveInfrastructureErrors,
  hasStreamResolveRateLimitErrors,
  displayStreamTelemetry,
  streamResolveBudgetMs,
  streamsAreOnlyErrorPlaceholders,
  type ResolveNote,
  type Stream,
} from './core.js';
import { defaultFilterConfig, mergeFilterConfig } from './stream-filters.js';

function note(kind: ResolveNote['kind'], message: string): ResolveNote {
  return { kind, message };
}

test('stream resolve classifier treats clean zero streams as title exhaustion', () => {
  assert.equal(hasStreamResolveInfrastructureErrors([]), false);
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('annotation', 'zero streams after 2 attempts')]),
    false,
  );
});

test('stream resolve classifier keeps provider failures as infrastructure', () => {
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('addon_error', 'AIOStreams: HTTP 502')]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('addon_error', 'AIOStreams: timeout after 12000ms')]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('addon_error', 'AIOMetadata: rate limit exceeded')]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      note('skip', 'stream resolve skipped — recent miss (retry shortly)'),
    ]),
    false,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      note('infra', 'stream resolve skipped — recent rate-limit (retry shortly)'),
    ]),
    true,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      note('infra', 'stream resolve skipped — recent rate-limit placeholders'),
    ]),
    true,
  );
});

test('stream resolve classifier accepts legacy string[] for transition', () => {
  assert.equal(hasStreamResolveInfrastructureErrors(['zero streams after 2 attempts']), false);
  assert.equal(hasStreamResolveInfrastructureErrors(['AIOStreams: HTTP 502']), true);
  assert.equal(
    hasStreamResolveInfrastructureErrors(['stream resolve skipped — recent miss (retry shortly)']),
    false,
  );
  assert.equal(
    hasStreamResolveInfrastructureErrors([
      'stream resolve skipped — recent rate-limit (retry shortly)',
    ]),
    true,
  );
});

test('stream resolve classifier treats non-cacheable placeholders as infrastructure', () => {
  assert.equal(streamsAreOnlyErrorPlaceholders([
    {
      url: 'https://example.test/rate-limit-exceeded',
      title: '[❌] TorBox Search failed',
      source: 'AIOStreams',
    } as Stream,
  ]), true);
  assert.equal(streamsAreOnlyErrorPlaceholders([
    {
      url: 'https://example.test/movie.mp4',
      title: 'Movie 1080p',
      source: 'AIOStreams',
    } as Stream,
  ]), false);
});

test('rate-limit classifier excludes timeouts (2A — no busy backoff on timeout)', () => {
  assert.equal(
    hasStreamResolveRateLimitErrors([note('addon_error', 'AIOStreams: timeout after 12000ms')]),
    false,
  );
  assert.equal(
    hasStreamResolveRateLimitErrors([note('addon_error', 'AIOStreams: HTTP 502')]),
    false,
  );
  assert.equal(
    hasStreamResolveRateLimitErrors([note('addon_error', 'AIOMetadata: rate limit exceeded')]),
    true,
  );
  assert.equal(
    hasStreamResolveRateLimitErrors([
      note('infra', 'stream resolve skipped — recent rate-limit (retry shortly)'),
    ]),
    true,
  );
  // Still infra for couch timed-out messaging:
  assert.equal(
    hasStreamResolveInfrastructureErrors([note('addon_error', 'AIOStreams: timeout after 12000ms')]),
    true,
  );
});

test('streamResolveBudgetMs is longer for user than background (1A)', () => {
  assert.equal(streamResolveBudgetMs('background'), 12000);
  assert.equal(streamResolveBudgetMs(undefined), 12000);
  assert.equal(streamResolveBudgetMs('user'), 30000);
});

test('S7: display telemetry reports truthful title, HDR/quality, and language stage loss', () => {
  const config = mergeFilterConfig(defaultFilterConfig(), { hard_language: 'hindi' });
  const streams: Stream[] = [
    { url: 'https://example.test/good', title: "India's Got Latent S01E01 1080p Hindi HEVC", description: "📁 India's Got Latent S01E01 1080p Hindi HEVC", source: 'AIOStreams' },
    { url: 'https://example.test/wrong', title: 'Better Call Saul S01E01 1080p Hindi HEVC', description: '📁 Better Call Saul S01E01 1080p Hindi HEVC', source: 'AIOStreams' },
    { url: 'https://example.test/hdr', title: "India's Got Latent S01E01 2160p HDR Hindi H264", description: "📁 India's Got Latent S01E01 2160p HDR Hindi H264", source: 'AIOStreams' },
    { url: 'https://example.test/english', title: "India's Got Latent S01E01 1080p English HEVC", description: "📁 India's Got Latent S01E01 1080p English HEVC", source: 'AIOStreams' },
  ];
  const telemetry = displayStreamTelemetry(streams, config, {
    contentType: 'series',
    metaTitle: "India's Got Latent",
    metaId: 'tt33094114:1:1',
  });
  assert.equal(telemetry.excluded.title_mismatch, 1);
  assert.equal(telemetry.excluded.language_mismatch, 1);
  assert.equal(telemetry.excluded.above_max_quality, 1);
  assert.deepEqual(telemetry.stages, {
    raw: 4,
    integrity_safe: 3,
    main: 1,
    last_resort: 1,
    obligation_floor: 2,
  });
});
