import { parseSeriesEpisodeId } from './bonus-stream-resolve.js';
import type { PlaybackHudContext } from './mpv.js';

export function buildPlaybackHudContext(input: {
  type?: string;
  title?: string;
  contentId?: string;
  episodeTitle?: string;
}): PlaybackHudContext {
  if (input.type === 'tv') return { title: input.title, kind: 'tv' };
  if (input.type === 'series') {
    const episode = input.contentId ? parseSeriesEpisodeId(input.contentId) : null;
    const episodeLabel = episode ? `S${episode.season} E${episode.episode}` : '';
    return {
      title: input.title,
      context: [episodeLabel, input.episodeTitle].filter(Boolean).join(' · '),
      kind: 'series',
    };
  }
  return {
    title: input.title,
    kind: input.type === 'movie' ? 'movie' : 'unknown',
  };
}
