import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type PlaybackSessionState =
  | 'accepted'
  | 'resolving'
  | 'playing'
  | 'stopping'
  | 'stopped'
  | 'ended'
  | 'cancelled'
  | 'failed_before_frame'
  | 'failed_after_frame';

export type PlaybackSessionSource = 'catalog' | 'youtube';

export interface PlaybackSession {
  session_id: string;
  request_id: string;
  epoch: number;
  version: number;
  source: PlaybackSessionSource;
  state: PlaybackSessionState;
  content_type: string | null;
  content_id: string | null;
  title: string | null;
  ever_ready: boolean;
  accepted_at: number;
  updated_at: number;
  ready_at: number | null;
  terminal_at: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

type SessionWaiter = {
  afterVersion: number;
  resolve: (session: PlaybackSession) => void;
  timer: NodeJS.Timeout;
};

const sessions = new Map<string, PlaybackSession>();
const waiters = new Map<string, Set<SessionWaiter>>();
const MAX_MEMORY_SESSIONS = 32;
let persistChain: Promise<void> = Promise.resolve();
let hydratedPath: string | null = null;

function statePath(): string {
  return process.env.MANGO_PLAYBACK_SESSION_PATH
    || `${process.env.HOME || '/home/aman'}/.cache/mango/playback-session.json`;
}

function cloneSession(session: PlaybackSession): PlaybackSession {
  return structuredClone(session);
}

function isTerminal(state: PlaybackSessionState): boolean {
  return state === 'stopped'
    || state === 'ended'
    || state === 'cancelled'
    || state === 'failed_before_frame'
    || state === 'failed_after_frame';
}

function sanitizedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizedValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(?:^|_)(?:url|token|credential|secret)(?:$|_)/i.test(key)) {
      continue;
    }
    sanitized[key] = sanitizedValue(child);
  }
  return sanitized;
}

function slimPlaybackResult(result: Record<string, unknown>): Record<string, unknown> {
  const slim: Record<string, unknown> = {};
  if ('ok' in result) slim.ok = result.ok;
  for (const key of [
    'ttff_ms',
    'total_ms',
    'attempts',
    'error',
    'first_time_verified',
    'candidate_count',
    'win_ladder_step',
  ] as const) {
    if (result[key] !== undefined) slim[key] = result[key];
  }
  if (result.stream && typeof result.stream === 'object') {
    const stream = result.stream as Record<string, unknown>;
    const slimStream: Record<string, unknown> = {};
    for (const key of [
      'source',
      'title',
      'quality',
      'display_label',
      'resolve_ms',
      'format',
      'cached',
    ] as const) {
      if (stream[key] !== undefined) slimStream[key] = stream[key];
    }
    if (Object.keys(slimStream).length > 0) slim.stream = slimStream;
  }
  if (result.filters && typeof result.filters === 'object') {
    const filters = result.filters as Record<string, unknown>;
    const applied = filters.applied && typeof filters.applied === 'object'
      ? filters.applied as Record<string, unknown>
      : {};
    if (Array.isArray(applied.main_ladder)) {
      slim.filters = { applied: { main_ladder: applied.main_ladder } };
    }
  }
  return slim;
}

function sanitizeResult(result: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  return result ? sanitizedValue(slimPlaybackResult(result)) as Record<string, unknown> : null;
}

async function hydrate(): Promise<void> {
  const path = statePath();
  if (hydratedPath === path) return;
  hydratedPath = path;
  sessions.clear();
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as PlaybackSession;
    if (parsed?.session_id && parsed.request_id && Number.isFinite(parsed.version)) {
      const now = Date.now();
      const recovered = parsed.state === 'accepted' || parsed.state === 'resolving'
        ? {
          ...parsed,
          state: 'failed_before_frame' as const,
          version: parsed.version + 1,
          updated_at: now,
          terminal_at: now,
          error: 'playback service restarted before video became ready',
        }
        : parsed.state === 'stopping'
          ? {
            ...parsed,
            state: 'stopped' as const,
            version: parsed.version + 1,
            updated_at: now,
            terminal_at: now,
          }
          : parsed;
      sessions.set(recovered.session_id, recovered);
      if (recovered !== parsed) {
        await persist(recovered);
      }
    }
  } catch {
    // Missing or invalid cache state is equivalent to no previous session.
  }
}

function persist(session: PlaybackSession): Promise<void> {
  const path = statePath();
  const snapshot = JSON.stringify(session);
  const pending = persistChain.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${snapshot}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  });
  persistChain = pending.catch(() => undefined);
  return pending;
}

function notify(session: PlaybackSession): void {
  const pending = waiters.get(session.session_id);
  if (!pending) return;
  for (const waiter of [...pending]) {
    if (session.version <= waiter.afterVersion) continue;
    clearTimeout(waiter.timer);
    pending.delete(waiter);
    waiter.resolve(cloneSession(session));
  }
  if (pending.size === 0) waiters.delete(session.session_id);
}

function pruneMemorySessions(currentSessionId: string): void {
  if (sessions.size <= MAX_MEMORY_SESSIONS) return;
  const candidates = [...sessions.values()]
    .filter((session) => session.session_id !== currentSessionId && !waiters.has(session.session_id))
    .sort((left, right) => {
      const terminalDelta = Number(isTerminal(right.state)) - Number(isTerminal(left.state));
      return terminalDelta || left.updated_at - right.updated_at;
    });
  for (const candidate of candidates) {
    if (sessions.size <= MAX_MEMORY_SESSIONS) break;
    sessions.delete(candidate.session_id);
  }
}

export async function createPlaybackSession(input: {
  requestId: string;
  epoch: number;
  source: PlaybackSessionSource;
  contentType?: string | null;
  contentId?: string | null;
  title?: string | null;
  nowMs?: number;
}): Promise<{ session: PlaybackSession; created: boolean }> {
  await hydrate();
  const existing = sessions.get(input.requestId);
  if (existing) {
    return { session: cloneSession(existing), created: false };
  }
  const now = input.nowMs ?? Date.now();
  const session: PlaybackSession = {
    session_id: input.requestId,
    request_id: input.requestId,
    epoch: input.epoch,
    version: 1,
    source: input.source,
    state: 'accepted',
    content_type: input.contentType ?? null,
    content_id: input.contentId ?? null,
    title: input.title ?? null,
    ever_ready: false,
    accepted_at: now,
    updated_at: now,
    ready_at: null,
    terminal_at: null,
    error: null,
    result: null,
  };
  sessions.set(session.session_id, session);
  pruneMemorySessions(session.session_id);
  await persist(session);
  return { session: cloneSession(session), created: true };
}

export async function getPlaybackSession(sessionId: string): Promise<PlaybackSession | null> {
  await hydrate();
  const session = sessions.get(sessionId);
  return session ? cloneSession(session) : null;
}

export async function transitionPlaybackSession(
  sessionId: string,
  state: PlaybackSessionState,
  options: {
    result?: Record<string, unknown> | null;
    error?: string | null;
    nowMs?: number;
  } = {},
): Promise<PlaybackSession | null> {
  await hydrate();
  const current = sessions.get(sessionId);
  if (!current) return null;
  if (isTerminal(current.state) && current.state !== state) {
    return cloneSession(current);
  }
  const now = options.nowMs ?? Date.now();
  const everReady = current.ever_ready || state === 'playing' || state === 'stopping'
    || state === 'stopped' || state === 'ended' || state === 'failed_after_frame';
  const next: PlaybackSession = {
    ...current,
    state,
    version: current.version + 1,
    ever_ready: everReady,
    updated_at: now,
    ready_at: everReady ? (current.ready_at ?? now) : null,
    terminal_at: isTerminal(state) ? now : null,
    error: options.error === undefined ? current.error : options.error,
    result: options.result === undefined ? current.result : sanitizeResult(options.result),
  };
  sessions.set(sessionId, next);
  await persist(next);
  notify(next);
  return cloneSession(next);
}

export async function waitForPlaybackSession(
  sessionId: string,
  afterVersion: number,
  waitMs: number,
): Promise<PlaybackSession | null> {
  await hydrate();
  const current = sessions.get(sessionId);
  if (!current) return null;
  if (current.version > afterVersion || waitMs <= 0) {
    return cloneSession(current);
  }
  return new Promise<PlaybackSession>((resolve) => {
    const pending = waiters.get(sessionId) ?? new Set<SessionWaiter>();
    const waiter: SessionWaiter = {
      afterVersion,
      resolve,
      timer: setTimeout(() => {
        pending.delete(waiter);
        if (pending.size === 0) waiters.delete(sessionId);
        const latest = sessions.get(sessionId) ?? current;
        resolve(cloneSession(latest));
      }, Math.min(Math.max(waitMs, 1), 30_000)),
    };
    pending.add(waiter);
    waiters.set(sessionId, pending);
  });
}

export async function resetPlaybackSessionsForTest(): Promise<void> {
  for (const pending of waiters.values()) {
    for (const waiter of pending) clearTimeout(waiter.timer);
  }
  waiters.clear();
  sessions.clear();
  hydratedPath = null;
  await persistChain;
  persistChain = Promise.resolve();
}
