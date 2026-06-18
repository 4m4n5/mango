import "./style.css";

const statusEl = document.getElementById("status");
const pttBtn = document.getElementById("ptt");
const wsUrl = (import.meta.env.VITE_ORCH_WS as string | undefined) ?? "ws://127.0.0.1:8765/ws";

let socket: WebSocket | null = null;
let pttActive = false;

connect();

function connect(): void {
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    setStatus("connected");
  });
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const text = parseStatusText(event.data);
    if (text.length > 0) {
      setStatus(text);
    }
  });
  socket.addEventListener("close", () => {
    setStatus("disconnected");
    window.setTimeout(connect, 2000);
  });
  socket.addEventListener("error", () => {
    socket?.close();
  });
}

function setStatus(text: string): void {
  if (statusEl !== null) {
    statusEl.textContent = text;
  }
}

function send(msg: Record<string, string>): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function parseStatusText(raw: string): string {
  try {
    const msg = JSON.parse(raw) as { type?: string; text?: string; state?: string };
    if (msg.type === "status") {
      return (msg.text ?? msg.state ?? "").trim();
    }
  } catch {
    return raw.trim();
  }
  return "";
}

function startPtt(): void {
  if (pttActive) {
    return;
  }
  pttActive = true;
  pttBtn?.classList.add("active");
  send({ type: "ptt_start" });
}

function endPtt(): void {
  if (!pttActive) {
    return;
  }
  pttActive = false;
  pttBtn?.classList.remove("active");
  // Phase 2.2: attach pcm_b64 from MediaRecorder / AudioWorklet
  send({ type: "ptt_end" });
}

if (pttBtn instanceof HTMLButtonElement) {
  pttBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startPtt();
  });
  pttBtn.addEventListener("pointerup", endPtt);
  pttBtn.addEventListener("pointerleave", endPtt);
  pttBtn.addEventListener("pointercancel", endPtt);
}
