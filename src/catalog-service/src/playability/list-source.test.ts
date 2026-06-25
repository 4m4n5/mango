import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogResourceUrl,
  compositeCatalogFetchConcurrency,
  CompositeListSource,
  fetchAddonCatalogCandidates,
} from './list-source.js';

test('catalogResourceUrl passes skip to addon for server-side pagination', () => {
  const base = 'http://127.0.0.1:3036/stremio/uuid/manifest.json';
  assert.equal(
    catalogResourceUrl(base, 'movie', 'mdblist.88302'),
    'http://127.0.0.1:3036/stremio/uuid/catalog/movie/mdblist.88302.json',
  );
  assert.equal(
    catalogResourceUrl(base, 'movie', 'mdblist.88302', { skip: 200 }),
    'http://127.0.0.1:3036/stremio/uuid/catalog/movie/mdblist.88302/skip=200.json',
  );
});

test('fetchAddonCatalogCandidates canonicalizes series episode ids to title ids', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    metas: [
      { id: 'tt18266602:1:14', name: 'Man Udu Udu Zhala' },
      { id: 'tt12004706', name: 'Panchayat' },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;

  try {
    const candidates = await fetchAddonCatalogCandidates(
      'http://127.0.0.1:3036/stremio/a/manifest.json',
      'series',
      'tmdb-hi-latest_episodes-series',
      'A/latest',
      { offset: 0, limit: 10 },
      {
        sourceKey: 'A:latest',
        addon: 'A',
        catalog: 'tmdb-hi-latest_episodes-series',
        sourceName: 'Latest Episodes',
      },
    );
    assert.deepEqual(candidates.map((candidate) => candidate.id), ['tt18266602', 'tt12004706']);
    assert.equal(candidates[0]?.source_name, 'Latest Episodes');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchAddonCatalogCandidates hard-times out stalled catalog body fetches', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.MANGO_CATALOG_FETCH_TIMEOUT_MS;
  process.env.MANGO_CATALOG_FETCH_TIMEOUT_MS = '10';
  let aborted = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => {
      aborted = true;
    });
    return await new Promise<Response>(() => {});
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchAddonCatalogCandidates(
        'http://127.0.0.1:3036/stremio/a/manifest.json',
        'series',
        'mdblist.slow',
        'A/slow',
        { offset: 0, limit: 10 },
      ),
      /catalog A\/slow failed: timeout after 500ms/,
    );
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) {
      delete process.env.MANGO_CATALOG_FETCH_TIMEOUT_MS;
    } else {
      process.env.MANGO_CATALOG_FETCH_TIMEOUT_MS = originalTimeout;
    }
  }
});

test('CompositeListSource skips exhausted sources until cursor reset', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ metas: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const source = new CompositeListSource('rail', 'movie', [{
      addon: 'A',
      catalog: 'c1',
      weight: 1,
      manifestUrl: 'http://127.0.0.1:3036/stremio/a/manifest.json',
      sourceLabel: 'A/c1',
    }]);

    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(source.areAllSourcesExhausted(), true);
    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(fetches, 1);

    source.resetAllSourceOffsets();
    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CompositeListSource suppresses a source for the current grow run without moving cursor', async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ metas: [{ id: `tt${fetches}`, name: `Title ${fetches}` }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const source = new CompositeListSource('rail', 'movie', [{
      addon: 'A',
      catalog: 'c1',
      weight: 1,
      manifestUrl: 'http://127.0.0.1:3036/stremio/a/manifest.json',
      sourceLabel: 'A/c1',
    }]);
    source.setSuppressedSourceKeys(new Set(['A:c1']));

    assert.deepEqual(await source.candidates({ offset: 0, limit: 10 }), []);
    assert.equal(source.areAllSourcesExhausted(), true);
    assert.equal(fetches, 0);
    assert.equal(source.readSourceOffsets().get('A:c1'), undefined);

    source.setSuppressedSourceKeys(new Set());
    assert.equal((await source.candidates({ offset: 0, limit: 10 })).length, 1);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CompositeListSource samples probation sources without fetching all of them every page', async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    const count = url.includes('/active') ? 20 : 1;
    return new Response(JSON.stringify({
      metas: Array.from({ length: count }, (_, index) => ({
        id: `tt${fetched.length}-${index}`,
        name: `Title ${fetched.length}-${index}`,
      })),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const sources = [
      {
        addon: 'A',
        catalog: 'active',
        weight: 1,
        manifestUrl: 'http://127.0.0.1:3036/stremio/a/manifest.json',
        sourceLabel: 'A/active',
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        addon: 'P',
        catalog: `p${index}`,
        weight: 1,
        manifestUrl: 'http://127.0.0.1:3036/stremio/p/manifest.json',
        sourceLabel: `P/p${index}`,
      })),
    ];
    const source = new CompositeListSource('rail', 'movie', sources);
    source.setHitrateWeightMultipliers(new Map([
      ['P:p0', 0.08],
      ['P:p1', 0.08],
      ['P:p2', 0.08],
      ['P:p3', 0.08],
    ]));

    await source.candidates({ offset: 0, limit: 20 });
    assert.equal(fetched.length, 2);
    assert.ok(fetched.some((url) => url.includes('/active')));
    assert.ok(fetched.some((url) => url.includes('/p0')));

    fetched.length = 0;
    await source.candidates({ offset: 0, limit: 20 });
    assert.equal(fetched.length, 2);
    assert.ok(fetched.some((url) => url.includes('/active')));
    assert.ok(fetched.some((url) => url.includes('/p1')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CompositeListSource fetches active sources with bounded parallelism', async () => {
  const originalFetch = globalThis.fetch;
  const originalConcurrency = process.env.MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY;
  let active = 0;
  let maxActive = 0;
  const fetched: string[] = [];
  process.env.MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY = '2';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    const match = url.match(/catalog\/movie\/([^/.]+)/);
    const catalog = match?.[1] ?? 'unknown';
    return new Response(JSON.stringify({
      metas: [{ id: `tt-${catalog}`, name: `Title ${catalog}` }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const source = new CompositeListSource('rail', 'movie', Array.from({ length: 4 }, (_, index) => ({
      addon: 'A',
      catalog: `c${index}`,
      weight: 1,
      manifestUrl: 'http://127.0.0.1:3036/stremio/a/manifest.json',
      sourceLabel: `A/c${index}`,
    })));

    const candidates = await source.candidates({ offset: 0, limit: 4 });

    assert.equal(compositeCatalogFetchConcurrency(), 2);
    assert.equal(fetched.length, 4);
    assert.equal(maxActive, 2);
    assert.equal(candidates.length, 4);
    assert.deepEqual(
      source.readLastSourceFetchStats().map((stat) => stat.source_key),
      ['A:c0', 'A:c1', 'A:c2', 'A:c3'],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalConcurrency === undefined) {
      delete process.env.MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY;
    } else {
      process.env.MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY = originalConcurrency;
    }
  }
});
