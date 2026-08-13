/** Highest adaptive DASH up to 4K. Muxed progressive is not in this selector. */
export const YOUTUBE_ADAPTIVE_FORMAT = 'bv*[height<=2160]+ba';
/** H.264+AAC DASH when mpv rejects VP9/AV1 split streams. */
export const YOUTUBE_COMPAT_ADAPTIVE_FORMAT =
  'bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]';
/** Last resort. YouTube muxed progressive is typically 360p (itag 18). */
export const YOUTUBE_MUXED_FORMAT = 'b';
export const YOUTUBE_FORMAT_SORT =
  'res:2160,fps,hdr:12,vcodec:vp9.2:vp9:av01:h264,acodec:opus:mp4a';
/** Clients that still expose googlevideo DASH URLs to `yt-dlp -g`. `tv` first. */
export const YOUTUBE_EXTRACTOR_ARGS = 'youtube:player_client=tv,android,ios';

const LEGACY_YOUTUBE_FORMATS = new Set([
  'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
  'best[height<=1080]/best',
  'bv*[height<=1080]+ba/b[height<=1080]/b',
  'best*[height<=1080]/best*',
  'best',
]);

const MUXED_ONLY_FORMAT = /^(best\*?|b)(\[[^\]]*\])?$/i;

export function isMuxedOnlyYoutubeFormat(format: string): boolean {
  return MUXED_ONLY_FORMAT.test(format.trim());
}

/**
 * Drop slash-ored muxed fallbacks. `bestvideo+bestaudio/best` succeeds at 360p
 * as soon as DASH is missing from the default client, so muxed must never live
 * in the same `-f` string as adaptive.
 */
export function preferAdaptiveYoutubeFormat(format: string): string {
  return format
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && !isMuxedOnlyYoutubeFormat(part))
    .join('/');
}

export function effectiveYoutubeFormat(configured: string): string {
  const trimmed = configured.trim();
  if (!trimmed || LEGACY_YOUTUBE_FORMATS.has(trimmed)) {
    return YOUTUBE_ADAPTIVE_FORMAT;
  }
  return preferAdaptiveYoutubeFormat(trimmed) || YOUTUBE_ADAPTIVE_FORMAT;
}

function allowCompatAdaptive(preferred: string): boolean {
  return preferred === YOUTUBE_ADAPTIVE_FORMAT
    || /height\s*<=\s*(1080|1440|2160)/i.test(preferred);
}

export function ytDlpFormatCandidates(configured: string, excludedFormats: string[] = []): string[] {
  const excluded = new Set(excludedFormats.map((format) => format.trim()).filter(Boolean));
  const trimmed = configured.trim();
  const legacy = !trimmed || LEGACY_YOUTUBE_FORMATS.has(trimmed);
  const preferred = effectiveYoutubeFormat(trimmed);
  const formats = legacy
    ? [YOUTUBE_ADAPTIVE_FORMAT, YOUTUBE_COMPAT_ADAPTIVE_FORMAT, YOUTUBE_MUXED_FORMAT]
    : allowCompatAdaptive(preferred)
      ? [preferred, YOUTUBE_COMPAT_ADAPTIVE_FORMAT, YOUTUBE_MUXED_FORMAT]
      : [preferred, YOUTUBE_MUXED_FORMAT];
  return formats
    .map((format) => format.trim())
    .filter(Boolean)
    .filter((format, index, list) => list.indexOf(format) === index)
    .filter((format) => !excluded.has(format));
}
