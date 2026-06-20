import assert from 'node:assert/strict';
import test from 'node:test';
import { metahubPosterUrl, normalizePosterUrl, resolvePosterFromMeta } from './poster.js';

test('normalizePosterUrl upgrades http and protocol-relative URLs', () => {
  assert.equal(normalizePosterUrl('//cdn.example/p.jpg'), 'https://cdn.example/p.jpg');
  assert.equal(normalizePosterUrl('http://cdn.example/p.jpg'), 'https://cdn.example/p.jpg');
  assert.equal(normalizePosterUrl('https://cdn.example/p.jpg'), 'https://cdn.example/p.jpg');
  assert.equal(normalizePosterUrl(''), null);
});

test('metahubPosterUrl builds Cinemeta CDN path from episode ids', () => {
  assert.equal(
    metahubPosterUrl('tt12004706:1:3'),
    'https://images.metahub.space/poster/medium/tt12004706/img',
  );
  assert.equal(metahubPosterUrl('not-an-id'), null);
});

test('resolvePosterFromMeta falls back through artwork fields', () => {
  assert.equal(
    resolvePosterFromMeta({
      id: 'tt1',
      type: 'movie',
      poster: '',
      background: 'https://cdn.example/bg.jpg',
    }),
    'https://cdn.example/bg.jpg',
  );
});
