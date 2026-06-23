import {
  clearRailSessions,
  countVerifiedRailPoolByRailIds,
  deleteRailPoolForRailIds,
} from './db.js';
import {
  LEGACY_POOL_RAIL_IDS,
  type LegacyPoolPruneResult,
} from './rail-pool-legacy.js';

export async function pruneLegacyPoolRails(
  dryRun: boolean,
  railIds: readonly string[] = LEGACY_POOL_RAIL_IDS,
): Promise<LegacyPoolPruneResult> {
  const counts = await countVerifiedRailPoolByRailIds([...railIds]);
  const rails: Record<string, number> = {};
  let total = 0;
  for (const railId of railIds) {
    const count = counts.get(railId) ?? 0;
    if (count > 0) {
      rails[railId] = count;
      total += count;
    }
  }

  if (!dryRun && total > 0) {
    await deleteRailPoolForRailIds(Object.keys(rails));
    await clearRailSessions(Object.keys(rails));
  }

  return {
    ok: true,
    dry_run: dryRun,
    rails,
    removed: dryRun ? 0 : total,
    sessions_cleared: dryRun ? [] : Object.keys(rails),
  };
}

export { LEGACY_POOL_RAIL_IDS };
