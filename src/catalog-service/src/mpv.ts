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

export async function playUrl(url: string): Promise<PlayResult> {
  const script = resolve(repoDir(), 'scripts/phase-n1/mpv-play.sh');
  const started = Date.now();
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    execFile('bash', [script, '--url', url], {
      cwd: repoDir(),
      env: displayEnv(),
      timeout: 90000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = `${stderr || stdout || error.message}`.trim();
        reject(new Error(message || 'mpv-play failed'));
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
