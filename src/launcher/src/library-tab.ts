import type { BrowseTab, ContentCard } from "./types";

/** Content identity owns its library tab; `fallback` is only for unknown types. */
export function tabForCard(
  card: Pick<ContentCard, "type" | "source">,
  fallback?: BrowseTab,
): BrowseTab {
  const source = card.source?.trim().toLowerCase() || "mango";
  const type = card.type.trim().toLowerCase();
  if (source === "youtube" || type.startsWith("youtube_")) {
    return "youtube";
  }
  if (type === "tv" || type === "live" || type === "channel") {
    return "live";
  }
  if (type === "series") {
    return "series";
  }
  if (type === "movie" || type === "film" || type === "") {
    return "movies";
  }
  return fallback ?? "movies";
}

/** Preserve a server-issued library key without changing playback transport. */
export function librarySourceForCard(
  card: Pick<ContentCard, "librarySource" | "source" | "type">,
): string {
  const librarySource = card.librarySource?.trim().toLowerCase();
  if (librarySource) return librarySource;
  const source = card.source?.trim().toLowerCase();
  if (source) return source === "youtube" ? "youtube" : "mango";
  return card.type.trim().toLowerCase().startsWith("youtube_") ? "youtube" : "mango";
}
