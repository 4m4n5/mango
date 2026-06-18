import "./style.css";

type OverlayMessage =
  | { type: "status"; state?: string; text?: string }
  | { type: "chat"; role?: string; text?: string }
  | { type: "error"; message?: string };

const label = document.getElementById("label");
const dot = document.getElementById("dot");
const urls = ["ws://127.0.0.1:8765/ws", "wss://127.0.0.1:8765/ws"];

let urlIndex = 0;
let reconnectTimer: number | undefined;

connectStatusSocket();

function connectStatusSocket(): void {
  window.clearTimeout(reconnectTimer);
  let socket: WebSocket;
  try {
    socket = new WebSocket(urls[urlIndex]);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    setOverlay("idle", "idle");
  });
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    handleMessage(event.data);
  });
  socket.addEventListener("close", () => {
    setOverlay("idle", "idle");
    urlIndex = (urlIndex + 1) % urls.length;
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
      setOverlay(msg.state ?? "idle", (msg.text ?? msg.state ?? "idle").trim());
      return;
    }
    if (msg.type === "chat" && msg.role === "assistant" && msg.text !== undefined) {
      setOverlay("speaking", msg.text);
      return;
    }
    if (msg.type === "error") {
      setOverlay("idle", msg.message ?? "voice error");
    }
  } catch {
    setOverlay("idle", raw.trim());
  }
}

function setOverlay(state: string, text: string): void {
  if (label !== null) {
    label.textContent = text.length > 0 ? text : "idle";
  }
  if (dot !== null) {
    dot.dataset.state = state;
  }
}
