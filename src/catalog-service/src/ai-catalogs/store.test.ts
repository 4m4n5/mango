import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { slugifySlotId } from './service.js';
import {
  loadAiCatalogSlots,
  slotToRail,
  tabHasCapacity,
  writeAiCatalogSlot,
} from './store.js';
import { MAX_AI_SLOTS_PER_TAB } from './types.js';

test('slugifySlotId produces stable ids', () => {
  assert.equal(slugifySlotId('Cozy Sci-Fi Nights'), 'cozy-sci-fi-nights');
});

test('store round-trip and tab capacity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mango-ai-catalogs-'));
  process.env.MANGO_AI_CATALOGS_DIR = root;
  await mkdir(path.join(root, 'slots'), { recursive: true });

  const slot = await writeAiCatalogSlot({
    version: 1,
    slot_id: 'cozy-nights',
    tab: 'movies',
    label: 'Cozy Nights',
    content_type: 'movie',
    enabled: true,
    seed_titles: [{ type: 'movie', id: 'tt123', title: 'Sample' }],
    llm_hints: { theme: 'cozy' },
  });

  const loaded = await loadAiCatalogSlots();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.slot_id, slot.slot_id);

  const rail = slotToRail(slot);
  assert.equal(rail.id, 'ai-cozy-nights');
  assert.equal(rail.type, 'ai_catalog');

  for (let index = 0; index < MAX_AI_SLOTS_PER_TAB; index += 1) {
    await writeAiCatalogSlot({
      version: 1,
      slot_id: `movies-slot-${index}`,
      tab: 'movies',
      label: `Slot ${index}`,
      content_type: 'movie',
      enabled: true,
    });
  }
  const movies = await loadAiCatalogSlots();
  assert.equal(tabHasCapacity(movies, 'movies'), false);
  assert.equal(tabHasCapacity(movies, 'series'), true);

  delete process.env.MANGO_AI_CATALOGS_DIR;
});

test('store reads yaml slot files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mango-ai-catalogs-read-'));
  process.env.MANGO_AI_CATALOGS_DIR = root;
  const slotsDir = path.join(root, 'slots');
  await mkdir(slotsDir, { recursive: true });
  await writeFile(
    path.join(slotsDir, 'sample.yaml'),
    `version: 1
slot_id: sample
tab: series
label: Sample Series
content_type: series
enabled: true
seed_titles:
  - type: series
    id: tt999
    title: Show
`,
    'utf8',
  );

  const slots = await loadAiCatalogSlots();
  assert.equal(slots.length, 1);
  assert.equal(slots[0]?.content_type, 'series');

  delete process.env.MANGO_AI_CATALOGS_DIR;
});
