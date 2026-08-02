import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { playbackHudEnv, sanitizePlaybackHudText } from './mpv.js';

const repoDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const script = join(repoDir, 'scripts/m2-catalog/service/mpv-play.sh');

test('HUD launch text strips controls, collapses whitespace, and truncates by Unicode character', () => {
  assert.equal(
    sanitizePlaybackHudText('  Mango\n\tTV\u0000  ', 40),
    'Mango TV',
  );
  assert.equal(sanitizePlaybackHudText('अंतरिक्ष यात्रा', 5), 'अंतरि');
  assert.equal(sanitizePlaybackHudText('   ', 10), undefined);
});

test('HUD context reaches mpv only as bounded safe metadata', () => {
  assert.deepEqual(playbackHudEnv({
    title: 'Example\nSeries',
    context: 'S2 E7 · Finale',
    kind: 'series',
    confirmation: 'Now playing · 1080p · Ready now',
  }), {
    MANGO_PLAYBACK_TITLE: 'Example Series',
    MANGO_PLAYBACK_CONTEXT: 'S2 E7 · Finale',
    MANGO_PLAYBACK_CONFIRMATION: 'Now playing · 1080p · Ready now',
    MANGO_PLAYBACK_KIND: 'series',
  });
  assert.equal(playbackHudEnv({ kind: 'not-real' as never }).MANGO_PLAYBACK_KIND, 'unknown');
});

async function printDeferredArgs(ladderStep: string): Promise<string[]> {
  const home = await mkdtemp(join(tmpdir(), 'mango-mpv-args-'));
  try {
    const stdout = await new Promise<string>((resolvePromise, reject) => {
      execFile('bash', [script, '--url', 'https://example.invalid/video', '--timeout-ms', '5000'], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: home,
          MANGO_REPO_DIR: repoDir,
          MANGO_PLAY_REQUEST_CLASS: 'user',
          MANGO_MPV_PID_FILE: join(home, 'mpv.pid'),
          MANGO_MPV_SOCKET: join(home, 'mpv.sock'),
          MANGO_PLAYBACK_ACTIVE_FILE: join(home, 'playback-active'),
          MANGO_PLAYBACK_OWNERSHIP_LOCK: join(home, 'owner.lock.d'),
          MANGO_MPV_DEFER_FOREGROUND: '1',
          MANGO_MPV_SKIP_FFPROBE: '1',
          MANGO_MPV_PRINT_ARGS: '1',
          MANGO_PLAY_LADDER_STEP: ladderStep,
          MANGO_MPV_GPU_API: 'opengl',
          MANGO_MPV_PROFILE: 'fast',
          MANGO_MPV_TONE_MAPPING: 'bt.2446a',
          MANGO_MPV_AUDIO_CHANNELS: 'auto-safe',
          MANGO_MPV_BLEND_SUBTITLES: 'no',
          MANGO_MPV_CACHE: 'yes',
          MANGO_MPV_READAHEAD_SECS: '30',
          MANGO_MPV_VOD_SWAPINTERVAL: '1',
        },
      }, (error, output, stderr) => {
        if (error) reject(new Error(stderr || output || error.message));
        else resolvePromise(output);
      });
    });
    return stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('--'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

for (const fixture of ['ideal_1080p_hdr', '4k_sdr_cached']) {
  test(`S4: deferred ${fixture} starts with complete shared hifi policy`, async () => {
    const args = await printDeferredArgs(fixture);
    for (const expected of [
      '--vo=null',
      '--ao=null',
      '--gpu-api=opengl',
      '--profile=fast',
      '--tone-mapping=bt.2446a',
      '--audio-channels=auto-safe',
      '--sub-visibility=no',
      '--sub-auto=all',
      '--blend-subtitles=no',
      '--cache=yes',
      '--demuxer-readahead-secs=30',
      '--opengl-swapinterval=1',
    ]) assert.ok(args.includes(expected), `missing ${expected}: ${args.join(' ')}`);
  });
}

test('S4: deferred handoff restores automatic audio output when no AO override exists', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /local ao="\$\{MANGO_MPV_AO:-auto\}"/);
  assert.match(source, /\["set_property","ao","%s"\]/);
});

test('S4: persistent probe workers return duration before teardown', async () => {
  const source = await readFile(
    join(repoDir, 'scripts/m3-play/playability/mpv-probe-ipc.sh'),
    'utf8',
  );
  assert.match(source, /PASS: ttff_ms=.*duration_sec=/);
});

test('S4: a hung ffprobe is bounded by the shared script deadline', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mango-ffprobe-deadline-'));
  const bin = join(home, 'bin');
  await mkdir(bin);
  const fakeFfprobe = join(bin, 'ffprobe');
  await writeFile(fakeFfprobe, '#!/usr/bin/env bash\nsleep 5\n');
  await chmod(fakeFfprobe, 0o755);
  const started = Date.now();
  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolvePromise) => {
      execFile('bash', [script, '--url', 'https://example.invalid/video', '--timeout-ms', '300'], {
        cwd: repoDir,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          HOME: home,
          MANGO_REPO_DIR: repoDir,
          MANGO_PLAY_REQUEST_CLASS: 'user',
          MANGO_MPV_PID_FILE: join(home, 'mpv.pid'),
          MANGO_MPV_SOCKET: join(home, 'mpv.sock'),
          MANGO_PLAYBACK_ACTIVE_FILE: join(home, 'playback-active'),
          MANGO_PLAYBACK_OWNERSHIP_LOCK: join(home, 'owner.lock.d'),
        },
      }, (error, stdout, stderr) => resolvePromise({
        code: error && 'code' in error && typeof error.code === 'number' ? error.code : 0,
        output: `${stdout}\n${stderr}`,
      }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /deadline exhausted before mpv startup/);
    assert.ok(Date.now() - started < 2000, `ffprobe exceeded cleanup grace: ${Date.now() - started}ms`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
