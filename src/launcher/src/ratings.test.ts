import test from "node:test";
import assert from "node:assert/strict";
import {
  initialRatingAxisValue,
  NEUTRAL_FIRE_WATER_RATING,
} from "./ratings";

test("an unset Fire or Water axis starts at the ranker's neutral value", () => {
  assert.equal(NEUTRAL_FIRE_WATER_RATING, 2);
  assert.equal(initialRatingAxisValue(null), 2);
  assert.equal(initialRatingAxisValue(0.5), 0.5);
  assert.equal(initialRatingAxisValue(4.5), 4.5);
});
