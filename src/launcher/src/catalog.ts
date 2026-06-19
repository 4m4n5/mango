import type { ContentCard, ContentRail } from "./types";
import { couchSafeCatalogMessage } from "./catalog-errors";

const RAIL_FETCH_STAGGER_MS = 400;

function isElfHostedRail(rail: { addon?: string }): boolean {
  return /elfhosted/i.test(rail.addon || "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function loadCatalogRails(): Promise<ContentRail[]> {
  const summary = await fetchJson<RailSummaryResponse>("/api/catalog/rails");
  const ordered = [...summary.rails].sort((left, right) => {
    const leftElf = isElfHostedRail(left) ? 1 : 0;
    const rightElf = isElfHostedRail(right) ? 1 : 0;
    return leftElf - rightElf;
  });

  const rails: ContentRail[] = [];
  let elfHostedLoads = 0;
  for (const rail of ordered) {
    if (elfHostedLoads > 0) {
      await delay(RAIL_FETCH_STAGGER_MS);
    }
    if (isElfHostedRail(rail)) {
      elfHostedLoads += 1;
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
