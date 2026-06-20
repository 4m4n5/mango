/**
 * Launcher voice command channel — orchestrator broadcasts launcher_command over WS.
 */

import type { BrowseTab, ContentCard } from "./types";

export type VoiceCommandHandlers = {
  onHome: () => void;
  onBack: () => void;
  onSettings: () => void;
  onTab: (tab: BrowseTab) => void;
  onOpenDetail: (card: ContentCard, tab: BrowseTab) => void;
};

type LauncherCommandMessage = {
  type: "launcher_command";
  action?: string;
  tab?: string;
  content_type?: string;
  id?: string;
  title?: string;
  poster?: string;
};

function parseBrowseTab(value: string | undefined): BrowseTab | null {
  if (value === "movies" || value === "series" || value === "live") {
    return value;
  }
  return null;
}

function cardFromCommand(message: LauncherCommandMessage): ContentCard | null {
  const id = message.id?.trim();
  const contentType = message.content_type?.trim();
  if (!id || !contentType) {
    return null;
  }
  return {
    id,
    type: contentType,
    title: message.title?.trim() || id,
    subtitle: "",
    posterUrl: message.poster?.trim() || undefined,
    source: "voice",
  };
}

export function handleLauncherCommand(
  raw: unknown,
  handlers: VoiceCommandHandlers,
): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const message = raw as LauncherCommandMessage;
  if (message.type !== "launcher_command") {
    return false;
  }

  const action = message.action?.trim();
  if (action === "home") {
    handlers.onHome();
    return true;
  }
  if (action === "back") {
    handlers.onBack();
    return true;
  }
  if (action === "settings") {
    handlers.onSettings();
    return true;
  }
  if (action === "tab") {
    const tab = parseBrowseTab(message.tab);
    if (tab !== null) {
      handlers.onTab(tab);
    }
    return true;
  }
  if (action === "open_detail") {
    const tab = parseBrowseTab(message.tab) ?? "movies";
    const card = cardFromCommand(message);
    if (card !== null) {
      handlers.onOpenDetail(card, tab);
    }
    return true;
  }
  return false;
}

export function startVoiceCommands(
  wsUrls: string[],
  handlers: VoiceCommandHandlers,
): () => void {
  let reconnectTimer: number | undefined;
  let urlIndex = 0;
  let stopped = false;

  const scheduleReconnect = (advanceUrl: boolean): void => {
    if (stopped) {
      return;
    }
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
      socket = new WebSocket(wsUrls[urlIndex] ?? "ws://127.0.0.1:8766/ws");
    } catch {
      scheduleReconnect(true);
      return;
    }

    socket.addEventListener("open", () => {
      opened = true;
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as unknown;
        handleLauncherCommand(payload, handlers);
      } catch {
        // ignore malformed payloads
      }
    });
    socket.addEventListener("close", () => {
      scheduleReconnect(!opened);
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  };

  connect();
  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
  };
}

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
