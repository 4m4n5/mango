import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type GrowRunStateUpdate = {
  phase: string;
  message?: string;
  mode?: string;
  preset?: string;
  run_id?: string;
  rail_id?: string;
  rail_label?: string;
  grow_target?: number;
  fresh_verified?: number;
  attempts?: number;
  max_attempts?: number;
  candidates_seen?: number;
  skipped_rejected?: number;
  suppressed_sources?: string[];
  elapsed_ms?: number;
  wall_ms?: number;
  ok?: boolean;
  failure_category?: string;
  updated_at?: string;
  [key: string]: unknown;
};

function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg && xdg.trim() !== ''
    ? join(xdg, 'mango')
    : join(homedir(), '.cache/mango');
}

export function growRunStatePath(): string {
  return process.env.MANGO_GROW_RUN_STATE_PATH?.trim()
    || join(cacheDir(), 'grow-run-state.json');
}

function growRunLogPath(): string {
  return process.env.MANGO_GROW_LOG_PATH?.trim()
    || join(cacheDir(), 'playability-grow.log');
}

function loadPreviousState(path: string): Record<string, unknown> {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function envPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function recordGrowRunState(update: GrowRunStateUpdate, options: { log?: string } = {}): void {
  if (process.env.MANGO_GROW_RUN_STATE === '0') {
    return;
  }
  const path = growRunStatePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const previous = loadPreviousState(path);
    const runId = update.run_id ?? process.env.MANGO_OPS_RUN_ID ?? previous.run_id;
    const sameRun = runId !== undefined && previous.run_id === runId;
    const state = {
      ...update,
      run_id: runId,
      mode: update.mode ?? process.env.MANGO_PLAYABILITY_REFRESH_MODE ?? previous.mode,
      preset: update.preset ?? process.env.MANGO_GROW_PRESET ?? previous.preset,
      grow_per_pass: update.grow_per_pass
        ?? envPositiveInt('MANGO_GROW_PER_PASS')
        ?? (sameRun ? previous.grow_per_pass : undefined),
      updated_at: update.updated_at ?? new Date().toISOString(),
    };
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    // Monitoring state must never fail a grow run.
  }

  if (options.log && process.env.MANGO_GROW_RUN_STATE_LOG === '1') {
    try {
      const logPath = growRunLogPath();
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${new Date().toISOString()} ${options.log}\n`, 'utf8');
    } catch {
      // Best-effort operator log only.
    }
  }
}
