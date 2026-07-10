import assert from 'node:assert/strict';
import test from 'node:test';
import { preflightPlaybackUrl } from './preflight-playback.js';

test('preflightPlaybackUrl accepts matroska magic bytes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]), {
    status: 206,
    headers: { 'content-type': 'application/octet-stream' },
  });
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/movie.mkv'), 'video');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl accepts mp4 ftyp magic bytes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]), {
    status: 206,
    headers: { 'content-type': 'application/octet-stream' },
  });
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/movie.mp4'), 'video');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl accepts mpeg-ts sync byte', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from([0x47, 0x40, 0x00, 0x10]), {
    status: 206,
    headers: { 'content-type': 'application/octet-stream' },
  });
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/stream.ts'), 'video');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl accepts mpeg-ps pack header', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from([0x00, 0x00, 0x01, 0xba, 0x44]), {
    status: 206,
    headers: { 'content-type': 'application/octet-stream' },
  });
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/stream.mpg'), 'video');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl rejects nfo sidecar text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[img]http://lookpic.com/x.jpg[/img]\nGeneral', {
    status: 206,
    headers: { 'content-type': 'text/x-nfo' },
  });
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/release.nfo'), 'nfo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl returns timeout on abort', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const signal = init?.signal;
    return await new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/slow.mp4', 20), 'timeout');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl accepts ftyp magic beyond the first 16 bytes', async () => {
  const originalFetch = globalThis.fetch;
  // 20-byte pad then a standard ftyp box header at offset 20.
  const buf = Buffer.alloc(40, 0);
  buf.writeUInt32BE(24, 20);
  buf.write('ftyp', 24);
  buf.write('isom', 28);
  globalThis.fetch = async (_url, init) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range
      || (init?.headers as Headers | undefined)?.get?.('Range');
    assert.match(String(range), /bytes=0-4095/);
    return new Response(buf, {
      status: 206,
      headers: { 'content-type': 'application/octet-stream' },
    });
  };
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/offset-ftyp.mp4'), 'video');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl accepts HLS playlists (MediaFusion mpegurl)', async () => {
  const originalFetch = globalThis.fetch;
  const playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg0.ts\n';
  globalThis.fetch = async () => new Response(playlist, {
    status: 200,
    headers: { 'content-type': 'application/vnd.apple.mpegurl; charset=utf-8' },
  });
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/manifest.m3u8'), 'video');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preflightPlaybackUrl accepts HLS body even when content-type is octet-stream', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nindex.m3u8\n', {
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
  });
  try {
    assert.equal(await preflightPlaybackUrl('https://example.test/master.m3u8'), 'video');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
