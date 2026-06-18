/**
 * Ephemeral TV voice card — show only during a turn, dismiss on idle.
 * Phone keeps full chat history; TV follows leanback assistant patterns.
 */

export type VoiceMessage =
  | { type: "status"; state?: string; text?: string }
  | { type: "chat"; role?: string; text?: string; partial?: boolean }
  | { type: "error"; message?: string };

export type VoiceHudElements = {
  card: HTMLElement;
  stateLabel: HTMLElement | null;
  dot: HTMLElement | null;
  userLine: HTMLElement | null;
  userText: HTMLElement | null;
  replyLine: HTMLElement | null;
  replyText: HTMLElement | null;
};

const ACTIVE_STATES = new Set(["listening", "thinking", "speaking"]);

export function connectVoiceHud(wsUrl: string, els: VoiceHudElements): void {
  let reconnectTimer: number | undefined;
  let errorDismissTimer: number | undefined;

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

  const connect = (): void => {
    window.clearTimeout(reconnectTimer);
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      reconnectTimer = window.setTimeout(connect, 2000);
      return;
    }

    socket.addEventListener("open", () => {
      dismiss();
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      dismiss();
      reconnectTimer = window.setTimeout(connect, 2000);
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
