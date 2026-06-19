import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDisplayLabel,
  parseFormatterDescription,
} from './stream-formatter.js';
import type { Stream } from './core.js';

const shawshankSm737 = `📁 The Shawshank Redemption (1994)
🎥 BluRay 🎞️ HEVC 🏷️ SM737
📺 HDR10 • DV 🎧 DD+ • DD 🔊 5.1 • 2.0
📦 8.98 GB ⏱️ 2h:22m:32s 🔍 ThePirateBay
🌐 🇬🇧📝 🇬🇧 / 🇸🇦`;

const shawshankLama = `📁 The Shawshank Redemption (1994)
🎥 BluRay 🎞️ AVC 🏷️ LAMA
📦 3.02 GB 🔍 TorrentGalaxy
🌐 🇬🇧 / 🇮🇳`;

function stream(overrides: Partial<Stream>): Stream {
  return {
    url: 'https://example.test/video.mp4',
    source: 'AIOStreams',
    name: '[TB⚡] Torrentio 1080p',
    ...overrides,
  };
}

test('parseFormatterDescription extracts lightgdrive fields', () => {
  const parsed = parseFormatterDescription(shawshankSm737);
  assert.equal(parsed.release_tier, 'BluRay');
  assert.equal(parsed.encode, 'HEVC');
  assert.equal(parsed.release_group, 'SM737');
  assert.equal(parsed.size_gb, 8.98);
  assert.equal(parsed.indexer, 'ThePirateBay');
  assert.deepEqual(parsed.hdr_tags, ['HDR10', 'DV']);
  assert.deepEqual(parsed.languages, ['English', 'Arabic']);
});

test('buildDisplayLabel creates 10-foot label from parsed fields', () => {
  const parsed = parseFormatterDescription(`1080p\n${shawshankSm737}`);
  assert.equal(
    buildDisplayLabel(parsed, stream({ description: shawshankSm737 })),
    '1080p BluRay HEVC · SM737 · 9 GB',
  );
});

test('parseFormatterDescription falls back to haystack-only streams', () => {
  const parsed = parseFormatterDescription('Some.Movie.2024.1080p.WEB-DL.x265-GROUP 1.44 GB English');
  assert.equal(parsed.resolution, '1080p');
  assert.equal(parsed.release_tier, 'WEB-DL');
  assert.equal(parsed.encode, 'HEVC');
  assert.equal(parsed.release_group, 'GROUP');
  assert.equal(parsed.size_gb, 1.44);
  assert.deepEqual(parsed.languages, ['English']);
});

test('subtitle lines do not add audio languages', () => {
  const parsed = parseFormatterDescription(`🎥 BluRay 🏷️ SM737
🌐 🇬🇧
Subtitles: Hindi, Tamil`);
  assert.deepEqual(parsed.languages, ['English']);
});

test('flag line maps Hindi and distinct release groups produce distinct labels', () => {
  const first = parseFormatterDescription(`1080p\n${shawshankSm737}`);
  const second = parseFormatterDescription(`1080p\n${shawshankLama}`);
  assert.deepEqual(second.languages, ['English', 'Hindi']);
  assert.notEqual(
    buildDisplayLabel(first, stream({ description: shawshankSm737 })),
    buildDisplayLabel(second, stream({ description: shawshankLama })),
  );
});

