import type { RailPlayabilityConfig } from '../rails.js';

export type PoolTargetOptions = {
  bootstrap?: boolean;
};

/** Per-refresh pool goal: grow by pool_growth_per_refresh unless legacy (growth=0). */
export function effectivePoolTarget(
  playability: RailPlayabilityConfig,
  currentVerified: number,
  options: PoolTargetOptions = {},
): number {
  if (options.bootstrap === true) {
    return playability.min_display;
  }

  const growth = playability.pool_growth_per_refresh;
  if (growth <= 0) {
    return playability.pool_target;
  }

  const floor = playability.pool_target;
  const ceiling = playability.pool_max ?? Number.MAX_SAFE_INTEGER;
  const grown = Math.max(floor, currentVerified + growth);
  return Math.min(ceiling, grown);
}

/** Visible row size can grow slowly as the verified pool deepens (10-ft cap). */
export function effectiveDisplayLimit(
  playability: RailPlayabilityConfig,
  currentVerified: number,
): number {
  const base = playability.display_limit;
  const max = playability.display_max ?? base;
  if (max <= base || playability.pool_growth_per_refresh <= 0) {
    return base;
  }
  const extra = Math.floor(Math.max(0, currentVerified - playability.min_display) / 15);
  return Math.min(max, base + extra);
}

/** Widen ingest window as pools deepen so refresh can discover new titles. */
export function effectiveCandidateLimit(
  railLimit: number,
  ingestMultiplier: number,
  currentVerified: number,
  poolTarget: number,
): number {
  const base = railLimit * ingestMultiplier;
  const headroom = Math.max(0, poolTarget - currentVerified);
  return base + headroom * 2;
}
