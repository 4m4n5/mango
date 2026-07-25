import assert from "node:assert/strict";
import test from "node:test";

import { mergeComposeFocusRows, shouldClearSuggestions, validRestoreState } from "./search";

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
