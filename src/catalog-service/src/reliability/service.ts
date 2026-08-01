import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { PlayabilityStatus } from '../playability/db.js';
import { startRefreshJob } from '../playability/refresh-control.js';
import { computeStarvingRails, evaluateReliability } from './model.js';
import {
  appendReliabilityProof,
  latestReliabilityProof,
  listReliabilityProofs,
} from './store.js';
import type {
  RailGrowthNight,
  ReliabilityFacts,
  ReliabilityProofRecord,
  ReliabilityState,
} from './types.js';

type CatalogHealth = Record<string, unknown>;
type YoutubeState = Record<string, unknown>;
type PlayabilityStatusLike = Omit<PlayabilityStatus, 'ok'> & {
  ok: boolean;
  error?: string;
};

export type ReliabilityServiceOptions = {
  catalogHealth: () => CatalogHealth;
  playabilityStatus: () => Promise<PlayabilityStatus>;
  youtubeState: () => YoutubeState;
};

export type ReliabilityActionResult = {
  ok: boolean;
  action: string;
  pid?: number;
  message: string;
  state?: ReliabilityState;
  error?: string;
};

function repoDir(): string {
  return process.env.MANGO_REPO_DIR || resolve(process.cwd(), '../..');
}

function cacheDir(): string {
  return process.env.XDG_CACHE_HOME || join(process.env.HOME || '/tmp', '.cache', 'mango');
}

function couchActivityPath(): string {
  return process.env.MANGO_COUCH_ACTIVITY_STATE || join(cacheDir(), 'couch-activity.json');
}

function controllerLinkStatusPath(): string {
  return process.env.MANGO_CONTROLLER_LINK_STATUS_PATH || join(cacheDir(), 'mango-controller-link-status.json');
}

function opsDir(): string {
  return join(cacheDir(), 'ops');
}

function railMissNightsThreshold(): number {
  const parsed = Number(process.env.MANGO_RAIL_MISS_NIGHTS || 3);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 3;
}

function idleAfterSec(): number {
  const parsed = Number(process.env.MANGO_COUCH_IDLE_SEC || 1800);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1800;
}

function nowMs(): number {
  return Date.now();
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeBool(value: unknown): boolean {
  return value === true;
}

function commandText(command: string, args: string[], timeoutMs = 2500): string {
  const result = spawnSync(command, args, {
    cwd: repoDir(),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function processCount(pattern: string): number {
  const stdout = commandText('pgrep', ['-f', pattern], 1500);
  return stdout ? stdout.split('\n').filter(Boolean).length : 0;
}

function commandOk(command: string, args: string[], timeoutMs = 2500): boolean {
  const result = spawnSync(command, args, {
    cwd: repoDir(),
    stdio: 'ignore',
    timeout: timeoutMs,
  });
  return result.status === 0;
}

function commandJson(command: string, args: string[], timeoutMs = 2500): Record<string, unknown> {
  const stdout = commandText(command, args, timeoutMs);
  if (!stdout) return {};
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function httpJson(url: string, timeoutMs = 2500): Promise<Record<string, unknown>> {
  return new Promise((resolveJson) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          resolveJson(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {});
        } catch {
          resolveJson({});
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolveJson({});
    });
    req.on('error', () => resolveJson({}));
  });
}

async function readCouchIdle(): Promise<ReliabilityFacts['idle']> {
  const path = couchActivityPath();
  const threshold = idleAfterSec();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    data = { ts: 0, source: 'none', hint: '' };
  }
  const ts = safeNumber(data.ts, 0);
  const ageSec = ts > 0 ? Math.max(0, Math.round((nowMs() - ts) / 1000)) : 1_000_000_000;
  return {
    ok: true,
    idle: ageSec >= threshold,
    age_sec: ageSec,
    idle_after_sec: threshold,
    source: safeString(data.source, 'unknown'),
    hint: safeString(data.hint, ''),
    ts,
    path,
  };
}

function lockHeld(lockPath: string): boolean {
  const result = spawnSync('python3', [
    '-c',
    [
      'import fcntl, os, sys',
      'path = sys.argv[1]',
      'try:',
      '    fd = os.open(path, os.O_RDWR)',
      'except OSError:',
      '    sys.exit(2)',
      'try:',
      '    try:',
      '        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)',
      '    except BlockingIOError:',
      '        sys.exit(0)',
      '    sys.exit(1)',
      'finally:',
      '    os.close(fd)',
    ].join('\n'),
    lockPath,
  ], { stdio: 'ignore', timeout: 1500 });
  return result.status === 0;
}

function staleLocks(): string[] {
  let names: string[];
  try {
    names = readdirSync(cacheDir()).filter((name) => name.endsWith('.lock'));
  } catch {
    return [];
  }
  return names.filter((name) => !lockHeld(join(cacheDir(), name))).sort();
}

function maintenanceBusy(): boolean {
  if (processCount('[p]layability-maintenance.sh|[n]ightly-library-refresh.sh|[o]vernight-playability-grow.sh') > 0) {
    return true;
  }
  const lock = join(cacheDir(), 'playability-maintenance.lock');
  return lockHeld(lock);
}

function gitCommit(): string {
  return commandText('git', ['rev-parse', '--short', 'HEAD'], 1500) || 'unknown';
}

async function launcherHealth(): Promise<ReliabilityFacts['launcher']> {
  const port = process.env.MANGO_LAUNCHER_PORT || '3000';
  const health = await httpJson(`http://127.0.0.1:${port}/api/health`, 2500);
  const checks = health.checks && typeof health.checks === 'object'
    ? health.checks as Record<string, unknown>
    : {};
  return {
    ok: safeBool(health.ok),
    browser: safeBool(checks.launcher_browser),
    openbox: checks.openbox === 'active',
    catalog_proxy: safeBool(checks.catalog),
  };
}

function controllerHealth(): ReliabilityFacts['controller'] {
  const script = join(repoDir(), 'scripts/m1-foundation/pad/pad-health.sh');
  const data = commandJson('bash', [script, '--json', '--quiet'], 3500);
  const ok = safeBool(data.ok);
  const fallback = processCount('input-remapper-service') > 0;
  let link: Record<string, unknown> = {};
  try {
    link = JSON.parse(readFileSync(controllerLinkStatusPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    // Older Pi installs do not have the supervisor yet; preserve the existing
    // pad-health result until the controller installer is applied.
  }
  const updatedAt = safeNumber(link.updated_at, 0);
  const updatedAtMs = updatedAt > 0 && updatedAt < 10_000_000_000 ? updatedAt * 1000 : updatedAt;
  const fresh = updatedAtMs > 0 && nowMs() - updatedAtMs <= 10_000;
  const linkState = safeString(link.state);
  const linkOk = safeBool(link.ok) && fresh;
  const reason = safeString(data.reason, ok ? 'ok' : 'pad health unavailable');
  return {
    ok: linkState ? linkOk && (
      ok
      || linkState === 'off'
      || linkState === 'maintenance_retry'
      || linkState === 'fast_retry'
      || linkState === 'connecting'
      || linkState === 'connected_waiting_for_input'
      || linkState === 'peripheral_asleep'
    ) : ok,
    fallback,
    reason,
    link_state: linkState || undefined,
    input_ready: safeBool(link.input_ready),
    last_error: safeString(link.last_error) || undefined,
    updated_at: updatedAt || undefined,
  };
}

function catalogFacts(health: CatalogHealth): ReliabilityFacts['catalog'] {
  const live = health.live && typeof health.live === 'object'
    ? health.live as Record<string, unknown>
    : {};
  const liveCache = live.cache && typeof live.cache === 'object'
    ? live.cache as Record<string, unknown>
    : {};
  return {
    ok: safeBool(health.ok),
    core: safeString(health.core, 'unknown'),
    rails_ready: safeBool(health.rails_ready),
    live_config_ready: safeBool(live.config_ready) || safeBool(health.live_ready) || safeBool(live.ready),
    live_cache_fresh: safeBool(live.cache_fresh) || safeBool(liveCache.fresh),
    live_serving_stale: safeBool(live.serving_stale) || (
      (safeBool(live.stale_fallback_available) || safeBool(liveCache.non_empty))
      && !safeBool(live.cache_fresh)
      && !safeBool(liveCache.fresh)
    ),
    live_ready: safeBool(live.config_ready) || safeBool(health.live_ready) || safeBool(live.ready),
    live_stale_fallback: safeBool(live.stale_fallback_available) || safeBool(liveCache.non_empty),
    rss_mb: health.rss_mb === undefined ? null : safeNumber(health.rss_mb, 0),
  };
}

function playabilityFacts(status: PlayabilityStatusLike): ReliabilityFacts['playability'] {
  const rails = status.rails || [];
  return {
    ok: status.ok === true,
    rail_count: rails.length,
    verified_total: safeNumber(status.totals?.verified_pool, 0),
    thin_rails: rails
      .filter((rail) => safeNumber(rail.verified_pool, 0) < 9)
      .map((rail) => ({ rail_id: rail.rail_id, verified_pool: safeNumber(rail.verified_pool, 0) })),
    last_indexer_run_at: status.last_indexer_run_at ?? null,
  };
}

function youtubeFacts(state: YoutubeState): ReliabilityFacts['youtube'] {
  const configured = state.configured && typeof state.configured === 'object'
    ? state.configured as Record<string, unknown>
    : {};
  const refresh = state.refresh && typeof state.refresh === 'object'
    ? state.refresh as Record<string, unknown>
    : {};
  const cache = state.cache && typeof state.cache === 'object'
    ? state.cache as Record<string, unknown>
    : {};
  const railIds = Array.isArray(cache.rail_ids) ? cache.rail_ids : [];
  const phases = Array.isArray(refresh.phase_results) ? refresh.phase_results : [];
  return {
    enabled: state.enabled !== false,
    configured: safeBool(configured.api_key),
    videos: safeNumber(cache.videos, 0),
    rail_count: railIds.length,
    last_success_at: refresh.last_success_at === null ? null : safeNumber(refresh.last_success_at, 0) || null,
    last_error: typeof refresh.last_error === 'string' ? refresh.last_error : null,
    failed_phases: phases
      .filter((phase) => phase && typeof phase === 'object' && (phase as Record<string, unknown>).ok !== true)
      .map((phase) => safeString((phase as Record<string, unknown>).phase, 'unknown')),
  };
}

function voiceFacts(): ReliabilityFacts['voice'] {
  const expected = process.env.MANGO_VOICE === '1';
  if (!expected) {
    return { expected, ok: true };
  }
  const ok = commandOk('curl', ['-skf', '--max-time', '2', 'https://127.0.0.1:8765/health'], 3000)
    || commandOk('curl', ['-sf', '--max-time', '2', 'http://127.0.0.1:8765/health'], 3000);
  return { expected, ok };
}

function processFacts(): ReliabilityFacts['processes'] {
  const launcherPort = process.env.MANGO_LAUNCHER_PORT || '3000';
  const chromium = processCount(`chromium.*mango-launcher.*127.0.0.1:${launcherPort}/`);
  const firefox = processCount(`firefox.*127.0.0.1:${launcherPort}/`);
  return {
    launcher_browsers: chromium + firefox,
    stremio: processCount('stremio'),
    kodi: processCount('kodi'),
    mpv: processCount('[m]pv'),
    indexer: processCount('playability-indexer'),
    orphan_debug: processCount('node --input-type=module -e.*CatalogCore'),
    pad_processes: processCount('mango-tv-pad\\.py'),
    remapper_processes: processCount('input-remapper-service'),
  };
}

const REFRESH_JSON_MAX_FILES = 120;

function refreshJsonFileNames(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => (
      name.startsWith('refresh-playability-') && name.endsWith('.json') && !name.endsWith('-deferred.json')
    ));
  } catch {
    return [];
  }
}

function refreshPayloadTimestamp(dir: string, name: string, payload: Record<string, unknown>): number {
  const finished = safeNumber(payload.finished_at, 0);
  if (finished > 0) return finished;
  const started = safeNumber(payload.started_at, 0);
  if (started > 0) return started;
  try {
    return statSync(join(dir, name)).mtimeMs;
  } catch {
    return 0;
  }
}

function refreshPayloadRailNight(payload: Record<string, unknown>): RailGrowthNight['rails'] {
  const mode = payload.mode;
  if (mode !== undefined && mode !== 'grow' && mode !== 'nightly') return [];
  const rails = Array.isArray(payload.rails) ? payload.rails : [];
  return rails
    .filter((row): row is Record<string, unknown> => (
      !!row && typeof row === 'object' && typeof (row as Record<string, unknown>).rail_id === 'string'
    ))
    .map((row) => {
      const growTarget = safeNumber(row.grow_target, 20);
      const freshVerified = safeNumber(
        row.new_to_rail_verified ?? row.fresh_verified ?? row.probe_verified,
        0,
      );
      const met = typeof row.grow_target_met === 'boolean' ? row.grow_target_met : freshVerified >= growTarget;
      return {
        rail_id: safeString(row.rail_id),
        grow_target: growTarget,
        new_to_rail_verified: freshVerified,
        grow_target_met: met,
      };
    });
}

/** Reads nightly/grow refresh JSON (scripts/diag/extract_refresh_json.py output) into per-night rail rows. */
function railGrowthHistory(): RailGrowthNight[] {
  const dir = opsDir();
  const names = refreshJsonFileNames(dir).slice(-REFRESH_JSON_MAX_FILES);
  const nights: RailGrowthNight[] = [];
  for (const name of names) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const rails = refreshPayloadRailNight(payload);
    if (rails.length === 0) continue;
    nights.push({ generated_at: refreshPayloadTimestamp(dir, name, payload), rails });
  }
  return nights;
}

function railGrowthFacts(): ReliabilityFacts['rail_growth'] {
  return { threshold_nights: railMissNightsThreshold(), history: railGrowthHistory() };
}

function runDetached(script: string, args: string[]): number {
  const child = spawn('bash', [script, ...args], {
    cwd: repoDir(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      MANGO_REPO_DIR: repoDir(),
    },
  });
  child.unref();
  return child.pid ?? 0;
}

export class ReliabilityService {
  constructor(private readonly options: ReliabilityServiceOptions) {}

  private async gatherFacts(): Promise<ReliabilityFacts> {
    const [idle, launcher, playability] = await Promise.all([
      readCouchIdle(),
      launcherHealth(),
      this.options.playabilityStatus().catch((error: unknown) => ({
        ok: false,
        db_path: '',
        schema_version: 0,
        rails: [],
        totals: { pool_depth: 0, verified_pool: 0, pending: 0, stale: 0, failed: 0 },
        last_indexer_run_at: null,
        error: error instanceof Error ? error.message : String(error),
      } as PlayabilityStatusLike)),
    ]);
    const playabilityInfo = playabilityFacts(playability);
    if ('error' in playability && playability.error) {
      playabilityInfo.error = playability.error;
    }
    return {
      generated_at: nowMs(),
      commit: gitCommit(),
      idle,
      catalog: catalogFacts(this.options.catalogHealth()),
      launcher,
      controller: controllerHealth(),
      playability: playabilityInfo,
      youtube: youtubeFacts(this.options.youtubeState()),
      voice: voiceFacts(),
      processes: processFacts(),
      maintenance: {
        busy: maintenanceBusy(),
        stale_locks: staleLocks(),
      },
      rail_growth: railGrowthFacts(),
      last_proof: latestReliabilityProof(),
    };
  }

  async state(): Promise<ReliabilityState> {
    return evaluateReliability(await this.gatherFacts());
  }

  async controller(): Promise<ReliabilityFacts['controller']> {
    return controllerHealth();
  }

  proofs(limit = 20): ReliabilityProofRecord[] {
    return listReliabilityProofs(limit);
  }

  async runProof(reason = 'manual', metadata: Record<string, unknown> = {}): Promise<{
    ok: boolean;
    proof: ReliabilityProofRecord;
    state: ReliabilityState;
  }> {
    const facts = await this.gatherFacts();
    const state = evaluateReliability(facts);
    const starvingRails = computeStarvingRails(facts.rail_growth.history)
      .filter((rail) => rail.nights_missed >= facts.rail_growth.threshold_nights);
    // Operator-only digest of starving rails, attached automatically so it is
    // never lost even if the caller (e.g. the nightly proof shell hop) does
    // not know about rail-growth tracking. Never surfaced on the TV.
    const mergedMetadata: Record<string, unknown> = { ...metadata };
    if (starvingRails.length > 0) {
      mergedMetadata.starving_rails = starvingRails.map((rail) => ({
        rail_id: rail.rail_id,
        nights_missed: rail.nights_missed,
        last_yield: rail.last_yield,
        grow_target: rail.grow_target,
      }));
    }
    const record: ReliabilityProofRecord = {
      proof_id: randomUUID(),
      reason,
      status: state.status,
      ok: state.status !== 'red',
      summary: state.summary,
      generated_at: state.generated_at,
      generated_at_iso: state.generated_at_iso,
      commit: state.commit,
      idle: state.idle.idle,
      metadata: mergedMetadata,
      components: state.components,
    };
    appendReliabilityProof(record);
    return { ok: record.ok, proof: record, state };
  }

  async repair(): Promise<ReliabilityActionResult> {
    const state = await this.state();
    const action = state.actions.find((entry) => entry.id === 'repair');
    if (!action?.enabled) {
      return {
        ok: false,
        action: 'repair',
        message: action?.reason || 'repair requires idle couch state',
        state,
      };
    }
    const pid = runDetached(join(repoDir(), 'scripts/mango-health-repair.sh'), ['--quiet']);
    return { ok: pid > 0, action: 'repair', pid, message: 'safe repair started', state };
  }

  async repairController(): Promise<ReliabilityActionResult> {
    const state = await this.state();
    const action = state.actions.find((entry) => entry.id === 'controller_repair');
    if (!action?.enabled) {
      return {
        ok: false,
        action: 'controller_repair',
        message: action?.reason || 'controller repair requires idle couch state',
        state,
      };
    }
    const pid = runDetached(join(repoDir(), 'scripts/m1-foundation/pad/controller-link-control.sh'), ['--repair']);
    return { ok: pid > 0, action: 'controller_repair', pid, message: 'controller repair requested', state };
  }

  async restartStack(): Promise<ReliabilityActionResult> {
    const state = await this.state();
    const action = state.actions.find((entry) => entry.id === 'stack_restart');
    if (!action?.enabled) {
      return {
        ok: false,
        action: 'stack_restart',
        message: action?.reason || 'stack restart requires idle couch state',
        state,
      };
    }
    const pid = runDetached(join(repoDir(), 'scripts/mango-stack.sh'), ['restart']);
    return { ok: pid > 0, action: 'stack_restart', pid, message: 'stack restart started', state };
  }

  async runRefresh(): Promise<ReliabilityActionResult> {
    const state = await this.state();
    const action = state.actions.find((entry) => entry.id === 'refresh');
    if (!action?.enabled) {
      return {
        ok: false,
        action: 'refresh',
        message: action?.reason || 'refresh requires idle couch state',
        state,
      };
    }
    const started = await startRefreshJob({ mode: 'nightly', preset: 'nightly', detach: true });
    if (!started.ok) {
      return { ok: false, action: 'refresh', message: started.error, state };
    }
    if (started.mode !== 'background') {
      return { ok: false, action: 'refresh', message: 'refresh did not start in background', state };
    }
    return {
      ok: true,
      action: 'refresh',
      pid: started.pid,
      message: 'nightly movie/TV plus YouTube refresh started',
      state,
    };
  }
}
