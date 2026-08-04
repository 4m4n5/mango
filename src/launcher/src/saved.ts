import type { BrowseTab, ContentCard } from "./types";
import { recommendationAttributionPayload } from "./recommendation-attribution";
import {
  personalizationExpectationBody,
  personalizationExpectationParams,
  personalizationOwnerFromPayload,
  samePersonalizationOwner,
  type PersonalizationOwner,
} from "./personalization";
import {
  CatalogOwnershipChangedError,
  CatalogResponseError,
} from "./catalog-errors";

export interface SavedRecord {
  source?: string;
  tab: BrowseTab;
  type: string;
  id: string;
  title: string;
  poster: string | null;
  saved_at: number;
}

export async function fetchSavedIds(
  tab: BrowseTab,
  expectedOwner?: PersonalizationOwner,
): Promise<Set<string>> {
  const params = expectedOwner
    ? personalizationExpectationParams(expectedOwner)
    : new URLSearchParams();
  params.set("tab", tab);
  let data: {
    saved: SavedRecord[];
    profile_id?: string;
    personalization_updated_at?: number;
  };
  try {
    data = await fetchJson(`/api/catalog/library/saved?${params.toString()}`);
  } catch (error) {
    if (expectedOwner && error instanceof CatalogResponseError && error.status === 409) {
      throw new CatalogOwnershipChangedError();
    }
    throw error;
  }
  if (expectedOwner) {
    assertSavedResponseOwner(data, expectedOwner);
  }
  return new Set((data.saved || []).map(savedKey));
}

/** Personalized Saved state is paintable only with the exact server owner echo. */
export function assertSavedResponseOwner(
  payload: { profile_id?: unknown; personalization_updated_at?: unknown },
  expectedOwner: PersonalizationOwner,
): void {
  const owner = personalizationOwnerFromPayload(payload);
  if (!owner || !samePersonalizationOwner(expectedOwner, owner)) {
    throw new CatalogOwnershipChangedError();
  }
}

export async function saveCard(
  tab: BrowseTab,
  card: ContentCard,
  expectedOwner: PersonalizationOwner,
): Promise<void> {
  await fetchOwnedJson("/api/catalog/library/saved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...cardPayload(tab, card),
      ...personalizationExpectationBody(expectedOwner),
    }),
  }, expectedOwner);
}

export async function unsaveCard(
  card: ContentCard,
  expectedOwner: PersonalizationOwner,
): Promise<void> {
  await fetchOwnedJson("/api/catalog/library/saved", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: librarySourceForCard(card),
      type: card.type,
      id: card.id,
      ...recommendationAttributionPayload(card),
      ...personalizationExpectationBody(expectedOwner),
    }),
  }, expectedOwner);
}

export interface LibraryContextRecord {
  profile_id: string;
  source: string;
  type: string;
  id: string;
  title: string;
  poster: string | null;
  tab: BrowseTab;
}

export async function fetchLibraryContext(
  expectedOwner: PersonalizationOwner,
): Promise<LibraryContextRecord | null> {
  try {
    const query = personalizationExpectationParams(expectedOwner);
    const data = await fetchOwnedJson<{
      ok: boolean;
      context: LibraryContextRecord | null;
      profile_id?: unknown;
      personalization_updated_at?: unknown;
    }>(`/api/catalog/library/context?${query}`, undefined, expectedOwner);
    return data.context ?? null;
  } catch (error) {
    if (error instanceof CatalogOwnershipChangedError) throw error;
    return null;
  }
}

export async function publishCurrentLibraryContext(
  tab: BrowseTab,
  card: ContentCard,
  expectedOwner: PersonalizationOwner,
  openedAt: number,
): Promise<void> {
  await fetchOwnedJson("/api/catalog/library/context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...cardPayload(tab, card),
      context_opened_at: openedAt,
      ...personalizationExpectationBody(expectedOwner),
    }),
  }, expectedOwner);
}

function cardPayload(tab: BrowseTab, card: ContentCard): Record<string, unknown> {
  return {
    source: librarySourceForCard(card),
    tab,
    type: card.type,
    id: card.id,
    title: card.title,
    poster: card.posterUrl || "",
    year: card.year,
    description: card.description,
    ...recommendationAttributionPayload(card),
  };
}

export function cardSavedKey(card: ContentCard): string {
  return `${librarySourceForCard(card)}:${card.type}:${card.id}`;
}

function savedKey(item: SavedRecord): string {
  return `${item.source || "mango"}:${item.type}:${item.id}`;
}

function librarySourceForCard(card: ContentCard): string {
  return card.source === "youtube" ? "youtube" : "mango";
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
    throw new CatalogResponseError(response.status, message);
  }
  return data as T;
}

async function fetchOwnedJson<T extends {
  profile_id?: unknown;
  personalization_updated_at?: unknown;
}>(
  url: string,
  init: RequestInit | undefined,
  expectedOwner: PersonalizationOwner,
): Promise<T> {
  let data: T;
  try {
    data = await fetchJson<T>(url, init);
  } catch (error) {
    if (error instanceof CatalogResponseError && error.status === 409) {
      throw new CatalogOwnershipChangedError();
    }
    throw error;
  }
  assertSavedResponseOwner(data, expectedOwner);
  return data;
}
