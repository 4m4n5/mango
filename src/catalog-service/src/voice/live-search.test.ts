import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearArea69SearchIndexCache } from '../live/area69.js';
import {
  liveChannelHealthKey,
  recordLiveChannelHealth,
  type LiveChannelHealthStatus,
} from '../live/health.js';
import { LIVE_RAILS_POLICY_VERSION } from '../live-rails-cache.js';
import {
  liveSearchValidationDiagnostics,
  LIVE_SEARCH_VALIDATION_BUDGET_MS,
  searchLiveChannels,
  rankLiveChannelEntries,
} from './live-search.js';
import type { CatalogCore } from '../core.js';

const DEFAULT_HEALTH: Array<[string, string, LiveChannelHealthStatus]> = [
  ['addon1', 'cnn', 'verified'],
  ['addon1', 'bbc', 'verified'],
  ['addon2', 'espn', 'verified'],
];

function withTempLiveCache<T>(
  fn: (paths: { dir: string; healthPath: string }) => T | Promise<T>,
  health = DEFAULT_HEALTH,
): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-live-voice-'));
  const cachePath = join(dir, 'live-rails-cache.json');
  const healthPath = join(dir, 'live-health.json');
  // Isolate from Pi/operator AREA69 indexes so unknown-validation caps stay deterministic.
  const previousArea69 = process.env.MANGO_AREA69_SEARCH_INDEX;
  delete process.env.MANGO_AREA69_SEARCH_INDEX;
  clearArea69SearchIndexCache();
  process.env.MANGO_LIVE_RAILS_CACHE = cachePath;
  process.env.MANGO_LIVE_HEALTH_REGISTRY = healthPath;
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
  const now = Date.now();
  writeFileSync(healthPath, JSON.stringify({
    version: 1,
    records: Object.fromEntries(health.map(([source, id, status]) => [
      liveChannelHealthKey(source, id),
      {
        status,
        updated_at: now,
        ...(status === 'verified' ? { last_success_at: now } : {}),
        ...(status === 'failed' ? { last_failure_at: now } : {}),
      },
    ])),
  }), 'utf8');
  const cleanup = () => {
    delete process.env.MANGO_LIVE_RAILS_CACHE;
    delete process.env.MANGO_LIVE_HEALTH_REGISTRY;
    clearArea69SearchIndexCache();
    if (previousArea69 === undefined) {
      delete process.env.MANGO_AREA69_SEARCH_INDEX;
    } else {
      process.env.MANGO_AREA69_SEARCH_INDEX = previousArea69;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn({ dir, healthPath });
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
  const hits = await searchLiveChannels('news', 8, undefined, { freshnessHorizonMs: 60_000 });
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
  const hits = await searchLiveChannels('espn', 5, undefined, { freshnessHorizonMs: 60_000 });
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
  writeFileSync(cachePath, JSON.stringify({ policy_version: LIVE_RAILS_POLICY_VERSION, saved_at: Date.now(), expires_at: Date.now() + 60 * 60 * 1000, payload: { tab: 'live', rails: [] } }), 'utf8');
  try {
    const hits = await searchLiveChannels('news', 5, undefined, { freshnessHorizonMs: 60_000 });
    assert.equal(hits.length, 0);
  } finally {
    delete process.env.MANGO_LIVE_RAILS_CACHE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('searchLiveChannels returns empty for short queries', async () => withTempLiveCache(async () => {
  const hits = await searchLiveChannels('c', 5, undefined, { freshnessHorizonMs: 60_000 });
  assert.equal(hits.length, 0);
}));

test('rankLiveChannelEntries matches rail label context', () => {
  const hits = rankLiveChannelEntries(
    [{ meta: { id: 'nick', name: 'Nickelodeon', title: 'Nickelodeon' }, context: 'cartoons' }],
    'cartoons',
    5,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'nick');
  assert.ok(hits[0].score > 0);
});

test('searchLiveChannels merges AREA69 hits and dedupes curated title matches', async () => withTempLiveCache(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-live-voice-area69-'));
  const indexPath = join(dir, 'area69-live-search.json');
  process.env.MANGO_AREA69_SEARCH_INDEX = indexPath;
  clearArea69SearchIndexCache();
  writeFileSync(indexPath, JSON.stringify({
    version: 2,
    entries: [
      { stream_id: '9001', name: 'ESPN' },
      { stream_id: '9002', name: 'ESPN 2' },
    ],
  }), 'utf8');
  try {
    await recordLiveChannelHealth({
      source: 'mango Live TV',
      channelId: 'area69:9002',
      status: 'verified',
    });
    const hits = await searchLiveChannels('espn', 5, undefined, { freshnessHorizonMs: 60_000 });
    const ids = hits.map((hit) => hit.id);
    assert.ok(ids.includes('espn'));
    assert.ok(ids.includes('area69:9002'));
    assert.equal(ids.includes('area69:9001'), false);
  } finally {
    clearArea69SearchIndexCache();
    delete process.env.MANGO_AREA69_SEARCH_INDEX;
    rmSync(dir, { recursive: true, force: true });
  }
}));

test('searchLiveChannels suppresses fresh failures without hiding verified alternatives', async () => withTempLiveCache(async () => {
  const hits = await searchLiveChannels('news', 8, undefined, { freshnessHorizonMs: 60_000 });
  assert.deepEqual(hits.map((hit) => hit.id), ['bbc']);
}, [
  ['addon1', 'cnn', 'failed'],
  ['addon1', 'bbc', 'verified'],
]));

test('searchLiveChannels validates at most one unknown free candidate in the response window', async () => withTempLiveCache(async ({ healthPath }) => {
  const validated: string[] = [];
  const core = {} as CatalogCore;
  const hits = await searchLiveChannels('news', 8, core, {
    validateUnknown: true,
    freshnessHorizonMs: 60_000,
    healthPath,
    validate: async (entry) => {
      validated.push(entry.meta.id);
      return true;
    },
  });
  assert.equal(validated.length, 1);
  assert.equal(hits.length, 1);
}, []));

test('Live search budget is two seconds and validation admits at most one candidate per inventory class', async () => withTempLiveCache(async ({ dir, healthPath }) => {
  assert.equal(LIVE_SEARCH_VALIDATION_BUDGET_MS, 2_000);
  const indexPath = join(dir, 'area69-live-search.json');
  process.env.MANGO_AREA69_SEARCH_INDEX = indexPath;
  clearArea69SearchIndexCache();
  writeFileSync(indexPath, JSON.stringify({
    version: 2,
    entries: [
      { stream_id: '9001', name: 'ESPN 2' },
      { stream_id: '9002', name: 'ESPN Deportes' },
    ],
  }), 'utf8');
  const validated: string[] = [];
  try {
    await searchLiveChannels('espn', 8, {} as CatalogCore, {
      validateUnknown: true,
      freshnessHorizonMs: 60_000,
      healthPath,
      validate: async (entry) => {
        validated.push(entry.meta.id);
        return true;
      },
    });
    assert.equal(validated.filter((id) => id.startsWith('area69:')).length, 1);
    assert.equal(validated.filter((id) => !id.startsWith('area69:')).length, 1);
  } finally {
    clearArea69SearchIndexCache();
    delete process.env.MANGO_AREA69_SEARCH_INDEX;
  }
}, []));

test('searchLiveChannels omits slow unknowns, then surfaces asynchronously proven results', async () => withTempLiveCache(async ({ healthPath }) => {
  const core = {} as CatalogCore;
  const budgetMs = 20;
  const validateDelayMs = 80;
  const started = Date.now();
  const first = await searchLiveChannels('espn', 5, core, {
    validateUnknown: true,
    validationBudgetMs: budgetMs,
    freshnessHorizonMs: 60_000,
    healthPath,
    validate: async (entry) => {
      await new Promise((resolve) => setTimeout(resolve, validateDelayMs));
      await recordLiveChannelHealth({
        source: entry.source || 'addon2',
        channelId: entry.meta.id,
        status: 'verified',
      }, healthPath);
      return true;
    },
  });
  assert.deepEqual(first, []);
  // Must return inside the response window, not after the slow validate completes.
  assert.ok(Date.now() - started < validateDelayMs);
  assert.equal(liveSearchValidationDiagnostics().queued, 1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(liveSearchValidationDiagnostics().queued, 0);
  const second = await searchLiveChannels('espn', 5, undefined, {
    freshnessHorizonMs: 60_000,
    healthPath,
  });
  assert.equal(second[0]?.id, 'espn');
}, []));
