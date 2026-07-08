import type { BrowseTab, ContentCard } from "./types";
import { fetchLibraryContext } from "./saved";

const STORAGE_KEY = "mango.playback-return.v1";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type PlaybackReturnSurface = "detail" | "tab_home";

export interface PlaybackReturnSnapshot {
  tab: BrowseTab;
  cardId: string;
  cardType: string;
  cardTitle: string;
  cardPoster?: string;
  cardSource?: string;
  episodeId?: string;
  returnSurface: PlaybackReturnSurface;
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

export function playbackReturnSurface(card: ContentCard, tab: BrowseTab): PlaybackReturnSurface {
  if (card.type === "tv" || tab === "live") {
    return "tab_home";
  }
  return "detail";
}

export function savePlaybackReturnSnapshot(
  tab: BrowseTab,
  card: ContentCard,
  episodeId?: string,
): void {
  const snapshot: PlaybackReturnSnapshot = {
    tab: tabForCard(card, tab),
    cardId: card.id,
    cardType: card.type,
    cardTitle: card.title,
    cardPoster: card.posterUrl,
    cardSource: card.source,
    episodeId,
    returnSurface: playbackReturnSurface(card, tab),
    savedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore quota errors
  }
}

export function readPlaybackReturnSnapshot(): PlaybackReturnSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const snapshot = JSON.parse(raw) as PlaybackReturnSnapshot;
    if (!snapshot?.cardId || !snapshot?.cardType) {
      return null;
    }
    if (Date.now() - snapshot.savedAt > MAX_AGE_MS) {
      clearPlaybackReturnSnapshot();
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function clearPlaybackReturnSnapshot(): void {
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
    savedAt: Date.now(),
  };
}
