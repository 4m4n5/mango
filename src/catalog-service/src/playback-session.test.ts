import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPlaybackSession,
  getPlaybackSession,
  resetPlaybackSessionsForTest,
  transitionPlaybackSession,
  waitForPlaybackSession,
} from './playback-session.js';

async function withSessionState(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playback-session-'));
  const path = join(dir, 'session.json');
  process.env.MANGO_PLAYBACK_SESSION_PATH = path;
  await resetPlaybackSessionsForTest();
  try {
    await run(path);
  } finally {
    await resetPlaybackSessionsForTest();
    delete process.env.MANGO_PLAYBACK_SESSION_PATH;
    await rm(dir, { recursive: true, force: true });
  }
}

test('playback sessions are idempotent by request id', () => withSessionState(async () => {
  const first = await createPlaybackSession({
    requestId: 'session-idempotent',
    epoch: 10,
    source: 'catalog',
    contentType: 'movie',
    contentId: 'tt1',
  });
  const second = await createPlaybackSession({
    requestId: 'session-idempotent',
    epoch: 11,
    source: 'catalog',
    contentType: 'movie',
    contentId: 'tt2',
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.session.epoch, 10);
  assert.equal(second.session.content_id, 'tt1');
}));

test('session transitions wake a waiter and preserve ready truth', () => withSessionState(async () => {
  await createPlaybackSession({
    requestId: 'session-waiter',
    epoch: 20,
    source: 'youtube',
  });
  const waiting = waitForPlaybackSession('session-waiter', 1, 1000);
  await transitionPlaybackSession('session-waiter', 'playing', {
    result: { ok: true, stream: { url: 'https://secret.invalid/video', format: '1080p' } },
  });
  const session = await waiting;
  assert.equal(session?.state, 'playing');
  assert.equal(session?.ever_ready, true);
  assert.deepEqual(session?.result, { ok: true, stream: { format: '1080p' } });
  await transitionPlaybackSession('session-waiter', 'stopped');
  assert.equal((await getPlaybackSession('session-waiter'))?.ever_ready, true);
}));

test('persisted session state never contains transport URLs', () => withSessionState(async (path) => {
  await createPlaybackSession({
    requestId: 'session-redaction',
    epoch: 30,
    source: 'catalog',
  });
  await transitionPlaybackSession('session-redaction', 'playing', {
    result: {
      ok: true,
      stream: {
        url: 'https://secret.invalid/signed',
        audio_url: 'https://secret.invalid/audio',
        display_label: '4K',
      },
    },
  });
  const raw = await readFile(path, 'utf8');
  assert.doesNotMatch(raw, /secret\.invalid/);
  assert.match(raw, /display_label/);
  assert.doesNotMatch(raw, /audio_url/);
}));

test('playback session result keeps only the launcher-needed subset', () => withSessionState(async () => {
  await createPlaybackSession({
    requestId: 'session-slim',
    epoch: 31,
    source: 'catalog',
  });
  await transitionPlaybackSession('session-slim', 'playing', {
    result: {
      ok: true,
      ttff_ms: 120,
      total_ms: 400,
      attempts: 2,
      candidate_count: 4,
      win_ladder_step: 'ideal',
      first_time_verified: true,
      unused_blob: 'drop-me',
      stream: {
        format: '1080p',
        display_label: '1080p',
        cached: true,
        resolve_ms: 80,
        url: 'https://secret.invalid/signed',
        extra: 'nope',
      },
      filters: {
        applied: { main_ladder: [{ step: 'ideal' }], other: true },
        play_ladder: ['ideal'],
      },
    },
  });
  const session = await getPlaybackSession('session-slim');
  assert.deepEqual(session?.result, {
    ok: true,
    ttff_ms: 120,
    total_ms: 400,
    attempts: 2,
    candidate_count: 4,
    win_ladder_step: 'ideal',
    first_time_verified: true,
    stream: {
      display_label: '1080p',
      resolve_ms: 80,
      format: '1080p',
      cached: true,
    },
    filters: {
      applied: { main_ladder: [{ step: 'ideal' }] },
    },
  });
}));

test('terminal cancellation cannot be overwritten by a late success', () => withSessionState(async () => {
  await createPlaybackSession({
    requestId: 'session-cancelled',
    epoch: 40,
    source: 'catalog',
  });
  await transitionPlaybackSession('session-cancelled', 'cancelled');
  const late = await transitionPlaybackSession('session-cancelled', 'playing', {
    result: { ok: true },
  });
  assert.equal(late?.state, 'cancelled');
  assert.equal(late?.ever_ready, false);
}));

test('in-memory session history stays bounded while the latest session remains available', () => withSessionState(async () => {
  for (let index = 0; index < 40; index += 1) {
    const requestId = `session-bounded-${index}`;
    await createPlaybackSession({
      requestId,
      epoch: 100 + index,
      source: 'catalog',
    });
    await transitionPlaybackSession(requestId, 'failed_before_frame', {
      error: 'expected test failure',
    });
  }
  assert.equal(await getPlaybackSession('session-bounded-0'), null);
  assert.equal((await getPlaybackSession('session-bounded-39'))?.state, 'failed_before_frame');
}));

test('hydration terminalizes a pre-frame session whose worker was interrupted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playback-session-recovery-'));
  const path = join(dir, 'session.json');
  process.env.MANGO_PLAYBACK_SESSION_PATH = path;
  const now = Date.now() - 1000;
  await writeFile(path, JSON.stringify({
    session_id: 'session-recovery',
    request_id: 'session-recovery',
    epoch: 200,
    version: 2,
    source: 'catalog',
    state: 'resolving',
    content_type: 'movie',
    content_id: 'tt-recovery',
    title: 'Recovery',
    ever_ready: false,
    accepted_at: now,
    updated_at: now,
    ready_at: null,
    terminal_at: null,
    error: null,
    result: null,
  }));
  await resetPlaybackSessionsForTest();
  try {
    const recovered = await getPlaybackSession('session-recovery');
    assert.equal(recovered?.state, 'failed_before_frame');
    assert.match(recovered?.error || '', /service restarted/);
  } finally {
    delete process.env.MANGO_PLAYBACK_SESSION_PATH;
    await resetPlaybackSessionsForTest();
    await rm(dir, { recursive: true, force: true });
  }
});
