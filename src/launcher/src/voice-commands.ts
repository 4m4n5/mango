/**
 * Launcher voice commands — HTTP poll only (reliable on Pi kiosk).
 * WS is reserved for HUD/chat; never replay stale navigation commands.
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

type VoiceCommandsResponse = {
  ok?: boolean;
  latest_seq?: number;
  commands?: Array<LauncherCommandMessage & { seq?: number }>;
};

type VoiceStateResponse = {
  ok?: boolean;
  latest_seq?: number;
};

const LAST_SEQ_KEY = "mango.voice.lastSeq";

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
    const tab = parseBrowseTab(message.tab) ?? tabFromContentType(message.content_type);
    const card = cardFromCommand(message);
    if (card !== null) {
      handlers.onOpenDetail(card, tab);
      return true;
    }
  }
  return false;
}

function readStoredLastSeq(): number {
  try {
    const raw = sessionStorage.getItem(LAST_SEQ_KEY);
    const parsed = raw !== null ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function storeLastSeq(seq: number): void {
  try {
    sessionStorage.setItem(LAST_SEQ_KEY, String(seq));
  } catch {
    // ignore private mode / storage errors
  }
}

function startVoiceCommandPoll(handlers: VoiceCommandHandlers): () => void {
  let lastSeq = readStoredLastSeq();
  let bootstrapped = lastSeq > 0;
  let stopped = false;
  let pollTimer: number | undefined;

  const bootstrap = async (): Promise<void> => {
    if (bootstrapped) {
      return;
    }
    try {
      const response = await fetch("/api/voice/state");
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as VoiceStateResponse;
      const latest = typeof payload.latest_seq === "number" ? payload.latest_seq : 0;
      lastSeq = Math.max(lastSeq, latest);
      storeLastSeq(lastSeq);
      bootstrapped = true;
    } catch {
      // UI server may be restarting
    }
  };

  const poll = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (!bootstrapped) {
      await bootstrap();
      return;
    }
    try {
      const response = await fetch(`/api/voice/commands?after=${lastSeq}`);
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as VoiceCommandsResponse;
      if (typeof payload.latest_seq === "number" && payload.latest_seq > lastSeq && (payload.commands?.length ?? 0) === 0) {
        lastSeq = payload.latest_seq;
        storeLastSeq(lastSeq);
      }
      for (const command of payload.commands ?? []) {
        if (typeof command.seq === "number" && command.seq > lastSeq) {
          lastSeq = command.seq;
        }
        handleLauncherCommand(command, handlers);
      }
      if ((payload.commands?.length ?? 0) > 0) {
        storeLastSeq(lastSeq);
      }
    } catch {
      // launcher UI server may restart briefly
    }
  };

  void bootstrap().then(() => void poll());
  pollTimer = window.setInterval(() => void poll(), 350);

  return () => {
    stopped = true;
    window.clearInterval(pollTimer);
  };
}

export function startVoiceCommands(
  _wsUrls: string[],
  handlers: VoiceCommandHandlers,
): () => void {
  return startVoiceCommandPoll(handlers);
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
