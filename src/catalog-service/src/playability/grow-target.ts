import type { RailPlayabilityConfig } from '../rails.js';

export type GrowPresetId = 'quick' | 'nightly' | 'overnight';

export type GrowPreset = {
  wall_ms: number;
  max_attempts: number;
};

export const GROW_PRESETS: Record<GrowPresetId, GrowPreset> = {
  quick: { wall_ms: 10 * 60 * 1000, max_attempts: 200 },
  nightly: { wall_ms: 90 * 60 * 1000, max_attempts: 500 },
  overnight: { wall_ms: 4 * 60 * 60 * 1000, max_attempts: 800 },
};

const SPARSE_TIER_MULTIPLIER = 2;

function growPerPassOverride(yamlValue: number): number {
  const raw = process.env.MANGO_GROW_PER_PASS ?? process.env.MANGO_PLAYABILITY_GROWTH_QUOTA;
  if (raw === undefined || raw === '') {
    return yamlValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return yamlValue;
  }
  return Math.min(parsed, 200);
}

/** Base verified titles to add per grow session (yaml grow_per_pass). */
export function effectiveGrowPerPass(playability: RailPlayabilityConfig): number {
  return growPerPassOverride(playability.grow_per_pass);
}

export type RefreshMode = 'grow' | 'stale';

const DEPRECATED_REFRESH_MODES = new Set(['full', 'growth']);

/** Normalize CLI/API refresh mode — full and growth alias to grow. */
export function normalizeRefreshMode(mode: string | undefined, fallback: RefreshMode = 'stale'): RefreshMode {
  const value = (mode ?? fallback).trim();
  if (value === 'grow' || value === 'stale') {
    return value;
  }
  if (DEPRECATED_REFRESH_MODES.has(value)) {
    console.warn(`playability: refresh mode "${value}" is deprecated — use "grow" or "stale"`);
    return 'grow';
  }
  throw new Error(`unsupported playability refresh mode: ${value}`);
}

/**
 * Per-rail grow target at session start.
 * Sparse rails (verified pool below display_limit) receive 2× the base target.
 */
export function resolveGrowTarget(
  playability: RailPlayabilityConfig,
  verifiedPool: number,
): number {
  const base = effectiveGrowPerPass(playability);
  if (verifiedPool < playability.display_limit) {
    return base * SPARSE_TIER_MULTIPLIER;
  }
  return base;
}

export function resolveGrowPreset(preset?: GrowPresetId): GrowPreset {
  const fromEnv = process.env.MANGO_GROW_PRESET?.trim() as GrowPresetId | undefined;
  const id = preset ?? fromEnv ?? 'nightly';
  return GROW_PRESETS[id] ?? GROW_PRESETS.nightly;
}

export function isGrowRefreshMode(mode: string | undefined, bootstrap = false): boolean {
  if (bootstrap) {
    return false;
  }
  if (!mode) {
    return false;
  }
  if (DEPRECATED_REFRESH_MODES.has(mode)) {
    return true;
  }
  return mode === 'grow';
}
