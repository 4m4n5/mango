import type { BrowseTab, ContentCard } from "./types";

export interface UserPinRecord {
  tab: BrowseTab;
  type: string;
  id: string;
  title: string;
  poster: string;
  pinned_at: number;
}

export async function fetchPinnedIds(tab: BrowseTab): Promise<Set<string>> {
  const data = await fetchJson<{ pins: UserPinRecord[] }>(
    `/api/catalog/pins?tab=${encodeURIComponent(tab)}`,
  );
  return new Set((data.pins || []).map((pin) => `${pin.type}:${pin.id}`));
}

export async function pinCard(tab: BrowseTab, card: ContentCard): Promise<void> {
  await fetchJson("/api/catalog/pins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tab,
      type: card.type,
      id: card.id,
      title: card.title,
      poster: card.posterUrl || "",
    }),
  });
}

export async function unpinCard(tab: BrowseTab, card: ContentCard): Promise<void> {
  await fetchJson("/api/catalog/pins", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tab,
      type: card.type,
      id: card.id,
    }),
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
    const message = typeof (data as { error?: string }).error === "string"
      ? (data as { error: string }).error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}
