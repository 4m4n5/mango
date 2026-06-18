type VoiceMessage =
  | { type: "status"; state?: string; text?: string }
  | { type: "chat"; role?: string; text?: string; partial?: boolean }
  | { type: "error"; message?: string };

const WS_URL = "ws://127.0.0.1:8766/ws";

export function startVoiceHud(): void {
  const card = document.getElementById("voice-hud");
  if (card === null) {
    return;
  }
  connect(0);
}

function connect(attempt: number): void {
  let socket: WebSocket;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    window.setTimeout(() => connect(attempt + 1), 2000);
    return;
  }

  socket.addEventListener("open", () => {
    setState("idle", "ready");
  });
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    handleMessage(event.data);
  });
  socket.addEventListener("close", () => {
    setState("idle", "reconnecting…");
    window.setTimeout(() => connect(attempt + 1), 2000);
  });
  socket.addEventListener("error", () => {
    socket.close();
  });
}

function handleMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw) as VoiceMessage;
    if (msg.type === "status") {
      const state = msg.state ?? "idle";
      const text = (msg.text ?? state).trim();
      setState(state, text);
      if (state === "thinking" && text.length > 0 && !text.endsWith("…")) {
        showReply(text, true);
      }
      return;
    }
    if (msg.type === "chat" && msg.text !== undefined) {
      if (msg.role === "user") {
        showUser(msg.text);
        return;
      }
      if (msg.role === "assistant") {
        showReply(msg.text, Boolean(msg.partial));
        setState(msg.partial ? "thinking" : "speaking", msg.partial ? "thinking…" : "mango");
      }
      return;
    }
    if (msg.type === "error") {
      setState("idle", msg.message ?? "voice error");
    }
  } catch {
    setState("idle", raw.trim());
  }
}

function setState(state: string, label: string): void {
  const card = document.getElementById("voice-hud");
  const stateLabel = document.getElementById("voice-state");
  const dot = document.getElementById("voice-dot");
  const hint = document.getElementById("voice-hint");
  if (card !== null) {
    card.dataset.state = state;
  }
  if (stateLabel !== null) {
    stateLabel.textContent = humanState(state, label);
  }
  if (dot !== null) {
    dot.dataset.state = state;
  }
  if (hint !== null) {
    hint.hidden = state !== "idle";
  }
  if (state === "listening") {
    showUser("");
    showReply("", false);
  }
}

function humanState(state: string, fallback: string): string {
  if (state === "listening") return "listening…";
  if (state === "thinking") {
    if (fallback.startsWith("transcribing")) return "hearing you…";
    return fallback.length > 0 ? fallback : "thinking…";
  }
  if (state === "speaking") return "mango";
  return "mango";
}

function showUser(text: string): void {
  const line = document.getElementById("voice-user-line");
  const value = document.getElementById("voice-user-text");
  if (value !== null) {
    value.textContent = text;
  }
  if (line !== null) {
    line.hidden = text.trim().length === 0;
  }
}

function showReply(text: string, partial: boolean): void {
  const line = document.getElementById("voice-reply-line");
  const value = document.getElementById("voice-reply-text");
  if (value !== null) {
    value.textContent = partial ? `${text}…` : text;
  }
  if (line !== null) {
    line.hidden = text.trim().length === 0;
  }
}
