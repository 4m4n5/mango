import { topUpRail } from '../../playability/top-up.js';
import { resolveAiCatalogPlan } from '../compose.js';
import { MAX_AI_SLOTS_PER_TAB } from '../types.js';
import type { SourceAdapter } from './types.js';

/** Thin passthrough to the existing movies/series ai-catalog pipeline — no new logic. */
export const vodAdapter: SourceAdapter = {
  id: 'vod',
  resolvePlan: resolveAiCatalogPlan,
  topUp: topUpRail,
  maxCapacity: () => MAX_AI_SLOTS_PER_TAB,
};
