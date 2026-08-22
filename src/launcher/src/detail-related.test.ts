import assert from "node:assert/strict";
import test from "node:test";
import { relatedTitlesLimit, relatedLabelForTab, cardHasCompleteDetailMeta } from "./detail.js";
import { isLandscapeCard } from "./home.js";
import type { ContentCard } from "./types.js";

const youtubeCard: ContentCard = {
  id: "abc",
  type: "youtube_video",
  title: "Clip",
  subtitle: "Channel",
  source: "youtube",
};

const movieCard: ContentCard = {
  id: "tt123",
  type: "movie",
  title: "Film",
  subtitle: "2024",
};

test("YouTube related shows four landscape titles and fetches a spare", () => {
  assert.deepEqual(relatedTitlesLimit("youtube"), { display: 4, fetch: 5 });
  assert.equal(isLandscapeCard(youtubeCard, "youtube"), true);
});

test("VOD related stays a seven-card portrait row", () => {
  assert.deepEqual(relatedTitlesLimit("movies"), { display: 7, fetch: 8 });
  assert.deepEqual(relatedTitlesLimit("series"), { display: 7, fetch: 8 });
  assert.equal(isLandscapeCard(movieCard, "movies"), false);
});

test("YouTube detail resample is labeled More to watch; VOD stays Related", () => {
  assert.equal(relatedLabelForTab("youtube"), "More to watch");
  assert.equal(relatedLabelForTab("movies"), "Related");
  assert.equal(relatedLabelForTab("series"), "Related");
  assert.equal(relatedLabelForTab("live"), "Related");
});

test("playback-return skips a second meta fetch when description and poster are already set", () => {
  assert.equal(cardHasCompleteDetailMeta({
    ...movieCard,
    description: "A desert epic.",
    posterUrl: "https://img.example/dune.jpg",
  }), true);
  assert.equal(cardHasCompleteDetailMeta({
    ...movieCard,
    posterUrl: "https://img.example/dune.jpg",
  }), false);
  assert.equal(cardHasCompleteDetailMeta({
    ...youtubeCard,
    description: "loading details…".slice(0, 0),
    posterUrl: "https://img.example/yt.jpg",
  }), false);
});
