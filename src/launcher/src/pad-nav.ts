/**
 * Launcher pad-navigation — HTTP long-poll client.
 * Mirrors voice-commands.ts poll loop, but drives FocusGrid / detail /
 * settings / next-episode prompt directly instead of via a synthetic
 * keyboard event — same branching as main.ts's handleKeydown.
 */

export type PadNavAction = "move" | "select" | "back" | "tab" | "shuffle";
export type PadNavDirection = "up" | "down" | "left" | "right";

export type PadNavCommand = {
  seq?: number;
  issued_at?: number;
  type?: string;
  action?: string;
  direction?: string | null;
  delta?: number | null;
};

type PadNavResponse = {
  ok?: boolean;
  latest_seq?: number;
  commands?: PadNavCommand[];
};

export type PadNavHandlers = {
  isNextPromptOpen: () => boolean;
  nextPromptSelect: () => void;
  nextPromptBack: () => void;
  nextPromptMove: (delta: number) => void;

  isDetailOpen: () => boolean;
  detailMoveRow: (delta: number) => void;
  detailMoveCol: (delta: number) => void;
  detailChangeSeason: (delta: number) => void;
  detailSelect: () => void;
  detailBack: () => void;

  isInSettings: () => boolean;
  settingsMove: (direction: PadNavDirection) => void;
  settingsSelect: () => void;
  settingsBack: () => void;

  homeMoveRow: (delta: number) => void;
  homeMoveCol: (delta: number) => void;
  homeSelect: () => void;
  homeBack: () => void;
  homeTab: (delta: number) => void;
  homeShuffle: () => void;
};

function isPadDirection(value: unknown): value is PadNavDirection {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

function applyMove(
  direction: string | null | undefined,
  moveRow: (delta: number) => void,
  moveCol: (delta: number) => void,
): void {
  if (direction === "up") {
    moveRow(-1);
  } else if (direction === "down") {
    moveRow(1);
  } else if (direction === "left") {
    moveCol(-1);
  } else if (direction === "right") {
    moveCol(1);
  }
}

/** Mirrors main.ts's handleKeydown priority chain: prompt -> detail -> settings -> home. */
export function handlePadNav(command: PadNavCommand, handlers: PadNavHandlers): void {
  const action = command.action;

  if (handlers.isNextPromptOpen()) {
    if (action === "select") {
      handlers.nextPromptSelect();
    } else if (action === "back") {
      handlers.nextPromptBack();
    } else if (action === "move") {
      if (command.direction === "right" || command.direction === "down") {
        handlers.nextPromptMove(1);
      } else if (command.direction === "left" || command.direction === "up") {
        handlers.nextPromptMove(-1);
      }
    }
    return;
  }

  if (handlers.isDetailOpen()) {
    if (action === "move") {
      applyMove(command.direction, handlers.detailMoveRow, handlers.detailMoveCol);
    } else if (action === "select") {
      handlers.detailSelect();
    } else if (action === "back") {
      handlers.detailBack();
    } else if (action === "tab" && typeof command.delta === "number") {
      // Shoulder buttons cycle seasons on the detail page instead of switching
      // browse tabs (which only applies on the home surface).
      handlers.detailChangeSeason(command.delta);
    }
    return;
  }

  if (handlers.isInSettings()) {
    if (action === "move" && isPadDirection(command.direction)) {
      handlers.settingsMove(command.direction);
    } else if (action === "select") {
      handlers.settingsSelect();
    } else if (action === "back") {
      handlers.settingsBack();
    }
    return;
  }

  if (action === "move") {
    applyMove(command.direction, handlers.homeMoveRow, handlers.homeMoveCol);
  } else if (action === "select") {
    handlers.homeSelect();
  } else if (action === "back") {
    handlers.homeBack();
  } else if (action === "tab") {
    if (typeof command.delta === "number") {
      handlers.homeTab(command.delta);
    }
  } else if (action === "shuffle") {
    handlers.homeShuffle();
  }
}

async function postPadAck(lastSeq: number): Promise<void> {
  try {
    await fetch("/api/pad/ack", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ last_seq: lastSeq }),
    });
  } catch {
    // launcher UI server may restart briefly
  }
}

export function startPadNavPoll(handlers: PadNavHandlers): () => void {
  const WAIT_SECONDS = 25;
  let lastSeq = 0;
  let stopped = false;
  let pollTimer: number | undefined;
  let pollInFlight = false;
  let currentController: AbortController | null = null;

  const scheduleNext = (delayMs: number): void => {
    if (stopped) {
      return;
    }
    pollTimer = window.setTimeout(() => void poll(), delayMs);
  };

  const poll = async (): Promise<void> => {
    if (stopped || pollInFlight) {
      return;
    }
    pollInFlight = true;
    let ok = false;
    const controller = new AbortController();
    currentController = controller;
    const abortTimer = window.setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // controller already aborted
      }
    }, WAIT_SECONDS * 1000 + 5000);
    try {
      const response = await fetch(
        `/api/pad/nav?after=${lastSeq}&wait=${WAIT_SECONDS}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as PadNavResponse;
      if (typeof payload.latest_seq === "number" && payload.latest_seq < lastSeq) {
        lastSeq = payload.latest_seq;
      }
      for (const command of payload.commands ?? []) {
        handlePadNav(command, handlers);
        if (typeof command.seq === "number" && command.seq > lastSeq) {
          lastSeq = command.seq;
        }
      }
      if ((payload.commands ?? []).length === 0 && typeof payload.latest_seq === "number" && payload.latest_seq > lastSeq) {
        lastSeq = payload.latest_seq;
      }
      void postPadAck(lastSeq);
      ok = true;
    } catch {
      // launcher UI server may restart briefly, or fetch was aborted
    } finally {
      window.clearTimeout(abortTimer);
      if (currentController === controller) {
        currentController = null;
      }
      pollInFlight = false;
      scheduleNext(ok ? 50 : 1000);
    }
  };

  void poll();

  return () => {
    stopped = true;
    if (pollTimer !== undefined) {
      window.clearTimeout(pollTimer);
      pollTimer = undefined;
    }
    if (currentController !== null) {
      try {
        currentController.abort();
      } catch {
        // controller may already be aborted
      }
      currentController = null;
    }
  };
}
