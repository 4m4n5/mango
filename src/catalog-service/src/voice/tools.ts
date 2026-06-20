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
      description: 'Search verified mango library titles by name. Use before play when the user gives a title, not an id.',
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
      name: 'mango_play',
      description: 'Start playback for a movie or series. Series bare ids resume continue progress or start at S1E1.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['movie', 'series', 'tv'] },
          id: { type: 'string' },
          resume: { type: 'boolean' },
        },
        required: ['type', 'id'],
      },
    },
    {
      name: 'mango_play_continue',
      description: 'Resume the most recent continue-watching title.',
      layer: 'catalog',
      input_schema: {
        type: 'object',
        properties: {
          tab: { type: 'string', enum: ['movies', 'series'] },
        },
      },
    },
    {
      name: 'mango_now_playing',
      description: 'Report what is currently playing on the TV, if anything.',
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
      name: 'mango_navigate',
      description: 'Navigate the TV launcher UI. Does not start playback.',
      layer: 'launcher',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['home', 'back', 'settings', 'tab', 'open_detail'],
          },
          tab: { type: 'string', enum: ['movies', 'series', 'live'] },
          type: { type: 'string' },
          id: { type: 'string' },
          title: { type: 'string' },
          poster: { type: 'string' },
        },
        required: ['action'],
      },
    },
  ];

  return { ok: true, tools };
}
