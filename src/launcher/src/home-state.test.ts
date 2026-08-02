import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogEmptyCopy,
  catalogOfflineCopy,
  catalogStateAfterFailure,
  catalogStateAfterSuccess,
  hasCatalogItems,
  nonEmptyCatalogRails,
  sameCatalogPresentation,
} from "./home.js";
import type { ContentRail } from "./types.js";

const emptyRail = (id: string): ContentRail => ({ id, label: id, cards: [] });
const populatedRail = (id: string): ContentRail => ({
  id,
  label: id,
  cards: [{ id: `movie:${id}`, type: "movie", title: id, subtitle: "2026" }],
});

test("empty rails are omitted without changing populated rail order", () => {
  const rails = [emptyRail("a"), populatedRail("b"), emptyRail("c"), populatedRail("d")];
  assert.equal(hasCatalogItems(rails), true);
  assert.deepEqual(nonEmptyCatalogRails(rails).map((rail) => rail.id), ["b", "d"]);
});

test("an all-empty response has no usable catalog items", () => {
  assert.equal(hasCatalogItems([emptyRail("a"), emptyRail("b")]), false);
  assert.deepEqual(nonEmptyCatalogRails([emptyRail("a")]), []);
});

test("empty and failed refreshes preserve usable fallback rails as stale", () => {
  const fallback = [populatedRail("current")];
  assert.deepEqual(catalogStateAfterSuccess([emptyRail("new")], fallback), {
    status: "ready",
    rails: fallback,
    freshness: "stale",
  });
  assert.deepEqual(catalogStateAfterFailure("unavailable", fallback), {
    status: "ready",
    rails: fallback,
    freshness: "stale",
  });
});

test("no-fallback terminal states are explicit", () => {
  assert.deepEqual(catalogStateAfterSuccess([emptyRail("new")], undefined), { status: "empty" });
  assert.deepEqual(catalogStateAfterFailure("timeout", undefined), {
    status: "offline",
    reason: "timeout",
  });
});

test("background retries can detect an unchanged stale/offline presentation", () => {
  const rails = [populatedRail("current")];
  const stale = { status: "ready", rails, freshness: "stale" } as const;
  assert.equal(sameCatalogPresentation(stale, catalogStateAfterFailure("unavailable", rails)), true);
  assert.equal(
    sameCatalogPresentation({ status: "offline", reason: "timeout" }, { status: "offline", reason: "timeout" }),
    true,
  );
  assert.equal(
    sameCatalogPresentation({ status: "offline", reason: "timeout" }, { status: "offline", reason: "busy" }),
    false,
  );
});

test("empty copy respects Live's no-shuffle contract", () => {
  assert.match(catalogEmptyCopy("movies").body, /press X/i);
  assert.doesNotMatch(catalogEmptyCopy("live").body, /press X/i);
});

test("offline copy is couch-safe and never names implementation details", () => {
  const copies = [
    catalogOfflineCopy("busy"),
    catalogOfflineCopy("timeout"),
    catalogOfflineCopy("unavailable"),
  ];
  for (const copy of copies) {
    const text = `${copy.heading} ${copy.title} ${copy.body}`;
    assert.doesNotMatch(text, /HTTP|fetch|catalog-service|N2|Pi|socket|endpoint/i);
  }
});
