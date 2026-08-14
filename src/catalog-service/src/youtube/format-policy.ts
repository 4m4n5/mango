/** Highest adaptive DASH up to 4K. Muxed progressive is never in this selector. */
export const YOUTUBE_ADAPTIVE_FORMAT = 'bv*[height<=2160]+ba';
/** If 4K VP9 fails in mpv, try 1440p before dropping to 1080p H.264. */
export const YOUTUBE_MID_ADAPTIVE_FORMAT = 'bv*[height<=1440]+ba';
/** H.264+AAC DASH after higher DASH is rejected. Still not muxed. */
export const YOUTUBE_COMPAT_ADAPTIVE_FORMAT =
  'bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]';
// Pi 5 has HEVC HW only. YouTube 4K is VP9/AV1 software. Prefer 4K SDR VP9
// (itag 315) over 4K HDR VP9.2 (337): hdr:12 + vp9.2-first made mpv fail the
// HDR stream and the only retry was 1080p H.264.
export const YOUTUBE_FORMAT_SORT =
  'res:2160,fps,vcodec:vp9:vp9.2:av01:h264,acodec:opus:mp4a';

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
 * as soon as DASH is missing, so muxed must never share a `-f` string with DASH.
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

function allowMidAdaptive(preferred: string): boolean {
  return preferred === YOUTUBE_ADAPTIVE_FORMAT
    || /height\s*<=\s*2160/i.test(preferred);
}

function allowCompatAdaptive(preferred: string): boolean {
  return preferred === YOUTUBE_ADAPTIVE_FORMAT
    || /height\s*<=\s*(1080|1440|2160)/i.test(preferred);
}

/**
 * Adaptive DASH first, then 1440 if the 4K selector was rejected, then
 * H.264 1080p DASH. Muxed progressive (itag 18 / 360p) is never a candidate:
 * it made 360p look like a successful play when DASH was missing.
 */
export function ytDlpFormatCandidates(configured: string, excludedFormats: string[] = []): string[] {
  const excluded = new Set(excludedFormats.map((format) => format.trim()).filter(Boolean));
  const preferred = effectiveYoutubeFormat(configured);
  const formats = [preferred];
  if (allowMidAdaptive(preferred)) {
    formats.push(YOUTUBE_MID_ADAPTIVE_FORMAT);
  }
  if (allowCompatAdaptive(preferred)) {
    formats.push(YOUTUBE_COMPAT_ADAPTIVE_FORMAT);
  }
  return formats
    .map((format) => format.trim())
    .filter(Boolean)
    .filter((format, index, list) => list.indexOf(format) === index)
    .filter((format) => !excluded.has(format) && !isMuxedOnlyYoutubeFormat(format));
}
