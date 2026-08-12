import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tryLease = [
  'import fcntl, os, sys',
  'fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)',
  'try:',
  '    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)',
  'except BlockingIOError:',
  '    raise SystemExit(75)',
  'os.close(fd)',
].join('\n');

const holdLease = [
  'import fcntl, os, sys',
  'path = sys.argv[1]',
  'os.makedirs(os.path.dirname(path), exist_ok=True)',
  'fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)',
  'fcntl.flock(fd, fcntl.LOCK_EX)',
  'print("CLAIMED", flush=True)',
  'sys.stdin.readline()',
  'os.close(fd)',
].join('\n');

test('probe-pool lease is exclusive across processes and keeps a stable pathname', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-probe-lease-'));
  const lockPath = join(dir, 'probe.lock');
  const holder = spawn('python3', ['-c', holdLease, lockPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      holder.once('error', reject);
      holder.once('exit', (code) => reject(new Error(`lease holder exited before claim: ${code}`)));
      holder.stdout.once('data', (chunk) => {
        if (String(chunk).includes('CLAIMED')) resolve();
        else reject(new Error(`unexpected lease holder output: ${String(chunk)}`));
      });
    });
    const blocked = spawnSync('python3', ['-c', tryLease, lockPath]);
    assert.equal(blocked.status, 75);
    holder.stdin.end('\n');
    await new Promise<void>((resolve) => holder.once('exit', () => resolve()));
    const acquired = spawnSync('python3', ['-c', tryLease, lockPath]);
    assert.equal(acquired.status, 0);
  } finally {
    if (holder.exitCode === null) holder.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
