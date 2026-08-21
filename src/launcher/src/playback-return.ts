import type { BrowseTab, ContentCard } from "./types";
import { fetchLibraryContext } from "./saved";
import { tabForCard } from "./library-tab";
import {
  personalizationOwnerFromPayload,
  type PersonalizationOwner,
} from "./personalization";

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
  cardLibrarySource?: string;
  episodeId?: string;
  returnSurface: PlaybackReturnSurface;
  origin?: PlaybackOrigin;
  searchState?: unknown;
  /** Immutable Detail owner; absent only on snapshots written by older builds. */
  profileId?: string;
  personalizationUpdatedAt?: number;
  savedAt: number;
}

export { tabForCard };

export function playbackReturnSurface(
  card: ContentCard,
  tab: BrowseTab,
  origin: PlaybackOrigin = "home",
): PlaybackReturnSurface {
  if (origin === "search") {
    return "detail";
  }
  if (tabForCard(card, tab) === "live") {
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
  owner?: PersonalizationOwner,
): void {
  const snapshot: PlaybackReturnSnapshot = {
    tab: tabForCard(card, tab),
    cardId: card.id,
    cardType: card.type,
    cardTitle: card.title,
    cardPoster: card.posterUrl,
    cardSource: card.source,
    cardLibrarySource: card.librarySource,
    episodeId,
    returnSurface: playbackReturnSurface(card, tab, origin),
    origin,
    ...(origin === "search" && searchState ? { searchState } : {}),
    ...(owner
      ? {
        profileId: owner.profileId,
        personalizationUpdatedAt: owner.personalizationUpdatedAt,
      }
      : {}),
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

/** Parse the persisted owner as an all-or-nothing pair for safe boot restore. */
export function playbackReturnOwner(
  snapshot: PlaybackReturnSnapshot,
): PersonalizationOwner | null {
  return personalizationOwnerFromPayload({
    profile_id: snapshot.profileId,
    personalization_updated_at: snapshot.personalizationUpdatedAt,
  });
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
      const fallback = ["movies", "series", "live", "youtube"].includes(snapshot.tab)
        ? snapshot.tab
        : "movies";
      const canonicalTab = tabForCard({
        type: snapshot.cardType,
        source: snapshot.cardSource,
      }, fallback);
      const effectiveOrigin = snapshot.origin === "search" || snapshot.searchState
        ? "search"
        : "home";
      return {
        ...snapshot,
        tab: canonicalTab,
        returnSurface: effectiveOrigin === "search" || canonicalTab !== "live"
          ? "detail"
          : "tab_home",
      };
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
    librarySource: snapshot.cardLibrarySource,
  };
}

export async function readPlaybackReturnFromContext(
  expectedOwner: PersonalizationOwner,
): Promise<PlaybackReturnSnapshot | null> {
  const ctx = await fetchLibraryContext(expectedOwner);
  if (!ctx) {
    return null;
  }
  const card: ContentCard = {
    id: ctx.id,
    type: ctx.type,
    title: ctx.title,
    subtitle: "",
    posterUrl: ctx.poster || undefined,
    source: ctx.tab === "youtube" || ctx.type.startsWith("youtube_") ? "youtube" : undefined,
    librarySource: ctx.source,
  };
  const tab = ctx.tab as BrowseTab;
  return {
    tab: tabForCard(card, tab),
    cardId: ctx.id,
    cardType: ctx.type,
    cardTitle: ctx.title,
    cardPoster: ctx.poster || undefined,
    cardSource: card.source,
    cardLibrarySource: card.librarySource,
    returnSurface: playbackReturnSurface(card, tab),
    origin: "home",
    profileId: expectedOwner.profileId,
    personalizationUpdatedAt: expectedOwner.personalizationUpdatedAt,
    savedAt: Date.now(),
  };
}
