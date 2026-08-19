import { CatalogError } from './catalog-errors.js';

export type PlaybackTelemetryValue = string | number | boolean | null | undefined;

const SENSITIVE_FIELD = /(?:url|token|credential|user_?data|secret)/i;
const TERMINAL_FIELDS = new Set([
  'request_id',
  'epoch',
  'content_type',
  'outcome',
  'failure_class',
  'stage',
  'failure_kind',
  'total_ms',
  'resolve_ms',
  'attempts',
  'candidate_count',
  'exact_main',
  'cached',
]);
const PLAY_FAILURE_KINDS = [
  'timeout',
  'bot_check',
  'blocked',
  'format_unavailable',
  'unavailable',
  'js_runtime',
  'mpv_handoff',
  'other',
] as const;
const TERMINAL_WINDOW_LIMIT = 256;
type TerminalAggregateEvent = {
  outcome: PlayRequestTerminalOutcome;
  failure_class: string | null;
  stage: string;
};
const recentTerminalEvents: TerminalAggregateEvent[] = [];

function boundedInteger(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(0, Math.round(value)));
}

function boundedEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export type PlayRequestTerminalOutcome = 'playing' | 'failed_before_frame' | 'cancelled';
export type PlayRequestTerminalDetails = {
  failureClass?: unknown;
  stage?: unknown;
  failureKind?: unknown;
  resolveMs?: unknown;
  attempts?: unknown;
  candidateCount?: unknown;
  exactMain?: unknown;
  cached?: unknown;
};

export type PlayRequestTerminalSummary = {
  window_limit: number;
  sample_size: number;
  outcomes: Record<PlayRequestTerminalOutcome, number>;
  failures_by_stage: Record<string, Record<string, number>>;
};

/** Distinguish upstream clean-empty resolution from an exhausted candidate ladder. */
export function noPlayableStreamTerminalStage(details: unknown): 'resolve' | 'candidate_ladder' {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return 'candidate_ladder';
  }
  const record = details as Record<string, unknown>;
  const candidates = [record.candidates, record.candidate_count]
    .find((value) => typeof value === 'number' && Number.isFinite(value));
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  return candidates === 0 && attempts.length === 0 ? 'resolve' : 'candidate_ladder';
}

function detailsRecord(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return details as Record<string, unknown>;
}

/**
 * Map a play-session error onto the bounded terminal allowlist.
 * Prefer explicit `playback_stage` / `failure_kind` on CatalogError details so
 * YouTube mpv-start failures are not mislabelled as resolve.
 */
export function classifyPlaybackTerminalFailure(
  error: unknown,
  cancelled: boolean,
): PlayRequestTerminalDetails {
  if (cancelled) return { failureClass: 'cancelled', stage: 'session' };
  if (error instanceof CatalogError) {
    const details = detailsRecord(error.details);
    const failureKind = typeof details.failure_kind === 'string' ? details.failure_kind : undefined;
    const playbackStage = typeof details.playback_stage === 'string' ? details.playback_stage : undefined;
    if (error.message === 'no_playable_stream') {
      return {
        failureClass: 'no_stream',
        stage: noPlayableStreamTerminalStage(error.details),
        failureKind,
      };
    }
    if (error.status === 504 || /deadline/i.test(error.message)) {
      return { failureClass: 'deadline', stage: playbackStage || 'play_start', failureKind };
    }
    if (error.status === 409) {
      return { failureClass: 'ownership', stage: 'session', failureKind };
    }
    const hasYoutubeFailureFields = Boolean(playbackStage || failureKind);
    if (error.status >= 500 || (hasYoutubeFailureFields && error.status >= 400)) {
      return {
        failureClass: 'provider',
        stage: playbackStage || (typeof details.mpv === 'string' ? 'play_start' : 'resolve'),
        failureKind,
      };
    }
  }
  return { failureClass: 'unknown', stage: 'play_start' };
}

function recordTerminalAggregate(
  record: Record<string, string | number | boolean | null>,
): void {
  const outcome = record.outcome;
  if (outcome !== 'playing' && outcome !== 'failed_before_frame' && outcome !== 'cancelled') {
    return;
  }
  recentTerminalEvents.push({
    outcome,
    failure_class: typeof record.failure_class === 'string' ? record.failure_class : null,
    stage: typeof record.stage === 'string' ? record.stage : 'unknown',
  });
  if (recentTerminalEvents.length > TERMINAL_WINDOW_LIMIT) {
    recentTerminalEvents.splice(0, recentTerminalEvents.length - TERMINAL_WINDOW_LIMIT);
  }
}

export function getRecentPlayRequestTerminalSummary(): PlayRequestTerminalSummary {
  const outcomes: Record<PlayRequestTerminalOutcome, number> = {
    playing: 0,
    failed_before_frame: 0,
    cancelled: 0,
  };
  const failuresByStage: Record<string, Record<string, number>> = {};
  for (const event of recentTerminalEvents) {
    outcomes[event.outcome] += 1;
    if (event.outcome === 'playing') continue;
    const stage = event.stage || 'unknown';
    const failureClass = event.failure_class || 'unknown';
    const stageCounts = failuresByStage[stage] ?? {};
    stageCounts[failureClass] = (stageCounts[failureClass] ?? 0) + 1;
    failuresByStage[stage] = stageCounts;
  }
  return {
    window_limit: TERMINAL_WINDOW_LIMIT,
    sample_size: recentTerminalEvents.length,
    outcomes,
    failures_by_stage: failuresByStage,
  };
}

export function resetPlayRequestTerminalSummaryForTests(): void {
  recentTerminalEvents.length = 0;
}

/** Fixed, bounded and identifier-free projection for viewer playback outcomes. */
export function playRequestTerminalTelemetryFields(input: {
  requestId: string | null;
  epoch: number;
  contentType?: unknown;
  outcome: PlayRequestTerminalOutcome;
  failureClass?: unknown;
  stage?: unknown;
  failureKind?: unknown;
  totalMs: number;
  resolveMs?: unknown;
  attempts?: unknown;
  candidateCount?: unknown;
  exactMain?: unknown;
  cached?: unknown;
}): Record<string, PlaybackTelemetryValue> {
  return {
    request_id: input.requestId ? input.requestId.slice(0, 160) : null,
    epoch: boundedInteger(input.epoch, Number.MAX_SAFE_INTEGER),
    content_type: boundedEnum(
      input.contentType,
      ['movie', 'series', 'tv', 'youtube', 'unknown'] as const,
      'unknown',
    ),
    outcome: input.outcome,
    failure_class: input.outcome === 'playing'
      ? null
      : boundedEnum(
        input.failureClass,
        ['cancelled', 'no_stream', 'deadline', 'ownership', 'provider', 'candidate', 'unknown'] as const,
        'unknown',
      ),
    stage: boundedEnum(
      input.stage,
      ['resolve', 'candidate_ladder', 'play_start', 'session', 'unknown'] as const,
      'unknown',
    ),
    failure_kind: input.outcome === 'playing' || input.outcome === 'cancelled'
      ? null
      : boundedEnum(input.failureKind, PLAY_FAILURE_KINDS, 'other'),
    total_ms: boundedInteger(input.totalMs, 10 * 60_000),
    resolve_ms: boundedInteger(input.resolveMs, 10 * 60_000),
    attempts: boundedInteger(input.attempts, 1_000),
    candidate_count: boundedInteger(input.candidateCount, 10_000),
    exact_main: typeof input.exactMain === 'boolean' ? input.exactMain : null,
    cached: typeof input.cached === 'boolean' ? input.cached : null,
  };
}

/** One-shot terminal emitter shared by every async launcher-play exit path. */
export function createPlayRequestTerminalEmitter(
  base: {
    requestId: string | null;
    epoch: number;
    contentType?: unknown;
    startedAtMs: number;
  },
  emit: typeof emitPlaybackTelemetry = emitPlaybackTelemetry,
  now: () => number = Date.now,
): (outcome: PlayRequestTerminalOutcome, details?: PlayRequestTerminalDetails) => boolean {
  let emitted = false;
  return (outcome, details = {}) => {
    if (emitted) return false;
    emitted = true;
    emit('play_request_terminal', playRequestTerminalTelemetryFields({
      ...base,
      outcome,
      totalMs: now() - base.startedAtMs,
      ...details,
    }));
    return true;
  };
}

/** Structured playback diagnostics with a deliberately count/identity-only schema. */
export function playbackTelemetryRecord(
  event: string,
  fields: Record<string, PlaybackTelemetryValue>,
  nowMs = Date.now(),
): Record<string, string | number | boolean | null> {
  const record: Record<string, string | number | boolean | null> = {
    component: 'catalog-playback',
    event,
    ts_ms: nowMs,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (event === 'play_request_terminal' && !TERMINAL_FIELDS.has(key)) continue;
    if (value === undefined || SENSITIVE_FIELD.test(key)) continue;
    record[key] = value;
  }
  return record;
}

export function emitPlaybackTelemetry(
  event: string,
  fields: Record<string, PlaybackTelemetryValue>,
): void {
  if (process.env.MANGO_PLAYBACK_TELEMETRY === '0') return;
  const record = playbackTelemetryRecord(event, fields);
  if (event === 'play_request_terminal') {
    recordTerminalAggregate(record);
  }
  console.log(JSON.stringify(record));
}
