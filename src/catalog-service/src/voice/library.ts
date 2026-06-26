import {
  listVerifiedLibraryCatalogRows,
  type VerifiedLibraryCatalogRow,
} from '../playability/db.js';
import {
  listSavedLibraryItems,
  listWatchHistory,
  type SavedLibraryItem,
  type WatchHistoryRow,
} from '../library/db.js';
import type { CatalogTab } from '../rails.js';

export type LibraryTitle = {
  type: string;
  id: string;
  title: string;
  year?: string;
  poster?: string;
  tab: CatalogTab;
  rails: string[];
  rail_ids: string[];
};

function tabForType(type: string): CatalogTab {
  if (type.trim().toLowerCase() === 'series') {
    return 'series';
  }
  return 'movies';
}

export function aggregateLibraryRows(
  rows: VerifiedLibraryCatalogRow[],
  railLabels: Map<string, string>,
): LibraryTitle[] {
  const byKey = new Map<string, LibraryTitle>();
  for (const row of rows) {
    const key = `${row.type}:${row.id}`;
    const railLabel = railLabels.get(row.rail_id) ?? row.rail_id;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.rail_ids.includes(row.rail_id)) {
        existing.rail_ids.push(row.rail_id);
        existing.rails.push(railLabel);
      }
      continue;
    }
    byKey.set(key, {
      type: row.type,
      id: row.id,
      title: row.title,
      year: row.year ?? undefined,
      poster: row.poster ?? undefined,
      tab: tabForType(row.type),
      rails: [railLabel],
      rail_ids: [row.rail_id],
    });
  }
  return [...byKey.values()].sort((left, right) => left.title.localeCompare(right.title));
}

export async function buildLibraryCatalog(
  railLabels: Map<string, string>,
  limit = 500,
): Promise<{
  ok: true;
  count: number;
  titles: LibraryTitle[];
  saved: SavedLibraryItem[];
  history: WatchHistoryRow[];
}> {
  const rows = await listVerifiedLibraryCatalogRows(limit);
  const titles = aggregateLibraryRows(rows, railLabels);
  return {
    ok: true,
    count: titles.length,
    titles,
    saved: listSavedLibraryItems(undefined, 50),
    history: listWatchHistory(25),
  };
}

export function buildLibraryOverview(
  titles: LibraryTitle[],
  railLabels: Map<string, string>,
): {
  ok: true;
  verified_count: number;
  saved_count: number;
  recent_history: Array<{ title: string | null; type: string; id: string; progress_pct: number; event: string }>;
  rails: Array<{ rail_id: string; label: string; count: number; sample: string[] }>;
} {
  const counts = new Map<string, number>();
  const samples = new Map<string, string[]>();
  for (const title of titles) {
    for (const railId of title.rail_ids) {
      counts.set(railId, (counts.get(railId) ?? 0) + 1);
      const sample = samples.get(railId) ?? [];
      if (sample.length < 4) {
        sample.push(title.title);
        samples.set(railId, sample);
      }
    }
  }
  const rails = [...counts.entries()]
    .map(([rail_id, count]) => ({
      rail_id,
      label: railLabels.get(rail_id) ?? rail_id,
      count,
      sample: samples.get(rail_id) ?? [],
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const saved = listSavedLibraryItems(undefined, 50);
  const history = listWatchHistory(10);
  return {
    ok: true,
    verified_count: titles.length,
    saved_count: saved.length,
    recent_history: history.map((row) => ({
      title: row.title,
      type: row.type,
      id: row.id,
      progress_pct: row.progress_pct,
      event: row.event,
    })),
    rails,
  };
}
