import { connectVoiceHud } from "../../shared/voiceHud";

const WS_URL = "ws://127.0.0.1:8766/ws";

export function startVoiceHud(): void {
  const card = document.getElementById("voice-hud");
  if (card === null) {
    return;
  }
  connectVoiceHud(WS_URL, {
    card,
    stateLabel: document.getElementById("voice-state"),
    dot: document.getElementById("voice-dot"),
    userLine: document.getElementById("voice-user-line"),
    userText: document.getElementById("voice-user-text"),
    replyLine: document.getElementById("voice-reply-line"),
    replyText: document.getElementById("voice-reply-text"),
  });
}
