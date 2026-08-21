import assert from "node:assert/strict";
import test from "node:test";
import { applyLauncherCommand, type VoiceCommandHandlers } from "./voice-commands";

function handlers(onProfileChanged: () => void | Promise<void>): VoiceCommandHandlers {
  return {
    onHome: () => undefined,
    onBack: () => undefined,
    onSettings: () => undefined,
    onTab: () => undefined,
    onOpenDetail: () => undefined,
    onProfileChanged,
  };
}

test("profile_changed waits for launcher cache invalidation before acknowledging", async () => {
  const calls: string[] = [];
  const result = await applyLauncherCommand({
    type: "launcher_command",
    action: "profile_changed",
    profile_id: "alice",
  }, handlers(async () => {
    await Promise.resolve();
    calls.push("invalidated");
  }));
  assert.deepEqual(result, { ok: true, reason: "" });
  assert.deepEqual(calls, ["invalidated"]);
});
