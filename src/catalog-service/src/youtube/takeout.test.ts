import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetLibraryDbForTests } from '../library/db.js';
import {
  latestYoutubeV2TakeoutImport,
  listYoutubeV2ImportedHistory,
  listYoutubeV2Subscriptions,
  replaceYoutubeV2Subscriptions,
  resetYoutubeDbForTests,
} from './db.js';
import {
  importYoutubeTakeout,
  importYoutubeTakeoutStream,
  parseYoutubeTakeout,
  YOUTUBE_TAKEOUT_MAX_ARCHIVE_BYTES,
} from './takeout.js';

function withTempYoutube<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-youtube-takeout-'));
  process.env.MANGO_YOUTUBE_DB_PATH = join(dir, 'youtube.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  resetYoutubeDbForTests();
  resetLibraryDbForTests();
  const cleanup = () => {
    resetYoutubeDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_YOUTUBE_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(files: Array<{ name: string; content: string }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.content);
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralData = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, eocd]);
}

const HISTORY = JSON.stringify([{
  header: 'YouTube',
  title: 'Watched Deep sea cooking',
  titleUrl: 'https://www.youtube.com/watch?v=AbCdEf12345',
  subtitles: [{ name: 'Ocean Kitchen', url: 'https://www.youtube.com/channel/UCkitchen' }],
  time: '2026-07-01T12:00:00Z',
}]);

async function* chunked(data: Buffer, size = 17): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < data.length; offset += size) {
    yield data.subarray(offset, offset + size);
  }
}

test('Takeout JSON import is idempotent and preserves repeated-safe history identity', () => withTempYoutube(() => {
  const first = importYoutubeTakeout(HISTORY, { filename: 'watch-history.json', imported_at: 1000 });
  const second = importYoutubeTakeout(HISTORY, { filename: 'watch-history.json', imported_at: 2000 });
  assert.equal(first.format, 'json');
  assert.equal(first.imported_history, 1);
  assert.equal(first.noop, false);
  assert.equal(first.files_read, 1);
  assert.equal(first.parsed_history, 1);
  assert.equal(first.ignored_subscriptions, 0);
  assert.equal('history' in first, false);
  assert.equal('subscriptions' in first, false);
  assert.equal(JSON.stringify(first).includes('Deep sea cooking'), false);
  assert.equal(JSON.stringify(first).includes('AbCdEf12345'), false);
  assert.equal(second.imported_history, 0);
  assert.equal(second.noop, true);
  assert.deepEqual(listYoutubeV2ImportedHistory().map((row) => row.video_id), ['AbCdEf12345']);
}));

test('Takeout subscriptions are audited but never replace the OAuth authoritative snapshot', () => withTempYoutube(() => {
  replaceYoutubeV2Subscriptions([{
    channel_key: 'UCoauth',
    channel_id: 'UCoauth',
    channel_title: 'OAuth Channel',
    channel_url: 'https://www.youtube.com/channel/UCoauth',
    source: 'oauth',
    subscribed_at: null,
  }], { source_generation: 'oauth-complete' });
  const first = JSON.stringify([{ channelId: 'UCfirst', channelTitle: 'First Channel' }]);
  const second = JSON.stringify([{ channelId: 'UCsecond', channelTitle: 'Second Channel' }]);
  const firstImport = importYoutubeTakeout(first, { filename: 'subscriptions.json' });
  const secondImport = importYoutubeTakeout(second, { filename: 'subscriptions.json' });
  assert.equal(firstImport.replaced_subscriptions, 0);
  assert.equal(secondImport.replaced_subscriptions, 0);
  assert.deepEqual(listYoutubeV2Subscriptions().map((row) => row.channel_id), ['UCoauth']);
  assert.equal(latestYoutubeV2TakeoutImport()?.subscription_count, 1);
  assert.match(latestYoutubeV2TakeoutImport()?.warnings[0] ?? '', /non-authoritative/);
}));

test('Takeout ZIP safely composes JSON history and HTML subscriptions', () => withTempYoutube(() => {
  const zip = storedZip([
    { name: 'Takeout/YouTube and YouTube Music/history/watch-history.json', content: HISTORY },
    {
      name: 'Takeout/YouTube and YouTube Music/subscriptions/subscriptions.html',
      content: '<a href="https://www.youtube.com/channel/UCzip">Zip Channel</a>',
    },
  ]);
  const parsed = parseYoutubeTakeout(zip);
  assert.equal(parsed.format, 'zip');
  assert.equal(parsed.authoritative_subscriptions, false);
  assert.deepEqual(parsed.subscriptions.map((row) => row.channel_id), ['UCzip']);
  assert.deepEqual(parsed.history.map((row) => row.video_id), ['AbCdEf12345']);
}));

test('Takeout ZIP rejects traversal paths before importing', () => withTempYoutube(() => {
  const zip = storedZip([{ name: '../watch-history.json', content: HISTORY }]);
  assert.throws(() => parseYoutubeTakeout(zip), /unsafe YouTube Takeout archive path/);
  assert.deepEqual(listYoutubeV2ImportedHistory(), []);
}));

test('Takeout HTML watch history parses an exported watch entry', () => {
  const html = `<!doctype html><html><body>
    <div class="outer-cell"><div class="content-cell">
      Watched <a href="https://www.youtube.com/watch?v=HtmlId12345">A patient documentary</a><br>
      <a href="https://www.youtube.com/channel/UCHtmlChannel">Careful Films</a><br>
      Jul 1, 2026, 5:00:00 AM PDT
    </div></div>
  </body></html>`;
  const parsed = parseYoutubeTakeout(html, { filename: 'watch-history.html' });
  assert.equal(parsed.format, 'html');
  assert.equal(parsed.history.length, 1);
  assert.equal(parsed.history[0]?.video_id, 'HtmlId12345');
  assert.equal(parsed.history[0]?.title, 'A patient documentary');
  assert.equal(parsed.history[0]?.channel_id, 'UCHtmlChannel');
  assert.equal(parsed.history[0]?.channel_title, 'Careful Films');
  assert.ok((parsed.history[0]?.watched_at ?? 0) > 0);
});

test('Takeout rejects unsupported raw input and ZIPs without supported files', () => {
  assert.throws(
    () => parseYoutubeTakeout('not a Takeout export', { filename: 'notes.txt' }),
    /unsupported YouTube Takeout format/,
  );
  assert.throws(
    () => parseYoutubeTakeout(storedZip([]), { filename: 'takeout.zip' }),
    /no supported JSON or HTML files/,
  );
  assert.throws(
    () => parseYoutubeTakeout(storedZip([{ name: 'Takeout/readme.txt', content: 'nothing here' }])),
    /no supported JSON or HTML files/,
  );
});

test('Takeout direct import records a failed audit for empty input', () => withTempYoutube(() => {
  assert.throws(
    () => importYoutubeTakeout(Buffer.alloc(0), {
      filename: 'empty.json',
      imported_at: 2_500,
    }),
    /input is empty/,
  );
  const audit = latestYoutubeV2TakeoutImport();
  assert.equal(audit?.status, 'failed');
  assert.equal(audit?.imported_at, 2_500);
  assert.match(audit?.source_hash ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(audit?.errors, ['YouTube Takeout input is empty']);
  assert.deepEqual(listYoutubeV2ImportedHistory(), []);
}));

test('Takeout direct import audits malformed input without retaining its raw content', () => withTempYoutube(() => {
  const privateMarker = 'PRIVATE_TAKEOUT_PAYLOAD_MUST_NOT_PERSIST';
  const malformed = `[{"title":"${privateMarker}"}`;
  assert.throws(
    () => importYoutubeTakeout(malformed, {
      filename: 'watch-history.json',
      imported_at: 2_600,
    }),
    /no readable watch history or subscriptions/,
  );
  const audit = latestYoutubeV2TakeoutImport();
  assert.equal(audit?.status, 'failed');
  assert.match(audit?.source_hash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(audit).includes(privateMarker), false);
  assert.deepEqual(
    audit?.errors,
    ['YouTube Takeout contained no readable watch history or subscriptions'],
  );
  assert.deepEqual(listYoutubeV2ImportedHistory(), []);
}));

test('Takeout direct import records a bounded failed audit for oversized malformed input', () => withTempYoutube(() => {
  const privateMarker = 'OVERSIZED_PRIVATE_TAKEOUT_PAYLOAD_MUST_NOT_PERSIST';
  const oversized = Buffer.alloc(YOUTUBE_TAKEOUT_MAX_ARCHIVE_BYTES + 1, 0x78);
  oversized.write(privateMarker, Math.floor(oversized.byteLength / 2), 'utf8');
  assert.throws(
    () => importYoutubeTakeout(oversized, {
      filename: 'watch-history.json',
      imported_at: 2_700,
    }),
    /input is too large/,
  );
  const audit = latestYoutubeV2TakeoutImport();
  assert.equal(audit?.status, 'failed');
  assert.equal(audit?.imported_at, 2_700);
  assert.match(audit?.source_hash ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(audit?.errors, ['YouTube Takeout input is too large']);
  assert.equal(JSON.stringify(audit).includes(privateMarker), false);
  assert.deepEqual(listYoutubeV2ImportedHistory(), []);
}));

test('Takeout accepts video and channel URLs only from YouTube hosts', () => {
  const history = JSON.stringify([
    {
      title: 'Watched forged host',
      titleUrl: 'https://youtube.com.example.test/watch?v=Forged12345',
      time: '2026-07-01T12:00:00Z',
    },
    {
      title: 'Watched safe short link',
      titleUrl: 'https://youtu.be/SafeId12345',
      subtitles: [{ name: 'Forged Channel', url: 'https://example.test/channel/UCForged' }],
      time: '2026-07-01T13:00:00Z',
    },
  ]);
  const parsedHistory = parseYoutubeTakeout(history, { filename: 'watch-history.json' });
  assert.deepEqual(parsedHistory.history.map((row) => row.video_id), ['SafeId12345']);
  assert.equal(parsedHistory.history[0]?.channel_id, null);

  const subscriptions = JSON.stringify([
    { channelTitle: 'Forged Channel', channelUrl: 'https://example.test/channel/UCForged' },
    { channelTitle: 'Real Channel', channelUrl: 'https://music.youtube.com/channel/UCReal' },
  ]);
  const parsedSubscriptions = parseYoutubeTakeout(subscriptions, { filename: 'subscriptions.json' });
  assert.deepEqual(parsedSubscriptions.subscriptions.map((row) => row.channel_id), ['UCReal']);
});

test('Takeout collapses same-video timestamps within sixty seconds but preserves material repeats', () => {
  const repeated = JSON.stringify([
    {
      title: 'Watched Repeat',
      titleUrl: 'https://www.youtube.com/watch?v=Repeat12345',
      time: '2026-07-01T12:00:00.000Z',
    },
    {
      title: 'Watched Repeat duplicate',
      titleUrl: 'https://www.youtube.com/watch?v=Repeat12345',
      time: '2026-07-01T12:00:30.000Z',
    },
    {
      title: 'Watched Repeat again',
      titleUrl: 'https://www.youtube.com/watch?v=Repeat12345',
      time: '2026-07-01T12:01:01.000Z',
    },
  ]);
  const parsed = parseYoutubeTakeout(repeated, { filename: 'watch-history.json' });
  assert.equal(parsed.history.length, 2);
  assert.deepEqual(
    parsed.history.map((row) => row.watched_at).sort((left, right) => left - right),
    [Date.parse('2026-07-01T12:00:00.000Z'), Date.parse('2026-07-01T12:01:01.000Z')],
  );
});

test('Takeout isolates a malformed sibling without retaining its partial rows', () => {
  const malformedAfterValidPrefix = '[{"title":"Watched partial","titleUrl":"https://youtube.com/watch?v=Partial12345","time":"2026-07-01T10:00:00Z"},';
  const zip = storedZip([
    { name: 'Takeout/history/broken.json', content: malformedAfterValidPrefix },
    { name: 'Takeout/history/watch-history.json', content: HISTORY },
  ]);
  const parsed = parseYoutubeTakeout(zip);
  assert.deepEqual(parsed.history.map((row) => row.video_id), ['AbCdEf12345']);
  assert.equal(parsed.warnings.length, 1);
  assert.doesNotMatch(parsed.warnings[0] ?? '', /broken\.json|Partial12345|Watched partial/);
  assert.match(parsed.warnings[0] ?? '', /skipped malformed YouTube Takeout file/);
  assert.deepEqual(parsed.files_read, ['Takeout/history/watch-history.json']);
});

test('Takeout import receipts and audits never expose malformed archive member names', () => withTempYoutube(() => {
  const privateMemberName = 'Takeout/history/private-viewer-folder.json';
  const zip = storedZip([
    { name: privateMemberName, content: '[{"private":"viewer value"},' },
    { name: 'Takeout/history/watch-history.json', content: HISTORY },
  ]);
  const receipt = importYoutubeTakeout(zip, { filename: 'takeout.zip', imported_at: 2_500 });
  const audit = latestYoutubeV2TakeoutImport();
  const exposed = JSON.stringify({ receipt, audit });
  assert.doesNotMatch(exposed, /private-viewer-folder|viewer value/);
  assert.match(receipt.warnings[0] ?? '', /skipped malformed YouTube Takeout file/);
  assert.equal(audit?.status, 'partial');
}));

test('Takeout upload is file-backed, chunk-streamed, audited, and removes the raw temporary file', async () => {
  await withTempYoutube(async () => {
    const temporaryNames = () => new Set(readdirSync(tmpdir())
      .filter((name) => name.startsWith('mango-youtube-takeout-')));
    const before = temporaryNames();
    const result = await importYoutubeTakeoutStream(chunked(Buffer.from(HISTORY)), {
      filename: 'watch-history.json',
      imported_at: 3_000,
    });
    assert.equal(result.imported_history, 1);
    assert.equal(result.replaced_subscriptions, 0);
    assert.equal(latestYoutubeV2TakeoutImport()?.status, 'success');
    assert.deepEqual(temporaryNames(), before);
  });
});

test('Takeout streamed ZIP reads supported members incrementally and rejects traversal', async () => {
  await withTempYoutube(async () => {
    const safe = storedZip([{
      name: 'Takeout/YouTube and YouTube Music/history/watch-history.json',
      content: HISTORY,
    }]);
    const result = await importYoutubeTakeoutStream(chunked(safe, 31), {
      filename: 'takeout.zip',
    });
    assert.equal(result.format, 'zip');
    assert.equal(result.imported_history, 1);

    const unsafe = storedZip([{ name: '../watch-history.json', content: HISTORY }]);
    await assert.rejects(
      importYoutubeTakeoutStream(chunked(unsafe, 29), { filename: 'takeout.zip' }),
      /unsafe YouTube Takeout archive path/,
    );
  });
});

test('Takeout stream rejects oversized input, retains no history, and records the failed batch', async () => {
  await withTempYoutube(async () => {
    await assert.rejects(
      importYoutubeTakeoutStream(chunked(Buffer.from(HISTORY)), {
        filename: 'watch-history.json',
        imported_at: 4_000,
        max_bytes: 8,
      }),
      /too large/,
    );
    assert.deepEqual(listYoutubeV2ImportedHistory(), []);
    assert.equal(latestYoutubeV2TakeoutImport()?.status, 'failed');
  });
});
