import type { BrowseTab, ContentCard } from "./types";

export interface SavedRecord {
  tab: BrowseTab;
  type: string;
  id: string;
  title: string;
  poster: string | null;
  saved_at: number;
}

export async function fetchSavedIds(tab: BrowseTab): Promise<Set<string>> {
  const data = await fetchJson<{ saved: SavedRecord[] }>(
    `/api/catalog/library/saved?tab=${encodeURIComponent(tab)}`,
  );
  return new Set((data.saved || []).map((item) => `${item.type}:${item.id}`));
}

export async function saveCard(tab: BrowseTab, card: ContentCard): Promise<void> {
  await fetchJson("/api/catalog/library/saved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cardPayload(tab, card)),
  });
}

export async function unsaveCard(card: ContentCard): Promise<void> {
  await fetchJson("/api/catalog/library/saved", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: card.type,
      id: card.id,
    }),
  });
}

export async function publishCurrentLibraryContext(tab: BrowseTab, card: ContentCard): Promise<void> {
  await fetchJson("/api/catalog/library/context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cardPayload(tab, card)),
  });
}

function cardPayload(tab: BrowseTab, card: ContentCard): Record<string, unknown> {
  return {
    tab,
    type: card.type,
    id: card.id,
    title: card.title,
    poster: card.posterUrl || "",
    year: card.year,
    description: card.description,
  };
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
    const message = typeof (data as { error?: string }).error === "string"
      ? (data as { error: string }).error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}
