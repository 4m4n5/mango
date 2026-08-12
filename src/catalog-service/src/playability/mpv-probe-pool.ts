import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMpvSuccessOutput, type PlayResult } from '../mpv.js';
import { playabilityProbeConcurrency, playabilityUseProbePool } from './config.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoDir = resolve(moduleDir, '../../../../');

let poolEnsured = false;
let nextWorker = 0;
let leaseProcess: ChildProcessWithoutNullStreams | null = null;
let leaseAcquire: Promise<void> | null = null;

function repoDir(): string {
  return process.env.MANGO_REPO_DIR || defaultRepoDir;
}

export function probePoolLeasePath(): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || join(process.env.HOME || '/tmp', '.cache');
  return process.env.MANGO_MPV_PROBE_LEASE_FILE || join(cacheRoot, 'mango', 'mpv-probe-pool.lock');
}

export async function acquireProbePoolLease(): Promise<void> {
  if (leaseProcess) return;
  if (leaseAcquire) return leaseAcquire;
  leaseAcquire = new Promise<void>((resolvePromise, reject) => {
    const child = spawn('python3', [
      '-c',
      [
        'import fcntl, os, sys',
        'path = sys.argv[1]',
        'os.makedirs(os.path.dirname(path), exist_ok=True)',
        'fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)',
        'try:',
        '    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)',
        'except BlockingIOError:',
        '    os.close(fd)',
        '    raise SystemExit(75)',
        'print("CLAIMED", flush=True)',
        'for line in sys.stdin:',
        '    if line.strip() == "release":',
        '        break',
        'os.close(fd)',
      ].join('\n'),
      probePoolLeasePath(),
    ], {
      cwd: repoDir(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (!settled && stdout.includes('CLAIMED\n')) {
        settled = true;
        leaseProcess = child;
        resolvePromise();
      }
    });
    child.once('error', (error) => fail(error));
    child.once('exit', (code) => {
      if (!settled) {
        fail(new Error(code === 75
          ? 'mpv probe pool is owned by another process'
          : `mpv probe lease exited code=${code ?? 'signal'} ${stderr.trim()}`));
      }
      if (leaseProcess === child) leaseProcess = null;
    });
  }).finally(() => {
    leaseAcquire = null;
  });
  return leaseAcquire;
}

export async function releaseProbePoolLease(): Promise<void> {
  const child = leaseProcess;
  leaseProcess = null;
  if (!child) return;
  await new Promise<void>((resolvePromise) => {
    const done = () => resolvePromise();
    child.once('exit', done);
    child.stdin.end('release\n');
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
      resolvePromise();
    }, 1_000).unref();
  });
}

function displayEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || '/home/aman';
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':0',
    XAUTHORITY: process.env.XAUTHORITY || `${home}/.Xauthority`,
    MANGO_REPO_DIR: repoDir(),
    MANGO_PLAYABILITY_PROBE_CONCURRENCY: String(playabilityProbeConcurrency()),
    ...(leaseProcess ? { MANGO_MPV_PROBE_LEASE_HELD: '1' } : {}),
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
  await acquireProbePoolLease();
  const poolScript = resolve(repoDir(), 'scripts/m3-play/playability/mpv-probe-pool.sh');
  try {
    await runScript(poolScript, ['ensure', '--workers', String(playabilityProbeConcurrency())]);
    poolEnsured = true;
  } catch (error) {
    await releaseProbePoolLease();
    throw error;
  }
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
  await releaseProbePoolLease();
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
  return parseMpvSuccessOutput(output, Date.now() - started);
}
