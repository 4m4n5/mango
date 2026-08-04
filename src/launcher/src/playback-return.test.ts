import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPlaybackReturnSnapshot,
  playbackReturnOwner,
  readPlaybackReturnSnapshot,
  savePlaybackReturnSnapshot,
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
