/** Catch-all browse rails — permissive theme; deprioritized for grow when already full. */

export const ANCHOR_RAIL_IDS = new Set([
  'movies-global-popular',
  'series-global-popular',
]);

export function isAnchorRail(railId: string): boolean {
  return ANCHOR_RAIL_IDS.has(railId);
}

/** When false, anchors use the same grow target as other rails. */
export function anchorGrowDietEnabled(): boolean {
  return process.env.MANGO_GROW_ANCHOR_DIET !== '0';
}
