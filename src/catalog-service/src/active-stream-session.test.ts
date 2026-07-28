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
  let releaseProbe: (() => void) | null = null;
  const probeBarrier = new Promise<void>((resolve) => { releaseProbe = resolve; });
  const playCalls: Array<{ url: string; start?: number }> = [];
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
    assert.equal(initial.status, 'ready');
    assert.equal(initial.candidates.length, 2);
    assert.doesNotMatch(JSON.stringify(initial), /signed\.example/);
    assert.doesNotMatch(await readFile(process.env.MANGO_ACTIVE_STREAMS_PATH, 'utf8'), /https?:\/\//);

    const target = initial.candidates.find((candidate) => !candidate.current)!;
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
    assert.deepEqual(playCalls, [{
      url: alternate.url,
      start: 613,
    }]);

    const issued = await service.reportIssue({
      sessionId: settled.session_id!,
      revision: settled.revision,
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
  const playCalls: Array<{ url: string; start?: number }> = [];
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
      playCalls.push({ url, start: options?.startSec });
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
      { url: alternate.url, start: 901 },
      { url: current.url, start: 901 },
    ]);
  } finally {
    resetPlayabilityDbForTests();
    delete process.env.MANGO_PLAYABILITY_DB;
    delete process.env.MANGO_ACTIVE_STREAMS_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});
