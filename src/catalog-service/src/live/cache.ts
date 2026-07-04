import type { CatalogCore } from '../core.js';

export function invalidateLiveTabRailCache(core: CatalogCore): void {
  core.invalidateLiveTabRailCache();
}
