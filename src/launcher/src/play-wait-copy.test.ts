import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAY_WAIT_ELLIPSIS,
  PLAY_WAIT_MAX_CHARS,
  PLAY_WAIT_PHRASES,
  PlayWaitCopy,
  formatPlayWaitLabel,
} from "./play-wait-copy.js";

const BANNED = [
  "stream",
  "resolve",
  "codec",
  "hevc",
  "1080",
  "2160",
  "4k",
  "url",
  "buffer",
  "cache",
  "debrid",
  "torrent",
  "provider",
  "ytdlp",
  "mpv",
  "dash",
  "mux",
  "youtube",
  "http",
  "error",
  "timeout",
  "fallback",
  "encode",
  "addon",
  "format",
  "quality",
  "bitrate",
  "download",
  "magnet",
  "hash",
  "api",
  "json",
  "parse",
  "fetch",
  "retry",
  "ladder",
  "picker",
  "remux",
  "buffering",
  "loading",
  "connecting",
  "torbox",
  "stremio",
  "plex",
  "kodi",
];

test("play-wait corpus is a large set of short two-word couch phrases", () => {
  assert.ok(PLAY_WAIT_PHRASES.length >= 120, `expected at least 120 phrases, got ${PLAY_WAIT_PHRASES.length}`);
  assert.equal(new Set(PLAY_WAIT_PHRASES).size, PLAY_WAIT_PHRASES.length);

  for (const phrase of PLAY_WAIT_PHRASES) {
    assert.match(phrase, /^[a-z]+ [a-z]+$/);
    assert.ok(
      phrase.length <= PLAY_WAIT_MAX_CHARS,
      `"${phrase}" is ${phrase.length} chars; couch buttons need <= ${PLAY_WAIT_MAX_CHARS}`,
    );
    const words = phrase.split(" ");
    for (const banned of BANNED) {
      const leaked = words.some((word) => word === banned || word.startsWith(banned));
      assert.equal(leaked, false, `"${phrase}" leaks technical wait copy (${banned})`);
    }
  }
});

test("play-wait labels add an ellipsis without a third word", () => {
  assert.equal(formatPlayWaitLabel("warming popcorn"), `warming popcorn${PLAY_WAIT_ELLIPSIS}`);
  assert.equal(formatPlayWaitLabel("warming popcorn").trim().split(/\s+/).length, 2);
});

test("play-wait rotator exhausts the bag without consecutive repeats", () => {
  const copy = new PlayWaitCopy();
  const firstBag = new Set<string>();
  let previous: string | null = null;
  for (let i = 0; i < PLAY_WAIT_PHRASES.length; i += 1) {
    const phrase = copy.nextPhrase();
    firstBag.add(phrase);
    assert.notEqual(phrase, previous);
    previous = phrase;
  }
  assert.equal(firstBag.size, PLAY_WAIT_PHRASES.length);

  for (let i = 0; i < PLAY_WAIT_PHRASES.length * 3; i += 1) {
    const phrase = copy.next();
    assert.ok(phrase.endsWith(PLAY_WAIT_ELLIPSIS));
    assert.notEqual(phrase, previous === null ? null : formatPlayWaitLabel(previous));
    previous = phrase.slice(0, -PLAY_WAIT_ELLIPSIS.length);
  }
});
