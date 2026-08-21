import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Stream } from './core.js';
import {
  ActiveStreamConflictError,
  ActiveStreamService,
} from './active-stream-session.js';
import { defaultFilterConfig, mergeFilterConfig } from './stream-filters.js';
import {
  initPlayabilityDb,
  resetPlayabilityDbForTests,
} from './playability/db.js';
import { streamReleaseFingerprint } from './play-ladder.js';

function stream(url: string, description: string): Stream {
  return {
    url,
    source: 'AIOStreams',
    title: description,
    description,
    behaviorHints: {
      bingeGroup: `com.aiostreams|torbox|true|${url}`,
    },
  };
}

test('active stream picker serializes switches and exposes no URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-active-streams-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_ACTIVE_STREAMS_PATH = join(dir, 'active-streams.json');
  resetPlayabilityDbForTests();
  await initPlayabilityDb();

  const current = stream(
    'https://signed.example/current',
    'Example.S01E03.1080p.HEVC.WEB-DL',
  );
  const alternate = stream(
    'https://signed.example/alternate',
    'Example.S01E03.720p.AVC.WEB-DL',
  );
  const risky = stream(
    'https://signed.example/risky',
    'Example.S01E03.2160p.HEVC.HDR.WEB-DL',
  );
  let releaseProbe: (() => void) | null = null;
  const probeBarrier = new Promise<void>((resolve) => { releaseProbe = resolve; });
  const playCalls: Array<{ url: string; start?: number }> = [];
  const hudConfirmations: Array<string | null | undefined> = [];
  const service = new ActiveStreamService({
    getPlaybackState: async () => ({ position_sec: 613, duration_sec: 2400 }),
    getProperty: async (property) => {
      if (property === 'track-list') {
        return [
          { id: 1, type: 'audio', lang: 'hin', title: 'Hindi' },
          { id: 2, type: 'sub', lang: 'eng', title: 'English' },
        ];
      }
      if (property === 'aid') return 1;
      if (property === 'sid') return 2;
      if (property === 'sub-visibility') return true;
      return null;
    },
    setProperty: async () => true,
    probe: async () => {
      await probeBarrier;
      return {
        ok: true,
        ttff_ms: 50,
        duration_sec: 2400,
        technical: { width: 1280, height: 720, codec: 'h264', hdr: false },
      };
    },
    play: async (url, _timeout, options) => {
      playCalls.push({ url, start: options?.startSec });
      hudConfirmations.push(options?.hud?.confirmation);
      return { ok: true, ttff_ms: 100 };
    },
  });
  const config = mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: false,
    max_quality: '2160p',
  });
  try {
    await service.register({
      sessionId: 'session-1',
      playEpoch: 7,
      contentType: 'series',
      contentId: 'tt1234567:1:3',
      title: 'Example',
      hud: { title: 'Example', context: 'S1 E3 · Pilot', kind: 'series' },
      streams: [current, risky, alternate],
      config,
      filterContext: {
        contentType: 'series',
        metaTitle: 'Example',
        metaId: 'tt1234567:1:3',
      },
      currentFingerprint: streamReleaseFingerprint(current),
      resolveFresh: async () => [current, risky, alternate],
    });
    const initial = await service.state();
    assert.equal(initial.status, 'ready');
    assert.equal(initial.candidates.length, 3);
    assert.equal(initial.candidates[0]?.current, true, 'current stream stays pinned first');
    assert.equal(initial.candidates.at(-1)?.capability_class, 'known_risky');
    assert.doesNotMatch(JSON.stringify(initial), /signed\.example/);
    assert.doesNotMatch(await readFile(process.env.MANGO_ACTIVE_STREAMS_PATH, 'utf8'), /https?:\/\//);

    const target = initial.candidates.find((candidate) => candidate.resolution === '720p')!;
    const checking = await service.beginSwitch({
      sessionId: initial.session_id!,
      revision: initial.revision,
      candidateId: target.candidate_id,
    });
    assert.equal(checking.status, 'checking');
    await assert.rejects(
      service.beginSwitch({
        sessionId: checking.session_id!,
        revision: checking.revision,
        candidateId: target.candidate_id,
      }),
      ActiveStreamConflictError,
    );
    releaseProbe!();
    let settled = await service.state(checking.revision, 2_000);
    while (settled.status === 'checking' || settled.status === 'switching') {
      settled = await service.state(settled.revision, 2_000);
    }
    assert.equal(settled.status, 'ready');
    assert.equal(settled.current_candidate_id, target.candidate_id);
    assert.equal(settled.candidates[0]?.candidate_id, target.candidate_id);
    assert.equal(settled.switch_undo_candidate_id, initial.current_candidate_id);
    assert.ok(settled.switch_confirmed_at);
    assert.deepEqual(playCalls, [{
      url: alternate.url,
      start: 613,
    }]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const reverse = await service.beginSwitch({
      sessionId: settled.session_id!,
      revision: settled.revision,
      candidateId: settled.switch_undo_candidate_id!,
      undo: true,
    });
    let reversed = await service.state(reverse.revision, 2_000);
    while (reversed.status === 'checking' || reversed.status === 'switching') {
      reversed = await service.state(reversed.revision, 2_000);
    }
    assert.equal(reversed.current_candidate_id, initial.current_candidate_id);
    assert.equal(reversed.switch_undo_candidate_id, null, 'Undo must not become Redo');
    assert.deepEqual(playCalls, [
      { url: alternate.url, start: 613 },
      { url: current.url, start: 613 },
    ]);
    assert.match(hudConfirmations[0] || '', /^Now playing · 720p · /);
    assert.equal(hudConfirmations[1], 'Previous stream restored');

    const issued = await service.reportIssue({
      sessionId: reversed.session_id!,
      revision: reversed.revision,
    });
    assert.equal(issued.undo_available, true);
    assert.equal(
      issued.candidates.find((candidate) => candidate.current)?.capability_class,
      'known_risky',
    );
    const undone = await service.undoIssue({
      sessionId: issued.session_id!,
      revision: issued.revision,
    });
    assert.equal(undone.undo_available, false);

    await assert.rejects(
      service.reportIssue({
        sessionId: undone.session_id!,
        revision: initial.revision,
      }),
      ActiveStreamConflictError,
      'stale revisions must not mutate the active session',
    );
  } finally {
    resetPlayabilityDbForTests();
    delete process.env.MANGO_PLAYABILITY_DB;
    delete process.env.MANGO_ACTIVE_STREAMS_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed foreground switch restores the original stream at the same position', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-active-stream-restore-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_ACTIVE_STREAMS_PATH = join(dir, 'active-streams.json');
  resetPlayabilityDbForTests();
  await initPlayabilityDb();

  const current = stream(
    'https://signed.example/original',
    'Example.S01E03.1080p.HEVC.WEB-DL',
  );
  const alternate = stream(
    'https://signed.example/replacement',
    'Example.S01E03.720p.AVC.WEB-DL',
  );
  const playCalls: Array<{ url: string; start?: number; reopen?: boolean }> = [];
  const service = new ActiveStreamService({
    getPlaybackState: async () => ({ position_sec: 901, duration_sec: 2400 }),
    getProperty: async (property) => {
      if (property === 'track-list') return [];
      if (property === 'sub-visibility') return false;
      return null;
    },
    setProperty: async () => true,
    probe: async () => ({
      ok: true,
      ttff_ms: 50,
      duration_sec: 2400,
      technical: { width: 1280, height: 720, codec: 'h264', hdr: false },
    }),
    play: async (url, _timeout, options) => {
      playCalls.push({ url, start: options?.startSec, reopen: options?.hud?.reopenStreams });
      if (url === alternate.url) throw new Error('replacement launch failed');
      return { ok: true, ttff_ms: 100 };
    },
  });
  const config = mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: false,
    max_quality: '2160p',
  });
  try {
    await service.register({
      sessionId: 'session-restore',
      playEpoch: 8,
      contentType: 'series',
      contentId: 'tt1234567:1:3',
      title: 'Example',
      streams: [current, alternate],
      config,
      filterContext: {
        contentType: 'series',
        metaTitle: 'Example',
        metaId: 'tt1234567:1:3',
      },
      currentFingerprint: streamReleaseFingerprint(current),
      resolveFresh: async () => [current, alternate],
    });
    const initial = await service.state();
    const target = initial.candidates.find((candidate) => !candidate.current)!;
    const checking = await service.beginSwitch({
      sessionId: initial.session_id!,
      revision: initial.revision,
      candidateId: target.candidate_id,
    });
    let settled = await service.state(checking.revision, 2_000);
    while (settled.status === 'checking' || settled.status === 'switching') {
      settled = await service.state(settled.revision, 2_000);
    }
    assert.equal(settled.status, 'ready');
    assert.equal(settled.current_candidate_id, initial.current_candidate_id);
    assert.match(settled.error || '', /original stream was restored/i);
    assert.deepEqual(playCalls, [
      { url: alternate.url, start: 901, reopen: undefined },
      { url: current.url, start: 901, reopen: true },
    ]);
  } finally {
    resetPlayabilityDbForTests();
    delete process.env.MANGO_PLAYABILITY_DB;
    delete process.env.MANGO_ACTIVE_STREAMS_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});

test('public stream roster is five, pins current, and keeps a failed choice last', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-active-stream-bound-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  process.env.MANGO_ACTIVE_STREAMS_PATH = join(dir, 'active-streams.json');
  resetPlayabilityDbForTests();
  await initPlayabilityDb();
  const streams = [
    stream('https://signed.example/current-five', 'Example.S01E03.1080p.HEVC.WEB-DL-GROUP0'),
    stream('https://signed.example/one', 'Example.S01E03.2160p.HEVC.WEB-DL-GROUP1'),
    stream('https://signed.example/two', 'Example.S01E03.1080p.AVC.WEB-DL-GROUP2'),
    stream('https://signed.example/three', 'Example.S01E03.720p.AVC.WEB-DL-GROUP3'),
    stream('https://signed.example/four', 'Example.S01E03.1080p.HEVC.WEB-DL-GROUP4'),
    stream('https://signed.example/five', 'Example.S01E03.720p.HEVC.WEB-DL-GROUP5'),
    stream('https://signed.example/six', 'Example.S01E03.480p.AVC.WEB-DL-GROUP6'),
  ];
  const service = new ActiveStreamService({
    getPlaybackState: async () => ({ position_sec: 120, duration_sec: 2400 }),
    getProperty: async (property) => property === 'sub-visibility' ? false : [],
    setProperty: async () => true,
    probe: async () => { throw new Error('isolated validation failed'); },
    play: async () => ({ ok: true, ttff_ms: 10 }),
  });
  const config = mergeFilterConfig({
    ...defaultFilterConfig(),
    strict_unknown_cache: false,
    max_quality: '2160p',
  });
  try {
    await service.register({
      sessionId: 'session-five',
      playEpoch: 9,
      contentType: 'series',
      contentId: 'tt7654321:1:3',
      title: 'Example',
      streams,
      config,
      filterContext: { contentType: 'series', metaTitle: 'Example', metaId: 'tt7654321:1:3' },
      currentFingerprint: streamReleaseFingerprint(streams[0]!),
      resolveFresh: async () => streams,
    });
    const initial = await service.state();
    assert.equal(initial.candidates.length, 5);
    assert.equal(initial.candidates[0]?.current, true);
    const failed = initial.candidates.find((candidate) => !candidate.current)!;
    const checking = await service.beginSwitch({
      sessionId: initial.session_id!,
      revision: initial.revision,
      candidateId: failed.candidate_id,
    });
    let settled = await service.state(checking.revision, 2_000);
    while (settled.status === 'checking' || settled.status === 'switching') {
      settled = await service.state(settled.revision, 2_000);
    }
    assert.equal(settled.candidates.length, 5);
    assert.equal(settled.candidates[0]?.current, true);
    assert.equal(settled.candidates.at(-1)?.candidate_id, failed.candidate_id);
    assert.equal(settled.candidates.at(-1)?.unavailable, true);
    assert.equal(settled.candidates.slice(0, -1).some((candidate) => candidate.unavailable), false);
    const publicJson = JSON.stringify(settled);
    const persisted = await readFile(process.env.MANGO_ACTIVE_STREAMS_PATH, 'utf8');
    assert.doesNotMatch(publicJson, /https?:\/\//);
    assert.doesNotMatch(persisted, /https?:\/\//);
    assert.doesNotMatch(persisted, /credential|token|authorization/i);
  } finally {
    resetPlayabilityDbForTests();
    delete process.env.MANGO_PLAYABILITY_DB;
    delete process.env.MANGO_ACTIVE_STREAMS_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});
