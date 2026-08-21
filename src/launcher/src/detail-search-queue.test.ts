import assert from "node:assert/strict";
import test from "node:test";
import { isConfirmedNoStreamsError } from "./detail";

test("Search external queue accepts only the conclusive no-stream verdict", () => {
  assert.equal(isConfirmedNoStreamsError(new Error("no streams found for this title")), true);
  assert.equal(isConfirmedNoStreamsError(new Error("catalog timed out — try again")), false);
  assert.equal(isConfirmedNoStreamsError(new Error("catalog temporarily unavailable")), false);
  assert.equal(isConfirmedNoStreamsError("no streams found for this title"), false);
});
