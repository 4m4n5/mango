import type { Meta } from './core.js';
import type { CinemetaVideo } from './episodes.js';

export type VideoLayer = {
  source: string;
  videos: CinemetaVideo[];
};

export function parseReleasedMs(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCinemetaSource(source: string): boolean {
  return source.toLowerCase().includes('cinemeta');
}

/** Union episode rows by Stremio id — prefer newer released; tie-break Cinemeta. */
export function mergeVideosByEpisodeId(layers: VideoLayer[]): CinemetaVideo[] {
  const byId = new Map<string, { video: CinemetaVideo; source: string; releasedMs: number }>();

  for (const layer of layers) {
    for (const video of layer.videos) {
      const id = typeof video.id === 'string' ? video.id.trim() : '';
      if (!id) {
        continue;
      }
      const releasedMs = parseReleasedMs(video.released);
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { video, source: layer.source, releasedMs });
        continue;
      }
      const newer = releasedMs > existing.releasedMs;
      const tieCinemeta = releasedMs === existing.releasedMs
        && isCinemetaSource(layer.source)
        && !isCinemetaSource(existing.source);
      if (newer || tieCinemeta) {
        byId.set(id, { video, source: layer.source, releasedMs });
      }
    }
  }

  return [...byId.values()]
    .sort((left, right) => {
      const leftSeason = Number(left.video.season ?? 0);
      const rightSeason = Number(right.video.season ?? 0);
      if (leftSeason !== rightSeason) {
        return leftSeason - rightSeason;
      }
      return Number(left.video.episode ?? 0) - Number(right.video.episode ?? 0);
    })
    .map((row) => row.video);
}

/** Merge addon meta without clobbering videos[] — union episodes across layers. */
export function mergeCatalogMetaPieces(
  base: Meta | null,
  piece: Meta,
  addonName: string,
  videoLayers: VideoLayer[],
): Meta {
  const pieceVideos = Array.isArray(piece.videos) ? piece.videos as CinemetaVideo[] : [];
  if (pieceVideos.length > 0) {
    videoLayers.push({ source: addonName, videos: pieceVideos });
  }

  const pieceFields = { ...piece };
  delete pieceFields.videos;

  if (!base) {
    const merged = Object.assign({}, pieceFields, { source: addonName }) as Meta;
    if (videoLayers.length > 0) {
      merged.videos = mergeVideosByEpisodeId(videoLayers);
    }
    return merged;
  }

  const baseFields = { ...base };
  delete baseFields.videos;
  const merged = Object.assign({}, baseFields, pieceFields, {
    source: base.source || addonName,
  }) as Meta;
  if (videoLayers.length > 0) {
    merged.videos = mergeVideosByEpisodeId(videoLayers);
  } else if (Array.isArray(base.videos) && base.videos.length > 0) {
    merged.videos = base.videos;
  }
  return merged;
}
