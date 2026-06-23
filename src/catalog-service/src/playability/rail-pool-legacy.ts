/** Legacy rail_pool ids from pre-yaml browse — not in catalog.yaml grow pass. */

export const LEGACY_POOL_RAIL_IDS = [
  'featured-global',
  'popular-global',
  'popular-india',
  'trending-india',
] as const;

export type LegacyPoolPruneResult = {
  ok: boolean;
  dry_run: boolean;
  rails: Record<string, number>;
  removed: number;
  sessions_cleared: string[];
};
