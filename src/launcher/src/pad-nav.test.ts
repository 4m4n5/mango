import assert from "node:assert/strict";
import test from "node:test";

import { handlePadNav, type PadNavHandlers } from "./pad-nav";

function handlers(log: string[], surface: "home" | "search"): PadNavHandlers {
  return {
    isNextPromptOpen: () => false,
    nextPromptSelect: () => log.push("prompt-select"),
    nextPromptBack: () => log.push("prompt-back"),
    nextPromptMove: () => log.push("prompt-move"),
    isDetailOpen: () => false,
    detailMoveRow: () => log.push("detail-row"),
    detailMoveCol: () => log.push("detail-col"),
    detailChangeSeason: () => log.push("detail-season"),
    detailSelect: () => log.push("detail-select"),
    detailBack: () => log.push("detail-back"),
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
    homeMoveRow: () => log.push("home-row"),
    homeMoveCol: () => log.push("home-col"),
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
