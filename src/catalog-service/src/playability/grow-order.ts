import type { PlayableRail } from '../core.js';

/**
 * Grow pass order: yaml/browse rails first, AI catalog slots last.
 * UI browse order (ai slots first) is unchanged — only maintenance grow sequencing.
 */
export function railsForGrowPass(rails: PlayableRail[]): PlayableRail[] {
  const browse: PlayableRail[] = [];
  const aiCatalog: PlayableRail[] = [];
  for (const rail of rails) {
    if (rail.type === 'ai_catalog') {
      aiCatalog.push(rail);
    } else {
      browse.push(rail);
    }
  }
  return [...browse, ...aiCatalog];
}
