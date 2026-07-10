/** Quick HTTP sniff — TorBox sometimes marks a release cached but serves the .nfo sidecar. */

export type PreflightResult = 'video' | 'nfo' | 'error' | 'timeout';

function preflightRangeEnd(): number {
  const raw = process.env.MANGO_PREFLIGHT_RANGE_END;
  if (raw === undefined || raw === '') return 4095;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 15) return 4095;
  return Math.min(65535, Math.floor(parsed));
}

function looksLikeVideo(buf: Buffer): boolean {
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return true;
  }
  if (buf.length >= 8 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    return true;
  }
  // ftyp may sit after a larger size field in some MP4 layouts — scan first 64 bytes.
  for (let i = 0; i + 8 <= Math.min(buf.length, 64); i += 1) {
    if (buf.slice(i + 4, i + 8).toString('ascii') === 'ftyp') {
      return true;
    }
  }
  if (buf.length >= 1 && buf[0] === 0x47) {
    return true;
  }
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] >= 0xba) {
    return true;
  }
  return false;
}

function looksLikeNfo(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const head = buf.slice(0, Math.min(buf.length, 32)).toString('utf8').toLowerCase();
  return head.startsWith('[') || head.includes('[img]') || head.includes('complete name');
}

export async function preflightPlaybackUrl(url: string, timeoutMs = 8000): Promise<PreflightResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rangeEnd = preflightRangeEnd();
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: `bytes=0-${rangeEnd}` },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await response.arrayBuffer());
    if (contentType.includes('nfo') || contentType.includes('text/')) {
      if (looksLikeNfo(buf)) return 'nfo';
      if (!looksLikeVideo(buf)) return 'nfo';
    }
    if (looksLikeVideo(buf)) return 'video';
    if (looksLikeNfo(buf)) return 'nfo';
    return 'error';
  } catch (error) {
    // Abort / network flakes are transient — proceed to probe, do not bad-cache.
    if (
      (error instanceof Error && error.name === 'AbortError')
      || (typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'AbortError')
    ) {
      return 'timeout';
    }
    return 'timeout';
  } finally {
    clearTimeout(timer);
  }
}
