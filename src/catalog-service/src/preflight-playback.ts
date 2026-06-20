/** Quick HTTP sniff — TorBox sometimes marks a release cached but serves the .nfo sidecar. */

export type PreflightResult = 'video' | 'nfo' | 'error';

function looksLikeVideo(buf: Buffer): boolean {
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return true;
  }
  if (buf.length >= 8 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    return true;
  }
  return false;
}

function looksLikeNfo(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const head = buf.slice(0, Math.min(buf.length, 32)).toString('utf8').toLowerCase();
  return head.startsWith('[') || head.includes('[img]') || head.includes('complete name');
}

export async function preflightPlaybackUrl(url: string, timeoutMs = 3000): Promise<PreflightResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-15' },
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
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}
