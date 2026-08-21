import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveAdapter } from './live.js';
import { LIVE_RAILS_POLICY_VERSION } from '../../live-rails-cache.js';

function withTempLiveCache<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-live-'));
  const cachePath = join(dir, 'live-rails-cache.json');
  process.env.MANGO_LIVE_RAILS_CACHE = cachePath;
  const cache = {
    policy_version: LIVE_RAILS_POLICY_VERSION,
    saved_at: Date.now(),
    expires_at: Date.now() + 60 * 60 * 1000,
    payload: {
      tab: 'live',
      rails: [
        {
          rail_id: 'news',
          label: 'News',
          items: [
            { id: 'cnn', type: 'tv', title: 'CNN News', subtitle: 'live', poster: 'https://img.example/cnn.jpg', source: 'addon1' },
            { id: 'bbc', type: 'tv', title: 'BBC World', subtitle: 'live', poster: 'https://img.example/bbc.jpg', source: 'addon1' },
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

test('liveAdapter resolvePlan maps cached live channels to tv seeds', async () => withTempLiveCache(async () => {
  const plan = await liveAdapter.resolvePlan(
    {
      label: 'World News',
      tab: 'live',
      content_type: 'tv',
      theme: 'news',
    },
    { searchLibrary: async () => [] },
  );
  assert.equal(plan.sources.length, 0);
  assert.equal(plan.catalogs_to_activate.length, 0);
  assert.equal(plan.fallback_level, 0);
  assert.equal(plan.thematic_score, 80);
  assert.ok(plan.seed_titles.length >= 1);
  const first = plan.seed_titles[0];
  assert.equal(first?.type, 'tv');
  assert.equal(first?.id, 'cnn');
  assert.equal(first?.title, 'CNN News');
  assert.equal(first?.poster, 'https://img.example/cnn.jpg');
  assert.equal(plan.llm_hints.theme, 'news');
}));

test('liveAdapter resolvePlan returns empty seeds when cache is empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-live-empty-'));
  const cachePath = join(dir, 'live-rails-cache.json');
  process.env.MANGO_LIVE_RAILS_CACHE = cachePath;
  writeFileSync(cachePath, JSON.stringify({ policy_version: LIVE_RAILS_POLICY_VERSION, saved_at: Date.now(), expires_at: Date.now() + 60 * 60 * 1000, payload: { tab: 'live', rails: [] } }), 'utf8');
  const cleanup = () => {
    delete process.env.MANGO_LIVE_RAILS_CACHE;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const plan = await liveAdapter.resolvePlan(
      {
        label: 'Empty',
        tab: 'live',
        content_type: 'tv',
      },
      { searchLibrary: async () => [] },
    );
    assert.equal(plan.seed_titles.length, 0);
    assert.equal(plan.sources.length, 0);
    assert.equal(plan.thematic_score, 80);
  } finally {
    cleanup();
  }
});
