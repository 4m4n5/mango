import "./style.css";

const label = document.getElementById("label");

connectStatusSocket();

function connectStatusSocket(): void {
  try {
    const socket = new WebSocket("ws://127.0.0.1:8765/ws");
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      const text = parseOverlayText(event.data);
      if (label !== null && text.length > 0) {
        label.textContent = text;
      }
    });
    socket.addEventListener("close", () => {
      if (label !== null) {
        label.textContent = "idle";
      }
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  } catch {
    if (label !== null) {
      label.textContent = "idle";
    }
  }
}

function parseOverlayText(raw: string): string {
  try {
    const msg = JSON.parse(raw) as { type?: string; text?: string; state?: string };
    if (msg.type === "status") {
      return (msg.text ?? msg.state ?? "idle").trim();
    }
  } catch {
    return raw.trim();
  }
  return "idle";
}
