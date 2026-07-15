import { spawn } from 'node:child_process';

export type ScopedChildResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
};

export class ScopedChildTimeoutError extends Error {
  constructor(
    public readonly result: ScopedChildResult,
  ) {
    super('scoped child timed out');
    this.name = 'ScopedChildTimeoutError';
  }
}

function killScopedGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already exited.
    }
  }
}

/** Run one detached request group, consume its output, and terminate that exact group on timeout. */
export function runScopedCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    killGraceMs?: number;
    maxOutputBytes?: number;
  },
): Promise<ScopedChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const max = options.maxOutputBytes ?? 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const append = (current: string, chunk: Buffer): string => (
      current.length >= max ? current : `${current}${chunk.toString('utf8', 0, max - current.length)}`
    );
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      killScopedGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(
        () => child.pid && killScopedGroup(child.pid, 'SIGKILL'),
        options.killGraceMs ?? 250,
      );
      killTimer.unref?.();
    }, Math.max(1, options.timeoutMs));
    timeout.unref?.();
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      const result = { stdout, stderr, code, signal };
      if (timedOut) reject(new ScopedChildTimeoutError(result));
      else resolve(result);
    });
  });
}
