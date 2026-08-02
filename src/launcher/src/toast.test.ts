import assert from "node:assert/strict";
import test from "node:test";
import { toastPolicy, toastToneForStatus } from "./toast.js";

test("toast severity owns duration and live-region policy", () => {
  assert.deepEqual(toastPolicy({ tone: "info" }), {
    tone: "info",
    durationMs: 3000,
    role: "status",
    live: "polite",
  });
  assert.deepEqual(toastPolicy({ tone: "success" }), {
    tone: "success",
    durationMs: 3000,
    role: "status",
    live: "polite",
  });
  assert.deepEqual(toastPolicy({ tone: "warning" }), {
    tone: "warning",
    durationMs: 4500,
    role: "status",
    live: "polite",
  });
  assert.deepEqual(toastPolicy({ tone: "error" }), {
    tone: "error",
    durationMs: 6000,
    role: "alert",
    live: "assertive",
  });
});

test("explicit duration overrides the tone default", () => {
  assert.equal(toastPolicy({ tone: "error", durationMs: 9000 }).durationMs, 9000);
});

test("navigation hints stay silent while outcome states map explicitly", () => {
  assert.equal(toastToneForStatus("hint"), null);
  assert.equal(toastToneForStatus("progress"), "info");
  assert.equal(toastToneForStatus("success"), "success");
  assert.equal(toastToneForStatus("warning"), "warning");
  assert.equal(toastToneForStatus("error"), "error");
});
