/** Quick HTTP sniff — TorBox sometimes marks a release cached but serves the .nfo sidecar.
 *  MediaFusion (and some debrid proxies) serve HLS playlists — those are playable by mpv
 *  and must not be treated as unreadable bytes. */

export type PreflightResult =
  | 'video'
  | 'nfo'
  | 'error'
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'http_error';

function preflightRangeEnd(): number {
  const raw = process.env.MANGO_PREFLIGHT_RANGE_END;
  if (raw === undefined || raw === '') return 4095;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 15) return 4095;
  return Math.min(65535, Math.floor(parsed));
}

function looksLikeHls(buf: Buffer): boolean {
  if (buf.length < 7) return false;
  const head = buf.slice(0, Math.min(buf.length, 16)).toString('utf8').trimStart();
  return head.startsWith('#EXTM3U');
}

function contentTypeLooksLikeHls(contentType: string): boolean {
  return (
    contentType.includes('mpegurl')
    || contentType.includes('m3u8')
    || contentType.includes('application/vnd.apple.mpegurl')
  );
}

function looksLikeVideo(buf: Buffer): boolean {
  if (looksLikeHls(buf)) {
    return true;
  }
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
  if (looksLikeHls(buf)) return false;
  const head = buf.slice(0, Math.min(buf.length, 4096)).toString('utf8').toLowerCase();
  return /^\s*\[img\]/i.test(head)
    || /(?:^|\n)general\s*(?:\r?\n|$)[\s\S]{0,512}complete name\s*:/i.test(head)
    || /complete name\s*:\s*\S+[\s\S]{0,512}(?:format|file size|duration)\s*:/i.test(head);
}

/** Retain at most maxBytes even when a server ignores Range and returns 200. */
export async function readResponsePrefix(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body || maxBytes <= 0) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let done = false;
  try {
    while (total < maxBytes) {
      const next = await reader.read();
      done = next.done;
      if (next.done || !next.value) break;
      const remaining = maxBytes - total;
      const chunk = Buffer.from(next.value.subarray(0, remaining));
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
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
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      return 'rate_limited';
    }
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      return 'server_error';
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return 'http_error';
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const buf = await readResponsePrefix(response, rangeEnd + 1);
    if (contentTypeLooksLikeHls(contentType) || looksLikeHls(buf)) {
      return 'video';
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
