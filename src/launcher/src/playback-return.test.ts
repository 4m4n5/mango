import assert from "node:assert/strict";
import test from "node:test";

import {
  cardFromPlaybackSnapshot,
  clearPlaybackReturnSnapshot,
  playbackReturnOwner,
  playbackReturnSurface,
  readPlaybackReturnFromContext,
  readPlaybackReturnSnapshot,
  savePlaybackReturnSnapshot,
  tabForCard,
} from "./playback-return";
import type { ContentCard } from "./types";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

function withBrowserStorage(run: (local: MemoryStorage, session: MemoryStorage) => void): void {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
  try {
    run(local, session);
  } finally {
    if (previousLocal) Object.defineProperty(globalThis, "localStorage", previousLocal);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (previousSession) Object.defineProperty(globalThis, "sessionStorage", previousSession);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
}

const officeUk: ContentCard = {
  id: "tt0290978",
  type: "series",
  title: "The Office",
  subtitle: "2001-2003",
  year: 2001,
};

test("known card identity owns its tab over the navigation fallback", () => {
  assert.equal(tabForCard({ type: "movie" }, "series"), "movies");
  assert.equal(tabForCard({ type: "film" }, "series"), "movies");
  assert.equal(tabForCard({ type: "series" }, "movies"), "series");
  assert.equal(tabForCard({ type: "channel" }, "series"), "live");
  assert.equal(tabForCard({ type: "movie", source: "YouTube" }, "movies"), "youtube");
  assert.equal(tabForCard({ type: "youtube_video" }, "series"), "youtube");
  assert.equal(tabForCard({ type: "legacy_special" }, "series"), "series");
});

test("playback return surface uses canonical card identity instead of a stale tab", () => {
  const movie: ContentCard = {
    id: "tt1160419", type: "movie", title: "Dune", subtitle: "2021",
  };
  const live: ContentCard = {
    id: "channel-one", type: "channel", title: "News", subtitle: "live",
  };
  assert.equal(playbackReturnSurface(movie, "live"), "detail");
  assert.equal(playbackReturnSurface(live, "movies"), "tab_home");
  assert.equal(playbackReturnSurface(live, "movies", "search"), "detail");
});

test("playback return round-trip preserves durable Saved source separately from YouTube playback", () => {
  const legacySaved: ContentCard = {
    id: "LegacyVideoCase",
    type: "youtube_video",
    title: "Legacy video",
    subtitle: "Legacy channel",
    source: "youtube",
    librarySource: "mango",
  };
  withBrowserStorage(() => {
    savePlaybackReturnSnapshot("youtube", legacySaved);
    const snapshot = readPlaybackReturnSnapshot();
    assert.equal(snapshot?.cardSource, "youtube");
    assert.equal(snapshot?.cardLibrarySource, "mango");
    const restored = snapshot && cardFromPlaybackSnapshot(snapshot);
    assert.equal(restored?.id, legacySaved.id);
    assert.equal(restored?.type, legacySaved.type);
    assert.equal(restored?.source, "youtube");
    assert.equal(restored?.librarySource, "mango");
  });
});

test("context playback return preserves a legacy Saved key while restoring YouTube playback", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true,
    profile_id: "alice",
    personalization_updated_at: 17,
    context: {
      profile_id: "alice",
      source: "mango",
      type: "youtube_video",
      id: "LegacyContextVideo",
      title: "Legacy context video",
      poster: null,
      tab: "youtube",
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  try {
    const snapshot = await readPlaybackReturnFromContext({
      profileId: "alice",
      personalizationUpdatedAt: 17,
    });
    assert.equal(snapshot?.tab, "youtube");
    assert.equal(snapshot?.cardSource, "youtube");
    assert.equal(snapshot?.cardLibrarySource, "mango");
    const restored = snapshot && cardFromPlaybackSnapshot(snapshot);
    assert.equal(restored?.id, "LegacyContextVideo");
    assert.equal(restored?.source, "youtube");
    assert.equal(restored?.librarySource, "mango");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("playback return survives an intentional Chromium tab restart", () => {
  withBrowserStorage((_local, session) => {
    savePlaybackReturnSnapshot(
      "series",
      officeUk,
      "tt0290978:1:1",
      "home",
      undefined,
      { profileId: "alice", personalizationUpdatedAt: 17 },
    );
    session.clear();

    const restored = readPlaybackReturnSnapshot();
    assert.equal(restored?.tab, "series");
    assert.equal(restored?.cardId, "tt0290978");
    assert.equal(restored?.episodeId, "tt0290978:1:1");
    assert.equal(restored?.returnSurface, "detail");
    assert.deepEqual(restored && playbackReturnOwner(restored), {
      profileId: "alice",
      personalizationUpdatedAt: 17,
    });
  });
});

test("legacy and partial playback snapshots never invent an owner", () => {
  assert.equal(playbackReturnOwner({
    tab: "movies",
    cardId: "tt-one",
    cardType: "movie",
    cardTitle: "One",
    returnSurface: "detail",
    savedAt: Date.now(),
  }), null);
  assert.equal(playbackReturnOwner({
    tab: "movies",
    cardId: "tt-one",
    cardType: "movie",
    cardTitle: "One",
    returnSurface: "detail",
    profileId: "alice",
    savedAt: Date.now(),
  }), null);
});

test("playback return remains durable across a thaw-before-restart race", () => {
  // Matched-4K restore historically thawed Chromium before killing it. The
  // suspended SPA could resume, refresh detail, and clear the snapshot before
  // the process died — boot then landed on Movies+Search. Keep localStorage
  // populated through that window; only an explicit clear may remove it.
  withBrowserStorage((_local, session) => {
    savePlaybackReturnSnapshot("movies", {
      id: "tt39139925",
      type: "movie",
      title: "Dhurandhar: The Revenge",
      subtitle: "2026",
    });
    session.clear();
    assert.equal(readPlaybackReturnSnapshot()?.cardId, "tt39139925");
    // Simulate another focus/visibility refresh that must NOT clear.
    assert.equal(readPlaybackReturnSnapshot()?.cardId, "tt39139925");
  });
});

test("clearing a playback return removes both durable and session copies", () => {
  withBrowserStorage(() => {
    savePlaybackReturnSnapshot("series", officeUk, "tt0290978:1:1");
    clearPlaybackReturnSnapshot();
    assert.equal(readPlaybackReturnSnapshot(), null);
  });
});

test("Search-origin Live playback returns to Detail with compact Search state", () => {
  const live: ContentCard = {
    id: "channel-1",
    type: "tv",
    title: "News Live",
    subtitle: "live channel",
  };
  withBrowserStorage(() => {
    const searchState = {
      version: 1,
      savedAt: Date.now(),
      query: "news",
      scope: "all",
      submitted: true,
      snapshot: null,
      pages: {},
      homeTab: "series",
    };
    savePlaybackReturnSnapshot("live", live, undefined, "search", searchState);
    const restored = readPlaybackReturnSnapshot();
    assert.equal(restored?.returnSurface, "detail");
    assert.equal(restored?.origin, "search");
    assert.deepEqual(restored?.searchState, searchState);
  });
});

test("Dune opened from TV Search remains movie-owned without losing Search return state", () => {
  const dune: ContentCard = {
    id: "tt1160419",
    type: "movie",
    title: "Dune",
    subtitle: "2021",
  };
  withBrowserStorage(() => {
    const searchState = {
      version: 1,
      savedAt: Date.now(),
      query: "dune",
      scope: "all",
      submitted: true,
      snapshot: null,
      pages: {},
      homeTab: "series",
    };
    savePlaybackReturnSnapshot("series", dune, undefined, "search", searchState);
    const restored = readPlaybackReturnSnapshot();
    assert.equal(restored?.tab, "movies");
    assert.equal(restored?.returnSurface, "detail");
    assert.equal(restored?.origin, "search");
    assert.deepEqual(restored?.searchState, searchState);
  });
});

test("a pre-upgrade playback snapshot cannot restore a movie into TV Shows", () => {
  withBrowserStorage((local) => {
    local.setItem("mango.playback-return.v1", JSON.stringify({
      tab: "series",
      cardId: "tt1160419",
      cardType: "movie",
      cardTitle: "Dune",
      returnSurface: "tab_home",
      savedAt: Date.now(),
    }));
    const restored = readPlaybackReturnSnapshot();
    assert.equal(restored?.tab, "movies");
    assert.equal(restored?.returnSurface, "detail");
  });
});
