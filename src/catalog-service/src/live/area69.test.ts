import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AREA69_CHANNEL_ID_PREFIX,
  clearArea69SearchIndexCache,
  formatArea69ChannelId,
  isArea69ChannelId,
  loadArea69SearchIndex,
  parseArea69StreamId,
  resolveArea69Streams,
  searchArea69Index,
} from './area69.js';

function withTempArea69Paths<T>(
  fn: (paths: { indexPath: string; credsPath: string }) => T | Promise<T>,
): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mango-area69-'));
  const indexPath = join(dir, 'area69-live-search.json');
  const credsPath = join(dir, 'area69.credentials');
  process.env.MANGO_AREA69_SEARCH_INDEX = indexPath;
  process.env.MANGO_AREA69_CREDS = credsPath;
  clearArea69SearchIndexCache();
  try {
    const result = fn({ indexPath, credsPath });
    if (result instanceof Promise) {
      return result.finally(() => {
        clearArea69SearchIndexCache();
        delete process.env.MANGO_AREA69_SEARCH_INDEX;
        delete process.env.MANGO_AREA69_CREDS;
        rmSync(dir, { recursive: true, force: true });
      });
    }
    clearArea69SearchIndexCache();
    delete process.env.MANGO_AREA69_SEARCH_INDEX;
    delete process.env.MANGO_AREA69_CREDS;
    rmSync(dir, { recursive: true, force: true });
    return result;
  } finally {
    // async cleanup handled by Promise.finally above
  }
}

test('AREA69 channel id helpers format and parse ids', () => {
  assert.equal(AREA69_CHANNEL_ID_PREFIX, 'area69:');
  const id = formatArea69ChannelId('12345');
  assert.equal(id, 'area69:12345');
  assert.equal(isArea69ChannelId(id), true);
  assert.equal(parseArea69StreamId(id), '12345');
  assert.equal(parseArea69StreamId('tv:12345'), null);
});

test('searchArea69Index loads entries from disk and scores hits', async () => withTempArea69Paths(async ({ indexPath }) => {
  writeFileSync(indexPath, JSON.stringify({
    version: 1,
    entries: [
      { stream_id: '1', name: 'Willow Cricket HD', logo: 'https://img.example/willow.png' },
      { stream_id: '2', name: 'Sky Sports Main Event' },
    ],
  }), 'utf8');
  const index = await loadArea69SearchIndex();
  assert.ok(index);
  assert.equal(index?.entries.length, 2);
  const hits = await searchArea69Index('willow', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'area69:1');
  assert.equal(hits[0].title, 'Willow Cricket HD');
  assert.equal(hits[0].type, 'tv');
  assert.equal(hits[0].tab, 'live');
  assert.ok(hits[0].score > 0);
}));

test('resolveArea69Streams parses quoted credentials and builds direct ts url', async () => withTempArea69Paths(async ({ credsPath }) => {
  writeFileSync(
    credsPath,
    [
      '# comments are ignored',
      'XTREAM_URL="https://example.xtream.test/"',
      'XTREAM_USER=\'alice\'',
      'XTREAM_PASS="super-secret"',
      '',
    ].join('\n'),
    'utf8',
  );
  const streams = await resolveArea69Streams('987');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://example.xtream.test/live/alice/super-secret/987.ts');
  assert.equal(streams[0].title, 'AREA69');
  assert.equal(streams[0].source, 'area69');
}));

test('resolveArea69Streams returns empty when credentials are missing', async () => withTempArea69Paths(async () => {
  const streams = await resolveArea69Streams('987');
  assert.deepEqual(streams, []);
}));

test('searchArea69Index returns empty when the index file is missing', async () => withTempArea69Paths(async () => {
  const index = await loadArea69SearchIndex();
  assert.equal(index, null);
  const hits = await searchArea69Index('espn', 5);
  assert.deepEqual(hits, []);
}));

test('search index reloads when the index file changes on disk', async () => withTempArea69Paths(async ({ indexPath }) => {
  writeFileSync(indexPath, JSON.stringify({
    entries: [{ stream_id: '1', name: 'CNN International' }],
  }), 'utf8');
  const first = await searchArea69Index('cnn', 5);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'area69:1');

  writeFileSync(indexPath, JSON.stringify({
    entries: [{ stream_id: '2', name: 'BBC World News' }],
  }), 'utf8');
  const reloaded = await searchArea69Index('bbc', 5);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, 'area69:2');
  assert.deepEqual(await searchArea69Index('cnn', 5), []);

  clearArea69SearchIndexCache();
  const afterClear = await searchArea69Index('bbc', 5);
  assert.equal(afterClear.length, 1);
}));
