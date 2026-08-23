import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTER_SCROLLPORT_MARGIN_RATIO,
  bindPosterImage,
  posterIsNearScrollport,
  posterScrollportHasBox,
  resolveCardPosterUrl,
  rewriteFragileYoutubeThumbnail,
} from "./poster.js";

const port = { top: 200, right: 1920, bottom: 1080, left: 0 };
const margin = {
  x: (port.right - port.left) * POSTER_SCROLLPORT_MARGIN_RATIO,
  y: (port.bottom - port.top) * POSTER_SCROLLPORT_MARGIN_RATIO,
};

test("a poster inside the rails scrollport is near", () => {
  const img = { top: 240, right: 400, bottom: 520, left: 40 };
  assert.equal(posterIsNearScrollport(img, port, margin), true);
});

test("the next rail just below the fold is still prefetched", () => {
  const img = { top: 1400, right: 400, bottom: 1680, left: 40 };
  assert.equal(posterIsNearScrollport(img, port, margin), true);
});

test("a rail more than one extra screen away stays deferred", () => {
  const img = { top: 2800, right: 400, bottom: 3080, left: 40 };
  assert.equal(posterIsNearScrollport(img, port, margin), false);
});

test("a zero-size box is not near so a disconnected card does not eager-load", () => {
  const img = { top: 0, right: 0, bottom: 0, left: 0 };
  assert.equal(posterIsNearScrollport(img, port, margin), false);
  assert.equal(posterScrollportHasBox(img), false);
  assert.equal(posterScrollportHasBox(port), true);
});

test("a zero-size scrollport is not near even when the card already has a box", () => {
  const img = { top: 240, right: 400, bottom: 520, left: 40 };
  const emptyPort = { top: 200, right: 200, bottom: 200, left: 200 };
  assert.equal(posterScrollportHasBox(emptyPort), false);
  assert.equal(posterIsNearScrollport(img, emptyPort, { x: 0, y: 0 }), false);
});

test("YouTube cards rewrite maxres thumbnails and fill missing artwork", () => {
  assert.equal(
    rewriteFragileYoutubeThumbnail("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  assert.equal(
    resolveCardPosterUrl({
      id: "dQw4w9WgXcQ",
      type: "youtube_video",
      posterUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    }),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  assert.equal(
    resolveCardPosterUrl({ id: "dQw4w9WgXcQ", type: "youtube_video" }),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
});

test("rebinding a reused detail poster clears stale fallback state", () => {
  let missingClassRemoved = false;
  let fallbackRemoved = false;
  const image = {
    dataset: {
      posterBound: "1",
      posterRetry: "1",
      posterFallbackTitle: "F1: The Movie",
    },
    classList: {
      remove(value: string) {
        if (value === "poster-image--missing") missingClassRemoved = true;
      },
    },
    closest() {
      return {
        querySelectorAll() {
          return [{ remove: () => { fallbackRemoved = true; } }];
        },
      };
    },
    getAttribute(name: string) {
      return name === "src" ? "https://images.example/rrr.jpg" : null;
    },
  } as unknown as HTMLImageElement;

  bindPosterImage(image, "RRR");

  assert.equal(missingClassRemoved, true);
  assert.equal(fallbackRemoved, true);
  assert.equal(image.dataset.posterRetry, undefined);
  assert.equal(image.dataset.posterFallbackTitle, "RRR");
});
