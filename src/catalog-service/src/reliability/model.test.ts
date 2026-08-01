import assert from 'node:assert/strict';
import test from 'node:test';
import { computeStarvingRails, evaluateReliability } from './model.js';
import type { RailGrowthNight, ReliabilityFacts, ReliabilityProofRecord } from './types.js';

function baseFacts(): ReliabilityFacts {
  const now = Date.now();
  return {
    generated_at: now,
    commit: 'test123',
    idle: {
      ok: true,
      idle: true,
      age_sec: 3600,
      idle_after_sec: 1800,
      source: 'none',
      hint: '',
      ts: now - 3600_000,
      path: '/tmp/couch.json',
    },
    catalog: {
      ok: true,
      core: 'ready',
      rails_ready: true,
      live_config_ready: true,
      live_cache_fresh: true,
      live_serving_stale: false,
      live_ready: true,
      live_stale_fallback: true,
      rss_mb: 256,
    },
    launcher: {
      ok: true,
      browser: true,
      openbox: true,
      catalog_proxy: true,
    },
    controller: {
      ok: true,
      fallback: false,
      reason: 'ok',
    },
    playability: {
      ok: true,
      rail_count: 4,
      verified_total: 120,
      thin_rails: [],
      last_indexer_run_at: now - 6 * 60 * 60 * 1000,
    },
    youtube: {
      enabled: true,
      configured: true,
      videos: 1000,
      rail_count: 8,
      last_success_at: now - 60 * 60 * 1000,
      last_error: null,
      failed_phases: [],
    },
    voice: {
      expected: false,
      ok: true,
    },
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
    maintenance: {
      busy: false,
      stale_locks: [],
    },
    rail_growth: {
      threshold_nights: 3,
      history: [],
    },
    last_proof: null,
  };
}

function proofRecord(overrides: Partial<ReliabilityProofRecord> = {}): ReliabilityProofRecord {
  const now = Date.now();
  return {
    proof_id: 'proof-1',
    reason: 'nightly_after_playability_nightly',
    status: 'green',
    ok: true,
    summary: 'ok',
    generated_at: now - 60 * 60 * 1000,
    generated_at_iso: new Date(now - 60 * 60 * 1000).toISOString(),
    commit: 'abc123',
    idle: true,
    metadata: {},
    components: [],
    ...overrides,
  };
}

function nightlyNight(generatedAt: number, rails: RailGrowthNight['rails']): RailGrowthNight {
  return { generated_at: generatedAt, rails };
}

test('green state enables safe actions when couch is idle', () => {
  const state = evaluateReliability(baseFacts());
  assert.equal(state.status, 'yellow', 'missing proof should keep first-run state yellow');
  assert.equal(state.ok, true);
  assert.equal(state.actions.find((action) => action.id === 'repair')?.enabled, true);
  assert.equal(state.actions.find((action) => action.id === 'controller_repair')?.enabled, true);
  assert.equal(state.actions.find((action) => action.id === 'stack_restart')?.enabled, true);
});

test('catalog or launcher couch breakers make reliability red', () => {
  const facts = baseFacts();
  facts.launcher.browser = false;
  const state = evaluateReliability(facts);
  assert.equal(state.status, 'red');
  assert.equal(state.ok, false);
  assert.equal(state.couch_message, 'Mango is not ready for couch use.');
});

test('thin library rails are yellow but still couch-usable', () => {
  const facts = baseFacts();
  facts.playability.thin_rails = [{ rail_id: 'series-india-picks', verified_pool: 5 }];
  const state = evaluateReliability(facts);
  assert.equal(state.status, 'yellow');
  assert.equal(state.ok, true);
  assert.match(state.components.find((entry) => entry.id === 'library')?.summary ?? '', /thin rails/);
});

test('stale locks are red because they block maintenance', () => {
  const facts = baseFacts();
  facts.maintenance.stale_locks = ['playability-maintenance.lock'];
  const state = evaluateReliability(facts);
  assert.equal(state.status, 'red');
  assert.equal(state.components.find((entry) => entry.id === 'maintenance')?.status, 'red');
});

test('active couch disables disruptive actions but keeps proof available', () => {
  const facts = baseFacts();
  facts.idle.idle = false;
  facts.idle.age_sec = 10;
  facts.idle.source = 'launcher';
  const state = evaluateReliability(facts);
  assert.equal(state.actions.find((action) => action.id === 'repair')?.enabled, false);
  assert.equal(state.actions.find((action) => action.id === 'controller_repair')?.enabled, false);
  assert.equal(state.actions.find((action) => action.id === 'refresh')?.enabled, false);
  assert.equal(state.actions.find((action) => action.id === 'proof')?.enabled, true);
});

test('controller off state is healthy while the dedicated controller is powered down', () => {
  const facts = baseFacts();
  facts.controller = {
    ok: true,
    fallback: false,
    reason: 'waiting_for_controller',
    link_state: 'off',
    input_ready: false,
  };
  const state = evaluateReliability(facts);
  const controller = state.components.find((entry) => entry.id === 'controller');
  assert.equal(controller?.status, 'green');
  assert.match(controller?.summary ?? '', /off; ready to reconnect/);
});

test('controller supervisor repair state makes couch reliability red', () => {
  const facts = baseFacts();
  facts.controller = {
    ok: false,
    fallback: false,
    reason: 'controller link unavailable',
    link_state: 'needs_repair',
    last_error: 'adapter_powered_off',
  };
  const state = evaluateReliability(facts);
  const controller = state.components.find((entry) => entry.id === 'controller');
  assert.equal(controller?.status, 'red');
  assert.match(controller?.summary ?? '', /needs repair/);
  assert.equal(state.status, 'red');
});

test('generic controller failure does not claim repair when bond may still be intact', () => {
  const facts = baseFacts();
  facts.controller = {
    ok: false,
    fallback: false,
    reason: 'controller_event_missing',
    link_state: '',
    last_error: 'Host is down (112)',
  };
  const state = evaluateReliability(facts);
  const controller = state.components.find((entry) => entry.id === 'controller');
  assert.equal(controller?.status, 'red');
  assert.match(controller?.summary ?? '', /unavailable/);
  assert.doesNotMatch(controller?.summary ?? '', /needs repair/);
});

test('only confirmed pairing loss tells the operator to re-pair', () => {
  const facts = baseFacts();
  facts.controller = {
    ok: false,
    fallback: false,
    reason: 'needs_re-pair',
    link_state: 'needs_re-pair',
    last_error: 'pairing_record_missing',
  };
  const state = evaluateReliability(facts);
  const controller = state.components.find((entry) => entry.id === 'controller');
  assert.equal(controller?.status, 'red');
  assert.match(controller?.summary ?? '', /explicit re-pair required/);
});

test('connected without evdev reports input registration wait without pairing copy', () => {
  const facts = baseFacts();
  facts.controller = {
    ok: true,
    fallback: false,
    reason: 'waiting_for_controller',
    link_state: 'connected_waiting_for_input',
    input_ready: false,
  };
  const state = evaluateReliability(facts);
  const controller = state.components.find((entry) => entry.id === 'controller');
  assert.equal(controller?.status, 'green');
  assert.match(controller?.summary ?? '', /waiting for Linux input/);
  assert.doesNotMatch(controller?.summary ?? '', /pair/i);
});

test('stale Live serving is honest yellow while config remains ready', () => {
  const facts = baseFacts();
  facts.catalog.live_cache_fresh = false;
  facts.catalog.live_serving_stale = true;
  const state = evaluateReliability(facts);
  const live = state.components.find((entry) => entry.id === 'live');
  assert.equal(live?.status, 'yellow');
  assert.match(live?.summary ?? '', /serving stale cache/);
});

test('Live config without fresh or stale cache is unavailable', () => {
  const facts = baseFacts();
  facts.catalog.live_cache_fresh = false;
  facts.catalog.live_serving_stale = false;
  facts.catalog.live_stale_fallback = false;
  const state = evaluateReliability(facts);
  const live = state.components.find((entry) => entry.id === 'live');
  assert.equal(live?.status, 'red');
  assert.match(live?.summary ?? '', /no usable cache/);
});

// H7-a: playability_rc (and related fields) in the last nightly proof's
// metadata used to be ignored entirely — a failed nightly grow could leave
// the couch-facing state green.

test('a failed nightly playability refresh (nonzero playability_rc) turns the proof component yellow', () => {
  const facts = baseFacts();
  facts.last_proof = proofRecord({ status: 'green', metadata: { playability_rc: 1 } });
  const state = evaluateReliability(facts);
  assert.equal(state.status, 'yellow');
  const proof = state.components.find((entry) => entry.id === 'proof');
  assert.equal(proof?.status, 'yellow');
  assert.match(proof?.summary ?? '', /playability refresh/);
  assert.match(proof?.detail ?? '', /playability_rc=1/);
});

test('playability_ok:false or a failure_category also escalate the proof component to yellow', () => {
  const okFalseFacts = baseFacts();
  okFalseFacts.last_proof = proofRecord({ status: 'green', metadata: { playability_ok: false } });
  const okFalseState = evaluateReliability(okFalseFacts);
  assert.equal(okFalseState.components.find((entry) => entry.id === 'proof')?.status, 'yellow');

  const categoryFacts = baseFacts();
  categoryFacts.last_proof = proofRecord({ status: 'green', metadata: { failure_category: 'grow_aborted' } });
  const categoryState = evaluateReliability(categoryFacts);
  assert.equal(categoryState.components.find((entry) => entry.id === 'proof')?.status, 'yellow');
  // Grow/library failures never escalate to red — that's reserved for actual
  // playback/catalog-down.
  assert.equal(categoryState.status, 'yellow');
  assert.equal(categoryState.ok, true);
});

test('a healthy last proof (zero rc, no failure_category) stays green', () => {
  const facts = baseFacts();
  facts.last_proof = proofRecord({ status: 'green', metadata: { playability_rc: 0, youtube_rc: 0 } });
  const state = evaluateReliability(facts);
  assert.equal(state.components.find((entry) => entry.id === 'proof')?.status, 'green');
});

// Q3: sustained rail-target misses escalate to yellow via a dedicated
// Rail Growth component; a single miss (or a miss followed by a met night)
// must not trip the threshold.

test('computeStarvingRails resets a rail streak once it meets its target again', () => {
  const history: RailGrowthNight[] = [
    nightlyNight(1_000, [{ rail_id: 'movies-india-thriller', grow_target: 20, new_to_rail_verified: 2, grow_target_met: false }]),
    nightlyNight(2_000, [{ rail_id: 'movies-india-thriller', grow_target: 20, new_to_rail_verified: 3, grow_target_met: false }]),
    nightlyNight(3_000, [{ rail_id: 'movies-india-thriller', grow_target: 20, new_to_rail_verified: 21, grow_target_met: true }]),
  ];
  const starving = computeStarvingRails(history);
  assert.deepEqual(starving, []);
});

test('a rail missing its +20 target for 3 consecutive nights turns Rail Growth yellow (default N=3)', () => {
  const facts = baseFacts();
  facts.rail_growth.history = [
    nightlyNight(1_000, [{ rail_id: 'series-anime-picks', grow_target: 20, new_to_rail_verified: 4, grow_target_met: false }]),
    nightlyNight(2_000, [{ rail_id: 'series-anime-picks', grow_target: 20, new_to_rail_verified: 1, grow_target_met: false }]),
    nightlyNight(3_000, [{ rail_id: 'series-anime-picks', grow_target: 20, new_to_rail_verified: 0, grow_target_met: false }]),
  ];
  const state = evaluateReliability(facts);
  const railGrowth = state.components.find((entry) => entry.id === 'rail_growth');
  assert.equal(railGrowth?.status, 'yellow');
  assert.match(railGrowth?.detail ?? '', /series-anime-picks: missed 3n/);
  assert.equal(state.status, 'yellow');
  // A missed grow target is never a couch-down event.
  assert.equal(state.ok, true);
});

test('a rail missing its target for only 2 nights (below default N=3) stays green', () => {
  const facts = baseFacts();
  facts.rail_growth.history = [
    nightlyNight(1_000, [{ rail_id: 'series-anime-picks', grow_target: 20, new_to_rail_verified: 4, grow_target_met: false }]),
    nightlyNight(2_000, [{ rail_id: 'series-anime-picks', grow_target: 20, new_to_rail_verified: 1, grow_target_met: false }]),
  ];
  const state = evaluateReliability(facts);
  assert.equal(state.components.find((entry) => entry.id === 'rail_growth')?.status, 'green');
});

test('rail-miss threshold is configurable via facts.rail_growth.threshold_nights', () => {
  const facts = baseFacts();
  facts.rail_growth.threshold_nights = 2;
  facts.rail_growth.history = [
    nightlyNight(1_000, [{ rail_id: 'movies-korean-drama', grow_target: 20, new_to_rail_verified: 0, grow_target_met: false }]),
    nightlyNight(2_000, [{ rail_id: 'movies-korean-drama', grow_target: 20, new_to_rail_verified: 0, grow_target_met: false }]),
  ];
  const state = evaluateReliability(facts);
  assert.equal(state.components.find((entry) => entry.id === 'rail_growth')?.status, 'yellow');
});
