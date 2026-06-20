/**
 * Launcher voice commands — HTTP poll (primary) + orchestrator WS (backup).
 * Never advance the poll cursor without applying commands (no bootstrap skip).
 */

import type { BrowseTab, ContentCard } from "./types";
import { resolveCardPosterUrl } from "./poster";

export type VoiceCommandHandlers = {
  onHome: () => void;
  onBack: () => void;
  onSettings: () => void;
  onTab: (tab: BrowseTab) => void;
  onOpenDetail: (card: ContentCard, tab: BrowseTab) => void | Promise<void>;
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

const APPLIED_SEQ_KEY = "mango.voice.appliedSeq";

function readAppliedSeq(): number {
  try {
    const raw = sessionStorage.getItem(APPLIED_SEQ_KEY);
    const parsed = raw !== null ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function storeAppliedSeq(seq: number): void {
  try {
    sessionStorage.setItem(APPLIED_SEQ_KEY, String(seq));
  } catch {
    // ignore
  }
}

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

function cardFromCommand(message: LauncherCommandMessage): { card: ContentCard | null; reason: string } {
  const id = message.id?.trim();
  const contentType = normalizeContentType(message.content_type);
  if (!id) {
    return { card: null, reason: "missing_id" };
  }
  if (!contentType) {
    return { card: null, reason: "missing_content_type" };
  }
  return {
    card: {
      id,
      type: contentType,
      title: message.title?.trim() || id,
      subtitle: "",
      posterUrl: resolveCardPosterUrl({ id, posterUrl: message.poster?.trim() }),
      source: "voice",
    },
    reason: "",
  };
}

export function handleLauncherCommand(
  raw: unknown,
  handlers: VoiceCommandHandlers,
): { ok: boolean; reason: string } {
  // Sync entry for tests — open_detail still fires async without waiting.
  void applyLauncherCommand(raw, handlers);
  const message = raw as LauncherCommandMessage;
  if (!raw || typeof raw !== "object" || message.type !== "launcher_command") {
    return { ok: false, reason: "invalid_payload" };
  }
  const action = message.action?.trim();
  if (action === "open_detail") {
    const { card, reason } = cardFromCommand(message);
    if (card === null) {
      return { ok: false, reason: reason || "open_detail_failed" };
    }
    return { ok: true, reason: "" };
  }
  if (action === "tab" && parseBrowseTab(message.tab) === null) {
    return { ok: false, reason: "invalid_tab" };
  }
  if (!action || action === "unknown_action") {
    return { ok: false, reason: "unknown_action" };
  }
  return { ok: true, reason: "" };
}

async function applyLauncherCommand(
  raw: unknown,
  handlers: VoiceCommandHandlers,
): Promise<{ ok: boolean; reason: string }> {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid_payload" };
  }
  const message = raw as LauncherCommandMessage;
  if (message.type !== "launcher_command") {
    return { ok: false, reason: "not_launcher_command" };
  }

  const action = message.action?.trim();
  if (action === "home") {
    handlers.onHome();
    return { ok: true, reason: "" };
  }
  if (action === "back") {
    handlers.onBack();
    return { ok: true, reason: "" };
  }
  if (action === "settings") {
    handlers.onSettings();
    return { ok: true, reason: "" };
  }
  if (action === "tab") {
    const tab = parseBrowseTab(message.tab);
    if (tab !== null) {
      handlers.onTab(tab);
      return { ok: true, reason: "" };
    }
    return { ok: false, reason: "invalid_tab" };
  }
  if (action === "open_detail") {
    const tab = parseBrowseTab(message.tab) ?? tabFromContentType(message.content_type);
    const { card, reason } = cardFromCommand(message);
    if (card === null) {
      return { ok: false, reason: reason || "open_detail_failed" };
    }
    try {
      await handlers.onOpenDetail(card, tab);
      return { ok: true, reason: "" };
    } catch {
      return { ok: false, reason: "open_detail_failed" };
    }
  }
  return { ok: false, reason: "unknown_action" };
}

async function postVoiceAck(
  seq: number | undefined,
  action: string | undefined,
  ok: boolean,
  reason: string,
): Promise<void> {
  if (typeof seq !== "number" || seq <= 0) {
    return;
  }
  try {
    await fetch("/api/voice/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seq,
        action: action ?? "",
        ok,
        reason,
      }),
    });
  } catch {
    // UI server may restart briefly
  }
}

function startVoiceCommandPoll(
  applyCommand: (command: LauncherCommandMessage) => Promise<{ ok: boolean; reason: string }>,
): () => void {
  let lastSeq = readAppliedSeq();
  let stopped = false;
  let pollTimer: number | undefined;
  let pollInFlight = false;

  const poll = async (): Promise<void> => {
    if (stopped || pollInFlight) {
      return;
    }
    pollInFlight = true;
    try {
      const response = await fetch(`/api/voice/commands?after=${lastSeq}`);
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as VoiceCommandsResponse;
      if (typeof payload.latest_seq === "number" && payload.latest_seq < lastSeq) {
        lastSeq = payload.latest_seq;
        storeAppliedSeq(lastSeq);
      }
      for (const command of payload.commands ?? []) {
        const seq = command.seq;
        const result = await applyCommand(command);
        void postVoiceAck(seq, command.action, result.ok, result.reason);
        if (typeof seq === "number" && seq > lastSeq) {
          lastSeq = seq;
          storeAppliedSeq(lastSeq);
        }
      }
    } catch {
      // launcher UI server may restart briefly
    } finally {
      pollInFlight = false;
    }
  };

  void poll();
  pollTimer = window.setInterval(() => void poll(), 150);

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

  const applyCommand = async (
    command: LauncherCommandMessage,
  ): Promise<{ ok: boolean; reason: string }> => {
    if (typeof command.seq === "number") {
      if (appliedSeq.has(command.seq)) {
        return { ok: true, reason: "duplicate" };
      }
      appliedSeq.add(command.seq);
      if (appliedSeq.size > 128) {
        const oldest = [...appliedSeq].sort((left, right) => left - right).slice(0, 64);
        for (const seq of oldest) {
          appliedSeq.delete(seq);
        }
      }
    }
    return applyLauncherCommand(command, handlers);
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
        void (async () => {
          const result = await applyCommand(message);
          void postVoiceAck(message.seq, message.action, result.ok, result.reason);
        })();
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
