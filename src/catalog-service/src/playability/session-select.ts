export function titleKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Fresh slots reserved for the newest-verified titles so grown content surfaces. */
export const SESSION_RECENCY_RESERVE = Math.max(0, envInt('MANGO_SESSION_RECENCY_RESERVE', 2));

/** A title counts as a "new arrival" eligible for the recency reserve within this window (ms). */
export const SESSION_RECENCY_WINDOW_MS = Math.max(
  0,
  envInt('MANGO_SESSION_RECENCY_WINDOW_MS', 3 * 24 * 60 * 60 * 1000),
);

function verifiedAtOf(item: unknown): number {
  const value = (item as { verified_at?: number | null }).verified_at;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Anchor rails (first N in yaml) reserve slots before niche reverse pass. */
export const TAB_SESSION_ANCHOR_RAIL_COUNT = 3;

/** Guaranteed display slots per rail before top-up (tab-wide dedup). */
export const TAB_SESSION_RESERVE_FLOOR = 4;

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
  options: {
    reserveFloor?: number;
    anchorRailCount?: number;
    shuffleFn?: (items: T[]) => T[];
    stableRatio?: number;
  } = {},
): Map<string, SessionSelectedItem<T>[]> {
  const floor = options.reserveFloor ?? TAB_SESSION_RESERVE_FLOOR;
  const stableRatio = options.stableRatio;
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
      stableRatio,
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

  for (const rail of railsForTabSessionAllocation(railsInYamlOrder)) {
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
      stableRatio,
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
    stableRatio?: number;
    now?: number;
    recencyReserve?: number;
    recencyWindowMs?: number;
  },
): SessionSelectedItem<T>[] {
  const {
    displayLimit,
    recentKeys,
    occupiedKeys,
    shuffleFn = defaultShuffle,
    stableRatio = 0.7,
    now = Date.now(),
    recencyReserve = SESSION_RECENCY_RESERVE,
    recencyWindowMs = SESSION_RECENCY_WINDOW_MS,
  } = options;

  const blocked = (item: T): boolean => occupiedKeys.has(titleKey(item.type, item.id));
  const available = pool.filter((item) => !blocked(item));
  const stableTarget = Math.ceil(displayLimit * Math.min(1, Math.max(0, stableRatio)));
  const stable = available
    .filter((item) => !recentKeys.has(titleKey(item.type, item.id)))
    .slice(0, stableTarget);
  const chosen = new Map(stable.map((item) => [titleKey(item.type, item.id), item]));
  const freshPool = available.filter((item) => !chosen.has(titleKey(item.type, item.id)));
  const freshSlots = Math.max(0, displayLimit - stable.length);

  // Reserve a bounded number of fresh slots for the newest-verified titles so
  // freshly-grown content surfaces instead of sinking below the static score order.
  // Stable anchors are left untouched to preserve the curated top of the rail.
  const recencyPicks = recencyReserve > 0 && recencyWindowMs > 0
    ? freshPool
      .filter((item) => {
        const verifiedAt = verifiedAtOf(item);
        return verifiedAt > 0 && now - verifiedAt <= recencyWindowMs;
      })
      .sort((a, b) => verifiedAtOf(b) - verifiedAtOf(a))
      .slice(0, Math.min(recencyReserve, freshSlots))
    : [];
  const recencyKeys = new Set(recencyPicks.map((item) => titleKey(item.type, item.id)));
  const shuffled = shuffleFn(
    freshPool.filter((item) => !recencyKeys.has(titleKey(item.type, item.id))),
  ).slice(0, Math.max(0, freshSlots - recencyPicks.length));
  const fresh = [...recencyPicks, ...shuffled];

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
