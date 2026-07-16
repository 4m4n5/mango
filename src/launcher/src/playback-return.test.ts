import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPlaybackReturnSnapshot,
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
    savePlaybackReturnSnapshot("series", officeUk, "tt0290978:1:1");
    session.clear();

    const restored = readPlaybackReturnSnapshot();
    assert.equal(restored?.tab, "series");
    assert.equal(restored?.cardId, "tt0290978");
    assert.equal(restored?.episodeId, "tt0290978:1:1");
    assert.equal(restored?.returnSurface, "detail");
  });
});

test("clearing a playback return removes both durable and session copies", () => {
  withBrowserStorage(() => {
    savePlaybackReturnSnapshot("series", officeUk, "tt0290978:1:1");
    clearPlaybackReturnSnapshot();
    assert.equal(readPlaybackReturnSnapshot(), null);
  });
});
