import "./style.css";
import { connectVoiceHud } from "../../shared/voiceHud";

const WS_URL = "ws://127.0.0.1:8766/ws";

const card = document.getElementById("card");
if (card !== null) {
  connectVoiceHud(WS_URL, {
    card,
    stateLabel: document.getElementById("state-label"),
    dot: document.getElementById("dot"),
    userLine: document.getElementById("user-line"),
    userText: document.getElementById("user-text"),
    replyLine: document.getElementById("reply-line"),
    replyText: document.getElementById("reply-text"),
  });
}
