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
