import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluatePublicSourceLifecycle,
  fetchIsolatedPublicJson,
  isPublicNetworkAddress,
  metadataCatalogsFromCommunityCollection,
  validatePublicMetadataUrl,
  type PublicSourceLifecycleState,
} from './public-catalog-discovery.js';
import { playabilityPolicySnapshot } from './policy.js';

test('public metadata URL and DNS gates reject SSRF destinations and credentials', async () => {
  assert.throws(() => validatePublicMetadataUrl('http://addons.example/manifest.json'), /HTTPS/);
  assert.throws(() => validatePublicMetadataUrl('https://token@addons.example/manifest.json'), /credentials/);
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.1.1', '192.168.1.1', '::1', 'fd00::1']) {
    assert.equal(isPublicNetworkAddress(address), false);
  }
  await assert.rejects(
    fetchIsolatedPublicJson('https://addons.example/manifest.json', {
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      transport: async () => ({ status: 200, headers: {}, body: '{}' }),
    }),
    /non-public address/,
  );
});

test('every redirect is revalidated and no ambient credentials are sent', async () => {
  const visited: string[] = [];
  const payload = await fetchIsolatedPublicJson('https://one.example/collection.json', {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    transport: async (url) => {
      visited.push(url.toString());
      return visited.length === 1
        ? { status: 302, headers: { location: 'https://two.example/data.json' }, body: '' }
        : { status: 200, headers: {}, body: '{"ok":true}' };
    },
  });
  assert.deepEqual(visited, ['https://one.example/collection.json', 'https://two.example/data.json']);
  assert.deepEqual(payload, { ok: true });
  await assert.rejects(
    fetchIsolatedPublicJson('https://one.example/collection.json', {
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: async () => ({ status: 302, headers: { location: 'https://127.0.0.1/private' }, body: '' }),
    }),
    /non-public address/,
  );
});

test('public metadata fetch fails closed on byte limits and timeouts', async () => {
  const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(
    fetchIsolatedPublicJson('https://addons.example/manifest.json', {
      resolver,
      maxBytes: 1024,
      transport: async () => ({ status: 200, headers: {}, body: 'é'.repeat(600) }),
    }),
    /size limit/,
  );
  await assert.rejects(
    fetchIsolatedPublicJson('https://addons.example/manifest.json', {
      resolver,
      timeoutMs: 250,
      transport: async () => { throw new Error('public catalog request timed out'); },
    }),
    /timed out/,
  );
});

test('collection parser accepts only movie/series catalogs and ignores stream resources', () => {
  const catalogs = metadataCatalogsFromCommunityCollection([{
    transportUrl: 'https://addons.example/manifest.json',
    manifest: {
      id: 'example.addon', name: 'Example', resources: ['catalog', 'stream'],
      catalogs: [{ type: 'movie', id: 'popular' }, { type: 'tv', id: 'channels' }],
    },
  }]);
  assert.deepEqual(catalogs, [{
    addon_id: 'example.addon', addon_name: 'Example',
    manifest_url: 'https://addons.example/manifest.json', content_type: 'movie', catalog_id: 'popular',
  }]);
});

test('public source lifecycle promotes on causal exact-main yield and quarantines violations', () => {
  const policy = playabilityPolicySnapshot().policy.source_lifecycle;
  const empty: PublicSourceLifecycleState = {
    state: 'sandbox', successful_nights: 0, unique_candidates: 0, exact_main_wins: 0,
    attempted_candidates: 0, failed_recanaries: 0, first_canary_at: null,
    quarantine_until: null, protocol_violations: 0, consecutive_fetch_failures: 0,
    candidates_since_exact_main_win: 0,
  };
  let state = empty;
  for (let night = 0; night < 3; night += 1) {
    state = evaluatePublicSourceLifecycle(state, {
      successful_night: true, unique_candidates: 10, attempted_candidates: 10, exact_main_wins: 1,
    }, policy, 1_000 + night);
  }
  assert.equal(state.state, 'promoted');
  const quarantined = evaluatePublicSourceLifecycle(empty, {
    successful_night: false, unique_candidates: 0, attempted_candidates: 0,
    exact_main_wins: 0, protocol_violation: true,
  }, policy, 10_000);
  assert.equal(quarantined.state, 'quarantined');
  assert.ok((quarantined.quarantine_until ?? 0) > 10_000);
});

test('public source lifecycle quarantines repeated fetch failures and no-win canaries', () => {
  const policy = playabilityPolicySnapshot().policy.source_lifecycle;
  const empty: PublicSourceLifecycleState = {
    state: 'sandbox', successful_nights: 0, unique_candidates: 0, exact_main_wins: 0,
    attempted_candidates: 0, failed_recanaries: 0, first_canary_at: null,
    quarantine_until: null, protocol_violations: 0, consecutive_fetch_failures: 0,
    candidates_since_exact_main_win: 0,
  };
  let fetchState = empty;
  for (let failure = 0; failure < policy.consecutive_fetch_failures; failure += 1) {
    fetchState = evaluatePublicSourceLifecycle(fetchState, {
      successful_night: false, unique_candidates: 0, attempted_candidates: 0,
      exact_main_wins: 0, fetch_failed: true,
    }, policy, 1_000 + failure);
  }
  assert.equal(fetchState.state, 'quarantined');

  const noWin = evaluatePublicSourceLifecycle(empty, {
    successful_night: true,
    unique_candidates: policy.no_win_candidate_limit,
    attempted_candidates: policy.no_win_candidate_limit,
    exact_main_wins: 0,
  }, policy, 20_000);
  assert.equal(noWin.state, 'quarantined');
});
