import assert from "node:assert/strict";
import test from "node:test";

import { splitFocusRows } from "./home";
import { railColumns } from "./layout";
import {
  mergeComposeFocusRows,
  searchGroupPageWindow,
  shouldClearSuggestions,
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

test("Search keeps prior suggestions visible while a new query is debounced", () => {
  assert.equal(shouldClearSuggestions("dune", 4), false);
  assert.equal(shouldClearSuggestions("du", 4), false);
  assert.equal(shouldClearSuggestions("d", 4), true);
  assert.equal(shouldClearSuggestions("", 4), true);
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

test("Search pagination keeps each rail action in that rail's final focus row", () => {
  const youtubeRows = splitFocusRows(["yt-1", "yt-2", "more:youtube"], railColumns(true));
  const externalRows = splitFocusRows(["vod-1", "more:external"], railColumns(false));
  assert.deepEqual([...youtubeRows, ...externalRows], [
    ["yt-1", "yt-2", "more:youtube"],
    ["vod-1", "more:external"],
  ]);
});
