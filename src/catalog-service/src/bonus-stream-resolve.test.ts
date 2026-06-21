import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bonusIndexerAliasId,
  buildBonusTitleTokens,
  dedupeStreamsByUrl,
  isSupplementalStream,
  parseSeriesEpisodeId,
  pickBonusStreamsFromCandidates,
  pickMainEpisodeStreams,
  streamMatchesBonusEpisodeNumber,
  streamMatchesBonusEpisodeTitle,
} from './bonus-stream-resolve.js';
import type { Stream } from './core.js';

function stream(name: string, description = '', url = 'https://example.test/a'): Stream {
  return { name, title: name, description, url, source: 'test' };
}

test('parseSeriesEpisodeId reads season and episode', () => {
  assert.deepEqual(parseSeriesEpisodeId('tt33094114:0:7'), {
    bare: 'tt33094114',
    season: 0,
    episode: 7,
  });
});

test('bonusIndexerAliasId maps season 0 to season 1 for early bonus rows', () => {
  assert.equal(bonusIndexerAliasId('tt33094114:0:1'), 'tt33094114:1:1');
  assert.equal(bonusIndexerAliasId('tt33094114:0:6'), 'tt33094114:1:6');
  assert.equal(bonusIndexerAliasId('tt33094114:0:7'), null);
  assert.equal(bonusIndexerAliasId('tt33094114:1:1'), null);
});

test('streamMatchesBonusEpisodeNumber matches indexer bonus labels', () => {
  assert.equal(streamMatchesBonusEpisodeNumber('igl bonus e01 web-dl', 1), true);
  assert.equal(streamMatchesBonusEpisodeNumber('igl bonus ep 3', 3), true);
  assert.equal(streamMatchesBonusEpisodeNumber('igl e07 main episode', 7), false);
});

test('streamMatchesBonusEpisodeTitle matches deleted-moments extras', () => {
  const haystack = 'indias got latent deleted moments deepak kalal 1080p';
  assert.equal(
    streamMatchesBonusEpisodeTitle(haystack, 'Deepak Kalal Episode Deleted Moments', 8),
    true,
  );
  assert.equal(
    streamMatchesBonusEpisodeTitle('igl e07 main episode', 'EP 07 ft. guest', 7),
    false,
  );
});

test('buildBonusTitleTokens strips short and stop words', () => {
  assert.deepEqual(
    buildBonusTitleTokens('Bonus EP 7 ft. Aakash Gupta').sort(),
    ['aakash', 'bonus', 'gupta'].sort(),
  );
});

test('pickBonusStreamsFromCandidates keeps bonus-labeled rows only', () => {
  const picked = pickBonusStreamsFromCandidates(
    [
      stream('Torrentio', '📁 Igl Bonus E02\n📦 1.15 GB'),
      stream('Torrentio', '📁 Igl E07\n📦 1.32 GB'),
    ],
    2,
    'Bonus EP 2 ft. Badshah',
  );
  assert.equal(picked.length, 1);
  assert.ok(/Bonus E02/i.test(String(picked[0]?.description ?? '')));
});

test('dedupeStreamsByUrl keeps first stream per url', () => {
  const kept = dedupeStreamsByUrl([
    stream('one', '', 'https://example.test/same'),
    stream('two', '', 'https://example.test/same'),
    stream('three', '', 'https://example.test/other'),
  ]);
  assert.equal(kept.length, 2);
});

test('pickMainEpisodeStreams drops supplemental and bonus-number mislabels', () => {
  const bonusOnly = pickMainEpisodeStreams(
    [stream('Torrentio', '📁 Igl Bonus E01 WEB-DL 1080p')],
    1,
    1,
  );
  assert.equal(bonusOnly.length, 0);

  const mixed = pickMainEpisodeStreams(
    [
      stream('Torrentio', '📁 Igl Bonus E01 WEB-DL 1080p'),
      stream('Torrentio', '📁 Igl S01E01 WEB-DL 1080p'),
    ],
    1,
    1,
  );
  assert.equal(mixed.length, 1);
  assert.ok(/S01E01/i.test(String(mixed[0]?.description ?? '')));
});

test('pickMainEpisodeStreams keeps normal series releases', () => {
  const kept = pickMainEpisodeStreams(
    [stream('Torrentio', '📁 Panchayat S01E01 AMZN WEB-DL')],
    1,
    1,
  );
  assert.equal(kept.length, 1);
  assert.equal(isSupplementalStream(kept[0] ?? stream('', '')), false);
});
