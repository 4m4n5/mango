import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLiveChannels } from './live-search.js';

function withTempLiveCache<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-live-voice-'));
  const cachePath = join(dir, 'live-rails-cache.json');
  process.env.MANGO_LIVE_RAILS_CACHE = cachePath;
  const cache = {
    saved_at: Date.now(),
    expires_at: Date.now() + 60 * 60 * 1000,
    payload: {
      tab: 'live',
      rails: [
        {
          rail_id: 'news',
          label: 'News',
          items: [
            { id: 'cnn', type: 'tv', title: 'CNN', subtitle: 'live', poster: 'https://img.example/cnn.jpg', source: 'addon1' },
            { id: 'bbc', type: 'tv', title: 'BBC World', subtitle: 'live', source: 'addon1' },
          ],
        },
        {
          rail_id: 'sports',
          label: 'Sports',
          items: [
            { id: 'espn', type: 'tv', title: 'ESPN', subtitle: 'live', source: 'addon2' },
          ],
        },
      ],
    },
  };
  writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
  const cleanup = () => {
    delete process.env.MANGO_LIVE_RAILS_CACHE;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('searchLiveChannels scores live channels by title and rail label', async () => withTempLiveCache(async () => {
  const hits = await searchLiveChannels('news', 8);
  assert.ok(hits.length >= 2);
  const ids = hits.map((hit) => hit.id);
  assert.ok(ids.includes('cnn'));
  assert.ok(ids.includes('bbc'));
  for (const hit of hits) {
    assert.equal(hit.type, 'tv');
    assert.equal(hit.tab, 'live');
    assert.ok(hit.score > 0);
  }
}));

test('searchLiveChannels returns exact title matches first', async () => withTempLiveCache(async () => {
  const hits = await searchLiveChannels('espn', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'espn');
  assert.equal(hits[0].title, 'ESPN');
  assert.equal(hits[0].type, 'tv');
  assert.equal(hits[0].tab, 'live');
  assert.ok(hits[0].score > 0);
}));

test('searchLiveChannels returns empty when cache is empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-live-voice-empty-'));
  const cachePath = join(dir, 'live-rails-cache.json');
  process.env.MANGO_LIVE_RAILS_CACHE = cachePath;
  writeFileSync(cachePath, JSON.stringify({ saved_at: Date.now(), expires_at: Date.now() + 60 * 60 * 1000, payload: { tab: 'live', rails: [] } }), 'utf8');
  try {
    const hits = await searchLiveChannels('news', 5);
    assert.equal(hits.length, 0);
  } finally {
    delete process.env.MANGO_LIVE_RAILS_CACHE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('searchLiveChannels returns empty for short queries', async () => withTempLiveCache(async () => {
  const hits = await searchLiveChannels('c', 5);
  assert.equal(hits.length, 0);
}));
