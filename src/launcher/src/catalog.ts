import type { ContentCard, ContentRail } from "./types";

interface RailSummaryResponse {
  rails: Array<{
    id: string;
    label: string;
    type: "addon_catalog";
    addon: string;
    catalog: string;
    content_type: string;
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
  stream?: {
    source?: string;
    title?: string;
    quality?: string;
    resolve_ms?: number;
  };
  error?: string;
}

export async function loadCatalogRails(): Promise<ContentRail[]> {
  const summary = await fetchJson<RailSummaryResponse>("/api/catalog/rails");
  const rails = await Promise.all(summary.rails.map(async (rail) => {
    const data = await fetchJson<RailItemsResponse>(`/api/catalog/rails/${encodeURIComponent(rail.id)}/items`);
    return {
      id: rail.id,
      label: rail.label,
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
  }));
  return rails;
}

export async function loadMeta(card: ContentCard): Promise<CatalogMeta> {
  return fetchJson<CatalogMeta>(
    `/api/catalog/meta/${encodeURIComponent(card.type)}/${encodeURIComponent(card.id)}`,
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
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}
