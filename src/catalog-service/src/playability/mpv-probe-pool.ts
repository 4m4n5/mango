import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlayResult } from '../mpv.js';
import { playabilityProbeConcurrency, playabilityUseProbePool } from './config.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoDir = resolve(moduleDir, '../../../../');

let poolEnsured = false;
let nextWorker = 0;

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
    MANGO_PLAYABILITY_PROBE_CONCURRENCY: String(playabilityProbeConcurrency()),
  };
}

async function runScript(script: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile('bash', [script, ...args], {
      cwd: repoDir(),
      env: displayEnv(),
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = `${stderr || stdout}`.trim();
        reject(new Error(message || `script failed: ${script}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

export async function ensureProbePool(): Promise<void> {
  if (!playabilityUseProbePool() || poolEnsured) {
    return;
  }
  const poolScript = resolve(repoDir(), 'scripts/m3-play/playability/mpv-probe-pool.sh');
  await runScript(poolScript, ['ensure', '--workers', String(playabilityProbeConcurrency())]);
  poolEnsured = true;
}

export async function stopProbePool(): Promise<void> {
  if (!playabilityUseProbePool()) {
    return;
  }
  const poolScript = resolve(repoDir(), 'scripts/m3-play/playability/mpv-probe-pool.sh');
  try {
    await runScript(poolScript, ['stop-all']);
  } catch {
    // best-effort cleanup
  }
  poolEnsured = false;
}

export async function probeUrlViaPool(
  url: string,
  timeoutMs: number,
  minDurationSec?: number,
): Promise<PlayResult> {
  await ensureProbePool();
  const workerCount = playabilityProbeConcurrency();
  const workerId = nextWorker % workerCount;
  nextWorker += 1;

  const probeScript = resolve(repoDir(), 'scripts/m3-play/playability/mpv-probe-ipc.sh');
  const started = Date.now();
  const args = [
    '--worker-id', String(workerId),
    '--url', url,
    '--timeout-ms', String(timeoutMs),
    '--probe',
    '--min-duration-sec', String(minDurationSec ?? 600),
  ];

  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    execFile('bash', [probeScript, ...args], {
      cwd: repoDir(),
      env: displayEnv(),
      timeout: timeoutMs + 10_000,
      maxBuffer: 1024 * 1024,
    }, (error, out, err) => {
      if (error) {
        const message = `${err || out}`.trim();
        reject(new Error(message || `probe failed on worker ${workerId}`));
        return;
      }
      resolvePromise({ stdout: out, stderr: err });
    });
  });

  const output = `${stdout}\n${stderr}`;
  const parsed = output.match(/ttff_ms=(\d+)/);
  return {
    ok: true,
    ttff_ms: parsed ? Number(parsed[1]) : Date.now() - started,
  };
}
