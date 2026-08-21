import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelSubtitle,
  finalizeLiveRailListing,
  findLiveAddonManifestUrl,
  incompleteLiveCatalogSources,
  keywordPattern,
  loadLiveRailConfig,
  matchChannelsToRail,
  matchChannelsWithSourceFill,
  partitionChannelsBySportRails,
  searchableChannelText,
  type LiveChannelMeta,
  type LiveChannelWithSource,
  type LiveSportRail,
} from './live-rails.js';

function channel(partial: Partial<LiveChannelMeta> & Pick<LiveChannelMeta, 'id' | 'name'>): LiveChannelMeta {
  return {
    id: partial.id,
    name: partial.name,
    title: partial.title,
    description: partial.description,
    genre: partial.genre,
    poster: partial.poster,
    releaseInfo: partial.releaseInfo,
    language: partial.language,
    languages: partial.languages,
    event: partial.event,
  };
}

test('live source lookup retains configured manifest URLs when boot loading was partial', () => {
  assert.equal(findLiveAddonManifestUrl('mango Live News', [
    { name: 'Cinemeta', manifestUrl: 'http://cinemeta.invalid/manifest.json' },
    { name: 'mango Live News', manifestUrl: 'http://news.invalid/manifest.json' },
  ]), 'http://news.invalid/manifest.json');
  assert.equal(findLiveAddonManifestUrl('MANGO LIVE NEWS', [
    { name: 'mango Live News', manifestUrl: 'http://news.invalid/manifest.json' },
  ]), 'http://news.invalid/manifest.json');
  assert.equal(findLiveAddonManifestUrl('missing', []), null);
});

test('live Home generation requires every configured curated source to contribute', () => {
  const sources = [
    { addon: 'mango Live TV' },
    { addon: 'mango Live News' },
    { addon: 'mango Live Cartoons' },
  ];
  assert.deepEqual(incompleteLiveCatalogSources(sources, {
    'mango Live TV': 92,
    'mango Live News': 12,
    'mango Live Cartoons': 4,
  }, []), []);
  assert.deepEqual(incompleteLiveCatalogSources(sources, {
    'mango Live TV': 92,
    'mango Live News': 12,
  }, ['mango Live Cartoons']), ['mango Live Cartoons']);
  assert.deepEqual(incompleteLiveCatalogSources(sources, {
    'mango Live TV': 92,
    'mango Live News': 0,
    'mango Live Cartoons': 4,
  }, []), ['mango Live News']);
});

test('live-rails matches cricket channels by keyword', () => {
  const rail: LiveSportRail = {
    id: 'live-cricket',
    label: 'cricket',
    keywords: ['cricket', 'ipl', 'star sports'],
    limit: 10,
  };
  const channels = [
    channel({ id: '1', name: 'Star Sports 1 HD', genre: 'sports' }),
    channel({ id: '2', name: 'HBO Movies' }),
    channel({ id: '3', name: 'Willow Cricket', description: 'live coverage' }),
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsToRail(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['1', '3']);
});

test('hybrid qualified rail keeps current matches before exact standing fills', () => {
  const rail: LiveSportRail = {
    id: 'live-cricket',
    label: 'cricket',
    keywords: ['cricket', 'india', 'star sports', 'willow'],
    qualification: 'india_cricket',
    limit: 3,
  };
  const channels = [
    channel({ id: 'standing-4k', name: 'Willow Sports 4K' }),
    channel({ id: 'live', name: 'LIVE | India vs Australia | 2nd ODI' }),
    channel({ id: 'standing-hd', name: 'Star Sports 1 HD' }),
    channel({ id: 'junk', name: 'LIVE | West Indies vs Australia | 2nd ODI' }),
  ];
  const matches = matchChannelsToRail(channels, rail, new Set());
  assert.deepEqual(matches.map((item) => item.id), ['live', 'standing-4k', 'standing-hd']);
});

test('hybrid source fill works when only exact standing brands are present', () => {
  const rail: LiveSportRail = {
    id: 'live-football',
    label: 'soccer',
    keywords: ['soccer'],
    qualification: 'main_soccer',
    limit: 2,
    source_fill: [{ addon: 'mango Live Free', limit: 2, keywords: ['bein sports'] }],
  };
  const channels: LiveChannelWithSource[] = [
    { ...channel({ id: 'bein', name: 'beIN Sports USA (720p)' }), source_addon: 'mango Live Free' },
    { ...channel({ id: 'noise', name: 'ESPN Sports' }), source_addon: 'mango Live Free' },
  ];
  const matches = matchChannelsWithSourceFill(channels, rail, new Set());
  assert.deepEqual(matches.map((item) => item.id), ['bein']);
});

test('cartoon rail admits unknown language but rejects known foreign language', () => {
  const rail: LiveSportRail = {
    id: 'live-cartoons',
    label: 'cartoons',
    keywords: ['cartoon network'],
    qualification: 'english_hindi_cartoons',
    limit: 8,
  };
  assert.deepEqual(
    matchChannelsToRail([channel({ id: 'unknown', name: 'Cartoon Network' })], rail, new Set())
      .map((item) => item.id),
    ['unknown'],
  );
  assert.deepEqual(
    matchChannelsToRail([channel({ id: 'spanish', name: 'Cartoon Network', languages: ['Spanish'] })], rail, new Set())
      .map((item) => item.id),
    [],
  );
  assert.deepEqual(
    matchChannelsToRail([channel({ id: 'english', name: 'Cartoon Network', languages: ['English'] })], rail, new Set())
      .map((item) => item.id),
    ['english'],
  );
});

test('live-rails assigns each channel to the first matching rail only', () => {
  const rails: LiveSportRail[] = [
    { id: 'live-cricket', label: 'cricket', keywords: ['sport'], limit: 5 },
    { id: 'live-other', label: 'more', keywords: ['sport'], limit: 5 },
  ];
  const channels = [channel({ id: 'a', name: 'Sky Sport News' })];
  const byRail = partitionChannelsBySportRails(channels, rails);
  assert.deepEqual(byRail.get('live-cricket')?.map((item) => item.id), ['a']);
  assert.deepEqual(byRail.get('live-other'), []);
});

test('live-rails matches national news without local affiliates', () => {
  const rail: LiveSportRail = {
    id: 'live-news',
    label: 'news',
    keywords: ['abc news live', 'ndtv', 'bbc news', 'nbc news now'],
    exclude_keywords: ['baltimore', 'originals'],
    limit: 10,
  };
  const channels = [
    channel({ id: '1', name: 'PRIME: ABC NEWS LIVE ᴿᴬᵂ' }),
    channel({ id: '2', name: 'PRIME: ABC BALTIMORE NEWS (WMAR) ᴿᴬᵂ' }),
    channel({ id: '3', name: 'NDTV 24x7' }),
    channel({ id: '4', name: 'PRIME: CNN ORIGINALS ᴿᴬᵂ' }),
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsToRail(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['3', '1']);
});

test('live-rails matches mixed racing channels', () => {
  const rail: LiveSportRail = {
    id: 'live-racing',
    label: 'racing',
    keywords: ['f1 tv', 'nascar', 'rally tv', 'motogp'],
    limit: 10,
  };
  const channels = [
    channel({ id: '1', name: 'PRIME: F1 TV ᴿᴬᵂ' }),
    channel({ id: '2', name: 'PRIME: NASCAR ᴿᴬᵂ' }),
    channel({ id: '3', name: 'Rally TV', genre: 'sports' }),
    channel({ id: '4', name: 'ESPN News' }),
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsToRail(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['3', '1', '2']);
});

test('live-rails hindi english news excludes regional language variants', () => {
  const rail: LiveSportRail = {
    id: 'live-news',
    label: 'news',
    keywords: ['abp news', 'republic tv', 'ndtv 24x7', 'aaj tak'],
    exclude_keywords: ['ananda', 'bangla', 'kannada', 'marathi', 'majha'],
    limit: 10,
  };
  const channels = [
    channel({ id: '1', name: 'ABP News' }),
    channel({ id: '2', name: 'ABP Ananda' }),
    channel({ id: '3', name: 'Republic TV' }),
    channel({ id: '4', name: 'Republic Bangla' }),
    channel({ id: '5', name: 'NDTV 24x7' }),
    channel({ id: '6', name: 'NDTV Marathi' }),
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsToRail(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['1', '3', '5']);
});

test('live-rails match_all fills curated addon in order', () => {
  const rail: LiveSportRail = {
    id: 'live-news',
    label: 'news',
    keywords: ['news'],
    limit: 3,
    source_fill: [{ addon: 'mango Live News', limit: 3, match_all: true }],
  };
  const channels: LiveChannelWithSource[] = [
    { ...channel({ id: '1', name: 'Republic TV (1080p)' }), source_addon: 'mango Live News' },
    { ...channel({ id: '2', name: 'NDTV 24x7 (720p)' }), source_addon: 'mango Live News' },
    { ...channel({ id: '3', name: 'Aaj Tak HD (1080p)' }), source_addon: 'mango Live News' },
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsWithSourceFill(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['1', '2', '3']);
});

test('live-rails football fill excludes generic PRIME channels', () => {
  const rail: LiveSportRail = {
    id: 'live-football',
    label: 'football',
    keywords: ['football'],
    limit: 5,
    source_fill: [{
      addon: 'mango Live TV',
      limit: 5,
      keywords: ['world cup'],
      exclude_keywords: ['prime', 'sitcom'],
    }],
  };
  const channels: LiveChannelWithSource[] = [
    { ...channel({ id: 'wc', name: 'World Cup 01 : Netherlands vs Sweden' }), source_addon: 'mango Live TV' },
    { ...channel({ id: 'bad', name: 'PRIME: 90S SITCOM' }), source_addon: 'mango Live TV' },
    { ...channel({ id: 'bad2', name: 'PRIME: ABC NEWS LIVE' }), source_addon: 'mango Live TV' },
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsWithSourceFill(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['wc']);
});

test('live-rails source_fill prefers Indian news before US paid affiliates', () => {
  const rail: LiveSportRail = {
    id: 'live-news',
    label: 'news',
    keywords: ['news'],
    limit: 4,
    source_fill: [
      {
        addon: 'mango Live News',
        limit: 2,
        keywords: ['ndtv', 'aaj tak'],
      },
      {
        addon: 'mango Live TV',
        limit: 2,
        keywords: ['abc news live', 'bbc news'],
      },
    ],
  };
  const channels: LiveChannelWithSource[] = [
    { ...channel({ id: 'us1', name: 'PRIME: ABC NEWS LIVE' }), source_addon: 'mango Live TV' },
    { ...channel({ id: 'us2', name: 'PRIME: ABC BALTIMORE NEWS' }), source_addon: 'mango Live TV' },
    { ...channel({ id: 'in1', name: 'NDTV 24x7' }), source_addon: 'mango Live News' },
    { ...channel({ id: 'in2', name: 'Aaj Tak' }), source_addon: 'mango Live News' },
    { ...channel({ id: 'us3', name: 'PRIME: BBC NEWS' }), source_addon: 'mango Live TV' },
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsWithSourceFill(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['in1', 'in2', 'us1', 'us3']);
});

test('live-rails keyword matches sort by quality before limit', () => {
  const rail: LiveSportRail = {
    id: 'live-football',
    label: 'football',
    keywords: ['world cup'],
    limit: 2,
  };
  const channels = [
    channel({ id: 'sd', name: 'World Cup Today HD' }),
    channel({ id: '8k', name: 'Live | World Cup Final | 8K EXCLUSIVE' }),
    channel({ id: '4k', name: 'Live | World Cup Final | 4K UHD' }),
  ];
  const assigned = new Set<string>();
  const matches = matchChannelsToRail(channels, rail, assigned);
  assert.deepEqual(matches.map((item) => item.id), ['8k', '4k']);
});

test('live-rails prefers EPG text for subtitles', () => {
  const text = searchableChannelText(channel({
    id: 'x',
    name: 'Fox Sports',
    releaseInfo: 'Liverpool vs Arsenal — 1st half',
  }));
  assert.equal(keywordPattern(['liverpool']).test(text), true);
  assert.equal(channelSubtitle(channel({
    id: 'x',
    name: 'Fox Sports',
    releaseInfo: 'Liverpool vs Arsenal — 1st half',
    genre: 'sports',
  })), 'Liverpool vs Arsenal — 1st half');
});

test('live-rails world cup rail claims fifa channels before soccer rail', () => {
  const rails: LiveSportRail[] = [
    {
      id: 'live-world-cup',
      label: 'world cup',
      keywords: ['world cup', 'fifa', 'copa mundial', 'mundial'],
      limit: 10,
    },
    {
      id: 'live-football',
      label: 'soccer',
      keywords: ['uefa', 'premier league', 'bein sports'],
      exclude_keywords: ['world cup', 'fifa', 'copa mundial', 'mundial'],
      limit: 10,
    },
  ];
  const channels = [
    channel({ id: 'wc1', name: 'World Cup 01 : Netherlands vs Sweden' }),
    channel({ id: 'wc2', name: 'FIFA+ Live | Copa Mundial' }),
    channel({ id: 'pl', name: 'Sky Sports Premier League HD' }),
    channel({ id: 'bein', name: 'beIN Sports 1 HD' }),
  ];
  const byRail = partitionChannelsBySportRails(channels, rails);
  assert.deepEqual(
    byRail.get('live-world-cup')?.map((item) => item.id).sort(),
    ['wc1', 'wc2'],
  );
  assert.deepEqual(
    byRail.get('live-football')?.map((item) => item.id).sort(),
    ['bein', 'pl'],
  );
});

test('live-rails finalize keeps all quality variants when dedupe_titles is false', () => {
  const rail: LiveSportRail = {
    id: 'live-world-cup',
    label: 'world cup',
    keywords: ['world cup'],
    limit: 4,
    dedupe_titles: false,
  };
  const channels = [
    channel({ id: '8k', name: 'Live | World Cup Final | 8K EXCLUSIVE' }),
    channel({ id: '4k', name: 'Live | World Cup Final | 4K UHD' }),
    channel({ id: 'hd', name: 'Live | World Cup Final | HD' }),
  ];
  const listed = finalizeLiveRailListing(channels, rail);
  assert.deepEqual(listed.map((item) => item.id), ['8k', '4k', 'hd']);
});

test('live-rails finalize dedupes identical titles by default', () => {
  const rail: LiveSportRail = {
    id: 'live-football',
    label: 'soccer',
    keywords: ['world cup'],
    limit: 4,
  };
  const channels = [
    channel({ id: '8k', name: 'World Cup 01 : Netherlands vs Sweden' }),
    channel({ id: '4k', name: 'World Cup 01 : Netherlands vs Sweden' }),
    channel({ id: 'other', name: 'World Cup 02 : France vs Spain' }),
  ];
  const listed = finalizeLiveRailListing(channels, rail);
  assert.deepEqual(listed.map((item) => item.id), ['8k', 'other']);
});

test('qualified rail rejects standing noise before ranking and keeps one best event variant', () => {
  const rail: LiveSportRail = {
    id: 'live-football',
    label: 'soccer',
    keywords: ['premier league', 'sky sports'],
    qualification: 'main_soccer',
    limit: 4,
  };
  const channels = [
    channel({ id: 'standing', name: 'Sky Sports Main Event 8K' }),
    channel({ id: 'hd', name: 'LIVE | Arsenal vs Liverpool | Premier League | 1080p' }),
    channel({ id: '4k', name: 'LIVE | Arsenal vs Liverpool | Premier League | 4K UHD' }),
    channel({ id: 'mls', name: 'LIVE | Inter Miami vs LAFC | MLS | 8K' }),
  ];
  const matches = matchChannelsToRail(channels, rail, new Set<string>());
  assert.deepEqual(matches.map((item) => item.id), ['4k']);
});

test('shipped Live config is restricted to four approved inventories and four browse rails', async () => {
  const path = new URL('../../../config/catalog-live.example.yaml', import.meta.url).pathname;
  const config = await loadLiveRailConfig(path);
  assert.deepEqual(config.sources.map((source) => source.addon), [
    'mango Live TV',
    'mango Live Free',
    'mango Live News',
    'mango Live Cartoons',
  ]);
  assert.deepEqual(config.rails.map((rail) => [rail.id, rail.qualification]), [
    ['live-cricket', 'india_cricket'],
    ['live-racing', 'f1_standing_allowlist'],
    ['live-news', 'balanced_news'],
    ['live-cartoons', 'english_hindi_cartoons'],
  ]);
});
