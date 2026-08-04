export function titleKey(type: string, id: string): string {
  return `${type}:${id}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WEIGHT_3D_MULTIPLIER = 3.0;
const RECENT_WEIGHT_7D_MULTIPLIER = 2.0;
const RECENT_WEIGHT_30D_MULTIPLIER = 1.3;
const BASE_RECENCY_WEIGHT_MULTIPLIER = 1.0;

function verifiedAtOf(item: unknown): number {
  const value = (item as { verified_at?: number | null }).verified_at;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function recencyWeight(item: unknown, now: number): number {
  const verifiedAt = verifiedAtOf(item);
  if (verifiedAt <= 0) {
    return BASE_RECENCY_WEIGHT_MULTIPLIER;
  }
  const ageMs = Math.max(0, now - verifiedAt);
  if (ageMs <= 3 * DAY_MS) {
    return RECENT_WEIGHT_3D_MULTIPLIER;
  }
  if (ageMs <= 7 * DAY_MS) {
    return RECENT_WEIGHT_7D_MULTIPLIER;
  }
  if (ageMs <= 30 * DAY_MS) {
    return RECENT_WEIGHT_30D_MULTIPLIER;
  }
  return BASE_RECENCY_WEIGHT_MULTIPLIER;
}

function weightedSampleWithoutReplacement<T>(
  items: T[],
  limit: number,
  now: number,
  rng: () => number,
): T[] {
  if (limit <= 0 || items.length === 0) {
    return [];
  }
  const ranked = items.map((item) => {
    const weight = Math.max(BASE_RECENCY_WEIGHT_MULTIPLIER, recencyWeight(item, now));
    const roll = Math.max(Number.MIN_VALUE, rng());
    // Efraimidis-Spirakis weighted permutation key; lower keys rank first.
    const key = -Math.log(roll) / weight;
    return { item, key };
  });
  ranked.sort((left, right) => left.key - right.key);
  return ranked.slice(0, Math.min(limit, ranked.length)).map((entry) => entry.item);
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
    stableRatio?: number;
    rng?: () => number;
  } = {},
): Map<string, SessionSelectedItem<T>[]> {
  const floor = options.reserveFloor ?? TAB_SESSION_RESERVE_FLOOR;
  const stableRatio = options.stableRatio;
  const anchorCount = Math.min(
    options.anchorRailCount ?? TAB_SESSION_ANCHOR_RAIL_COUNT,
    railsInYamlOrder.length,
  );
  const rng = options.rng;
  const tabOccupied = new Set<string>();
  const selections = new Map<string, SessionSelectedItem<T>[]>();

  const reserveForRail = (rail: TabSessionRailRequest): void => {
    const pool = pools.get(rail.railId) ?? [];
    const reserve = Math.min(floor, rail.minDisplay, rail.displayLimit, pool.length);
    const picked = selectRailSessionItems(pool, {
      displayLimit: reserve,
      recentKeys: recentKeysByRail.get(rail.railId) ?? new Set(),
      occupiedKeys: tabOccupied,
      stableRatio,
      rng,
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
      stableRatio,
      rng,
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

/** Pick stable + fresh session slots; exclude tab-wide occupied and per-rail recent titles. */
export function selectRailSessionItems<T extends { type: string; id: string }>(
  pool: T[],
  options: {
    displayLimit: number;
    recentKeys: Set<string>;
    occupiedKeys: Set<string>;
    stableRatio?: number;
    now?: number;
    rng?: () => number;
  },
): SessionSelectedItem<T>[] {
  const {
    displayLimit,
    recentKeys,
    occupiedKeys,
    stableRatio = 0.7,
    now = Date.now(),
    rng = Math.random,
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
  const fresh = weightedSampleWithoutReplacement(freshPool, freshSlots, now, rng);

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
