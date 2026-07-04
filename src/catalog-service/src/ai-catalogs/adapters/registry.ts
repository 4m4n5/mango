import type { CatalogTab } from '../../rails.js';
import { CatalogError } from '../../catalog-errors.js';
import type { SourceAdapter } from './types.js';
import { vodAdapter } from './vod.js';

export function getAdapterForTab(tab: CatalogTab): SourceAdapter {
  if (tab === 'movies' || tab === 'series') {
    return vodAdapter;
  }
  throw new CatalogError(400, 'ai catalog tab must be movies or series');
}
