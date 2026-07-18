import assert from 'node:assert/strict';
import test from 'node:test';
import type { LiveChannelMeta } from '../live-rails.js';
import {
  canonicalLiveChannelKey,
  dedupeLiveChannelsByCanonicalKey,
  qualifiesLiveChannel,
} from './qualification.js';

function channel(name: string, releaseInfo?: string, languages?: string[]): LiveChannelMeta {
  return { id: name, name, releaseInfo, languages };
}

test('FIFA policy admits exact standing fills but keeps adjacent events rejected', () => {
  assert.equal(qualifiesLiveChannel(channel('LIVE | France vs Brazil | FIFA World Cup | 4K'), 'fifa_mens_world_cup'), true);
  assert.equal(qualifiesLiveChannel(channel('LIVE | Francia - Suecia | Copa Mundial de la FIFA | 4K'), 'fifa_mens_world_cup'), true);
  assert.equal(qualifiesLiveChannel(channel('FIFA+ United States (720p)'), 'fifa_mens_world_cup'), true);
  assert.equal(qualifiesLiveChannel(channel('FIFA+ (720p)'), 'fifa_mens_world_cup'), true);
  assert.equal(qualifiesLiveChannel(channel("LIVE | FIFA Women's World Cup Final | 4K"), 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(channel('LIVE | FIFA Club World Cup Final'), 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(channel('LIVE | France vs Brazil | FIFA World Cup Qualifier'), 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(channel('REPLAY | France vs Brazil | FIFA World Cup'), 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(channel('ENDED | France vs Brazil | FIFA World Cup'), 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(channel('LIVE | FIFA World Cup Preview: France vs Brazil'), 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(channel('FIFA World Cup Studio', 'FIFA World Cup Highlights: France vs Brazil'), 'fifa_mens_world_cup'), false);
});

test('FIFA policy admits AREA69-style current World Cup feeds without LIVE| marker', () => {
  const listedSlot: LiveChannelMeta = {
    ...channel('World Cup 01 : France vs England 05:00pm'),
    event: { status: 'listed' },
  };
  const namedSemifinal: LiveChannelMeta = {
    ...channel('2026 FIFA World Cup Semifinal France vs Spain A @ Jul 16 12:00 PM :TSN+'),
    event: { status: 'listed' },
  };
  const fifaWcSlot: LiveChannelMeta = {
    id: 'fifa-wc-1',
    name: 'FIFA WC 01: France vs England 5:00 PM',
    title: 'FIFA WC 01: France vs England 5:00 PM',
    event: { status: 'listed' },
  };
  const emptySlot: LiveChannelMeta = {
    id: 'empty',
    name: 'World Cup 06 -',
    title: 'World Cup 06 -',
    event: undefined,
  };
  const endedPrefix: LiveChannelMeta = {
    ...channel('End | France vs England | FIFA World Cup | 8K EXCLUSIVE'),
    event: { status: 'listed' },
  };
  const nextPrefix: LiveChannelMeta = {
    ...channel('NEXT | France vs England | FIFA World Cup | 8K EXCLUSIVE'),
    event: { status: 'listed' },
  };
  const softball: LiveChannelMeta = {
    ...channel('Live | Dia 3 | Lima | Women\'s Softball World Cup | 8K EXCLUSIVE'),
    event: { status: 'listed' },
  };
  assert.equal(qualifiesLiveChannel(listedSlot, 'fifa_mens_world_cup'), true);
  assert.equal(qualifiesLiveChannel(namedSemifinal, 'fifa_mens_world_cup'), true);
  assert.equal(qualifiesLiveChannel(fifaWcSlot, 'fifa_mens_world_cup'), true);
  assert.equal(qualifiesLiveChannel(emptySlot, 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(endedPrefix, 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(nextPrefix, 'fifa_mens_world_cup'), false);
  assert.equal(qualifiesLiveChannel(softball, 'fifa_mens_world_cup'), false);
  assert.equal(
    qualifiesLiveChannel(channel('WORLD CUP 2026'), 'fifa_mens_world_cup'),
    false,
    'standing slot without matchup is not a current event',
  );
  assert.equal(
    qualifiesLiveChannel(
      channel('LIVE | Francia - Inglaterra | Tercer y cuarto puesto | Copa Mundial de la FIFA'),
      'fifa_mens_world_cup',
    ),
    true,
  );
});

test('India cricket requires current India cricket proof for standing channels', () => {
  assert.equal(qualifiesLiveChannel(channel('Star Sports 1 HD', 'LIVE India vs Australia — 2nd ODI'), 'india_cricket'), true);
  assert.equal(qualifiesLiveChannel(channel('Star Sports 1 HD', 'England vs Australia — cricket'), 'india_cricket'), false);
  assert.equal(qualifiesLiveChannel(channel('Willow Cricket HD'), 'india_cricket'), true);
  assert.equal(qualifiesLiveChannel(channel('Star Sports 2 HD'), 'india_cricket'), true);
  assert.equal(qualifiesLiveChannel(channel('LIVE | West Indies vs Australia | 2nd ODI'), 'india_cricket'), false);
  assert.equal(qualifiesLiveChannel(channel('Indian Cricket Studio | England vs Australia'), 'india_cricket'), false);
  assert.equal(qualifiesLiveChannel(channel('LIVE | Indian cricket | Australia vs England'), 'india_cricket'), false);
});

test('main soccer requires a current Big Five, UCL, or UEL event', () => {
  assert.equal(qualifiesLiveChannel(channel('Sky Sports Main Event', 'LIVE Arsenal vs Liverpool — Premier League'), 'main_soccer'), true);
  assert.equal(qualifiesLiveChannel(channel('LIVE | Real Madrid vs Barcelona | La Liga | 4K'), 'main_soccer'), true);
  assert.equal(qualifiesLiveChannel(channel('beIN Sports HD'), 'main_soccer'), true);
  assert.equal(qualifiesLiveChannel(channel('beIN Sports USA'), 'main_soccer'), true);
  assert.equal(qualifiesLiveChannel(channel('LIVE | Inter Miami vs LAFC | MLS'), 'main_soccer'), false);
  assert.equal(qualifiesLiveChannel(channel('LIVE | Al Hilal vs Urawa | AFC Champions League'), 'main_soccer'), false);
  assert.equal(qualifiesLiveChannel(channel('Sky Sports', 'Premier League preview: Arsenal vs Liverpool'), 'main_soccer'), false);
  for (const competition of [
    'Bundesliga',
    'Serie A',
    'Ligue 1',
    'UEFA Champions League',
    'UEFA Europa League',
  ]) {
    assert.equal(
      qualifiesLiveChannel(channel(`LIVE | Alpha FC vs Beta FC | ${competition}`), 'main_soccer'),
      true,
      competition,
    );
  }
});

test('structured AREA69 event timing cannot label a future or ended matchup as current', () => {
  const future: LiveChannelMeta = {
    ...channel('LIVE | Arsenal vs Liverpool | Premier League | 4K'),
    event: { status: 'listed', starts_at: Date.now() + 60_000, ends_at: Date.now() + 120_000 },
  };
  const current: LiveChannelMeta = {
    ...channel('Arsenal vs Liverpool | Premier League | 4K'),
    releaseInfo: 'Premier League · Arsenal vs Liverpool',
    event: { status: 'live' },
  };
  const ended: LiveChannelMeta = {
    ...current,
    event: { status: 'ended' },
  };
  assert.equal(qualifiesLiveChannel(future, 'main_soccer'), false);
  assert.equal(qualifiesLiveChannel(current, 'main_soccer'), true);
  assert.equal(qualifiesLiveChannel(ended, 'main_soccer'), false);
});

test('standing allowlists are exact and bounded by their curated identities', () => {
  assert.equal(qualifiesLiveChannel(channel('4K: SKY SPORTS F1 UHD'), 'f1_standing_allowlist'), true);
  for (const approved of ['F1 TV', 'Sky Sports F1', 'DAZN F1', 'Viaplay F1']) {
    assert.equal(qualifiesLiveChannel(channel(approved), 'f1_standing_allowlist'), true, approved);
  }
  assert.equal(qualifiesLiveChannel(channel('Sky Sports Main Event'), 'f1_standing_allowlist'), false);
  assert.equal(qualifiesLiveChannel(channel('Aaj Tak HD (1080p)'), 'balanced_news'), true);
  assert.equal(qualifiesLiveChannel(channel('PRIME: BBC NEWS ᴿᴬᵂ'), 'balanced_news'), true);
  assert.equal(qualifiesLiveChannel(channel('CNN International'), 'balanced_news'), false);
  for (const approved of [
    'NDTV 24x7', 'India Today', 'WION', 'Times Now News',
    'Aaj Tak', 'NDTV India', 'ABP News', 'Republic Bharat',
    'BBC News', 'Sky News', 'Al Jazeera English', 'NBC News Now',
  ]) {
    assert.equal(qualifiesLiveChannel(channel(approved), 'balanced_news'), true, approved);
  }
  assert.equal(qualifiesLiveChannel(channel('Republic TV'), 'balanced_news'), false);
  assert.equal(qualifiesLiveChannel(channel('Aaj Tak Bangla HD'), 'balanced_news'), false);
  assert.equal(qualifiesLiveChannel(channel('Moonbug Kids (1080p)', undefined, ['English']), 'english_hindi_cartoons'), true);
  assert.equal(qualifiesLiveChannel(channel('Moonbug Kids (1080p)'), 'english_hindi_cartoons'), true);
  assert.equal(qualifiesLiveChannel(channel('Moonbug Kids (1080p)', undefined, ['Spanish']), 'english_hindi_cartoons'), false);
  assert.equal(qualifiesLiveChannel(channel('Nickelodeon Clasico (720p)', undefined, ['English']), 'english_hindi_cartoons'), false);
});

test('canonical key collapses only quality/status variants after ranking', () => {
  const best = channel('LIVE | France vs Brazil | FIFA World Cup | 8K EXCLUSIVE');
  const lower = channel('France vs Brazil | FIFA World Cup | 1080p');
  assert.equal(canonicalLiveChannelKey(best), canonicalLiveChannelKey(lower));
  assert.deepEqual(dedupeLiveChannelsByCanonicalKey([best, lower]), [best]);
});
