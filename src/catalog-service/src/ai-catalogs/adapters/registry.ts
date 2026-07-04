import type { CatalogTab } from '../../rails.js';
import { CatalogError } from '../../catalog-errors.js';
import type { SourceAdapter } from './types.js';
import { vodAdapter } from './vod.js';
import { youtubeAdapter } from './youtube.js';

export function getAdapterForTab(tab: CatalogTab): SourceAdapter {
  if (tab === 'movies' || tab === 'series') {
    return vodAdapter;
  }
  if (tab === 'youtube') {
    return youtubeAdapter;
  }
  throw new CatalogError(400, 'ai catalog tab must be movies, series, or youtube');
}
