export function titleKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/** Anchor rails (first N in yaml) reserve slots before niche reverse pass. */
export const TAB_SESSION_ANCHOR_RAIL_COUNT = 3;

/** Guaranteed display slots per rail before top-up (tab-wide dedup). */
export const TAB_SESSION_RESERVE_FLOOR = 8;

/** Niche rails (later in catalog yaml) pick reserved slots first so tab-wide dedup does not starve them. */
export function railsForTabSessionAllocation<T>(rails: T[]): T[] {
  return [...rails].reverse();
}

export type TabSessionRailRequest = {
  railId: string;
  displayLimit: number;
  minDisplay: number;
};

/**
 * Two-phase tab session: reverse yaml reserves a floor for niche rails, then forward yaml
 * tops up anchor rails so global rows are not empty after comedy claims unique titles.
 */
export function buildTabSessionSelections<T extends { type: string; id: string }>(
  railsInYamlOrder: TabSessionRailRequest[],
  pools: Map<string, T[]>,
  recentKeysByRail: Map<string, Set<string>>,
  options: { reserveFloor?: number; anchorRailCount?: number; shuffleFn?: (items: T[]) => T[] } = {},
): Map<string, SessionSelectedItem<T>[]> {
  const floor = options.reserveFloor ?? TAB_SESSION_RESERVE_FLOOR;
  const anchorCount = Math.min(
    options.anchorRailCount ?? TAB_SESSION_ANCHOR_RAIL_COUNT,
    railsInYamlOrder.length,
  );
  const shuffleFn = options.shuffleFn;
  const tabOccupied = new Set<string>();
  const selections = new Map<string, SessionSelectedItem<T>[]>();

  const reserveForRail = (rail: TabSessionRailRequest): void => {
    const pool = pools.get(rail.railId) ?? [];
    const reserve = Math.min(floor, rail.minDisplay, rail.displayLimit, pool.length);
    const picked = selectRailSessionItems(pool, {
      displayLimit: reserve,
      recentKeys: recentKeysByRail.get(rail.railId) ?? new Set(),
      occupiedKeys: tabOccupied,
      shuffleFn,
    });
    const existing = selections.get(rail.railId) ?? [];
    const merged = [...existing, ...picked].slice(0, reserve);
    selections.set(rail.railId, merged);
    for (const item of picked) {
      tabOccupied.add(titleKey(item.type, item.id));
    }
  };

  for (const rail of railsInYamlOrder.slice(0, anchorCount)) {
    reserveForRail(rail);
  }
  for (const rail of railsForTabSessionAllocation(railsInYamlOrder.slice(anchorCount))) {
    reserveForRail(rail);
  }

  for (const rail of railsInYamlOrder) {
    const pool = pools.get(rail.railId) ?? [];
    const existing = selections.get(rail.railId) ?? [];
    const need = Math.max(0, rail.displayLimit - existing.length);
    if (need === 0) {
      continue;
    }
    const existingKeys = new Set(existing.map((item) => titleKey(item.type, item.id)));
    const available = pool.filter((item) => !existingKeys.has(titleKey(item.type, item.id)));
    const extra = selectRailSessionItems(available, {
      displayLimit: need,
      recentKeys: recentKeysByRail.get(rail.railId) ?? new Set(),
      occupiedKeys: tabOccupied,
      shuffleFn,
    });
    const merged = [...existing, ...extra].slice(0, rail.displayLimit);
    selections.set(rail.railId, merged);
    for (const item of extra) {
      tabOccupied.add(titleKey(item.type, item.id));
    }
  }

  return selections;
}

export type SessionMixBucket = 'stable' | 'fresh';

export type SessionSelectedItem<T> = T & { mix_bucket: SessionMixBucket };

function defaultShuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

/** Pick stable + fresh session slots; exclude tab-wide occupied and per-rail recent titles. */
export function selectRailSessionItems<T extends { type: string; id: string }>(
  pool: T[],
  options: {
    displayLimit: number;
    recentKeys: Set<string>;
    occupiedKeys: Set<string>;
    shuffleFn?: (items: T[]) => T[];
  },
): SessionSelectedItem<T>[] {
  const {
    displayLimit,
    recentKeys,
    occupiedKeys,
    shuffleFn = defaultShuffle,
  } = options;

  const blocked = (item: T): boolean => occupiedKeys.has(titleKey(item.type, item.id));
  const available = pool.filter((item) => !blocked(item));
  const stableTarget = Math.ceil(displayLimit * 0.7);
  const stable = available
    .filter((item) => !recentKeys.has(titleKey(item.type, item.id)))
    .slice(0, stableTarget);
  const chosen = new Map(stable.map((item) => [titleKey(item.type, item.id), item]));
  const fresh = shuffleFn(available.filter((item) => !chosen.has(titleKey(item.type, item.id))))
    .slice(0, Math.max(0, displayLimit - stable.length));

  return [
    ...stable.map((item) => ({ ...item, mix_bucket: 'stable' as const })),
    ...fresh.map((item) => ({ ...item, mix_bucket: 'fresh' as const })),
  ].slice(0, displayLimit);
}

export function sessionItemsConflictWithOccupied<T extends { type: string; id: string }>(
  items: T[],
  occupiedKeys: Set<string>,
): boolean {
  return items.some((item) => occupiedKeys.has(titleKey(item.type, item.id)));
}

export function tabSessionsHaveDuplicateTitles(
  sessions: Map<string, Array<{ type: string; id: string }>>,
): boolean {
  const seen = new Set<string>();
  for (const items of sessions.values()) {
    for (const item of items) {
      const key = titleKey(item.type, item.id);
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
    }
  }
  return false;
}
