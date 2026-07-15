import assert from 'node:assert/strict';
import test from 'node:test';
import { streamFlightBehaviorKey, streamFlightKey } from './stream-flight.js';

test('S2: foreground and background resolves never share the same flight key', () => {
  const common = { zeroStreamRetryAttempts: 0, deadlineAtMs: 12345 };
  assert.notEqual(
    streamFlightKey('movie:tt1', { ...common, requestClass: 'user' }),
    streamFlightKey('movie:tt1', { ...common, requestClass: 'background' }),
  );
});

test('S2: stable resolve behavior participates in the flight key but per-request deadlines do not', () => {
  const base = streamFlightBehaviorKey();
  assert.notEqual(base, streamFlightBehaviorKey({ seriesCrossProbeLimit: 1 }));
  assert.notEqual(base, streamFlightBehaviorKey({ zeroStreamRetryAttempts: 1 }));
  assert.notEqual(base, streamFlightBehaviorKey({ zeroStreamRetryDelayMs: 1 }));
  assert.equal(base, streamFlightBehaviorKey({ deadlineAtMs: 1 }));
  assert.equal(
    streamFlightKey('movie:tt1', { requestClass: 'user', deadlineAtMs: 1 }),
    streamFlightKey('movie:tt1', { requestClass: 'user', deadlineAtMs: 2 }),
  );
});
