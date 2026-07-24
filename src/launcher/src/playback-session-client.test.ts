import test from "node:test";
import assert from "node:assert/strict";
import { playbackSessionResult, type PlaybackSession } from "./catalog";

function session(overrides: Partial<PlaybackSession> = {}): PlaybackSession {
  return {
    session_id: "play-session-test",
    version: 1,
    state: "resolving",
    ever_ready: false,
    error: null,
    result: null,
    ...overrides,
  };
}

test("a stopped session that reached playback is successful return truth", () => {
  assert.deepEqual(
    playbackSessionResult(session({ state: "stopped", ever_ready: true })),
    { ok: true },
  );
});

test("a pre-frame failure surfaces its current couch-safe error", () => {
  assert.throws(
    () => playbackSessionResult(session({
      state: "failed_before_frame",
      error: "YouTube playback did not start — try another video",
    })),
    /YouTube playback did not start/,
  );
});

test("resolving state remains pending and cancellation stays distinct", () => {
  assert.equal(playbackSessionResult(session()), null);
  assert.throws(
    () => playbackSessionResult(session({ state: "cancelled" })),
    /play cancelled/,
  );
});
