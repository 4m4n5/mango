/**
 * Launcher voice commands — HTTP poll (primary) + orchestrator WS (backup).
 * Cursor always syncs from server; never trust sessionStorage across restarts.
 */

import type { BrowseTab, ContentCard } from "./types";
import { resolveCardPosterUrl } from "./poster";

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
  seq?: number;
};

type VoiceCommandsResponse = {
  ok?: boolean;
  latest_seq?: number;
  commands?: Array<LauncherCommandMessage & { seq?: number }>;
};

type VoiceStateResponse = {
  ok?: boolean;
  latest_seq?: number;
};

function parseBrowseTab(value: string | undefined): BrowseTab | null {
  if (value === "movies" || value === "series" || value === "live") {
    return value;
  }
  return null;
}

function tabFromContentType(contentType: string | undefined): BrowseTab {
  const normalized = contentType?.trim().toLowerCase() ?? "";
  if (normalized === "series" || normalized === "tv") {
    return "series";
  }
  if (normalized === "channel") {
    return "live";
  }
  return "movies";
}

function normalizeContentType(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "series" || normalized === "tv") {
    return "series";
  }
  if (normalized === "movie" || normalized === "film") {
    return "movie";
  }
  if (normalized === "channel") {
    return "tv";
  }
  return normalized || null;
}

function cardFromCommand(message: LauncherCommandMessage): ContentCard | null {
  const id = message.id?.trim();
  const contentType = normalizeContentType(message.content_type);
  if (!id || !contentType) {
    return null;
  }
  return {
    id,
    type: contentType,
    title: message.title?.trim() || id,
    subtitle: "",
    posterUrl: resolveCardPosterUrl({ id, posterUrl: message.poster?.trim() }),
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
    const tab = parseBrowseTab(message.tab) ?? tabFromContentType(message.content_type);
    const card = cardFromCommand(message);
    if (card !== null) {
      handlers.onOpenDetail(card, tab);
      return true;
    }
  }
  return false;
}

function startVoiceCommandPoll(
  applyCommand: (command: LauncherCommandMessage) => boolean,
): () => void {
  let lastSeq = 0;
  let cursorReady = false;
  let stopped = false;
  let pollTimer: number | undefined;

  const syncCursor = async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/voice/state");
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json()) as VoiceStateResponse;
      const latest = typeof payload.latest_seq === "number" ? payload.latest_seq : 0;
      if (!cursorReady || latest < lastSeq) {
        lastSeq = latest;
      }
      cursorReady = true;
      return true;
    } catch {
      return false;
    }
  };

  const poll = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (!cursorReady) {
      await syncCursor();
      return;
    }
    try {
      const response = await fetch(`/api/voice/commands?after=${lastSeq}`);
      if (!response.ok) {
        cursorReady = false;
        return;
      }
      const payload = (await response.json()) as VoiceCommandsResponse;
      if (typeof payload.latest_seq === "number" && payload.latest_seq < lastSeq) {
        lastSeq = payload.latest_seq;
      }
      for (const command of payload.commands ?? []) {
        if (typeof command.seq === "number") {
          if (command.seq <= lastSeq) {
            continue;
          }
          lastSeq = command.seq;
        }
        applyCommand(command);
      }
    } catch {
      cursorReady = false;
    }
  };

  void syncCursor().then(() => void poll());
  pollTimer = window.setInterval(() => void poll(), 300);

  return () => {
    stopped = true;
    window.clearInterval(pollTimer);
  };
}

export function startVoiceCommands(
  wsUrls: string[],
  handlers: VoiceCommandHandlers,
): () => void {
  const appliedSeq = new Set<number>();

  const applyCommand = (command: LauncherCommandMessage): boolean => {
    if (typeof command.seq === "number") {
      if (appliedSeq.has(command.seq)) {
        return false;
      }
      appliedSeq.add(command.seq);
      if (appliedSeq.size > 128) {
        const oldest = [...appliedSeq].sort((left, right) => left - right).slice(0, 64);
        for (const seq of oldest) {
          appliedSeq.delete(seq);
        }
      }
    }
    return handleLauncherCommand(command, handlers);
  };

  const stopPoll = startVoiceCommandPoll(applyCommand);

  let reconnectTimer: number | undefined;
  let urlIndex = 0;
  let wsStopped = false;

  const scheduleReconnect = (advanceUrl: boolean): void => {
    if (wsStopped) {
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
        if (!payload || typeof payload !== "object") {
          return;
        }
        const message = payload as LauncherCommandMessage;
        if (message.type !== "launcher_command") {
          return;
        }
        applyCommand(message);
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
    wsStopped = true;
    stopPoll();
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
