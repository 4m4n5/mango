import type { PlayableRail } from '../core.js';
import { isAnchorRail } from './grow-anchors.js';

export type GrowPassOrderOptions = {
  /** Active verified pool depth per rail — enables fill-ratio sort (thinnest first). */
  verifiedPoolByRail?: ReadonlyMap<string, number>;
};

function poolTargetForRail(rail: PlayableRail): number {
  return rail.playability?.pool_target ?? 20;
}

function fillRatio(rail: PlayableRail, verifiedPool: number): number {
  return verifiedPool / Math.max(1, poolTargetForRail(rail));
}

function compareBrowseGrowOrder(
  a: PlayableRail,
  b: PlayableRail,
  verifiedPoolByRail: ReadonlyMap<string, number>,
  indexById: Map<string, number>,
): number {
  const va = verifiedPoolByRail.get(a.id) ?? 0;
  const vb = verifiedPoolByRail.get(b.id) ?? 0;
  const ra = fillRatio(a, va);
  const rb = fillRatio(b, vb);
  if (ra !== rb) {
    return ra - rb;
  }
  const anchorBias = Number(isAnchorRail(a.id)) - Number(isAnchorRail(b.id));
  if (anchorBias !== 0) {
    return anchorBias;
  }
  return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
}

/**
 * Grow pass order: yaml browse rails sorted by verified_pool / pool_target (asc),
 * anchor rails tie-break last; AI catalog slots always last.
 */
export function railsForGrowPass(
  rails: PlayableRail[],
  options: GrowPassOrderOptions = {},
): PlayableRail[] {
  const verifiedPoolByRail = options.verifiedPoolByRail;
  const browse: PlayableRail[] = [];
  const aiCatalog: PlayableRail[] = [];
  const indexById = new Map<string, number>();

  for (const [index, rail] of rails.entries()) {
    indexById.set(rail.id, index);
    if (rail.type === 'ai_catalog') {
      aiCatalog.push(rail);
    } else {
      browse.push(rail);
    }
  }

  if (verifiedPoolByRail && verifiedPoolByRail.size > 0) {
    browse.sort((a, b) => compareBrowseGrowOrder(a, b, verifiedPoolByRail, indexById));
  }

  return [...browse, ...aiCatalog];
}
