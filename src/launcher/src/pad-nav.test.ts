import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPadNavBatch,
  commandsAfterSeq,
  handlePadNav,
  isPadNavCommandFresh,
  type PadNavCommand,
  type PadNavHandlers,
} from "./pad-nav";

function handlers(log: string[], surface: "home" | "search" | "detail"): PadNavHandlers {
  return {
    isNextPromptOpen: () => false,
    nextPromptSelect: () => log.push("prompt-select"),
    nextPromptBack: () => log.push("prompt-back"),
    nextPromptMove: () => log.push("prompt-move"),
    isDetailOpen: () => surface === "detail",
    detailMoveRow: () => log.push("detail-row"),
    detailMoveCol: () => log.push("detail-col"),
    detailChangeSeason: () => log.push("detail-season"),
    detailSelect: () => log.push("detail-select"),
    detailBack: () => log.push("detail-back"),
    detailSecondary: (kind) => log.push(`detail-secondary:${kind}`),
    isInSettings: () => false,
    settingsMove: () => log.push("settings-move"),
    settingsSelect: () => log.push("settings-select"),
    settingsBack: () => log.push("settings-back"),
    isInSearch: () => surface === "search",
    searchMoveRow: () => log.push("search-row"),
    searchMoveCol: () => log.push("search-col"),
    searchSelect: () => log.push("search-select"),
    searchBack: () => log.push("search-back"),
    searchSecondary: (kind) => log.push(`search-secondary:${kind}`),
    homeMoveRow: (delta) => log.push(`home-row:${delta}`),
    homeMoveCol: (delta) => log.push(`home-col:${delta}`),
    homeSelect: () => log.push("home-select"),
    homeBack: () => log.push("home-back"),
    homeTab: () => log.push("home-tab"),
    homeShuffle: () => log.push("home-shuffle"),
    homeSecondary: (kind) => log.push(`home-secondary:${kind}`),
  };
}

test("secondary tap and hold are owned by Search when Search is visible", () => {
  const log: string[] = [];
  const target = handlers(log, "search");
  handlePadNav({ action: "secondary", kind: "tap" }, target);
  handlePadNav({ action: "secondary", kind: "hold" }, target);
  assert.deepEqual(log, ["search-secondary:tap", "search-secondary:hold"]);
});

test("secondary remains a current-tab Home action outside Search", () => {
  const log: string[] = [];
  handlePadNav({ action: "secondary", kind: "tap" }, handlers(log, "home"));
  assert.deepEqual(log, ["home-secondary:tap"]);
});

test("secondary is contextual to an open Detail surface for rating clear", () => {
  const log: string[] = [];
  handlePadNav({ action: "secondary", kind: "tap" }, handlers(log, "detail"));
  assert.deepEqual(log, ["detail-secondary:tap"]);
});

test("commandsAfterSeq skips already-applied seqs", () => {
  const batch: PadNavCommand[] = [
    { seq: 1, action: "move", direction: "down" },
    { seq: 2, action: "move", direction: "down" },
    { seq: 3, action: "move", direction: "right" },
  ];
  assert.deepEqual(
    commandsAfterSeq(batch, 2).map((c) => c.seq),
    [3],
  );
  assert.deepEqual(commandsAfterSeq(batch, 3), []);
});

test("empty batch must not advance lastSeq (77941ae regression)", async () => {
  const log: string[] = [];
  const lastSeq = 10;
  // Poller contract: only call apply when batch.length > 0. Empty apply is a no-op.
  const next = await applyPadNavBatch([], handlers(log, "home"), lastSeq);
  assert.equal(next, lastSeq);
  assert.deepEqual(log, []);
});

test("applyPadNavBatch applies every command in order without coalescing", async () => {
  const log: string[] = [];
  const next = await applyPadNavBatch(
    [
      { seq: 4, action: "move", direction: "down" },
      { seq: 5, action: "move", direction: "down" },
      { seq: 6, action: "move", direction: "right" },
    ],
    handlers(log, "home"),
    3,
  );
  assert.equal(next, 6);
  assert.deepEqual(log, ["home-row:1", "home-row:1", "home-col:1"]);
});

test("stale movement is dropped while recent Select and Back remain actionable", () => {
  const now = Date.now();
  assert.equal(
    isPadNavCommandFresh({ action: "move", issued_at: (now - 901) / 1000 }, now),
    false,
  );
  assert.equal(
    isPadNavCommandFresh({ action: "select", issued_at: (now - 1499) / 1000 }, now),
    true,
  );
  assert.equal(
    isPadNavCommandFresh({ action: "back", issued_at: (now - 1501) / 1000 }, now),
    false,
  );
});

test("expired Home movement advances the ack cursor without changing focus", async () => {
  const log: string[] = [];
  const next = await applyPadNavBatch(
    [{
      seq: 9,
      action: "move",
      direction: "down",
      issued_at: (Date.now() - 1000) / 1000,
    }],
    handlers(log, "home"),
    8,
  );
  assert.equal(next, 9);
  assert.deepEqual(log, []);
});

test("a stalled Search still applies the latest queued move so results are not frozen", async () => {
  const log: string[] = [];
  const now = Date.now();
  const next = await applyPadNavBatch(
    [
      {
        seq: 9,
        action: "move",
        direction: "down",
        issued_at: (now - 1200) / 1000,
      },
      {
        seq: 10,
        action: "move",
        direction: "right",
        issued_at: (now - 1000) / 1000,
      },
    ],
    handlers(log, "search"),
    8,
  );
  assert.equal(next, 10);
  assert.deepEqual(log, ["search-col"]);
});
