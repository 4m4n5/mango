import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogEmptyCopy,
  catalogOfflineCopy,
  catalogStateAfterFailure,
  catalogStateAfterSuccess,
  catalogShuffleFingerprint,
  hasCatalogItems,
  nonEmptyCatalogRails,
  sameCatalogPresentation,
  shuffleableCatalogRails,
  youtubeHistoryImportRefreshPolicy,
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
  assert.doesNotMatch(catalogEmptyCopy("movies").body, /press X/i);
  assert.doesNotMatch(catalogEmptyCopy("live").body, /press X/i);
});

test("Shuffle is available only for public recommendation rails", () => {
  const curated = populatedRail("discover");
  const saved = populatedRail("saved");
  const vodForYou = populatedRail("for-you-movies");
  const youtubeForYou = populatedRail("for_you");
  assert.deepEqual(shuffleableCatalogRails("movies", [curated, saved]), []);
  assert.deepEqual(shuffleableCatalogRails("movies", [curated, vodForYou]).map((rail) => rail.id), [
    "for-you-movies",
  ]);
  assert.deepEqual(shuffleableCatalogRails("youtube", [saved]), []);
  assert.deepEqual(shuffleableCatalogRails("youtube", [saved, youtubeForYou]).map((rail) => rail.id), [
    "for_you",
  ]);
});

test("Shuffle success requires recommendation membership or order to change", () => {
  const before = populatedRail("for-you-movies");
  const same = populatedRail("for-you-movies");
  const after: ContentRail = {
    ...populatedRail("for-you-movies"),
    cards: [{ id: "movie:replacement", type: "movie", title: "replacement", subtitle: "2026" }],
  };
  assert.equal(catalogShuffleFingerprint("movies", [before]), catalogShuffleFingerprint("movies", [same]));
  assert.notEqual(catalogShuffleFingerprint("movies", [before]), catalogShuffleFingerprint("movies", [after]));
  assert.equal(catalogShuffleFingerprint("movies", [populatedRail("saved")]), null);
});

test("YouTube cold start explains the three private setup paths", () => {
  const copy = catalogEmptyCopy("youtube");
  assert.equal(copy.heading, "YouTube");
  assert.match(copy.body, /connect subscriptions/i);
  assert.match(copy.body, /Google Takeout/i);
  assert.match(copy.body, /watch a video/i);
});

test("Takeout completion invalidates only YouTube and never refreshes visible VOD", () => {
  assert.deepEqual(youtubeHistoryImportRefreshPolicy("movies", false), {
    cancelActiveCatalogRequest: false,
    reloadYoutubeNow: false,
    deferYoutubeReload: false,
  });
});

test("Takeout completion defers in Settings and reloads YouTube after an early Back", () => {
  assert.deepEqual(youtubeHistoryImportRefreshPolicy("youtube", true), {
    cancelActiveCatalogRequest: true,
    reloadYoutubeNow: false,
    deferYoutubeReload: true,
  });
  assert.deepEqual(youtubeHistoryImportRefreshPolicy("youtube", false), {
    cancelActiveCatalogRequest: true,
    reloadYoutubeNow: true,
    deferYoutubeReload: false,
  });
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
