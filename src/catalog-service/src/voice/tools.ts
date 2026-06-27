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
      description:
        'Search verified mango library by normalized title or keywords. Do NOT pass the user\'s full vague question (e.g. "good hindi movies") — use title names or extracted keywords after clarifying discover intent.',
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
      name: 'mango_youtube_search',
      description:
        'Search YouTube videos/channels/playlists through Mango. Use for YouTube discovery only. Return options or open a result; never starts playback.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'YouTube search query' },
          limit: { type: 'integer', description: 'Max results per group (default 5)' },
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
      name: 'mango_read_profile',
      description: 'Read the companion taste profile — loves, avoids, title favorites, familiarity stage, and stored facts.',
      layer: 'catalog',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mango_patch_profile',
      description: 'Patch companion profile fields (append facts/loves/avoids, update familiarity). Never full-replace the profile.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          append_facts: { type: 'array', items: { type: 'string' } },
          append_loves: { type: 'array', items: { type: 'string' } },
          append_avoids: { type: 'array', items: { type: 'string' } },
          familiarity: { type: 'object' },
        },
      },
    },
    {
      name: 'mango_companion_summary',
      description: 'Human-readable summary of what mango knows about the user — for "what do you know about me?" questions.',
      layer: 'catalog',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mango_append_session_notes',
      description: 'Append up to 5 concise session bullets to companion memory after a useful chat.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          bullets: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        },
        required: ['bullets'],
      },
    },
    {
      name: 'mango_open_title',
      description:
        'Open a title on the TV detail page (works from home, detail, or settings — replaces the current title in place). Use only when intent is clear: explicit open/kholo, unambiguous single search match, or ordinal/follow-up after listing options. Never starts playback; user presses B to play.',
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
      name: 'mango_open_youtube',
      description:
        'Open a YouTube video, channel, or playlist result on the TV detail page. Videos can be played with pad B; channels/playlists open a list of videos. Never starts playback.',
      layer: 'launcher',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['youtube_video', 'youtube_channel', 'youtube_playlist'] },
          id: { type: 'string', description: 'YouTube video/channel/playlist id from mango_youtube_search' },
          title: { type: 'string', description: 'Display title from YouTube search' },
          poster: { type: 'string', description: 'Thumbnail URL from YouTube search' },
          source: { type: 'string', enum: ['youtube'] },
          tab: { type: 'string', enum: ['youtube'] },
        },
        required: ['type', 'id', 'title'],
      },
    },
    {
      name: 'mango_save_title',
      description:
        'Save a Mango title to the user Saved rail. Use current=true for "save this" when a title is open on TV, or pass exact type/id/title from search results. Exact title text may be used only when it resolves to one verified Mango library title. Never starts playback.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          current: { type: 'boolean', description: 'Save the current title open on the TV detail page' },
          type: { type: 'string', enum: ['movie', 'series', 'tv', 'youtube_video'] },
          id: { type: 'string', description: 'Stremio/Mango id from search results' },
          title: { type: 'string', description: 'Exact title from search results or exact Mango library title' },
          poster: { type: 'string', description: 'Poster URL from search results' },
          source: { type: 'string', enum: ['mango', 'youtube'] },
          tab: { type: 'string', enum: ['movies', 'series', 'live', 'youtube'] },
        },
      },
    },
    {
      name: 'mango_unsave_title',
      description:
        'Remove a Mango title from the user Saved rail. Use current=true for "unsave this" when a title is open on TV, or pass exact type/id/title. Never hides titles and never starts/stops playback.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          current: { type: 'boolean', description: 'Unsave the current title open on the TV detail page' },
          type: { type: 'string', enum: ['movie', 'series', 'tv', 'youtube_video'] },
          id: { type: 'string', description: 'Stremio/Mango id from search results' },
          title: { type: 'string', description: 'Exact title from search results or exact Mango library title' },
          source: { type: 'string', enum: ['mango', 'youtube'] },
          tab: { type: 'string', enum: ['movies', 'series', 'live', 'youtube'] },
        },
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
      input_schema: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: REFRESH_ENUM,
            description: REFRESH_MANIFEST.parameters.properties.level.description,
          },
          mode: REFRESH_MANIFEST.parameters.properties.mode,
          preset: REFRESH_MANIFEST.parameters.properties.preset,
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
        'Create a voice-managed AI catalog rail. Server composes mdblist sources + thematic seeds from theme. '
        + 'Returns bootstrap job — poll mango_ai_catalog_status until visible_on_tab before claiming TV visibility. '
        + 'When tab already has 3 catalogs, response includes overflow_options.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short rail label' },
          tab: { type: 'string', enum: ['movies', 'series'] },
          content_type: { type: 'string', enum: ['movie', 'series'] },
          theme: { type: 'string', description: 'Thematic intent e.g. horror movies, hindi comedy' },
          llm_hints: {
            type: 'object',
            description: 'Optional theme/prompt override',
          },
          overflow_action: {
            type: 'string',
            enum: ['replace', 'merge'],
            description: 'Only when tab is full (4th catalog). Never saves titles to the user Saved rail.',
          },
          replace_slot_id: { type: 'string' },
          merge_into_slot_id: { type: 'string' },
        },
        required: ['label', 'tab', 'content_type'],
      },
    },
    {
      name: 'mango_ai_catalog_status',
      description: 'Poll AI catalog bootstrap status — visible_on_tab, verified_pool, displayed count.',
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
