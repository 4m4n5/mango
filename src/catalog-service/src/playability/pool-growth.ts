import type { RailPlayabilityConfig } from '../rails.js';
import type { BrowsableRail } from '../rails.js';
import { playabilityPoolGrowthOverride } from './config.js';

export type PoolTargetOptions = {
  bootstrap?: boolean;
};

/** Per-rail grow session probe counter (growRail inner loop). */
export type GrowthPassState = {
  quotas: Map<string, number>;
  verifiedAddedThisPass: Map<string, number>;
};

const UNBOUNDED_POOL_MAX = Number.MAX_SAFE_INTEGER;

export function createGrowthPassState(
  rails: BrowsableRail[],
  targetsByRail?: Map<string, number>,
): GrowthPassState {
  const quotas = new Map<string, number>();
  const verifiedAddedThisPass = new Map<string, number>();
  for (const rail of rails) {
    quotas.set(rail.id, targetsByRail?.get(rail.id) ?? 0);
    verifiedAddedThisPass.set(rail.id, 0);
  }
  return { quotas, verifiedAddedThisPass };
}

export function railMeetsGrowthQuota(
  growthPass: GrowthPassState,
  railId: string,
): boolean {
  const added = growthPass.verifiedAddedThisPass.get(railId) ?? 0;
  const quota = growthPass.quotas.get(railId) ?? 0;
  return added >= quota;
}

export function incrementGrowthPassVerified(
  growthPass: GrowthPassState,
  railIds: string[],
): void {
  for (const railId of railIds) {
    growthPass.verifiedAddedThisPass.set(
      railId,
      (growthPass.verifiedAddedThisPass.get(railId) ?? 0) + 1,
    );
  }
}

/** Bootstrap / incremental top-up pool goal (not used by growRail). */
export function effectivePoolTarget(
  playability: RailPlayabilityConfig,
  currentVerified: number,
  options: PoolTargetOptions = {},
): number {
  if (options.bootstrap === true) {
    return playability.min_display;
  }

  const growth = playabilityPoolGrowthOverride(playability.pool_growth_per_refresh);
  if (growth <= 0) {
    return playability.pool_target;
  }

  const floor = playability.pool_target;
  const ceiling = playability.pool_max ?? UNBOUNDED_POOL_MAX;
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
