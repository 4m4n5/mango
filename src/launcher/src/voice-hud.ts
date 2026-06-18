/**
 * Launcher-owned TV voice card. N0 removes the second overlay Chromium, so the
 * kiosk HUD connects directly to the single orchestrator listener on :8765.
 */

type VoiceMessage =
  | { type: "status"; state?: string; text?: string }
  | { type: "chat"; role?: string; text?: string; partial?: boolean }
  | { type: "error"; message?: string };

type VoiceHudElements = {
  card: HTMLElement;
  stateLabel: HTMLElement | null;
  dot: HTMLElement | null;
  userLine: HTMLElement | null;
  userText: HTMLElement | null;
  replyLine: HTMLElement | null;
  replyText: HTMLElement | null;
};

const ACTIVE_STATES = new Set(["listening", "thinking", "speaking"]);

export function startVoiceHud(): void {
  const card = document.getElementById("voice-hud");
  if (card === null) {
    return;
  }
  connectVoiceHud(resolveVoiceWsUrls(), {
    card,
    stateLabel: document.getElementById("voice-state"),
    dot: document.getElementById("voice-dot"),
    userLine: document.getElementById("voice-user-line"),
    userText: document.getElementById("voice-user-text"),
    replyLine: document.getElementById("voice-reply-line"),
    replyText: document.getElementById("voice-reply-text"),
  });
}

function resolveVoiceWsUrls(): string[] {
  const env = import.meta.env as Record<string, string | undefined>;
  const explicit = env.VITE_ORCH_WS?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    const urls = explicit.split(",").map((url) => url.trim()).filter(Boolean);
    if (urls.length > 0) {
      return urls;
    }
  }
  const host = window.location.hostname || "127.0.0.1";
  const wss = `wss://${host}:8765/ws`;
  if (window.location.protocol === "https:") {
    return [wss];
  }
  return [wss, `ws://${host}:8765/ws`];
}

function connectVoiceHud(wsUrls: string[], els: VoiceHudElements): void {
  let reconnectTimer: number | undefined;
  let errorDismissTimer: number | undefined;
  let urlIndex = 0;

  const dismiss = (): void => {
    window.clearTimeout(errorDismissTimer);
    showUser(els, "");
    showReply(els, "", false);
    els.card.dataset.state = "idle";
    els.card.dataset.visible = "false";
    els.card.setAttribute("aria-hidden", "true");
    if (els.stateLabel !== null) {
      els.stateLabel.textContent = "mango";
    }
    if (els.dot !== null) {
      els.dot.dataset.state = "idle";
    }
  };

  const showActive = (state: string, label: string): void => {
    window.clearTimeout(errorDismissTimer);
    els.card.dataset.visible = "true";
    els.card.setAttribute("aria-hidden", "false");
    els.card.dataset.state = state;
    if (els.stateLabel !== null) {
      els.stateLabel.textContent = humanState(state, label);
    }
    if (els.dot !== null) {
      els.dot.dataset.state = state;
    }
    if (state === "listening") {
      showUser(els, "");
      showReply(els, "", false);
    }
  };

  const scheduleReconnect = (advanceUrl: boolean): void => {
    if (advanceUrl && wsUrls.length > 1) {
      urlIndex = (urlIndex + 1) % wsUrls.length;
    }
    reconnectTimer = window.setTimeout(connect, advanceUrl ? 250 : 2000);
  };

  const connect = (): void => {
    window.clearTimeout(reconnectTimer);
    let socket: WebSocket;
    let opened = false;
    try {
      socket = new WebSocket(wsUrls[urlIndex] ?? "wss://127.0.0.1:8765/ws");
    } catch {
      scheduleReconnect(true);
      return;
    }

    socket.addEventListener("open", () => {
      opened = true;
      dismiss();
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      dismiss();
      scheduleReconnect(!opened);
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  };

  const handleMessage = (raw: string): void => {
    try {
      const msg = JSON.parse(raw) as VoiceMessage;
      if (msg.type === "status") {
        const state = msg.state ?? "idle";
        const text = (msg.text ?? state).trim();
        if (state === "idle" || !ACTIVE_STATES.has(state)) {
          dismiss();
          return;
        }
        showActive(state, text);
        if (state === "thinking" && text.length > 0 && !text.endsWith("…")) {
          showReply(els, text, true);
        }
        return;
      }
      if (msg.type === "chat" && msg.text !== undefined) {
        if (msg.role === "user") {
          showActive("thinking", "hearing you…");
          showUser(els, msg.text);
          return;
        }
        if (msg.role === "assistant") {
          showReply(els, msg.text, Boolean(msg.partial));
          showActive(
            msg.partial ? "thinking" : "speaking",
            msg.partial ? "thinking…" : "mango",
          );
        }
        return;
      }
      if (msg.type === "error") {
        const message = msg.message ?? "voice error";
        showReply(els, message, false);
        showActive("speaking", "mango");
        errorDismissTimer = window.setTimeout(dismiss, 4000);
      }
    } catch {
      dismiss();
    }
  };

  dismiss();
  connect();
}

function humanState(state: string, fallback: string): string {
  if (state === "listening") return "listening…";
  if (state === "thinking") {
    if (fallback.startsWith("transcribing")) return "hearing you…";
    if (fallback === "thinking…") return "thinking…";
    return fallback.length > 0 ? fallback : "thinking…";
  }
  if (state === "speaking") return "mango";
  return "mango";
}

function showUser(els: VoiceHudElements, text: string): void {
  if (els.userText !== null) {
    els.userText.textContent = text;
  }
  if (els.userLine !== null) {
    els.userLine.hidden = text.trim().length === 0;
  }
}

function showReply(els: VoiceHudElements, text: string, partial: boolean): void {
  if (els.replyText !== null) {
    els.replyText.textContent = partial ? `${text}…` : text;
  }
  if (els.replyLine !== null) {
    els.replyLine.hidden = text.trim().length === 0;
  }
}
