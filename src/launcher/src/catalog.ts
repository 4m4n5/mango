import type { ContentCard, ContentRail } from "./types";
import { couchSafeCatalogMessage } from "./catalog-errors";
import type { BrowseTab } from "./types";

interface RailSummaryResponse {
  rails: Array<{
    id: string;
    label: string;
    type: "addon_catalog" | "composite_list";
    content_type: string;
    sources: Array<{ addon: string; catalog: string; weight: number }>;
  }>;
}

interface RailItemsResponse {
  rail_id: string;
  label?: string;
  items: Array<{
    id: string;
    type: string;
    title: string;
    subtitle?: string;
    poster: string;
    year?: number | string;
    description?: string;
    source?: string;
  }>;
  resolve_ms?: number;
}

interface TabRailItemsResponse {
  tab: BrowseTab;
  rails: RailItemsResponse[];
  resolve_ms?: number;
}

export interface CatalogMeta {
  id: string;
  type: string;
  name?: string;
  title?: string;
  year?: number | string;
  poster?: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
}

export interface PlayResult {
  ok: boolean;
  ttff_ms?: number;
  total_ms?: number;
  attempts?: number;
  stream?: {
    source?: string;
    title?: string;
    quality?: string;
    resolve_ms?: number;
  };
  error?: string;
}

function mapRailItems(data: RailItemsResponse): ContentRail {
  return {
    id: data.rail_id,
    label: data.label || data.rail_id,
    cards: data.items.map((item): ContentCard => ({
      id: item.id,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle || (item.year ? String(item.year) : item.type),
      posterUrl: item.poster,
      year: item.year,
      description: item.description,
      source: item.source,
    })),
  };
}

export async function loadCatalogRails(tab: BrowseTab = "movies"): Promise<ContentRail[]> {
  try {
    const batch = await fetchJson<TabRailItemsResponse>(
      `/api/catalog/rails/items?tab=${encodeURIComponent(tab)}`,
    );
    return batch.rails.map(mapRailItems);
  } catch {
    // Fallback for older catalog-service builds without tab batch allocation.
    const summary = await fetchJson<RailSummaryResponse>(
      `/api/catalog/rails?tab=${encodeURIComponent(tab)}`,
    );
    const rails: ContentRail[] = [];
    for (const rail of summary.rails) {
      const data = await fetchJson<RailItemsResponse>(
        `/api/catalog/rails/${encodeURIComponent(rail.id)}/items`,
      );
      rails.push(mapRailItems({ ...data, label: data.label || rail.label }));
    }
    return rails;
  }
}

export async function loadMeta(card: ContentCard): Promise<CatalogMeta> {
  return fetchJson<CatalogMeta>(
    `/api/catalog/meta/${encodeURIComponent(card.type)}/${encodeURIComponent(card.id)}`,
  );
}

export async function prefetchStreams(card: ContentCard): Promise<void> {
  await fetchJson(
    `/api/catalog/stream/${encodeURIComponent(card.type)}/${encodeURIComponent(card.id)}`,
  );
}

export async function playCard(card: ContentCard): Promise<PlayResult> {
  return fetchJson<PlayResult>("/api/catalog/play", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: card.type, id: card.id }),
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(couchSafeCatalogMessage(raw));
  }
  return data as T;
}
