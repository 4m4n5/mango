import { PlayTimeoutError } from './catalog-errors';
import type { SeriesEpisodesResponse } from './catalog';

function episodeRow(response: SeriesEpisodesResponse, episodeId: string) {
  for (const season of response.seasons) {
    const row = season.episodes.find((episode) => episode.id === episodeId);
    if (row) return row;
  }
  return null;
}

/**
 * A frozen launcher can lose the successful /play response to its expired
 * timer. Suppress the timeout only when the server had already finished that
 * exact request and the episode received a fresh verified write after this
 * attempt began. A stale prior verified row is not sufficient proof.
 */
export async function reconcileEpisodePlayTimeout(
  error: unknown,
  episodeId: string,
  attemptStartedAt: number,
  loadEpisodes: () => Promise<SeriesEpisodesResponse>,
): Promise<boolean> {
  if (!(error instanceof PlayTimeoutError) || !error.requestAlreadyFinished) {
    return false;
  }
  try {
    const row = episodeRow(await loadEpisodes(), episodeId);
    return row?.playable === true
      && row.playability_status === 'verified'
      && typeof row.playability_updated_at === 'number'
      && row.playability_updated_at >= attemptStartedAt;
  } catch {
    return false;
  }
}
