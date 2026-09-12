import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { computeStarvingRails } from './model.js';
import {
  ReliabilityService,
  catalogFacts,
  playabilityFacts,
  processFactsFromSnapshot,
  railGrowthHistory,
  sanitizeReliabilityProofMetadata,
  sanitizeReliabilityProofReason,
  type ReliabilityRuntimeFacts,
  type PlayabilityStatusLike,
} from './service.js';
import type { ReliabilityProofRecord } from './types.js';

test('proof metadata accepts bounded receipts and rejects privacy-risk fields', () => {
  assert.deepEqual(sanitizeReliabilityProofMetadata({
    playability_rc: 0,
    recommendation_rc: 10,
    run_id: 'playability-run-123',
    readback_ok: true,
    sampled: 24,
    broken_verified: 2,
    play_probe: false,
  }), {
    playability_rc: 0,
    recommendation_rc: 10,
    run_id: 'playability-run-123',
    readback_ok: true,
    sampled: 24,
    broken_verified: 2,
    play_probe: false,
  });
  assert.throws(
    () => sanitizeReliabilityProofMetadata({ stream_url: 'https://secret.example/token' }),
    /unknown proof metadata field/,
  );
  assert.throws(() => sanitizeReliabilityProofReason('manual reason with spaces'), /bounded identifier/);
  assert.equal(sanitizeReliabilityProofReason('nightly_after_playability_grow'), 'nightly_after_playability_grow');
});

function statusRail(railId: string, verifiedPool: number, visiblePool = verifiedPool) {
  return {
    rail_id: railId,
    pool_depth: verifiedPool,
    verified_pool: verifiedPool,
    visible_pool: visiblePool,
    pending: 0,
    stale: 0,
    failed: 0,
    last_verified_at: 1,
  };
}

function playabilityStatus(): PlayabilityStatusLike {
  return {
    ok: true,
    db_path: '/tmp/playability.db',
    schema_version: 17,
    rails: [
      statusRail('movies-active', 20),
      statusRail('series-active', 12),
      statusRail('historical-retired', 0),
    ],
    totals: {
      pool_depth: 32,
      verified_pool: 32,
      visible_pool: 32,
      pending: 0,
      stale: 0,
      failed: 0,
    },
    last_indexer_run_at: 1,
    verification: {
      legacy_verified: 20,
      exact_main_verified: 12,
      expired_verified: 0,
      identity_type_conflicts: { verified: 0, stale: 0 },
      exact_episodes: { verified: 0, stale: 0, failed: 0 },
    },
    retry_queue: { total: 0, due: 0, oldest_requested_at: null, by_reason: {} },
    publication: null,
  };
}

function refreshPayload(
  finishedAt: number,
  yieldValue: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    mode: 'grow',
    maintenance_rc: 0,
    all_rails_publishable: true,
    finished_at: finishedAt,
    rails: [{
      rail_id: 'series-active',
      grow_target: 20,
      new_to_rail_verified: yieldValue,
      grow_target_met: yieldValue >= 20,
    }],
    ...overrides,
  };
}

function writeRefresh(dir: string, name: string, payload: Record<string, unknown>): void {
  writeFileSync(join(dir, name), `${JSON.stringify(payload)}\n`, 'utf8');
}

function proofRecord(overrides: Partial<ReliabilityProofRecord> = {}): ReliabilityProofRecord {
  const now = Date.now();
  return {
    proof_id: 'proof-previous',
    reason: 'gate_m6_reliability',
    status: 'yellow',
    ok: true,
    summary: 'Mango is usable, but reliability needs attention.',
    generated_at: now - 60_000,
    generated_at_iso: new Date(now - 60_000).toISOString(),
    commit: 'previous-sha',
    idle: true,
    metadata: {},
    components: [{
      id: 'proof',
      label: 'Last Reliability Proof',
      status: 'yellow',
      summary: 'last proof was yellow',
    }],
    ...overrides,
  };
}

async function withTempProofLedger<T>(
  proof: ReliabilityProofRecord,
  fn: () => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-proof-'));
  const previousPath = process.env.MANGO_RELIABILITY_PROOF_PATH;
  process.env.MANGO_RELIABILITY_PROOF_PATH = join(dir, 'proofs.jsonl');
  writeFileSync(process.env.MANGO_RELIABILITY_PROOF_PATH, `${JSON.stringify(proof)}\n`, 'utf8');
  try {
    return await fn();
  } finally {
    if (previousPath === undefined) {
      delete process.env.MANGO_RELIABILITY_PROOF_PATH;
    } else {
      process.env.MANGO_RELIABILITY_PROOF_PATH = previousPath;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withLauncherHealth<T>(fn: () => Promise<T>): Promise<T> {
  const previousPort = process.env.MANGO_LAUNCHER_PORT;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        checks: {
          launcher_browser: true,
          openbox: 'active',
          catalog: true,
        },
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.env.MANGO_LAUNCHER_PORT = String(address.port);
  try {
    return await fn();
  } finally {
    if (previousPort === undefined) {
      delete process.env.MANGO_LAUNCHER_PORT;
    } else {
      process.env.MANGO_LAUNCHER_PORT = previousPort;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('library facts exclude historical status rows but preserve genuine active thin rails', () => {
  const healthy = playabilityFacts(playabilityStatus(), ['movies-active', 'series-active']);
  assert.equal(healthy.rail_count, 2);
  assert.equal(healthy.verified_distinct, 32);
  assert.equal(healthy.verified_total, 32);
  assert.equal(healthy.visible_total, 32);
  assert.deepEqual(healthy.thin_rails, []);

  const status = playabilityStatus();
  status.rails[1] = statusRail('series-active', 5);
  const thin = playabilityFacts(status, ['movies-active', 'series-active']);
  assert.equal(thin.verified_total, 25);
  assert.equal(thin.visible_total, 25);
  assert.deepEqual(thin.thin_rails, [{ rail_id: 'series-active', verified_pool: 5, visible_pool: 5 }]);
});

test('library facts use visible pool for browse-thin rails without relabeling it fresh', () => {
  const status = playabilityStatus();
  status.rails[1] = statusRail('series-active', 5, 12);
  status.totals.verified_pool = 25;
  status.totals.visible_pool = 32;
  const facts = playabilityFacts(status, ['movies-active', 'series-active']);
  assert.equal(facts.verified_total, 25);
  assert.equal(facts.visible_total, 32);
  assert.deepEqual(facts.thin_rails, []);

  status.rails[1] = statusRail('series-active', 12, 5);
  const visibleThin = playabilityFacts(status, ['movies-active', 'series-active']);
  assert.equal(visibleThin.verified_total, 32);
  assert.equal(visibleThin.visible_total, 25);
  assert.deepEqual(visibleThin.thin_rails, [
    { rail_id: 'series-active', verified_pool: 12, visible_pool: 5 },
  ]);
});

test('library facts exclude expired distinct verified rows from current proof', () => {
  const status = playabilityStatus();
  status.verification = {
    legacy_verified: 6680,
    exact_main_verified: 2750,
    expired_verified: 6680,
    identity_type_conflicts: { verified: 0, stale: 0 },
    exact_episodes: { verified: 0, stale: 0, failed: 0 },
  };
  const facts = playabilityFacts(status, ['movies-active', 'series-active']);
  assert.equal(facts.verified_distinct, 2750);
  assert.equal(facts.expired_verified, 6680);
});

test('catalog facts treat absent Live rails as optional disabled state', () => {
  const facts = catalogFacts({
    ok: true,
    core: 'ready',
    rails_ready: true,
    live_rails: 0,
    live_ready: false,
    live: {
      ready: false,
      config_ready: false,
      cache_fresh: false,
      sources: [],
      cache: { fresh: false, non_empty: false },
    },
  });
  assert.equal(facts.live_enabled, false);
  assert.equal(facts.live_config_ready, false);
});

test('catalog facts preserve configured empty-cache Live as enabled', () => {
  const facts = catalogFacts({
    ok: true,
    core: 'ready',
    rails_ready: true,
    live_rails: 1,
    live_ready: false,
    live: {
      ready: false,
      config_ready: false,
      cache_fresh: false,
      sources: [{ addon: 'mango Live TV', catalog: 'tv' }],
      cache: { fresh: false, non_empty: false },
    },
  });
  assert.equal(facts.live_enabled, true);
  assert.equal(facts.live_config_ready, false);
});

test('catalog facts preserve malformed configured Live as enabled from config error', () => {
  const facts = catalogFacts({
    ok: true,
    core: 'ready',
    rails_ready: true,
    live_rails: 0,
    live_ready: false,
    live: {
      ready: false,
      config_ready: false,
      cache_fresh: false,
      config_error: 'live catalog rails must be a non-empty array',
      sources: [],
      cache: { fresh: false, non_empty: false },
    },
  });
  assert.equal(facts.live_enabled, true);
  assert.equal(facts.live_config_ready, false);
});

test('rail growth counts one completed publishable refresh per local calendar date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-growth-'));
  try {
    const dayOneEarly = new Date(2026, 0, 10, 2, 0, 0).getTime();
    const dayOneLate = new Date(2026, 0, 10, 18, 0, 0).getTime();
    const dayTwo = new Date(2026, 0, 11, 3, 0, 0).getTime();
    const dayThree = new Date(2026, 0, 12, 3, 0, 0).getTime();
    writeRefresh(dir, 'refresh-playability-20260110-020000.json', refreshPayload(dayOneEarly, 1));
    writeRefresh(dir, 'refresh-playability-20260110-180000.json', refreshPayload(dayOneLate, 5));
    writeRefresh(dir, 'refresh-playability-20260111-030000.json', refreshPayload(dayTwo, 2));
    writeRefresh(dir, 'refresh-playability-20260112-030000.json', refreshPayload(dayThree, 3));

    const history = railGrowthHistory(['series-active'], dir);
    assert.equal(history.length, 3);
    assert.equal(history[0]?.generated_at, dayOneLate);
    assert.equal(history[0]?.rails[0]?.new_to_rail_verified, 5);
    assert.equal(computeStarvingRails(history)[0]?.nights_missed, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rail growth ignores incomplete, discarded, and historical-rail artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-growth-'));
  try {
    const base = new Date(2026, 1, 1, 3, 0, 0).getTime();
    writeRefresh(dir, 'refresh-playability-20260201-030000.json', refreshPayload(base, 2, { ok: false }));
    writeRefresh(dir, 'refresh-playability-20260202-030000.json', refreshPayload(base + 86_400_000, 2, { maintenance_rc: 1 }));
    writeRefresh(dir, 'refresh-playability-20260203-030000.json', refreshPayload(base + 2 * 86_400_000, 2, { all_rails_publishable: false }));
    writeRefresh(dir, 'refresh-playability-20260204-030000.json', refreshPayload(base + 3 * 86_400_000, 2, { finished_at: null }));
    writeRefresh(dir, 'refresh-playability-20260205-030000.json', refreshPayload(base + 4 * 86_400_000, 2, {
      rails: [{
        rail_id: 'historical-retired',
        grow_target: 20,
        new_to_rail_verified: 0,
        grow_target_met: false,
      }],
    }));
    writeRefresh(dir, 'refresh-playability-20260206-030000.json', refreshPayload(base + 5 * 86_400_000, 2));

    const history = railGrowthHistory(['series-active'], dir);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.rails[0]?.rail_id, 'series-active');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid artifact bursts cannot evict older valid calendar-night evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-growth-'));
  try {
    const first = new Date(2026, 2, 1, 3, 0, 0).getTime();
    for (let day = 0; day < 3; day += 1) {
      writeRefresh(
        dir,
        `refresh-playability-2026030${day + 1}-030000.json`,
        refreshPayload(first + day * 86_400_000, 1),
      );
    }
    for (let index = 0; index < 121; index += 1) {
      writeRefresh(
        dir,
        `refresh-playability-20260401-invalid-${String(index).padStart(3, '0')}.json`,
        refreshPayload(first + 31 * 86_400_000 + index, 0, { ok: false }),
      );
    }

    const history = railGrowthHistory(['series-active'], dir);
    assert.equal(history.length, 3);
    assert.equal(computeStarvingRails(history)[0]?.nights_missed, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runtimeFacts(): ReliabilityRuntimeFacts {
  return {
    commit: 'test-sha',
    controller: { ok: true, fallback: false, reason: 'ok' },
    voice: { expected: false, ok: true },
    processes: {
      launcher_browsers: 1,
      stremio: 0,
      kodi: 0,
      mpv: 0,
      indexer: 0,
      orphan_debug: 0,
      pad_processes: 1,
      remapper_processes: 0,
    },
    maintenance: { busy: false, stale_locks: [] },
  };
}

function testReliabilityService(options: {
  runtimeFacts?: () => Promise<ReliabilityRuntimeFacts>;
  catalogHealth?: () => Record<string, unknown>;
  commandRunner?: (command: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; ok: boolean }>;
  stateCacheTtlMs?: number;
} = {}): ReliabilityService {
  return new ReliabilityService({
    catalogHealth: options.catalogHealth ?? (() => ({
      ok: true,
      core: 'ready',
      rails_ready: true,
      live: { config_ready: true, cache_fresh: true, cache: { fresh: true } },
      rss_mb: 128,
    })),
    playabilityStatus: async () => playabilityStatus() as PlayabilityStatusLike & { ok: true },
    activePlayabilityRailIds: () => ['movies-active', 'series-active'],
    youtubeState: () => ({
      enabled: true,
      configured: { api_key: true },
      cache: { videos: 24, rail_count: 6 },
      refresh: { last_success_at: Date.now(), last_error: null, phase_results: [] },
    }),
    ...(options.runtimeFacts ? { runtimeFacts: options.runtimeFacts } : {}),
    ...(options.commandRunner ? { commandRunner: options.commandRunner } : {}),
    stateCacheTtlMs: options.stateCacheTtlMs ?? 200,
  });
}

test('state snapshots coalesce concurrent expensive runtime probes', async () => {
  let calls = 0;
  const service = testReliabilityService({
    runtimeFacts: async () => {
      calls += 1;
      await new Promise((resolve) => { setTimeout(resolve, 25); });
      return runtimeFacts();
    },
  });
  const [first, second] = await Promise.all([service.state(), service.state()]);
  assert.equal(calls, 1);
  assert.equal(first.generated_at, second.generated_at);
  assert.equal(first.freshness?.fresh, true);
  assert.equal(first.freshness?.cache_ttl_ms, 200);
});

test('warm state reads reuse the fresh snapshot and do not re-run runtime probes', async () => {
  let calls = 0;
  const service = testReliabilityService({
    runtimeFacts: async () => {
      calls += 1;
      return runtimeFacts();
    },
    stateCacheTtlMs: 500,
  });
  const first = await service.state();
  const warm = await service.state();
  assert.equal(calls, 1);
  assert.equal(warm.generated_at, first.generated_at);
  assert.ok((warm.freshness?.snapshot_age_ms ?? -1) >= 0);
});

test('expired snapshots force a fresh runtime probe instead of stale readiness', async () => {
  let calls = 0;
  const service = testReliabilityService({
    runtimeFacts: async () => {
      calls += 1;
      return runtimeFacts();
    },
    stateCacheTtlMs: 0,
  });
  const first = await service.state();
  const second = await service.state();
  assert.equal(calls, 2);
  assert.ok((second.freshness?.probe_started_at ?? 0) >= (first.freshness?.probe_started_at ?? 0));
});

test('default runtime probes are asynchronous enough for unrelated timers to advance', async () => {
  let calls = 0;
  const service = testReliabilityService({
    commandRunner: async (command, args) => {
      calls += 1;
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      if (command === 'git') return { stdout: 'async-sha', ok: true };
      if (command === 'ps') {
        return {
          stdout: [
            '123 chromium mango-launcher http://127.0.0.1:3000/',
            '124 mango-tv-pad.py',
          ].join('\n'),
          ok: true,
        };
      }
      if (command === 'bash' && args.some((arg) => arg.endsWith('pad-health.sh'))) {
        return { stdout: JSON.stringify({ ok: true, reason: 'ok' }), ok: true };
      }
      return { stdout: '', ok: false };
    },
    stateCacheTtlMs: 0,
  });
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  try {
    const state = await service.state();
    assert.equal(state.commit, 'async-sha');
  } finally {
    clearInterval(timer);
  }
  assert.ok(calls >= 4, `expected default probes to run, saw ${calls}`);
  assert.ok(ticks > 0, 'timer did not advance while slow runtime probes were in flight');
});

test('process facts count full-path mpv without matching wrapper scripts', () => {
  const facts = processFactsFromSnapshot([
    '101 /usr/bin/mpv --idle=yes',
    '102 mpv --no-config',
    '103 /home/pi/mango/scripts/m2-catalog/service/mpv-play.sh --request',
    '104 node /tmp/mention-mpv-in-wrapper.js',
    '105 /usr/bin/python3 mango-tv-pad.py',
  ].join('\n'));
  assert.equal(facts.mpv, 2);
  assert.equal(facts.pad_processes, 1);
});

test('forced state refreshes bypass warm cache but coalesce with an in-flight probe', async () => {
  let calls = 0;
  const service = testReliabilityService({
    runtimeFacts: async () => {
      calls += 1;
      await new Promise((resolve) => { setTimeout(resolve, 25); });
      return runtimeFacts();
    },
    stateCacheTtlMs: 500,
  });
  await service.state();
  const [first, second] = await Promise.all([
    service.state({ force: true }),
    service.state({ force: true }),
  ]);
  assert.equal(calls, 2);
  assert.equal(first.generated_at, second.generated_at);
});

test('idle-gated actions re-read couch activity instead of trusting a stale cached idle snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-idle-'));
  const previous = process.env.MANGO_COUCH_ACTIVITY_STATE;
  process.env.MANGO_COUCH_ACTIVITY_STATE = join(dir, 'couch-activity.json');
  try {
    writeFileSync(
      process.env.MANGO_COUCH_ACTIVITY_STATE,
      JSON.stringify({ ts: Date.now() - 3_600_000, source: 'test', hint: 'old' }),
    );
    const service = testReliabilityService({
      runtimeFacts: async () => runtimeFacts(),
      stateCacheTtlMs: 30_000,
    });
    const cached = await service.state();
    assert.equal(cached.idle.idle, true);

    writeFileSync(
      process.env.MANGO_COUCH_ACTIVITY_STATE,
      JSON.stringify({ ts: Date.now(), source: 'mpv', hint: 'playing' }),
    );
    const result = await service.repair();
    assert.equal(result.ok, false);
    assert.match(result.message, /active recently from mpv/);
    assert.equal(result.state?.idle.idle, false);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_COUCH_ACTIVITY_STATE;
    } else {
      process.env.MANGO_COUCH_ACTIVITY_STATE = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProof records current healthy observations instead of inheriting prior yellow proof color', async () => {
  await withTempProofLedger(proofRecord({ status: 'yellow' }), async () => {
    await withLauncherHealth(async () => {
      const service = testReliabilityService({ runtimeFacts: async () => runtimeFacts(), stateCacheTtlMs: 0 });
      const historical = await service.state();
      const historicalProof = historical.components.find((entry) => entry.id === 'proof');
      assert.equal(historicalProof?.label, 'Last Reliability Proof');
      assert.equal(historicalProof?.status, 'yellow');
      assert.equal(historical.status, 'yellow');

      const result = await service.runProof('gate_m6_reliability', {
        sampled: 32,
        broken_verified: 0,
      });

      assert.equal(result.proof.status, 'green');
      assert.equal(result.ok, true);
      assert.equal(result.state.status, 'green');
      const recordedProof = result.proof.components.find((entry) => entry.id === 'proof');
      assert.equal(recordedProof?.label, 'Last Reliability Proof');
      assert.equal(recordedProof?.status, 'green');
      assert.equal(recordedProof?.summary, 'current reliability proof uses fresh observations');
    });
  });
});

test('runProof preserves current rc metadata warnings while avoiding prior-proof inertia', async () => {
  const cases: Array<{
    metadata: Record<string, number>;
    detail: RegExp;
  }> = [
    { metadata: { playability_rc: 1 }, detail: /playability_rc=1/ },
    { metadata: { recommendation_rc: 10 }, detail: /recommendation_rc=10/ },
    { metadata: { youtube_rc: 2 }, detail: /youtube_rc=2/ },
    { metadata: { maintenance_rc: 3 }, detail: /maintenance_rc=3/ },
    { metadata: { broken_verified: 1 }, detail: /broken_verified=1/ },
  ];

  for (const scenario of cases) {
    await withTempProofLedger(proofRecord({ status: 'yellow' }), async () => {
      await withLauncherHealth(async () => {
        const service = testReliabilityService({ runtimeFacts: async () => runtimeFacts(), stateCacheTtlMs: 0 });
        const result = await service.runProof('nightly_after_playability_nightly', scenario.metadata);
        assert.equal(result.proof.status, 'yellow');
        assert.equal(result.proof.ok, true);
        const proof = result.proof.components.find((entry) => entry.id === 'proof');
        assert.equal(proof?.status, 'yellow');
        assert.match(proof?.detail ?? '', scenario.detail);
      });
    });
  }
});

test('runProof preserves current red and yellow components when previous proof was the only historical warning', async () => {
  await withTempProofLedger(proofRecord({ status: 'yellow' }), async () => {
    await withLauncherHealth(async () => {
      const service = testReliabilityService({
        runtimeFacts: async () => runtimeFacts(),
        stateCacheTtlMs: 0,
        catalogHealth: () => ({
          ok: true,
          core: 'ready',
          rails_ready: true,
          live_rails: 1,
          live: {
            config_ready: true,
            cache_fresh: false,
            serving_stale: false,
            stale_fallback_available: false,
            sources: [{ addon: 'mango Live TV', catalog: 'tv' }],
            cache: { fresh: false, non_empty: false },
          },
          rss_mb: 128,
        }),
      });

      const result = await service.runProof('gate_m6_reliability', {
        sampled: 32,
        broken_verified: 0,
      });

      assert.equal(result.proof.status, 'red');
      assert.equal(result.ok, false);
      const live = result.proof.components.find((entry) => entry.id === 'live');
      assert.equal(live?.status, 'red');
      const proof = result.proof.components.find((entry) => entry.id === 'proof');
      assert.equal(proof?.status, 'green');
    });
  });
});
