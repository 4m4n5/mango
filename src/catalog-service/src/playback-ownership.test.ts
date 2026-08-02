import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

function isAlive(child: ChildProcess): boolean {
  if (!child.pid) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()));
}

test('S2: normal stop kills only the tracked Mango process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-stop-scope-'));
  const socket = join(dir, 'mpv.sock');
  const fakeMpv = join(dir, 'fake-mpv');
  await writeFile(fakeMpv, `#!/usr/bin/env bash
trap 'exit 0' TERM
while true; do sleep 1; done
`);
  await chmod(fakeMpv, 0o755);
  const tracked = spawn(fakeMpv, [`--input-ipc-server=${socket}`]);
  const unrelated = spawn('sleep', ['30']);
  try {
    assert.ok(tracked.pid && unrelated.pid);
    const pidFile = join(dir, 'mpv.pid');
    await writeFile(pidFile, `${tracked.pid}\n`);
    await new Promise<void>((resolvePromise, reject) => {
      execFile('bash', [join(repoDir, 'scripts/m2-catalog/service/mpv-stop.sh')], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_MPV_PID_FILE: pidFile,
          MANGO_MPV_SOCKET: socket,
          MANGO_PLAYBACK_ACTIVE_FILE: join(dir, 'playback-active'),
          MANGO_MPV_STOP_NO_DISPLAY: '1',
          MANGO_MPV_STOP_NO_CANCEL: '1',
        },
      }, (error) => (error ? reject(error) : resolvePromise()));
    });
    await waitForExit(tracked);
    assert.equal(isAlive(tracked), false);
    assert.equal(isAlive(unrelated), true);
  } finally {
    tracked.kill('SIGKILL');
    unrelated.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('S2: a stale PID file never kills an unrelated reused process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-stop-stale-pid-'));
  const unrelated = spawn('sleep', ['30']);
  try {
    assert.ok(unrelated.pid);
    const pidFile = join(dir, 'mpv.pid');
    await writeFile(pidFile, `${unrelated.pid}\n`);
    await new Promise<void>((resolvePromise, reject) => {
      execFile('bash', [join(repoDir, 'scripts/m2-catalog/service/mpv-stop.sh')], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_MPV_PID_FILE: pidFile,
          MANGO_MPV_SOCKET: join(dir, 'mpv.sock'),
          MANGO_PLAYBACK_ACTIVE_FILE: join(dir, 'playback-active'),
          MANGO_MPV_STOP_NO_DISPLAY: '1',
          MANGO_MPV_STOP_NO_CANCEL: '1',
        },
      }, (error) => (error ? reject(error) : resolvePromise()));
    });
    assert.equal(isAlive(unrelated), true);
  } finally {
    unrelated.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('S2: stale natural-exit cleanup cannot stop a newer playback generation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-stop-stale-generation-'));
  const socket = join(dir, 'mpv.sock');
  const fakeMpv = join(dir, 'fake-mpv');
  await writeFile(fakeMpv, `#!/usr/bin/env bash
trap 'exit 0' TERM
while true; do sleep 1; done
`);
  await chmod(fakeMpv, 0o755);
  const tracked = spawn(fakeMpv, [`--input-ipc-server=${socket}`]);
  try {
    assert.ok(tracked.pid);
    const pidFile = join(dir, 'mpv.pid');
    const epochFile = join(dir, 'play-cancel.epoch');
    await writeFile(pidFile, `${tracked.pid}\n`);
    await writeFile(epochFile, '200\n');
    await new Promise<void>((resolvePromise, reject) => {
      execFile('bash', [join(repoDir, 'scripts/m2-catalog/service/mpv-stop.sh')], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_MPV_PID_FILE: pidFile,
          MANGO_MPV_SOCKET: socket,
          MANGO_PLAY_CANCEL_PATH: epochFile,
          MANGO_PLAYBACK_ACTIVE_FILE: join(dir, 'playback-active'),
          MANGO_MPV_STOP_NO_DISPLAY: '1',
          MANGO_MPV_STOP_NO_CANCEL: '1',
          MANGO_EXPECTED_MPV_PID: String(tracked.pid),
          MANGO_EXPECTED_PLAY_EPOCH: '100',
        },
      }, (error) => (error ? reject(error) : resolvePromise()));
    });
    assert.equal(isAlive(tracked), true);
  } finally {
    tracked.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('S2: a foreground request waits for a short background ownership window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-owner-wait-'));
  const lock = join(dir, 'owner.lock.d');
  await mkdir(lock);
  await writeFile(join(lock, 'owner'), `${process.pid}\n`);
  const release = setTimeout(() => {
    void rm(lock, { recursive: true, force: true });
  }, 250);
  try {
    const started = Date.now();
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise) => {
      execFile('bash', [
        join(repoDir, 'scripts/m2-catalog/service/mpv-play.sh'),
        '--url',
        'https://example.invalid/video',
        '--timeout-ms',
        '2000',
      ], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_PLAY_REQUEST_CLASS: 'user',
          MANGO_PLAYBACK_OWNERSHIP_WAIT_MS: '1000',
          MANGO_PLAYBACK_OWNERSHIP_LOCK: lock,
          MANGO_MPV_DEFER_FOREGROUND: '1',
          MANGO_MPV_PRINT_ARGS: '1',
          MANGO_MPV_SKIP_FFPROBE: '1',
          MANGO_MPV_PID_FILE: join(dir, 'mpv.pid'),
          MANGO_MPV_SOCKET: join(dir, 'mpv.sock'),
          MANGO_PLAYBACK_ACTIVE_FILE: join(dir, 'playback-active'),
        },
      }, (error, stdout, stderr) => resolvePromise({
        code: error && 'code' in error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      }));
    });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(Date.now() - started >= 200);
  } finally {
    clearTimeout(release);
    await rm(dir, { recursive: true, force: true });
  }
});

test('S2: background probe defers before touching a live couch process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-probe-owner-'));
  const socket = join(dir, 'mpv.sock');
  const server = createServer();
  try {
    const pidFile = join(dir, 'mpv.pid');
    await writeFile(pidFile, `${process.pid}\n`);
    await writeFile(join(dir, 'playback-active'), '');
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(socket, () => resolvePromise());
    });
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise) => {
      execFile('bash', [
        join(repoDir, 'scripts/m2-catalog/service/mpv-play.sh'),
        '--url',
        'https://example.invalid/video',
        '--probe',
        '--timeout-ms',
        '1000',
      ], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_PLAY_REQUEST_CLASS: 'background',
          MANGO_MPV_PID_FILE: pidFile,
          MANGO_MPV_SOCKET: socket,
          MANGO_PLAYBACK_ACTIVE_FILE: join(dir, 'playback-active'),
          MANGO_PLAYBACK_OWNERSHIP_LOCK: join(dir, 'owner.lock.d'),
        },
      }, (error, stdout, stderr) => resolvePromise({
        code: error && 'code' in error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      }));
    });
    assert.equal(result.code, 75);
    assert.match(result.stdout, /DEFERRED: foreground_playback_active/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /mpv-play:/);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('S2: an idle background probe never invokes tracked mpv teardown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-background-no-stop-'));
  const socket = join(dir, 'mpv.sock');
  const fakeMpv = join(dir, 'fake-mpv');
  await writeFile(fakeMpv, `#!/usr/bin/env bash
trap 'exit 0' TERM
while true; do sleep 1; done
`);
  await chmod(fakeMpv, 0o755);
  const tracked = spawn(fakeMpv, [`--input-ipc-server=${socket}`]);
  try {
    assert.ok(tracked.pid);
    await writeFile(join(dir, 'mpv.pid'), `${tracked.pid}\n`);
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise) => {
      execFile('bash', [
        join(repoDir, 'scripts/m2-catalog/service/mpv-play.sh'),
        '--url',
        'https://example.invalid/video',
        '--probe',
        '--timeout-ms',
        '1000',
      ], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_PLAY_REQUEST_CLASS: 'background',
          MANGO_MPV_PID_FILE: join(dir, 'mpv.pid'),
          MANGO_MPV_SOCKET: socket,
          MANGO_PLAYBACK_ACTIVE_FILE: join(dir, 'playback-active'),
          MANGO_PLAYBACK_OWNERSHIP_LOCK: join(dir, 'owner.lock.d'),
          MANGO_MPV_PRINT_ARGS: '1',
          MANGO_MPV_SKIP_FFPROBE: '1',
        },
      }, (error, stdout, stderr) => resolvePromise({
        code: error && 'code' in error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      }));
    });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(isAlive(tracked), true);
  } finally {
    tracked.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('S2: a failed non-isolated probe never restores the TV display', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-probe-display-neutral-'));
  const bin = join(dir, 'bin');
  const displayMarker = join(dir, 'display-restored');
  await mkdir(bin);
  const fakeMpv = join(bin, 'mpv');
  const fakeDisplayMode = join(bin, 'display-mode');
  await writeFile(fakeMpv, '#!/usr/bin/env bash\nexit 1\n');
  await writeFile(fakeDisplayMode, '#!/usr/bin/env bash\n: >"$MANGO_TEST_DISPLAY_MARKER"\n');
  await chmod(fakeMpv, 0o755);
  await chmod(fakeDisplayMode, 0o755);
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise) => {
      execFile('bash', [
        join(repoDir, 'scripts/m2-catalog/service/mpv-play.sh'),
        '--url',
        'https://example.invalid/video',
        '--probe',
        '--timeout-ms',
        '500',
      ], {
        cwd: repoDir,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_PLAY_REQUEST_CLASS: 'background',
          MANGO_MPV_SKIP_FFPROBE: '1',
          MANGO_MPV_PID_FILE: join(dir, 'mpv.pid'),
          MANGO_MPV_SOCKET: join(dir, 'mpv.sock'),
          MANGO_PLAYBACK_ACTIVE_FILE: join(dir, 'playback-active'),
          MANGO_PLAYBACK_OWNERSHIP_LOCK: join(dir, 'owner.lock.d'),
          MANGO_DISPLAY_MODE_SH: fakeDisplayMode,
          MANGO_TEST_DISPLAY_MARKER: displayMarker,
        },
      }, (error, stdout, stderr) => resolvePromise({
        code: error && 'code' in error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      }));
    });
    assert.notEqual(result.code, 0, `${result.stdout}\n${result.stderr}`);
    await assert.rejects(access(displayMarker), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('S2: the persistent probe pool defers while couch playback is active', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-pool-owner-'));
  const socket = join(dir, 'mpv.sock');
  const server = createServer();
  try {
    await writeFile(join(dir, 'mpv.pid'), `${process.pid}\n`);
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(socket, () => resolvePromise());
    });
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise) => {
      execFile('bash', [
        join(repoDir, 'scripts/m3-play/playability/mpv-probe-ipc.sh'),
        '--worker-id',
        '0',
        '--url',
        'https://example.invalid/video',
        '--probe',
        '--timeout-ms',
        '1000',
      ], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: dir,
          MANGO_REPO_DIR: repoDir,
          MANGO_MPV_PID_FILE: join(dir, 'mpv.pid'),
          MANGO_MPV_SOCKET: socket,
          MANGO_MPV_PROBE_SOCKET_DIR: join(dir, 'probe'),
        },
      }, (error, stdout, stderr) => resolvePromise({
        code: error && 'code' in error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      }));
    });
    assert.equal(result.code, 75);
    assert.match(result.stdout, /DEFERRED: foreground_playback_active/);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    await rm(dir, { recursive: true, force: true });
  }
});
