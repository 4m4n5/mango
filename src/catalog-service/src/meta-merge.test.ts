import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCatalogMetaPieces, mergeVideosByEpisodeId } from './meta-merge.js';

const IGL_BONUS = {
  id: 'tt33094114:0:1',
  season: 0,
  episode: 1,
  title: 'Bonus EP ft. Arpit Bala',
  released: '2024-09-15',
};

const IGL_S1E1 = {
  id: 'tt33094114:1:1',
  season: 1,
  episode: 1,
  title: 'EP 01',
  released: '2024-07-14',
};

const IGL_S2E1_CINEMETA = {
  id: 'tt33094114:2:1',
  season: 2,
  episode: 1,
  title: 'Episode 1',
  released: '2026-06-20',
};

test('mergeVideosByEpisodeId unions layers and keeps Cinemeta-only episodes', () => {
  const merged = mergeVideosByEpisodeId([
    {
      source: 'Cinemeta',
      videos: [IGL_BONUS, IGL_S1E1, IGL_S2E1_CINEMETA],
    },
    {
      source: 'AIOMetadata',
      videos: [IGL_BONUS, IGL_S1E1],
    },
  ]);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((row) => row.id),
    ['tt33094114:0:1', 'tt33094114:1:1', 'tt33094114:2:1'],
  );
});

test('mergeVideosByEpisodeId prefers newer released date on conflict', () => {
  const merged = mergeVideosByEpisodeId([
    {
      source: 'AIOMetadata',
      videos: [{
        ...IGL_S1E1,
        title: 'Stale title',
        released: '2024-01-01',
      }],
    },
    {
      source: 'Cinemeta',
      videos: [{
        ...IGL_S1E1,
        title: 'Fresh title',
        released: '2024-07-14',
      }],
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.title, 'Fresh title');
});

test('mergeCatalogMetaPieces keeps union when later addon lacks new season', () => {
  const layers: Parameters<typeof mergeCatalogMetaPieces>[3] = [];
  const cinemeta = mergeCatalogMetaPieces(
    null,
    { id: 'tt33094114', type: 'series', videos: [IGL_S1E1, IGL_S2E1_CINEMETA] },
    'Cinemeta',
    layers,
  );
  const merged = mergeCatalogMetaPieces(
    cinemeta,
    { id: 'tt33094114', type: 'series', videos: [IGL_S1E1], description: 'enriched' },
    'AIOMetadata',
    layers,
  );
  assert.equal(merged.description, 'enriched');
  assert.equal(Array.isArray(merged.videos) ? merged.videos.length : 0, 2);
  const videos = merged.videos as Array<{ id?: string }>;
  assert.equal(videos[1]?.id, 'tt33094114:2:1');
});
