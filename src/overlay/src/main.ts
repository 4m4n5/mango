import "./style.css";

const label = document.getElementById("label");

connectStatusSocket();

function connectStatusSocket(): void {
  try {
    const socket = new WebSocket("ws://127.0.0.1:8765");
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      if (label !== null && event.data.trim().length > 0) {
        label.textContent = event.data.trim();
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
