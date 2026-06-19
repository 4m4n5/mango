import type { ContentCard, ContentRail } from "./types";
import { couchSafeCatalogMessage } from "./catalog-errors";
import type { BrowseTab } from "./types";

const RAIL_FETCH_STAGGER_MS = 400;

function isHeavyCatalogAddon(rail: { sources?: Array<{ addon?: string }> }): boolean {
  return (rail.sources || []).some((source) => /elfhosted|aiolists|india ott/i.test(source.addon || ""));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function loadCatalogRails(tab: BrowseTab = "movies"): Promise<ContentRail[]> {
  const summary = await fetchJson<RailSummaryResponse>(
    `/api/catalog/rails?tab=${encodeURIComponent(tab)}`,
  );
  const ordered = [...summary.rails].sort((left, right) => {
    const leftHeavy = isHeavyCatalogAddon(left) ? 1 : 0;
    const rightHeavy = isHeavyCatalogAddon(right) ? 1 : 0;
    return leftHeavy - rightHeavy;
  });

  const rails: ContentRail[] = [];
  let heavyCatalogLoads = 0;
  for (const rail of ordered) {
    if (heavyCatalogLoads > 0) {
      await delay(RAIL_FETCH_STAGGER_MS);
    }
    if (isHeavyCatalogAddon(rail)) {
      heavyCatalogLoads += 1;
    }
    const data = await fetchJson<RailItemsResponse>(
      `/api/catalog/rails/${encodeURIComponent(rail.id)}/items`,
    );
    rails.push({
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
    });
  }
  return rails;
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
