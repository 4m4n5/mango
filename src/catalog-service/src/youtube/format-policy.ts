export function youtubeAdaptiveSelector(height: string): string {
  const cap = `[height<=${height}]`;
  return `bv*${cap}[protocol^=m3u8]+ba[protocol^=m3u8]/bv*${cap}+ba/b${cap}[protocol^=m3u8]`;
}

/** HLS first when YouTube still offers it, then https DASH, then muxed HLS. */
export const YOUTUBE_ADAPTIVE_FORMAT = youtubeAdaptiveSelector('2160');
/** Operator helper for a 1440 cap. Not an automatic play ladder. */
export const YOUTUBE_MID_ADAPTIVE_FORMAT = youtubeAdaptiveSelector('1440');
/** Operator helper for a 1080 cap. Not an automatic play ladder. */
export const YOUTUBE_COMPAT_ADAPTIVE_FORMAT = youtubeAdaptiveSelector('1080');
// Pi 5 has HEVC HW only. YouTube HLS from web_safari is H.264+AAC when it
// still exists; tv_simply https DASH is H.264/VP9 + AAC/Opus. Keep VP9-first sort.
export const YOUTUBE_FORMAT_SORT =
  'res:2160,fps,vcodec:vp9:vp9.2:av01:h264,acodec:opus:mp4a';

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
 * succeeds at 360p as soon as DASH is missing. HLS muxed (`b[protocol^=m3u8]`)
 * is kept when YouTube still offers it.
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

export function effectiveYoutubeFormat(configured: string): string {
  const trimmed = configured.trim();
  if (!trimmed || LEGACY_YOUTUBE_FORMATS.has(trimmed)) {
    return YOUTUBE_ADAPTIVE_FORMAT;
  }
  const adaptive = preferAdaptiveYoutubeFormat(trimmed);
  if (!adaptive) {
    return YOUTUBE_ADAPTIVE_FORMAT;
  }
  if (adaptive.includes('/bv*') && isHlsYoutubeFormat(adaptive)) {
    return adaptive;
  }
  return youtubeAdaptiveSelector(heightCap(adaptive) || '2160');
}

/**
 * One selector: HLS split, then https DASH split, then muxed HLS.
 * web_safari HLS is preferred when present; tv_simply https DASH is the
 * living transport after safari m3u8 disappeared and mweb GVS 403s. Bare
 * muxed progressive (`best` / itag 18) is still never a candidate.
 */
export function ytDlpFormatCandidates(configured: string, excludedFormats: string[] = []): string[] {
  const excluded = new Set(excludedFormats.map((format) => format.trim()).filter(Boolean));
  const preferred = effectiveYoutubeFormat(configured);
  return [preferred]
    .map((format) => format.trim())
    .filter(Boolean)
    .filter((format, index, list) => list.indexOf(format) === index)
    .filter((format) => !excluded.has(format) && !isMuxedOnlyYoutubeFormat(format));
}
