import type { BrowseTab, ContentCard } from "./types";
import { fetchLibraryContext } from "./saved";

const STORAGE_KEY = "mango.playback-return.v1";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type PlaybackReturnSurface = "detail" | "tab_home";
export type PlaybackOrigin = "home" | "search";

export interface PlaybackReturnSnapshot {
  tab: BrowseTab;
  cardId: string;
  cardType: string;
  cardTitle: string;
  cardPoster?: string;
  cardSource?: string;
  episodeId?: string;
  returnSurface: PlaybackReturnSurface;
  origin?: PlaybackOrigin;
  searchState?: unknown;
  savedAt: number;
}

export function tabForCard(
  card: Pick<ContentCard, "type" | "source">,
  fallback?: BrowseTab,
): BrowseTab {
  if (card.source === "youtube" || card.type.startsWith("youtube_")) {
    return "youtube";
  }
  if (card.type === "tv") {
    return "live";
  }
  if (card.type === "series") {
    return "series";
  }
  return fallback ?? "movies";
}

export function playbackReturnSurface(
  card: ContentCard,
  tab: BrowseTab,
  origin: PlaybackOrigin = "home",
): PlaybackReturnSurface {
  if (origin === "search") {
    return "detail";
  }
  if (card.type === "tv" || tab === "live") {
    return "tab_home";
  }
  return "detail";
}

export function savePlaybackReturnSnapshot(
  tab: BrowseTab,
  card: ContentCard,
  episodeId?: string,
  origin: PlaybackOrigin = "home",
  searchState?: unknown,
): void {
  const snapshot: PlaybackReturnSnapshot = {
    tab: tabForCard(card, tab),
    cardId: card.id,
    cardType: card.type,
    cardTitle: card.title,
    cardPoster: card.posterUrl,
    cardSource: card.source,
    episodeId,
    returnSurface: playbackReturnSurface(card, tab, origin),
    origin,
    ...(origin === "search" && searchState ? { searchState } : {}),
    savedAt: Date.now(),
  };
  const serialized = JSON.stringify(snapshot);
  // Matched-4K playback restarts Chromium after restoring the launcher display
  // mode so EGL is rebuilt cleanly. sessionStorage dies with that tab, while
  // localStorage survives the intentional browser restart. Keep a session copy
  // as a fallback for restricted/private browser contexts.
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // ignore quota errors
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // ignore quota errors
  }
}

export function readPlaybackReturnSnapshot(): PlaybackReturnSnapshot | null {
  const rawSnapshots: Array<string | null> = [];
  try {
    rawSnapshots.push(localStorage.getItem(STORAGE_KEY));
  } catch {
    rawSnapshots.push(null);
  }
  try {
    rawSnapshots.push(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    rawSnapshots.push(null);
  }
  for (const raw of rawSnapshots) {
    if (!raw) continue;
    try {
      const snapshot = JSON.parse(raw) as PlaybackReturnSnapshot;
      if (!snapshot?.cardId || !snapshot?.cardType || !Number.isFinite(snapshot.savedAt)) {
        continue;
      }
      if (Date.now() - snapshot.savedAt > MAX_AGE_MS) {
        clearPlaybackReturnSnapshot();
        return null;
      }
      return snapshot;
    } catch {
      // Try the other storage copy before giving up.
    }
  }
  return null;
}

export function clearPlaybackReturnSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function cardFromPlaybackSnapshot(snapshot: PlaybackReturnSnapshot): ContentCard {
  return {
    id: snapshot.cardId,
    type: snapshot.cardType,
    title: snapshot.cardTitle,
    subtitle: "",
    posterUrl: snapshot.cardPoster,
    source: snapshot.cardSource,
  };
}

export async function readPlaybackReturnFromContext(): Promise<PlaybackReturnSnapshot | null> {
  const ctx = await fetchLibraryContext();
  if (!ctx) {
    return null;
  }
  const card: ContentCard = {
    id: ctx.id,
    type: ctx.type,
    title: ctx.title,
    subtitle: "",
    posterUrl: ctx.poster || undefined,
    source: ctx.source === "youtube" ? "youtube" : undefined,
  };
  const tab = ctx.tab as BrowseTab;
  return {
    tab: tabForCard(card, tab),
    cardId: ctx.id,
    cardType: ctx.type,
    cardTitle: ctx.title,
    cardPoster: ctx.poster || undefined,
    cardSource: card.source,
    returnSurface: playbackReturnSurface(card, tab),
    origin: "home",
    savedAt: Date.now(),
  };
}
