import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enrichMetaForLauncher,
  metahubPosterUrl,
  normalizePosterUrl,
  resolvePosterFromMeta,
  stubMetaForLauncher,
  youtubeCardThumbnailUrl,
  youtubeVideoThumbnailUrl,
} from './poster.js';

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

test('youtubeVideoThumbnailUrl accepts video ids without permitting arbitrary paths', () => {
  assert.equal(
    youtubeVideoThumbnailUrl('AbC_123-XyZ'),
    'https://i.ytimg.com/vi/AbC_123-XyZ/hqdefault.jpg',
  );
  assert.equal(youtubeVideoThumbnailUrl('../not-a-video'), null);
  assert.equal(youtubeVideoThumbnailUrl('UCxxxxxxxxxxxxxxxxxxxxxx'), null);
});

test('youtubeCardThumbnailUrl rewrites fragile ytimg sizes and fills missing artwork', () => {
  assert.equal(
    youtubeCardThumbnailUrl('AbC_123-XyZ', 'https://i.ytimg.com/vi/AbC_123-XyZ/maxresdefault.jpg'),
    'https://i.ytimg.com/vi/AbC_123-XyZ/hqdefault.jpg',
  );
  assert.equal(
    youtubeCardThumbnailUrl('AbC_123-XyZ', null),
    'https://i.ytimg.com/vi/AbC_123-XyZ/hqdefault.jpg',
  );
  assert.equal(
    youtubeCardThumbnailUrl('AbC_123-XyZ', 'https://private.example/watch?token=keep'),
    'https://private.example/watch?token=keep',
  );
  assert.equal(
    youtubeCardThumbnailUrl('UCchannelidxxxxxxxxxxxxxx', 'https://yt3.ggpht.com/avatar.jpg', 'channel'),
    'https://yt3.ggpht.com/avatar.jpg',
  );
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

test('enrichMetaForLauncher adds metahub poster and display title', () => {
  const enriched = enrichMetaForLauncher({
    id: 'tt0111161',
    type: 'movie',
    name: 'The Shawshank Redemption',
    description: 'Hope.',
  });
  assert.equal(enriched.name, 'The Shawshank Redemption');
  assert.match(String(enriched.poster), /metahub\.space\/poster\/large\/tt0111161/);
});

test('stubMetaForLauncher returns metahub poster for imdb ids', () => {
  const stub = stubMetaForLauncher('movie', 'tt0111161');
  assert.ok(stub);
  assert.match(String(stub?.poster), /metahub\.space/);
  assert.equal(stubMetaForLauncher('movie', 'not-an-id'), null);
});
