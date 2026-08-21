import assert from "node:assert/strict";
import test from "node:test";

import { nextEpisodeFocusTarget } from "./detail";

test("completed episode return focuses the backend-authoritative next episode", () => {
  assert.equal(nextEpisodeFocusTarget(
    "tt0290978",
    "tt0290978:1:1",
    {
      show: true,
      series_id: "tt0290978",
      from_episode_id: "tt0290978:1:1",
      next: { id: "tt0290978:1:2", season: 1, episode: 2, title: "Work Experience" },
    },
  ), "tt0290978:1:2");
});

test("playback return ignores a stale next-episode hint from another title or episode", () => {
  const next = { id: "tt0386676:1:2", season: 1, episode: 2, title: "Diversity Day" };
  assert.equal(nextEpisodeFocusTarget(
    "tt0290978",
    "tt0290978:1:1",
    {
      show: true,
      series_id: "tt0386676",
      from_episode_id: "tt0386676:1:1",
      next,
    },
  ), null);
  assert.equal(nextEpisodeFocusTarget(
    "tt0386676",
    "tt0386676:1:3",
    {
      show: true,
      series_id: "tt0386676",
      from_episode_id: "tt0386676:1:1",
      next,
    },
  ), null);
});
