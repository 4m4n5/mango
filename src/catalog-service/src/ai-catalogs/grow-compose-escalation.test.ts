import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COMPOSE_FALLBACK,
  nextComposeFallbackLevel,
  sourcesSignature,
} from './grow-compose-escalation.js';

test('nextComposeFallbackLevel steps until max', () => {
  assert.equal(nextComposeFallbackLevel(0), 1);
  assert.equal(nextComposeFallbackLevel(2), 3);
  assert.equal(nextComposeFallbackLevel(MAX_COMPOSE_FALLBACK), null);
});

test('sourcesSignature detects catalog changes', () => {
  const left = [{ addon: 'AIOMetadata', catalog: 'mdblist.2410', weight: 1 }];
  const right = [{ addon: 'AIOMetadata', catalog: 'mdblist.88302', weight: 1 }];
  assert.notEqual(sourcesSignature(left), sourcesSignature(right));
  assert.equal(sourcesSignature(left), sourcesSignature([...left]));
});
