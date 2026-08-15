import test from "node:test";
import assert from "node:assert/strict";
import {
  initialRatingAxisValue,
  NEUTRAL_FIRE_WATER_RATING,
  nudgeHalfStep,
} from "./ratings";
import { LAUNCHER_ICON_PATHS } from "./icons";

test("an unset Fire or Water axis starts at the ranker's neutral value", () => {
  assert.equal(NEUTRAL_FIRE_WATER_RATING, 2);
  assert.equal(initialRatingAxisValue(null), 2);
  assert.equal(initialRatingAxisValue(0.5), 0.5);
  assert.equal(initialRatingAxisValue(4.5), 4.5);
});

test("focused-axis Left/Right nudges 0.5 from neutral without an extra confirm", () => {
  assert.equal(nudgeHalfStep(null, 1), 2.5);
  assert.equal(nudgeHalfStep(null, -1), 1.5);
  assert.equal(nudgeHalfStep(4, 1), 4.5);
  assert.equal(nudgeHalfStep(0, -1), 0);
  assert.equal(nudgeHalfStep(5, 1), 5);
  assert.equal(nudgeHalfStep(2.5, -1), 2);
});

test("Detail play and Search play share the same triangle path", () => {
  assert.deepEqual(LAUNCHER_ICON_PATHS.play, ["M8.5 6.5v11l9-5.5z"]);
});
