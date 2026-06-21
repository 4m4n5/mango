import type { CatalogSourceRef, CatalogTab, RailPlayabilityConfig } from '../rails.js';

export const MAX_AI_SLOTS_PER_TAB = 3;
export const AI_CATALOG_RAIL_PREFIX = 'ai-';

export type AiSeedTitle = {
  type: string;
  id: string;
  title?: string;
  poster?: string;
  score?: number;
};

export type AiCatalogLlmHints = {
  prompt?: string;
  theme?: string;
  /** Title ids the LLM wants removed from pool on next top-up. */
  remove_ids?: string[];
  /** Title ids to prioritize on next top-up ingest. */
  add_ids?: string[];
  /** Natural-language suggestions for the next nightly top-up (orchestrator reads). */
  topup_suggestions?: string[];
  updated_at?: string;
};

export type AiCatalogSlotFile = {
  version: number;
  slot_id: string;
  tab: CatalogTab;
  label: string;
  content_type: 'movie' | 'series';
  enabled: boolean;
  created_at?: string;
  sources?: CatalogSourceRef[];
  seed_titles?: AiSeedTitle[];
  llm_hints?: AiCatalogLlmHints;
  playability?: Partial<RailPlayabilityConfig>;
};

export type AiCatalogRail = {
  type: 'ai_catalog';
  id: string;
  label: string;
  tab: CatalogTab;
  content_type: string;
  limit: number;
  playability: RailPlayabilityConfig;
  enabled: true;
  sources: CatalogSourceRef[];
  seed_titles: AiSeedTitle[];
  llm_hints: AiCatalogLlmHints;
};

export type AiCatalogOverflowOptions = {
  tab: CatalogTab;
  replaceable_slots: Array<{ slot_id: string; label: string }>;
  pin_merge_candidates: AiSeedTitle[];
  merge_target_slots: Array<{ slot_id: string; label: string }>;
};
