import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyLiveAiCatalogRails, buildLiveAiCatalogRails } from './ai-catalog-rails.js';
import type { TabRailItemsResponse } from '../core.js';

async function withAiCatalogDir(run: (dir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'mango-ai-catalogs-'));
  await mkdir(path.join(root, 'slots'), { recursive: true });
  const previous = process.env.MANGO_AI_CATALOGS_DIR;
  process.env.MANGO_AI_CATALOGS_DIR = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_AI_CATALOGS_DIR;
    } else {
      process.env.MANGO_AI_CATALOGS_DIR = previous;
    }
  }
}

test('live ai cricket slot merges into live-cricket rail', async () => {
  await withAiCatalogDir(async (dir) => {
    await writeFile(path.join(dir, 'slots', 'cricket-channels.yaml'), `
version: 1
slot_id: cricket-channels
tab: live
label: Cricket Channels
content_type: tv
enabled: true
sources: []
seed_titles:
  - type: tv
    id: willow-720
    title: Willow (720p)
  - type: tv
    id: cricket-gold
    title: Cricket Gold (1080p)
`);

    const payload: TabRailItemsResponse = {
      tab: 'live',
      rails: [{
        rail_id: 'live-cricket',
        label: 'cricket',
        items: [{
          id: 'cricket-gold',
          type: 'tv',
          title: 'Cricket Gold (1080p)',
          subtitle: 'live',
          poster: '',
          source: '',
        }],
        resolve_ms: 1,
        skipped: 0,
        playability: {
          displayed: 1,
          verified_pool: 1,
          pending: 0,
          low_water: false,
          session_id: 'live',
        },
      }],
      resolve_ms: 1,
    };

    const merged = await applyLiveAiCatalogRails(payload);
    assert.equal(merged.rails.length, 1);
    assert.equal(merged.rails[0]?.rail_id, 'live-cricket');
    assert.deepEqual(merged.rails[0]?.items.map((item) => item.id), ['cricket-gold', 'willow-720']);
    assert.equal(await buildLiveAiCatalogRails().then((rails) => rails.length), 0);
  });
});
