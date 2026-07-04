import type { CatalogTab } from '../../rails.js';
import type { CatalogCore } from '../../core.js';
import type { TopUpRailOptions, TopUpRailResult } from '../../playability/top-up.js';
import type { ComposeDeps, ComposeInput, ComposePlan } from '../compose.js';

/**
 * Tab-agnostic seam between the ai-catalog engine (service/bootstrap) and the
 * content-specific pipeline that composes plans and tops up rail pools.
 * `VodAdapter` is today's only implementation (movies/series, thin passthrough).
 */
export interface SourceAdapter {
  readonly id: string;
  resolvePlan(input: ComposeInput, deps: ComposeDeps): Promise<ComposePlan>;
  topUp(core: CatalogCore, railId: string, options?: TopUpRailOptions): Promise<TopUpRailResult>;
  maxCapacity(tab: CatalogTab): number;
}
