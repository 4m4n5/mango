import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReliability } from './model.js';
import type { ReliabilityFacts } from './types.js';

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
    last_proof: null,
  };
}

test('green state enables safe actions when couch is idle', () => {
  const state = evaluateReliability(baseFacts());
  assert.equal(state.status, 'yellow', 'missing proof should keep first-run state yellow');
  assert.equal(state.ok, true);
  assert.equal(state.actions.find((action) => action.id === 'repair')?.enabled, true);
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
  assert.equal(state.actions.find((action) => action.id === 'refresh')?.enabled, false);
  assert.equal(state.actions.find((action) => action.id === 'proof')?.enabled, true);
});
