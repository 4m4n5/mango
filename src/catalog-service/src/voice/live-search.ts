import { searchLiveChannelSeeds } from '../live/ai-catalog-seeds.js';
import type { VoiceSearchHit } from './search.js';

export async function searchLiveChannels(
  query: string,
  limit = 8,
): Promise<VoiceSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const seeds = await searchLiveChannelSeeds(trimmed, limit);
  return seeds.map((seed) => ({
    type: 'tv',
    id: seed.id,
    title: seed.title || seed.id,
    poster: seed.poster,
    tab: 'live',
    score: seed.score ?? 0,
  }));
}
