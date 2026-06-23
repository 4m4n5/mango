import assert from 'node:assert/strict';
import test from 'node:test';
import { filterVodAddonExports } from './core.js';
import type { LiveRailConfig } from './live-rails.js';

const liveConfig: LiveRailConfig = {
  version: 2,
  addon: 'mango Live TV',
  catalog: 'iptv_channels',
  catalog_type: 'tv',
  pages: 1,
  cache_ttl_sec: 1800,
  verify_streams: false,
  verify_pool_multiplier: 2,
  verify_delay_ms: 0,
  verify_max_per_rail: 3,
  sources: [
    { addon: 'mango Live TV', catalog: 'iptv_channels', catalog_type: 'tv', pages: 1 },
    { addon: 'mango Live Free', catalog: 'iptv_channels', catalog_type: 'tv', pages: 1 },
  ],
  rails: [
    { id: 'live-cricket', label: 'cricket', keywords: ['cricket'], limit: 7 },
  ],
};

test('filterVodAddonExports skips optional live manifests but keeps VOD graph', () => {
  const filtered = filterVodAddonExports([
    { name: 'Cinemeta', manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json' },
    { name: 'AIOStreams', manifestUrl: 'http://127.0.0.1:3035/stremio/u/manifest.json' },
    { name: 'AIOMetadata', manifestUrl: 'http://127.0.0.1:3036/stremio/u/c/manifest.json' },
    { name: 'mango Live TV', manifestUrl: 'http://127.0.0.1:7000/token/manifest.json' },
    { name: 'mango Live Free', manifestUrl: 'http://127.0.0.1:7001/token/manifest.json' },
  ], liveConfig);

  assert.deepEqual(
    filtered.map((addon) => addon.name),
    ['Cinemeta', 'AIOStreams', 'AIOMetadata'],
  );
});

test('filterVodAddonExports also skips heuristic NexoTV/live exports when config is absent', () => {
  const filtered = filterVodAddonExports([
    { name: 'Cinemeta', manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json' },
    { name: 'NexoTV Sports', manifestUrl: 'http://127.0.0.1:7003/token/manifest.json' },
    { name: 'mango Live News', manifestUrl: 'http://127.0.0.1:7002/token/manifest.json' },
  ], null);

  assert.deepEqual(filtered.map((addon) => addon.name), ['Cinemeta']);
});
