import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AREA69_CHANNEL_ID_PREFIX,
  AREA69_SEARCH_INDEX_VERSION,
  area69EntryToTaggedChannel,
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
    version: AREA69_SEARCH_INDEX_VERSION,
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

test('legacy AREA69 indexes are incompatible and never silently searched', async () => withTempArea69Paths(async ({ indexPath }) => {
  writeFileSync(indexPath, JSON.stringify({
    version: 1,
    entries: [{ stream_id: '1', name: 'Legacy Broad Channel' }],
  }), 'utf8');
  assert.equal(await loadArea69SearchIndex(), null);
  assert.deepEqual(await searchArea69Index('legacy', 5), []);
}));

test('index v2 preserves qualified event context while dropping unrecognized secret-bearing fields', async () => withTempArea69Paths(async ({ indexPath }) => {
  writeFileSync(indexPath, JSON.stringify({
    version: 2,
    entries: [{
      stream_id: '7001',
      name: 'FIFA World Cup: India VS England (2026-07-16 19:00)',
      category_id: '91',
      category: 'FIFA World Cup',
      logo: 'https://img.example/fifa.png',
      epg_channel_id: 'fifa.world.cup',
      kind: 'event',
      event: {
        status: 'listed',
        starts_at: 1784247600,
        competition: 'FIFA World Cup',
        stream_url: 'https://alice:super-secret@example.test/live/7001.ts',
      },
      direct_source: 'https://example.test/live/alice/super-secret/7001.ts',
      password: 'super-secret',
    }],
  }), 'utf8');

  const index = await loadArea69SearchIndex();
  assert.equal(index?.version, 2);
  assert.equal(index?.entries.length, 1);
  const entry = index?.entries[0];
  assert.ok(entry);
  assert.equal(entry.kind, 'event');
  assert.equal(entry.category_id, '91');
  assert.equal(entry.category, 'FIFA World Cup');
  assert.equal(entry.logo, 'https://img.example/fifa.png');
  assert.equal(entry.epg_channel_id, 'fifa.world.cup');
  assert.deepEqual(entry.event, {
    status: 'listed',
    starts_at: 1784247600,
    competition: 'FIFA World Cup',
  });
  assert.equal(JSON.stringify(index).includes('super-secret'), false);

  const tagged = area69EntryToTaggedChannel(entry);
  assert.equal(tagged.id, 'area69:7001');
  assert.equal(tagged.poster, 'https://img.example/fifa.png');
  assert.equal(tagged.genre, 'FIFA World Cup');
  assert.equal(tagged.releaseInfo, 'FIFA World Cup · listed · 1784247600');
  assert.match(tagged.description || '', /listed/);
  assert.equal(tagged.event?.starts_at, 1784247600);
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
    version: AREA69_SEARCH_INDEX_VERSION,
    entries: [{ stream_id: '1', name: 'CNN International' }],
  }), 'utf8');
  const first = await searchArea69Index('cnn', 5);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'area69:1');

  writeFileSync(indexPath, JSON.stringify({
    version: AREA69_SEARCH_INDEX_VERSION,
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
