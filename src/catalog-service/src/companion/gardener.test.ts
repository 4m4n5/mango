import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  applyCompanionGardener,
  assignTitleLovesToSlots,
  buildTopUpSuggestions,
  gardenerHintsAreSafe,
  mergeGardenerHints,
  scoreSlotAffinity,
} from './gardener.js';
import { defaultProfile, type CompanionProfile } from './types.js';
import { writeProfile } from './profile.js';

function sampleProfile(): CompanionProfile {
  const profile = defaultProfile();
  profile.taste.loves = ['hindi comedy', 'cozy nights'];
  profile.taste.avoids = ['horror'];
  profile.taste.title_loves = [
    { type: 'movie', id: 'tt1', title: '3 Idiots' },
    { type: 'movie', id: 'tt2', title: 'Zindagi Na Milegi Dobara' },
  ];
  return profile;
}

function sampleSlot(overrides: Partial<{ slot_id: string; label: string; content_type: 'movie' | 'series' }> = {}) {
  return {
    version: 1,
    slot_id: overrides.slot_id ?? 'cozy-nights',
    tab: 'movies' as const,
    label: overrides.label ?? 'cozy nights',
    content_type: overrides.content_type ?? 'movie',
    enabled: true,
    seed_titles: [],
    llm_hints: { theme: 'cozy comedy' },
  };
}

test('scoreSlotAffinity prefers matching loves', () => {
  const profile = sampleProfile();
  const cozy = sampleSlot();
  const action = sampleSlot({ slot_id: 'action', label: 'action blockbusters', content_type: 'movie' });
  assert.ok(scoreSlotAffinity(profile, cozy) > scoreSlotAffinity(profile, action));
});

test('assignTitleLovesToSlots maps movie titles to movie slots', () => {
  const profile = sampleProfile();
  const slots = [
    sampleSlot(),
    sampleSlot({ slot_id: 'weekend', label: 'weekend picks' }),
  ];
  const map = assignTitleLovesToSlots(profile, slots);
  assert.ok((map.get('cozy-nights') ?? []).includes('tt1'));
});

test('mergeGardenerHints never adds remove_ids', () => {
  const merged = mergeGardenerHints({}, {
    add_ids: ['tt9'],
    topup_suggestions: ['Try light hindi comedies'],
  });
  assert.deepEqual(merged.remove_ids, []);
  assert.ok(gardenerHintsAreSafe(merged));
  assert.ok(merged.add_ids?.includes('tt9'));
});

test('buildTopUpSuggestions mentions unmatched loves or avoids', () => {
  const profile = sampleProfile();
  const suggestions = buildTopUpSuggestions(profile, sampleSlot({ label: 'sci-fi picks' }));
  assert.ok(suggestions.length > 0);
  assert.ok(
    suggestions.some((s) => s.includes('Consider') || s.includes('Deprioritize')),
  );
});

test('applyCompanionGardener writes hints to ai catalog slots', async () => {
  const companionDir = mkdtempSync(path.join(tmpdir(), 'mango-gardener-companion-'));
  const aiDir = mkdtempSync(path.join(tmpdir(), 'mango-gardener-ai-'));
  const prevCompanion = process.env.MANGO_COMPANION_DIR;
  const prevAi = process.env.MANGO_AI_CATALOGS_DIR;
  process.env.MANGO_COMPANION_DIR = companionDir;
  process.env.MANGO_AI_CATALOGS_DIR = aiDir;

  try {
    await writeProfile(sampleProfile());
    const slotsDir = path.join(aiDir, 'slots');
    await mkdir(slotsDir, { recursive: true });
    await writeFile(
      path.join(slotsDir, 'cozy-nights.yaml'),
      `version: 1
slot_id: cozy-nights
tab: movies
label: cozy nights
content_type: movie
enabled: true
seed_titles: []
llm_hints:
  theme: cozy
`,
      'utf8',
    );

    const result = await applyCompanionGardener();
    assert.equal(result.ok, true);
    assert.ok(result.slots_updated >= 1);
    assert.ok(result.details[0]?.add_ids >= 1);
  } finally {
    if (prevCompanion === undefined) delete process.env.MANGO_COMPANION_DIR;
    else process.env.MANGO_COMPANION_DIR = prevCompanion;
    if (prevAi === undefined) delete process.env.MANGO_AI_CATALOGS_DIR;
    else process.env.MANGO_AI_CATALOGS_DIR = prevAi;
    rmSync(companionDir, { recursive: true, force: true });
    rmSync(aiDir, { recursive: true, force: true });
  }
});
