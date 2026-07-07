import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export type PlayResult = {
  ok: true;
  ttff_ms: number;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoDir = resolve(moduleDir, '../../..');

function repoDir(): string {
  return process.env.MANGO_REPO_DIR || defaultRepoDir;
}

/**
 * mpv-play.sh writes a "FAIL: <reason>" line to stderr for every known
 * failure mode (cancelled, display-enable, short clip, copyright block, or
 * the generic "did not start playback" timeout). Node only ever sees the
 * wrapper's own stdout/stderr — mpv's own log lives in mpv-play.log on disk —
 * so the FAIL line is the most specific reason available here. Never fall
 * back to the invocation header line ("mpv-play: <url> mode=... ..."), which
 * is just the logged command params, not an error.
 */
export function extractMpvFailureReason(
  stdout: string,
  stderr: string,
  exitCode?: number | string | null,
): string {
  const lines = (text: string) => text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const stderrLines = lines(stderr);
  const stdoutLines = lines(stdout);

  const failLine = [...stderrLines, ...stdoutLines].find((line) => /^FAIL:/i.test(line));
  if (failLine) {
    return failLine.replace(/^FAIL:\s*/i, '').trim();
  }

  const isHeaderLine = (line: string) => line.startsWith('mpv-play:') || line.startsWith('handoff:');
  const meaningfulStderr = stderrLines.filter((line) => !isHeaderLine(line));
  if (meaningfulStderr.length > 0) {
    return meaningfulStderr[meaningfulStderr.length - 1];
  }

  const meaningfulStdout = stdoutLines.filter((line) => !isHeaderLine(line));
  if (meaningfulStdout.length > 0) {
    return meaningfulStdout[meaningfulStdout.length - 1];
  }

  return `no error detail captured (exit ${exitCode ?? 'unknown'})`;
}

function displayEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || '/home/aman';
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':0',
    XAUTHORITY: process.env.XAUTHORITY || `${home}/.Xauthority`,
    MANGO_REPO_DIR: repoDir(),
  };
}

async function runMpv(
  url: string,
  options: {
    probe: boolean;
    live?: boolean;
    timeoutMs: number;
    minDurationSec?: number;
    playEpoch?: number;
    startSec?: number;
    audioUrl?: string;
    ladderStep?: string;
  },
): Promise<PlayResult> {
  const script = resolve(repoDir(), 'scripts/m2-catalog/service/mpv-play.sh');
  const started = Date.now();
  const args = [
    script,
    '--url',
    url,
    '--timeout-ms',
    String(options.timeoutMs),
  ];
  if (options.live) {
    args.push('--live');
  }
  if (options.audioUrl) {
    args.push('--audio-url', options.audioUrl);
  }
  if (options.probe) {
    args.push('--probe');
    if (options.minDurationSec !== undefined) {
      args.push('--min-duration-sec', String(options.minDurationSec));
    }
  } else {
    args.push('--min-duration-sec', String(options.minDurationSec ?? (options.live ? 3 : 600)));
    if (options.startSec !== undefined && options.startSec > 0) {
      args.push('--start-sec', String(Math.floor(options.startSec)));
    }
  }
  const env = displayEnv();
  if (options.playEpoch !== undefined) {
    env.MANGO_PLAY_EPOCH = String(options.playEpoch);
  }
  if (options.ladderStep) {
    env.MANGO_PLAY_LADDER_STEP = options.ladderStep;
  }
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    execFile('bash', args, {
      cwd: repoDir(),
      env,
      timeout: options.timeoutMs + 5000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const reason = extractMpvFailureReason(stdout, stderr, error.code ?? undefined);
        reject(new Error(`mpv-play failed: ${reason}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
  const output = `${stdout}\n${stderr}`;
  const parsed = output.match(/ttff_ms=(\d+)/);
  return {
    ok: true,
    ttff_ms: parsed ? Number(parsed[1]) : Date.now() - started,
  };
}

export async function probeUrl(
  url: string,
  timeoutMs: number,
  minDurationSec?: number,
  playEpoch?: number,
  startSec?: number,
): Promise<PlayResult> {
  return runMpv(url, { probe: true, timeoutMs, minDurationSec, playEpoch, startSec });
}

export async function playUrl(
  url: string,
  timeoutMs = 90000,
  options: {
    minDurationSec?: number;
    playEpoch?: number;
    startSec?: number;
    live?: boolean;
    audioUrl?: string;
    ladderStep?: string;
  } = {},
): Promise<PlayResult> {
  return runMpv(url, {
    probe: false,
    timeoutMs,
    minDurationSec: options.minDurationSec,
    playEpoch: options.playEpoch,
    startSec: options.startSec,
    live: options.live,
    audioUrl: options.audioUrl,
    ladderStep: options.ladderStep,
  });
}

function mpvSocketPath(): string {
  const home = process.env.HOME || '/home/aman';
  return process.env.MANGO_MPV_SOCKET || `${home}/.cache/mango/mpv.sock`;
}

async function mpvIpcProperty(property: string): Promise<number | null> {
  const script = resolve(repoDir(), 'scripts/m2-catalog/service/mpv-ipc.sh');
  try {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
      execFile('bash', [script, 'get_property', property], {
        cwd: repoDir(),
        env: displayEnv(),
        timeout: 3000,
        maxBuffer: 256 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || `mpv-ipc failed for ${property}`));
          return;
        }
        resolvePromise({ stdout, stderr });
      });
    });
    const parsed = JSON.parse(stdout) as { data?: unknown };
    const value = typeof parsed.data === 'number' ? parsed.data : Number(parsed.data);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export async function isMpvActive(): Promise<boolean> {
  try {
    await access(mpvSocketPath());
    return true;
  } catch {
    return false;
  }
}

export async function getMpvPlaybackState(): Promise<{
  position_sec: number;
  duration_sec: number;
} | null> {
  try {
    await access(mpvSocketPath());
    const position = await mpvIpcProperty('playback-time');
    const duration = await mpvIpcProperty('duration');
    if (position !== null && duration !== null) {
      return {
        position_sec: Math.max(0, position),
        duration_sec: Math.max(0, duration),
      };
    }
  } catch {
    return null;
  }
  return null;
}
