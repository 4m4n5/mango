import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PlayabilityBatchWriter } from './batch-writer.js';
import { countVerifiedRailPoolByRailIds } from './db.js';
import { pruneLegacyPoolRails } from './rail-pool-legacy-prune.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
});

test('pruneLegacyPoolRails removes legacy rail_pool rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-legacy-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');

  const writer = new PlayabilityBatchWriter();
  writer.queueVerify({
    type: 'movie',
    id: 'tt9990001',
    status: 'verified',
    rail_id: 'popular-global',
    outcome: 'verified',
    probe_ms: 100,
  });
  writer.queuePool({
    rail_id: 'popular-global',
    type: 'movie',
    id: 'tt9990001',
    score: 50,
    title: 'Legacy Title',
  });
  await writer.flush();

  const dry = await pruneLegacyPoolRails(true);
  assert.ok((dry.rails['popular-global'] ?? 0) >= 1);
  assert.equal(dry.removed, 0);

  const apply = await pruneLegacyPoolRails(false);
  assert.ok(apply.removed >= 1);
  const after = await countVerifiedRailPoolByRailIds(['popular-global']);
  assert.equal(after.get('popular-global') ?? 0, 0);
});
