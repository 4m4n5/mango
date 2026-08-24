/**
 * Isolated low-priority VOD recommendations worker CLI.
 *
 * Contract:
 *   1. Reads `vod_desired_revisions` from library.db and processes movie then
 *      series sequentially. Never overlaps itself: holds a filesystem lease at
 *      `MANGO_VOD_RECS_WORKER_LEASE` (default `~/.cache/mango/vod-recs-worker.lease`).
 *   2. Emits a heartbeat file every `MANGO_VOD_RECS_WORKER_HEARTBEAT_MS`
 *      milliseconds (default 10s); stale heartbeats let ops declare the
 *      previous worker dead without touching catalog state.
 *   3. Never throws to the top level — every rank invocation is wrapped;
 *      any failure is reported to `acknowledgeDesiredRevision` as
 *      `last_good_retained`, preserving previous complete generations.
 *   4. If the desired revision advances during a rank build, the completed
 *      build is discarded before pointer activation via
 *      `acknowledgeDesiredRevision({ outcome: 'discarded_stale' })`. That
 *      matches the "discard stale builds before pointer activation" invariant.
 *   5. Exits 0 when idle and `MANGO_VOD_RECS_WORKER_ONESHOT=1`, otherwise
 *      sleeps `MANGO_VOD_RECS_WORKER_POLL_MS` (default 15s) and repeats.
 *
 * The worker deliberately runs in its own OS process. Catalog boot and
 * couch playback are unaffected by a worker crash; systemd restarts the
 * unit on failure with a long RestartSec so it cannot busy-loop.
 */

import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RatingContentType } from '../library/ratings.js';
import {
  acknowledgeDesiredRevision,
  readAllDesiredRevisions,
  readDesiredRevision,
} from './desired-revision.js';
import {
  claimQueuedRecommendationRefreshJobsForContent,
  updateRecommendationRefreshJobs,
} from './jobs.js';

export type WorkerRankResult = {
  rank_generation_id?: number | null;
  published?: boolean;
  activated?: boolean;
  reason?: string;
};

/** Options handed to the isolated worker's refresh implementation. */
export type WorkerRefreshOptions = {
  /**
   * The desired revision the worker is trying to satisfy. The rank
   * implementation must re-read the durable desired revision immediately
   * before moving the active pointer; if it has advanced past this
   * value, the pointer MUST NOT move (activated=false).
   */
  expected_desired_revision: number;
  /**
   * When true, the ranker skips couch-preemption yields and runs to
   * completion under its regular low-priority resource envelope. The
   * isolated worker's whole purpose is to keep pointer motion out of
   * couch time; couch-preemption there would cause pointless retries.
   */
  ignore_couch: boolean;
};

export type WorkerDependencies = {
  refresh: (tab: 'movies' | 'series', options: WorkerRefreshOptions) => Promise<WorkerRankResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
};

export type WorkerOptions = {
  leasePath?: string;
  heartbeatPath?: string;
  pollMs?: number;
  heartbeatMs?: number;
  oneshot?: boolean;
  maxIterations?: number;
};

const DEFAULT_POLL_MS = 15_000;

function defaultLeasePath(): string {
  return process.env.MANGO_VOD_RECS_WORKER_LEASE
    ?? join(process.env.HOME ?? homedir(), '.cache', 'mango', 'vod-recs-worker.lease');
}

function defaultHeartbeatPath(): string {
  return process.env.MANGO_VOD_RECS_WORKER_HEARTBEAT
    ?? `${defaultLeasePath()}.heartbeat`;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function defaultSleep(ms: number): Promise<void> {
  // The idle poll timer must stay referenced: this CLI is a persistent
  // systemd worker, and an unref'ed timer would let Node exit cleanly while
  // desired revisions are idle. Rank heartbeat timers may remain unref'ed
  // because the active rank promise already keeps the process alive.
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Best-effort exclusive lease using `O_EXCL` on a small pid file. Not an OS
 * flock — enough to prevent two worker processes from stepping on each
 * other. Dead-owner recovery is atomic: if the lease exists but its
 * recorded PID is no longer live, we unlink the stale file and retry the
 * exclusive create in the same operation, so a crashed worker cannot
 * permanently block restart. Concurrent recovery is safe because only the
 * second `openSync(path, 'wx')` succeeds; the other attempt sees `EEXIST`
 * and exits.
 */
export type LeaseAcquisition = { fd: number; path: string } | null;

export type LeaseDependencies = {
  isPidLive?: (pid: number) => boolean;
  now?: () => number;
};

function defaultIsPidLive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // `kill(pid, 0)` on POSIX is a permission/existence probe. Throws
    // ESRCH when the pid no longer exists, EPERM when the pid is live
    // but owned by a different uid. Both branches count as "live" for
    // safety — we only recover on confirmed ESRCH so we cannot steal an
    // active worker's lease.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    return true;
  }
}

function readLeasePid(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown };
    const pid = typeof parsed.pid === 'number' ? parsed.pid : Number.parseInt(String(parsed.pid ?? ''), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function acquireExclusiveLease(
  path: string,
  log: (msg: string) => void,
  deps: LeaseDependencies = {},
): LeaseAcquisition {
  const isPidLive = deps.isPidLive ?? defaultIsPidLive;
  const now = deps.now ?? Date.now;
  const tryCreate = (): number | null => {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: now() }));
      return fd;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return null;
      log(`vod-recs-worker: unable to acquire lease (${(error as Error).message})`);
      throw error;
    }
  };
  let fd: number | null = null;
  try {
    fd = tryCreate();
  } catch {
    return null;
  }
  if (fd !== null) return { fd, path };
  // Lease file exists; check whether the recorded PID is still alive.
  const existingPid = readLeasePid(path);
  if (existingPid !== null && isPidLive(existingPid)) {
    log(`vod-recs-worker: existing lease at ${path} owned by pid ${existingPid}; exiting to avoid overlap`);
    return null;
  }
  // Owner is dead or the lease is corrupt. Reclaim atomically: unlink then
  // retry the exclusive create. If another concurrent process wins the
  // race, its create succeeds and ours returns EEXIST, at which point we
  // give up on this iteration.
  try {
    unlinkSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log(`vod-recs-worker: failed to reclaim stale lease at ${path} (${(error as Error).message})`);
      return null;
    }
  }
  try {
    fd = tryCreate();
  } catch {
    return null;
  }
  if (fd === null) {
    log(`vod-recs-worker: lease reclaim race lost at ${path}; another worker recovered first`);
    return null;
  }
  log(`vod-recs-worker: reclaimed stale lease at ${path} from dead pid ${existingPid ?? '?'}`);
  return { fd, path };
}

function releaseLease(fd: number | null, path: string): void {
  if (fd !== null) { try { closeSync(fd); } catch { /* best effort */ } }
  try { if (existsSync(path)) unlinkSync(path); } catch { /* best effort */ }
}

function writeHeartbeat(path: string, phase: string, now: number): void {
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, phase, at: now }));
  } catch { /* heartbeat is best-effort */ }
}

/**
 * Which pending desired revisions should we work on, in serial order?
 * A row is only returned when it is both `pending` (revision >
 * acknowledged_revision) AND `retry_due` (retry_after is null or ≤ now).
 * This is what enforces bounded exponential backoff on transient failure:
 * the worker will not repeatedly retry a failing tab until its
 * `retry_after` clock has elapsed, unless a fresh signal resets state.
 */
export function pickPendingRevisions(
  now: number = Date.now(),
): Array<{ tab: 'movies' | 'series'; revision: number }> {
  const rows = readAllDesiredRevisions(now);
  const byType = new Map<RatingContentType, typeof rows[0]>();
  for (const row of rows) byType.set(row.content_type, row);
  const out: Array<{ tab: 'movies' | 'series'; revision: number }> = [];
  for (const type of ['movie', 'series'] as const) {
    const row = byType.get(type);
    if (row && row.pending && row.retry_due) {
      out.push({ tab: type === 'movie' ? 'movies' : 'series', revision: row.revision });
    }
  }
  return out;
}

async function processOne(
  tab: 'movies' | 'series',
  revision: number,
  deps: WorkerDependencies,
  log: (msg: string) => void,
): Promise<void> {
  const contentType: RatingContentType = tab === 'movies' ? 'movie' : 'series';
  const now = deps.now ?? Date.now;
  // Claim any queued facade rows so `/recommendations/state` reports
  // `running` while the worker is building this revision. The claim runs
  // in a transaction; concurrent readers only ever see `queued` or the
  // terminal state.
  const claimedJobIds = claimQueuedRecommendationRefreshJobsForContent('vod', contentType, now());
  try {
    const result = await deps.refresh(tab, {
      expected_desired_revision: revision,
      ignore_couch: true,
    });
    const current = readDesiredRevision(contentType, now());
    if (current && current.revision > revision) {
      acknowledgeDesiredRevision({
        content_type: contentType,
        revision,
        rank_generation_id: result.rank_generation_id ?? null,
        outcome: 'discarded_stale',
        now: now(),
        error: 'desired_revision_advanced_during_build',
      });
      if (claimedJobIds.length > 0) {
        updateRecommendationRefreshJobs(
          claimedJobIds,
          'coalesced',
          'superseded by a newer desired revision',
          now(),
        );
      }
      log(`vod-recs-worker: ${tab} rank ${revision} discarded; desired advanced to ${current.revision}`);
      return;
    }
    acknowledgeDesiredRevision({
      content_type: contentType,
      revision,
      rank_generation_id: result.rank_generation_id ?? null,
      outcome: result.activated ? 'activated' : 'last_good_retained',
      error: result.activated ? null : (result.reason ?? 'not_activated'),
      now: now(),
    });
    if (claimedJobIds.length > 0) {
      updateRecommendationRefreshJobs(
        claimedJobIds,
        result.activated ? 'complete' : 'failed',
        result.activated ? undefined : (result.reason ?? 'not_activated'),
        now(),
      );
    }
    log(`vod-recs-worker: ${tab} rank ${revision} ${result.activated ? 'activated' : 'last-good-retained'}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    acknowledgeDesiredRevision({
      content_type: contentType,
      revision,
      rank_generation_id: null,
      outcome: 'last_good_retained',
      error: message.slice(0, 512),
      now: (deps.now ?? Date.now)(),
    });
    if (claimedJobIds.length > 0) {
      updateRecommendationRefreshJobs(claimedJobIds, 'failed', message, now());
    }
    log(`vod-recs-worker: ${tab} rank ${revision} failed; last-good retained (${message})`);
  }
}

/** Testable core loop. Never throws. */
export async function runWorkerLoop(
  deps: WorkerDependencies,
  options: WorkerOptions = {},
): Promise<{ iterations: number; processed: number }> {
  const log = deps.log ?? ((_msg: string) => undefined);
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const heartbeatPath = options.heartbeatPath ?? defaultHeartbeatPath();
  const pollMs = options.pollMs ?? envInt('MANGO_VOD_RECS_WORKER_POLL_MS', DEFAULT_POLL_MS, 1_000, 5 * 60_000);
  const heartbeatMs = options.heartbeatMs
    ?? envInt('MANGO_VOD_RECS_WORKER_HEARTBEAT_MS', 10_000, 1_000, 60_000);
  const oneshot = options.oneshot ?? (process.env.MANGO_VOD_RECS_WORKER_ONESHOT === '1');
  const maxIterations = options.maxIterations ?? Infinity;
  let iterations = 0;
  let processed = 0;
  while (iterations < maxIterations) {
    iterations += 1;
    writeHeartbeat(heartbeatPath, 'poll', now());
    const pending = pickPendingRevisions(now());
    if (pending.length === 0) {
      if (oneshot) return { iterations, processed };
      await sleep(pollMs);
      continue;
    }
    for (const item of pending) {
      const phase = `rank:${item.tab}:${item.revision}`;
      writeHeartbeat(heartbeatPath, phase, now());
      const heartbeatTimer = setInterval(() => {
        writeHeartbeat(heartbeatPath, phase, now());
      }, heartbeatMs);
      heartbeatTimer.unref();
      try {
        await processOne(item.tab, item.revision, deps, log);
      } finally {
        clearInterval(heartbeatTimer);
      }
      processed += 1;
    }
    if (oneshot) return { iterations, processed };
  }
  return { iterations, processed };
}

/**
 * CLI entry. Exit code contract (systemd `Restart=on-failure` depends on it):
 *   - 0: normal termination (idle oneshot exit, SIGTERM/SIGINT, lease
 *     contention with a live owner). Systemd will not restart.
 *   - 1: a fatal error escaped the worker (import failure, top-level
 *     rank exception, malformed dependencies). Systemd will restart.
 * `runWorkerLoop` itself never throws — every rank invocation is wrapped
 * and reported to `acknowledgeDesiredRevision`. The catch below covers
 * import failure, dependency wiring bugs, and unrecoverable environment
 * problems.
 */
export async function main(): Promise<number> {
  const log = (msg: string): void => { process.stderr.write(`${msg}\n`); };
  const leasePath = defaultLeasePath();
  const acquired = acquireExclusiveLease(leasePath, log);
  if (acquired === null) return 0;
  const cleanup = (): void => releaseLease(acquired.fd, acquired.path);
  const sigterm = (): void => { cleanup(); process.exit(0); };
  const sigint = (): void => { cleanup(); process.exit(0); };
  process.once('SIGTERM', sigterm);
  process.once('SIGINT', sigint);
  try {
    // Deferred import so the module can be unit-tested without initializing
    // the full catalog service on import.
    const { refreshStoryGraphForYou } = await import('./story-graph-service.js');
    await runWorkerLoop({
      refresh: async (tab, options) => {
        const result = await refreshStoryGraphForYou(tab, {
          trigger_reasons: ['vod_recs_worker'],
          expected_desired_revision: options.expected_desired_revision,
          ignore_couch_preemption: options.ignore_couch,
        });
        return {
          rank_generation_id: result.rank_generation_id,
          published: result.published,
          activated: result.activated,
          reason: result.evaluation.reasons.join(',') || undefined,
        };
      },
      log,
    });
    return 0;
  } catch (error) {
    log(`vod-recs-worker: fatal error (${
      error instanceof Error ? error.message : String(error)
    })`);
    return 1;
  } finally {
    process.removeListener('SIGTERM', sigterm);
    process.removeListener('SIGINT', sigint);
    cleanup();
  }
}

// Only run when invoked as a CLI entrypoint, not when imported by tests.
// process.argv[1] ends with `worker-cli.js` only for the compiled CLI; the
// unit test file is `worker-cli.test.js`, so this comparison is safe.
if (process.argv[1]?.endsWith('worker-cli.js')) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      // Should not reach here — `main` catches — but if a synchronous
      // top-level throw escapes, systemd MUST restart the unit.
      process.stderr.write(`vod-recs-worker: unhandled top-level error (${
        error instanceof Error ? error.message : String(error)
      })\n`);
      process.exitCode = 1;
    },
  );
}
