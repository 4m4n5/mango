/** Shared voice WebSocket URL resolution for HUD and command backup. */

export function resolveVoiceWsUrls(): string[] {
  const env = import.meta.env as Record<string, string | undefined>;
  const explicit = env.VITE_ORCH_WS?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    const urls = explicit.split(",").map((url) => url.trim()).filter(Boolean);
    if (urls.length > 0) {
      return urls;
    }
  }
  const host = window.location.hostname || "127.0.0.1";
  if (window.location.protocol === "https:") {
    return [`wss://${host}:8765/ws`];
  }
  return [`ws://127.0.0.1:8766/ws`, `ws://${host}:8766/ws`];
}
