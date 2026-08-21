import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  appendReliabilityProof,
  latestReliabilityProof,
  listReliabilityProofs,
} from './store.js';
import type { ReliabilityProofRecord } from './types.js';

function proof(id: string, generatedAt: number): ReliabilityProofRecord {
  return {
    proof_id: id,
    reason: 'test',
    status: 'green',
    ok: true,
    summary: 'ok',
    generated_at: generatedAt,
    generated_at_iso: new Date(generatedAt).toISOString(),
    commit: 'abc123',
    idle: true,
    metadata: {},
    components: [],
  };
}

test('proof store appends, sorts newest first, and prunes old records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-'));
  const oldDir = process.env.MANGO_RELIABILITY_DIR;
  process.env.MANGO_RELIABILITY_DIR = dir;
  try {
    const now = Date.now();
    appendReliabilityProof(proof('old', now - 31 * 24 * 60 * 60 * 1000));
    appendReliabilityProof(proof('newer', now - 1000));
    appendReliabilityProof(proof('newest', now));

    const proofs = listReliabilityProofs(10);
    assert.deepEqual(proofs.map((entry) => entry.proof_id), ['newest', 'newer']);
    assert.equal(latestReliabilityProof()?.proof_id, 'newest');
  } finally {
    if (oldDir === undefined) {
      delete process.env.MANGO_RELIABILITY_DIR;
    } else {
      process.env.MANGO_RELIABILITY_DIR = oldDir;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
