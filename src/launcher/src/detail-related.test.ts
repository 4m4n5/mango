import assert from "node:assert/strict";
import test from "node:test";
import { relatedTitlesLimit } from "./detail.js";
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
