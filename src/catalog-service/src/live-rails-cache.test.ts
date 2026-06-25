import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  liveRailsDiskCacheFresh,
  liveRailsDiskCacheNonEmpty,
  liveRailsDiskCacheSummary,
  liveRailsCachePath,
  readLiveRailsDiskCache,
  writeLiveRailsDiskCache,
} from './live-rails-cache.js';

test('live rails disk cache accepts stale non-empty fallback and reports diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-cache-'));
  const oldPath = process.env.MANGO_LIVE_RAILS_CACHE;
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live-cache.json');
  try {
    const now = Date.now();
    await writeFile(liveRailsCachePath(), JSON.stringify({
      saved_at: now - 2 * 60 * 60 * 1000,
      expires_at: now - 60 * 1000,
      payload: {
        tab: 'live',
        rails: [
          { rail_id: 'live-cricket', items: [{ id: 'one' }] },
          { id: 'live-football', items: [{ id: 'two' }, { id: 'three' }] },
        ],
      },
    }), 'utf8');

    const entry = await readLiveRailsDiskCache();
    assert.equal(liveRailsDiskCacheFresh(entry), false);
    assert.equal(liveRailsDiskCacheNonEmpty(entry), true);

    const summary = liveRailsDiskCacheSummary(entry);
    assert.equal(summary.path, process.env.MANGO_LIVE_RAILS_CACHE);
    assert.equal(summary.present, true);
    assert.equal(summary.non_empty, true);
    assert.equal(summary.fresh, false);
    assert.equal(summary.rail_counts['live-cricket'], 1);
    assert.equal(summary.rail_counts['live-football'], 2);
  } finally {
    if (oldPath === undefined) {
      delete process.env.MANGO_LIVE_RAILS_CACHE;
    } else {
      process.env.MANGO_LIVE_RAILS_CACHE = oldPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('live rails disk cache never treats empty cache as fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-cache-'));
  const oldPath = process.env.MANGO_LIVE_RAILS_CACHE;
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live-cache.json');
  try {
    await writeLiveRailsDiskCache({ tab: 'live', rails: [] }, 30);
    const entry = await readLiveRailsDiskCache();
    assert.equal(liveRailsDiskCacheFresh(entry), false);
    assert.equal(liveRailsDiskCacheNonEmpty(entry), false);
    assert.deepEqual(liveRailsDiskCacheSummary(entry).rail_counts, {});
  } finally {
    if (oldPath === undefined) {
      delete process.env.MANGO_LIVE_RAILS_CACHE;
    } else {
      process.env.MANGO_LIVE_RAILS_CACHE = oldPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
