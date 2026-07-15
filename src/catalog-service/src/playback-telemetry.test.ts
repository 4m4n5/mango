import assert from 'node:assert/strict';
import test from 'node:test';

import { playbackTelemetryRecord } from './playback-telemetry.js';

test('S7: playback telemetry is structured and drops URL/credential fields', () => {
  assert.deepEqual(playbackTelemetryRecord('resolve', {
    request_id: 'request-7',
    epoch: 4,
    total_deadline_ms: 85_000,
    resolve_request_class: 'user',
    provider_fanout_count: 2,
    provider_fanout_ms: 31,
    signed_url: 'https://secret.example/token',
    provider_userData: 'secret',
  }, 123), {
    component: 'catalog-playback',
    event: 'resolve',
    ts_ms: 123,
    request_id: 'request-7',
    epoch: 4,
    total_deadline_ms: 85_000,
    resolve_request_class: 'user',
    provider_fanout_count: 2,
    provider_fanout_ms: 31,
  });
});
