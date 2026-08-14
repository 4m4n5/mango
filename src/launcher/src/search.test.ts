import assert from "node:assert/strict";
import test from "node:test";

import { splitFocusRows } from "./home";
import { railColumns } from "./layout";
import {
  ARTWORK_DWELL_MS,
  isSearchPinnedChromeKey,
  mergeComposeFocusRows,
  readPersistedSearchState,
  SEARCH_KEYBOARD,
  SEARCH_KEYBOARD_COLUMNS,
    SEARCH_RESULTS_PAINT_MS,
    searchGroupPageWindow,
    searchQueryCaretLeading,
    searchQueryDisplayText,
    shouldClearSuggestions,
    slimSearchSnapshot,
    validRestoreState,
} from "./search";

test("Search compose focus rows connect keyboard and right-side suggestions", () => {
  assert.deepEqual(
    mergeComposeFocusRows(
      [["q", "w"], ["a", "s"], ["space", "search"]],
      [["recent-1"], ["recent-2"], ["recent-3"], ["recent-4"]],
    ),
    [
      ["q", "w", "recent-1"],
      ["a", "s", "recent-2"],
      ["space", "search", "recent-3"],
      ["recent-4"],
    ],
  );
});

test("Search keyboard is a 10-column rectangle so Down stays in column", () => {
  assert.equal(SEARCH_KEYBOARD.length, 4);
  for (const row of SEARCH_KEYBOARD) {
    assert.equal(row.length, SEARCH_KEYBOARD_COLUMNS);
  }
  assert.equal(SEARCH_KEYBOARD[1]?.[9]?.id, "p");
  assert.equal(SEARCH_KEYBOARD[2]?.[9]?.id, "delete");
  assert.equal(SEARCH_KEYBOARD[3]?.[7]?.id, "space");
  assert.equal(SEARCH_KEYBOARD[3]?.[9]?.id, "submit");
});

test("Search keeps prior suggestions visible while a new query is debounced", () => {
  assert.equal(shouldClearSuggestions("dune", 4), false);
  assert.equal(shouldClearSuggestions("du", 4), false);
  assert.equal(shouldClearSuggestions("d", 4), true);
  assert.equal(shouldClearSuggestions("", 4), true);
});

test("Empty compose caret leads the placeholder; typed query keeps a trailing caret", () => {
  assert.equal(searchQueryCaretLeading(""), true);
  assert.equal(searchQueryCaretLeading("d"), false);
  assert.equal(searchQueryDisplayText(""), "search mango");
  assert.equal(searchQueryDisplayText("dune"), "dune");
});

test("Search artwork dwell is long enough to skip rapid D-pad strobing", () => {
  assert.ok(ARTWORK_DWELL_MS >= 160);
  assert.ok(ARTWORK_DWELL_MS <= 200);
});

test("Search restore state preserves result focus, pages, and originating Home state", () => {
  const savedAt = Date.now();
  const restored = validRestoreState({
    version: 1,
    savedAt,
    query: "Dune",
    scope: "movies",
    submitted: true,
    snapshot: null,
    pages: { movies: 2 },
    focusedKey: "rail:movies:movie:tt1160419",
    position: { row: 3, col: 2 },
    homeTab: "series",
    homeFocusKey: "rail:continue:series:tt0944947",
    homePosition: { row: 1, col: 4 },
  });
  assert.equal(restored?.query, "Dune");
  assert.equal(restored?.pages.movies, 2);
  assert.equal(restored?.focusedKey, "rail:movies:movie:tt1160419");
  assert.equal(restored?.homeTab, "series");
  assert.deepEqual(restored?.homePosition, { row: 1, col: 4 });
});

test("Search restoration rejects expired or malformed snapshots", () => {
  assert.equal(validRestoreState({
    version: 1,
    savedAt: Date.now() - 7 * 60 * 60 * 1000,
    query: "Dune",
    scope: "all",
  }), null);
  assert.equal(validRestoreState({
    version: 1,
    savedAt: Date.now(),
    query: "Dune",
    scope: "invalid",
  }), null);
});

test("Search boot recovery reads the durable state after Chromium restarts", () => {
  const persisted = {
    version: 1,
    savedAt: Date.now(),
    query: "Panchayat",
    scope: "series",
    submitted: true,
    snapshot: null,
    pages: {},
    focusedKey: "search:edit",
  };
  const restored = readPersistedSearchState({
    getItem: () => JSON.stringify(persisted),
  });
  assert.equal(restored?.query, "Panchayat");
  assert.equal(restored?.scope, "series");
  assert.equal(restored?.submitted, true);
  assert.equal(restored?.focusedKey, "search:edit");
});

test("A Search result page fills whole rows of the live grid, More in the final slot", () => {
  const items = Array.from({ length: 30 }, (_, index) => ({
    key: `youtube:youtube_video:video-${index}`,
    source: "youtube" as const,
    type: "youtube_video",
    id: `video-${index}`,
    title: `Video ${index}`,
    subtitle: "Channel",
    tab: "youtube" as const,
    kind: "video" as const,
    in_library: true,
    queued_for_verify: false,
  }));
  // Asserted against railColumns rather than a literal: page size and column
  // count were set independently once before, and drifted apart the moment the
  // grid was resized, which left "More" revealing rows nobody could see.
  for (const layout of ["landscape", "poster"] as const) {
    const cols = railColumns(layout === "landscape");
    const first = searchGroupPageWindow({ layout, items }, 0);
    assert.equal(first.capacity % cols, 0, `${layout} page is whole rows`);
    assert.equal(first.items.length, first.capacity - 1);
    assert.equal(first.hasMore, true);
    const rows = splitFocusRows([...first.items.map((item) => item.id), `more:${layout}`], cols);
    assert.deepEqual(
      rows.map((row) => row.length),
      Array.from({ length: first.capacity / cols }, () => cols),
      `${layout} page leaves no part-filled row`,
    );

    const second = searchGroupPageWindow({ layout, items }, 1);
    assert.equal(second.items.length, first.capacity * 2 - 1);
    assert.equal(second.items[first.items.length]?.id, `video-${first.capacity - 1}`);
  }
});

test("Search result paints wait out a trailing window so D-pad can drain", () => {
  assert.ok(SEARCH_RESULTS_PAINT_MS >= 80);
  assert.ok(SEARCH_RESULTS_PAINT_MS <= 120);
});

test("Search scope chips and Edit are pinned chrome, not result cards", () => {
  assert.equal(isSearchPinnedChromeKey("search:scope:youtube"), true);
  assert.equal(isSearchPinnedChromeKey("search:edit"), true);
  assert.equal(isSearchPinnedChromeKey("rail:youtube:youtube_video:abc"), false);
  assert.equal(isSearchPinnedChromeKey("search:key:q"), false);
});

test("Search pagination keeps each rail action in that rail's final focus row", () => {
  const youtubeRows = splitFocusRows(["yt-1", "yt-2", "more:youtube"], railColumns(true));
  const externalRows = splitFocusRows(["vod-1", "more:external"], railColumns(false));
  assert.deepEqual([...youtubeRows, ...externalRows], [
    ["yt-1", "yt-2", "more:youtube"],
    ["vod-1", "more:external"],
  ]);
});

test("Search restore snapshots drop synopsis text", () => {
  const slim = slimSearchSnapshot({
    ok: true,
    search_id: "s1",
    query: "dune",
    normalized_query: "dune",
    scope: "all",
    revision: 2,
    complete: true,
    groups: [{
      id: "youtube",
      label: "YouTube",
      layout: "landscape",
      total: 1,
      status: "ready",
      items: [{
        key: "youtube:youtube_video:abc",
        source: "youtube",
        type: "youtube_video",
        id: "abc",
        title: "Dune",
        subtitle: "Film Craft",
        description: "A".repeat(4000),
        tab: "youtube",
        in_library: true,
        queued_for_verify: false,
      }],
    }],
    phases: {},
    created_at: 1,
    updated_at: 1,
  });
  assert.equal(slim?.groups[0]?.items[0]?.title, "Dune");
  assert.equal(slim?.groups[0]?.items[0]?.description, undefined);
});
