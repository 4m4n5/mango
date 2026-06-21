import { buildLlmRefreshToolManifest } from '../playability/refresh-control.js';
import type { RefreshLevelId } from '../playability/refresh-control.js';

export type VoiceToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  layer: 'catalog' | 'launcher';
  requires_confirm?: boolean;
};

const REFRESH_MANIFEST = buildLlmRefreshToolManifest();
const REFRESH_LEVELS = REFRESH_MANIFEST.levels.filter((level) => level.blocks_couch);
const REFRESH_ENUM = REFRESH_LEVELS.map((level) => level.id) as RefreshLevelId[];

export function buildVoiceToolManifest(): {
  ok: true;
  tools: VoiceToolDefinition[];
} {
  const tools: VoiceToolDefinition[] = [
    {
      name: 'mango_search',
      description: 'Search verified mango library titles by name. Use first when the user names a show or movie.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Title or partial title' },
          limit: { type: 'integer', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'mango_library_overview',
      description: 'Summarize the verified playable library — rail themes, counts, and sample titles. Use for recommendations and "what do we have?" questions.',
      layer: 'catalog',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mango_library_browse',
      description: 'List verified playable titles grouped by rails (up to ~120). Use when you need specific title names from the library.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max titles (default 120, max 500)' },
        },
      },
    },
    {
      name: 'mango_search_external',
      description: 'Search Cinemeta for titles outside the verified library. Default queue_missing=false. Use queue_missing=true only when the user wants a title added to the verify pool without opening it on TV.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Title to look up' },
          type: { type: 'string', enum: ['movie', 'series'], description: 'Optional content type filter' },
          limit: { type: 'integer', description: 'Max results (default 8)' },
          queue_missing: { type: 'boolean', description: 'Queue unverified hits for the next pool verify pass' },
        },
        required: ['query'],
      },
    },
    {
      name: 'mango_read_librarian_notes',
      description: 'Read persistent notes about the library — themes, prior recommendations, user taste. Avoid re-deriving the same analysis each session.',
      layer: 'catalog',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mango_update_librarian_notes',
      description: 'Update persistent librarian notes after learning something useful about the library or user preferences. Keep concise bullet-style text.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          notes: { type: 'string', description: 'Full replacement notes text (not a patch)' },
        },
        required: ['notes'],
      },
    },
    {
      name: 'mango_open_title',
      description:
        'Open a title on the TV detail page (works from home, detail, or settings — replaces the current title in place). Never starts playback; user presses B to play.',
      layer: 'launcher',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['movie', 'series', 'tv'] },
          id: { type: 'string', description: 'Stremio id from search results' },
          title: { type: 'string', description: 'Display title from search' },
          poster: { type: 'string', description: 'Poster URL from search' },
          tab: { type: 'string', enum: ['movies', 'series', 'live'], description: 'Browse tab from search' },
        },
        required: ['type', 'id', 'title'],
      },
    },
    {
      name: 'mango_now_playing',
      description: 'Report what is currently playing on the TV, if anything. Read-only — does not control playback.',
      layer: 'catalog',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mango_library_shuffle',
      description: 'Instantly re-pick posters on home rails from verified pools (~5 sec).',
      layer: 'catalog',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mango_playability_refresh',
      description: REFRESH_MANIFEST.description,
      layer: 'catalog',
      requires_confirm: true,
      input_schema: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: REFRESH_ENUM,
            description: REFRESH_MANIFEST.parameters.properties.level.description,
          },
          confirmed: {
            type: 'boolean',
            description: 'Must be true for jobs that pause couch browsing.',
          },
        },
        required: ['level'],
      },
    },
    {
      name: 'mango_list_ai_catalogs',
      description: 'List voice-created AI catalog rails (max 3 per movies/series tab). Read-only.',
      layer: 'catalog',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mango_create_ai_catalog',
      description:
        'Create a voice-managed AI catalog rail (verified playability pool + nightly top-up). '
        + 'Movies-only or series-only. When tab already has 3 catalogs, response includes overflow_options - '
        + 'ask the user once: replace a slot, pin specific titles, or merge seeds into an existing AI rail.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short rail label' },
          tab: { type: 'string', enum: ['movies', 'series'] },
          content_type: { type: 'string', enum: ['movie', 'series'] },
          seed_titles: {
            type: 'array',
            description: 'Hand-picked Stremio titles { type, id, title?, poster? }',
          },
          sources: {
            type: 'array',
            description: 'Optional addon catalog sources { addon, catalog, weight? }',
          },
          llm_hints: {
            type: 'object',
            description: 'Theme/prompt, add_ids, remove_ids, topup_suggestions for pool curation',
          },
          overflow_action: {
            type: 'string',
            enum: ['replace', 'pin_titles', 'merge'],
            description: 'Only when tab is full (4th catalog)',
          },
          replace_slot_id: { type: 'string' },
          merge_into_slot_id: { type: 'string' },
          pin_titles: { type: 'array', description: 'Titles to pin when overflow_action=pin_titles' },
        },
        required: ['label', 'tab', 'content_type'],
      },
    },
    {
      name: 'mango_update_ai_catalog',
      description: 'Rename or update an AI catalog - seeds, sources, llm_hints (add/remove/suggest for next top-up).',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          slot_id: { type: 'string' },
          label: { type: 'string' },
          seed_titles: { type: 'array' },
          append_seeds: { type: 'array' },
          remove_seed_ids: { type: 'array', items: { type: 'string' } },
          sources: { type: 'array' },
          llm_hints: { type: 'object' },
        },
        required: ['slot_id'],
      },
    },
    {
      name: 'mango_delete_ai_catalog',
      description: 'Delete a voice-managed AI catalog slot and hide its rail.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          slot_id: { type: 'string' },
        },
        required: ['slot_id'],
      },
    },
    {
      name: 'mango_refresh_ai_catalog',
      description: 'Top up one AI catalog playability pool now (applies llm remove_ids first).',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          slot_id: { type: 'string' },
        },
        required: ['slot_id'],
      },
    },
    {
      name: 'mango_navigate',
      description: 'Navigate the TV launcher (home, back, settings, tab). Does not open titles or start playback.',
      layer: 'launcher',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['home', 'back', 'settings', 'tab'],
          },
          tab: { type: 'string', enum: ['movies', 'series', 'live'] },
        },
        required: ['action'],
      },
    },
  ];

  return { ok: true, tools };
}
