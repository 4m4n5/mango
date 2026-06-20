import { execFile } from 'node:child_process';
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
  options: { probe: boolean; timeoutMs: number; minDurationSec?: number; playEpoch?: number },
): Promise<PlayResult> {
  const script = resolve(repoDir(), 'scripts/phase-n1/mpv-play.sh');
  const started = Date.now();
  const args = [
    script,
    '--url',
    url,
    '--timeout-ms',
    String(options.timeoutMs),
    '--min-duration-sec',
    String(options.minDurationSec ?? 600),
  ];
  if (options.probe) {
    args.push('--probe');
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
  options: { minDurationSec?: number; playEpoch?: number } = {},
): Promise<PlayResult> {
  return runMpv(url, { probe: false, timeoutMs, minDurationSec: options.minDurationSec, playEpoch: options.playEpoch });
}
