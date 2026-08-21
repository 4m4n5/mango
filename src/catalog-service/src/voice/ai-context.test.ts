import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAiCatalogsByTab } from './ai-context.js';
import type { AiCatalogSummary } from '../ai-catalogs/service.js';

function summary(overrides: Partial<AiCatalogSummary>): AiCatalogSummary {
  return {
    slot_id: 'my-slot',
    rail_id: 'ai_catalog:my-slot',
    tab: 'movies',
    label: 'My Slot',
    content_type: 'movie',
    seed_count: 0,
    source_count: 0,
    llm_hints: {},
    ...overrides,
  };
}

test('groupAiCatalogsByTab groups rails under every known tab', () => {
  const grouped = groupAiCatalogsByTab([]);
  assert.deepEqual(Object.keys(grouped).sort(), ['live', 'movies', 'series', 'youtube']);
  assert.deepEqual(grouped.movies, []);
});

test('groupAiCatalogsByTab buckets summaries by tab and trims fields', () => {
  const summaries = [
    summary({ slot_id: 'a', rail_id: 'ai_catalog:a', tab: 'movies', label: 'A', content_type: 'movie' }),
    summary({ slot_id: 'b', rail_id: 'ai_catalog:b', tab: 'series', label: 'B', content_type: 'series' }),
  ];
  const grouped = groupAiCatalogsByTab(summaries);
  assert.deepEqual(grouped.movies, [
    { slot_id: 'a', rail_id: 'ai_catalog:a', label: 'A', content_type: 'movie' },
  ]);
  assert.deepEqual(grouped.series, [
    { slot_id: 'b', rail_id: 'ai_catalog:b', label: 'B', content_type: 'series' },
  ]);
  assert.deepEqual(grouped.live, []);
  assert.deepEqual(grouped.youtube, []);
});
