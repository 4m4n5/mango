import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  getStreamPathEvidence,
  initPlayabilityDb,
  prunePlayabilityMaintenance,
  recordStreamLongWatch,
  recordStreamPlaybackIssue,
  resetPlayabilityDbForTests,
  undoStreamPlaybackIssue,
  upsertStreamPathEvidence,
} from './db.js';

test('path evidence stores technical proof, long watch, issue TTL, and undo without URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-stream-evidence-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await initPlayabilityDb();
    const key = 'svc:torbox|ih:abc';
    const profile = 'pi5-x11-mpv-hifi';
    upsertStreamPathEvidence({
      release_fingerprint: key,
      profile_id: profile,
      capability_class: 'proven_smooth',
      technical: {
        width: 3840,
        height: 2160,
        codec: 'hevc',
        hdr: false,
      },
      reason: 'path-proven compatible',
      last_proof_at: 100,
      now: 100,
    });
    recordStreamLongWatch({
      release_fingerprint: key,
      profile_id: profile,
      now: 200,
    });
    assert.equal(getStreamPathEvidence(key, profile)?.capability_class, 'proven_smooth');
    assert.equal(getStreamPathEvidence(key, profile)?.long_watch_count, 1);

    const riskyKey = 'svc:torbox|ih:risky';
    upsertStreamPathEvidence({
      release_fingerprint: riskyKey,
      profile_id: profile,
      capability_class: 'known_risky',
      reason: 'technical path is risky',
      now: 210,
    });
    recordStreamLongWatch({
      release_fingerprint: riskyKey,
      profile_id: profile,
      now: 220,
    });
    assert.equal(
      getStreamPathEvidence(riskyKey, profile)?.capability_class,
      'known_risky',
      'a long watch is a soft signal and cannot override the technical tier',
    );

    const issued = recordStreamPlaybackIssue({
      release_fingerprint: key,
      profile_id: profile,
      reason: 'user requested a smoother source',
      ttl_ms: 7 * 24 * 60 * 60 * 1000,
      now: 300,
    });
    assert.equal(issued.capability_class, 'known_risky');
    assert.equal(issued.issue_expires_at, 300 + 7 * 24 * 60 * 60 * 1000);

    const undone = undoStreamPlaybackIssue({
      release_fingerprint: key,
      profile_id: profile,
      now: 400,
    });
    assert.equal(undone?.capability_class, 'proven_smooth');
    assert.equal(undone?.issue_reason, null);
    assert.doesNotMatch(undone?.technical_json || '', /https?:\/\//);

    const unknownKey = 'svc:torbox|ih:def';
    recordStreamPlaybackIssue({
      release_fingerprint: unknownKey,
      profile_id: profile,
      reason: 'temporary playback issue',
      ttl_ms: 60_000,
      now: 1_000,
    });
    prunePlayabilityMaintenance(61_001);
    const expired = getStreamPathEvidence(unknownKey, profile);
    assert.equal(expired?.capability_class, 'unknown');
    assert.equal(expired?.issue_reason, null);
    assert.equal(expired?.issue_expires_at, null);
  } finally {
    resetPlayabilityDbForTests();
    delete process.env.MANGO_PLAYABILITY_DB;
    await rm(dir, { recursive: true, force: true });
  }
});
