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
  options: { probe: boolean; timeoutMs: number; minDurationSec?: number; playEpoch?: number; startSec?: number },
): Promise<PlayResult> {
  const script = resolve(repoDir(), 'scripts/phase-n1/mpv-play.sh');
  const started = Date.now();
  const args = [
    script,
    '--url',
    url,
    '--timeout-ms',
    String(options.timeoutMs),
  ];
  if (options.probe) {
    args.push('--probe');
    if (options.minDurationSec !== undefined) {
      args.push('--min-duration-sec', String(options.minDurationSec));
    }
  } else {
    args.push('--min-duration-sec', String(options.minDurationSec ?? 600));
    if (options.startSec !== undefined && options.startSec > 0) {
      args.push('--start-sec', String(Math.floor(options.startSec)));
    }
  }
  const env = displayEnv();
  if (options.playEpoch !== undefined) {
    env.MANGO_PLAY_EPOCH = String(options.playEpoch);
  }
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    execFile('bash', args, {
      cwd: repoDir(),
      env,
      timeout: options.timeoutMs + 5000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = `${stderr || stdout}`.trim();
        reject(new Error(message || `mpv-play failed with exit ${error.code ?? 'unknown'}`));
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
): Promise<PlayResult> {
  return runMpv(url, { probe: true, timeoutMs, minDurationSec, playEpoch });
}

export async function playUrl(
  url: string,
  timeoutMs = 90000,
  options: { minDurationSec?: number; playEpoch?: number; startSec?: number } = {},
): Promise<PlayResult> {
  return runMpv(url, {
    probe: false,
    timeoutMs,
    minDurationSec: options.minDurationSec,
    playEpoch: options.playEpoch,
    startSec: options.startSec,
  });
}

function mpvSocketPath(): string {
  const home = process.env.HOME || '/home/aman';
  return process.env.MANGO_MPV_SOCKET || `${home}/.cache/mango/mpv.sock`;
}

async function mpvIpcProperty(property: string): Promise<number | null> {
  const script = resolve(repoDir(), 'scripts/phase-n1/mpv-ipc.sh');
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
  if (!(await isMpvActive())) {
    return null;
  }
  const position = await mpvIpcProperty('playback-time');
  const duration = await mpvIpcProperty('duration');
  if (position === null || duration === null) {
    return null;
  }
  return {
    position_sec: Math.max(0, position),
    duration_sec: Math.max(0, duration),
  };
}
