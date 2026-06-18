import "./style.css";

type OverlayMessage =
  | { type: "status"; state?: string; text?: string }
  | { type: "chat"; role?: string; text?: string; partial?: boolean }
  | { type: "error"; message?: string };

const card = document.getElementById("card");
const stateLabel = document.getElementById("state-label");
const dot = document.getElementById("dot");
const userLine = document.getElementById("user-line");
const userText = document.getElementById("user-text");
const replyLine = document.getElementById("reply-line");
const replyText = document.getElementById("reply-text");
const hintLine = document.getElementById("hint-line");

// Plain WS on loopback — overlay Chromium cannot trust mkcert for WSS.
const WS_URL = "ws://127.0.0.1:8766/ws";

let reconnectTimer: number | undefined;

connectStatusSocket();

function connectStatusSocket(): void {
  window.clearTimeout(reconnectTimer);
  let socket: WebSocket;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
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
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    socket.close();
  });
}

function scheduleReconnect(): void {
  reconnectTimer = window.setTimeout(connectStatusSocket, 2000);
}

function handleMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw) as OverlayMessage;
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
        if (!msg.partial) {
          setState("speaking", "reply");
        } else {
          setState("thinking", "thinking…");
        }
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
  if (card !== null) {
    card.dataset.state = state;
  }
  if (stateLabel !== null) {
    stateLabel.textContent = humanState(state, label);
  }
  if (dot !== null) {
    dot.dataset.state = state;
  }
  if (hintLine !== null) {
    hintLine.hidden = state !== "idle";
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
    if (fallback === "thinking…") return "thinking…";
    return fallback.length > 0 ? fallback : "thinking…";
  }
  if (state === "speaking") return "mango";
  if (fallback === "idle" || fallback === "ready") return "mango";
  return fallback;
}

function showUser(text: string): void {
  if (userText !== null) {
    userText.textContent = text;
  }
  if (userLine !== null) {
    userLine.hidden = text.trim().length === 0;
  }
}

function showReply(text: string, partial: boolean): void {
  if (replyText !== null) {
    replyText.textContent = partial ? `${text}…` : text;
  }
  if (replyLine !== null) {
    replyLine.hidden = text.trim().length === 0;
  }
}
