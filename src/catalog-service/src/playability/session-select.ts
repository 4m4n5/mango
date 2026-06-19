export function titleKey(type: string, id: string): string {
  return `${type}:${id}`;
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
