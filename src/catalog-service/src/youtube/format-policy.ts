/** HLS split A/V up to 4K, then muxed HLS at the same cap. Progressive https is never a candidate. */
export const YOUTUBE_ADAPTIVE_FORMAT =
  'bv*[height<=2160][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=2160][protocol^=m3u8]';
/** Operator helper for a 1440 HLS cap. Not an automatic play ladder. */
export const YOUTUBE_MID_ADAPTIVE_FORMAT =
  'bv*[height<=1440][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=1440][protocol^=m3u8]';
/** Operator helper for a 1080 HLS cap. Not an automatic play ladder. */
export const YOUTUBE_COMPAT_ADAPTIVE_FORMAT =
  'bv*[height<=1080][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=1080][protocol^=m3u8]';
// Pi 5 has HEVC HW only. YouTube HLS from web_safari is H.264+AAC, typically
// 1080p muxed. Keep VP9-first sort for the rare split-HLS title.
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
 * is kept: it is the working web_safari transport.
 */
export function preferAdaptiveYoutubeFormat(format: string): string {
  return format
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && !isMuxedOnlyYoutubeFormat(part))
    .join('/');
}

function ensureHlsProtocol(part: string): string {
  const trimmed = part.trim();
  if (!trimmed || isHlsYoutubeFormat(trimmed)) {
    return trimmed;
  }
  return trimmed
    .split('+')
    .map((arm) => {
      const value = arm.trim();
      if (!value || isHlsYoutubeFormat(value)) {
        return value;
      }
      return `${value}[protocol^=m3u8]`;
    })
    .filter(Boolean)
    .join('+');
}

function heightCap(format: string): string | null {
  const match = format.match(/height\s*<=\s*(\d+)/i);
  return match?.[1] ?? null;
}

function muxedHlsFallback(format: string): string {
  const cap = heightCap(format);
  return cap ? `b[height<=${cap}][protocol^=m3u8]` : 'b[protocol^=m3u8]';
}

export function effectiveYoutubeFormat(configured: string): string {
  const trimmed = configured.trim();
  if (!trimmed || LEGACY_YOUTUBE_FORMATS.has(trimmed)) {
    return YOUTUBE_ADAPTIVE_FORMAT;
  }
  const adaptive = preferAdaptiveYoutubeFormat(trimmed);
  const primary = ensureHlsProtocol(adaptive || YOUTUBE_ADAPTIVE_FORMAT.split('/')[0] || '');
  if (!primary) {
    return YOUTUBE_ADAPTIVE_FORMAT;
  }
  const muxed = muxedHlsFallback(primary);
  const arms = primary.split('/').map((part) => part.trim()).filter(Boolean);
  if (arms.includes(muxed) || !primary.includes('+')) {
    return primary;
  }
  return `${primary}/${muxed}`;
}

/**
 * One HLS selector (split A/V, then muxed HLS). SABR-truncated https/DASH is
 * never a candidate: a 60-second death is worse than a clean couch error.
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
