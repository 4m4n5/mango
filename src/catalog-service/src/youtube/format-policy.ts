/** Product-wide YouTube ceiling. This is a hard cap, not a preference. */
export const YOUTUBE_MAX_HEIGHT = 1080;

function cappedYoutubeHeight(height: string): string {
  const parsed = Number.parseInt(height, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return String(YOUTUBE_MAX_HEIGHT);
  }
  return String(Math.min(parsed, YOUTUBE_MAX_HEIGHT));
}

export function youtubeAdaptiveSelector(height: string): string {
  const cap = `[height<=${cappedYoutubeHeight(height)}]`;
  return `bv*${cap}[protocol=https]+ba[protocol=https]/bv*${cap}[protocol^=m3u8]+ba[protocol^=m3u8]/b${cap}[protocol^=m3u8]`;
}

export function youtubeLiveSelector(height: string): string {
  const cap = `[height<=${cappedYoutubeHeight(height)}]`;
  return `bv*${cap}[protocol^=m3u8]+ba[protocol^=m3u8]/b${cap}[protocol^=m3u8]`;
}

/**
 * Seekable HTTPS DASH first for VOD, then split/muxed HLS compatibility.
 * Starting fresh on HLS is not enough: later VOD seeks must deliver video.
 */
export const YOUTUBE_ADAPTIVE_FORMAT = youtubeAdaptiveSelector(String(YOUTUBE_MAX_HEIGHT));
/** Live playback stays on HLS; DASH-first is a seekable VOD policy only. */
export const YOUTUBE_LIVE_FORMAT = youtubeLiveSelector(String(YOUTUBE_MAX_HEIGHT));
/** Compatibility aliases retained for callers; both obey the hard 1080p ceiling. */
export const YOUTUBE_MID_ADAPTIVE_FORMAT = YOUTUBE_ADAPTIVE_FORMAT;
export const YOUTUBE_COMPAT_ADAPTIVE_FORMAT = YOUTUBE_ADAPTIVE_FORMAT;
// Pi 5 does not hardware-decode YouTube AV1 on this path. Keep VP9 ahead of
// AV1 while allowing yt-dlp—not Mango—to maintain the viable player clients.
export const YOUTUBE_FORMAT_SORT =
  `res:${YOUTUBE_MAX_HEIGHT},fps,vcodec:vp9:vp9.2:av01:h264,acodec:opus:mp4a`;

const LEGACY_YOUTUBE_FORMATS = new Set([
  'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
  'best[height<=1080]/best',
  'bv*[height<=1080]+ba/b[height<=1080]/b',
  'best*[height<=1080]/best*',
  'best',
  'bv*[height<=2160]+ba',
  'bv*[height<=1440]+ba',
  'bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]',
]);

const MUXED_ONLY_FORMAT = /^(best\*?|b)(\[[^\]]*\])?$/i;
const HLS_PROTOCOL = /protocol\s*\^=\s*m3u8/i;

export function isHlsYoutubeFormat(format: string): boolean {
  return HLS_PROTOCOL.test(format);
}

export function isMuxedOnlyYoutubeFormat(format: string): boolean {
  const trimmed = format.trim();
  if (isHlsYoutubeFormat(trimmed)) {
    return false;
  }
  return MUXED_ONLY_FORMAT.test(trimmed);
}

/**
 * Drop slash-ored muxed progressive fallbacks. `bestvideo+bestaudio/best`
 * succeeds at 360p as soon as DASH is missing. Muxed HLS remains the final
 * live/compatibility fallback.
 */
export function preferAdaptiveYoutubeFormat(format: string): string {
  return format
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && !isMuxedOnlyYoutubeFormat(part))
    .join('/');
}

function heightCap(format: string): string | null {
  const match = format.match(/height\s*<=\s*(\d+)/i);
  return match?.[1] ?? null;
}

export function effectiveYoutubeFormat(configured: string, live = false): string {
  const trimmed = configured.trim();
  const cap = heightCap(trimmed) || String(YOUTUBE_MAX_HEIGHT);
  if (live) {
    return youtubeLiveSelector(cap);
  }
  if (!trimmed || LEGACY_YOUTUBE_FORMATS.has(trimmed)) {
    return YOUTUBE_ADAPTIVE_FORMAT;
  }
  const adaptive = preferAdaptiveYoutubeFormat(trimmed);
  if (!adaptive) {
    return YOUTUBE_ADAPTIVE_FORMAT;
  }
  // Rebuild the selector from the operator's requested height so no custom or
  // stale config can bypass the product-wide 1080p ceiling. Lower caps remain
  // valid; progressive muxed formats remain excluded.
  return youtubeAdaptiveSelector(cap);
}

/**
 * VOD uses seekable HTTPS DASH first; live uses HLS only. The caller must
 * classify live status before choosing. Bare muxed progressive (`best` /
 * itag 18) is never a candidate.
 */
export function ytDlpFormatCandidates(
  configured: string,
  excludedFormats: string[] = [],
  options: { live?: boolean } = {},
): string[] {
  const excluded = new Set(excludedFormats.map((format) => format.trim()).filter(Boolean));
  const preferred = effectiveYoutubeFormat(configured, options.live === true);
  return [preferred]
    .map((format) => format.trim())
    .filter(Boolean)
    .filter((format, index, list) => list.indexOf(format) === index)
    .filter((format) => !excluded.has(format) && !isMuxedOnlyYoutubeFormat(format));
}
