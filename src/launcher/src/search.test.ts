import assert from "node:assert/strict";
import test from "node:test";

import { validRestoreState } from "./search";

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
