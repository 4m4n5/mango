import type { LiveChannelMeta } from '../live-rails.js';

export const LIVE_QUALIFICATION_POLICIES = [
  'fifa_mens_world_cup',
  'india_cricket',
  'main_soccer',
  'f1_standing_allowlist',
  'balanced_news',
  'english_hindi_cartoons',
] as const;

export type LiveQualificationPolicy = typeof LIVE_QUALIFICATION_POLICIES[number];

// AREA69 names the mens tournament as both "FIFA World Cup …" and numbered
// "World Cup 01 : Team vs Team" PPV slots. Bare "World Cup" alone is not enough —
// that collides with cricket/rugby/softball cups (see FIFA_WRONG_EVENT).
const FIFA_COMPETITION = /\b(?:(?:\d{4}\s+)?fifa(?:\s+men'?s)?\s+world\s+cup|copa\s+mundial\s+de\s+la\s+fifa|copa\s+do\s+mundo\s+da\s+fifa|world\s+cup\s+\d{1,2})\b/i;
const FIFA_WRONG_EVENT = /\b(?:women'?s|femenin[oa]|u[- ]?(?:17|20)|under[- ]?(?:17|20)|club|futsal|beach|qualif(?:ier|ying|ication)|softball|cricket|rugby|hockey|volleyball|baseball)\b/i;
const INDIA = /\b(?:india|ind)\b/i;
const CRICKET = /\b(?:cricket|icc|odi|t20i?|test\s+match|champions\s+trophy|asia\s+cup)\b/i;
const MAIN_SOCCER = /\b(?:premier\s+league|la\s+liga|bundesliga|serie\s+a|ligue\s+1|uefa\s+champions\s+league|ucl|uefa\s+europa\s+league|uel)\b/i;
const MATCHUP = /\b[\w.'-]+(?:\s+[\w.'-]+){0,3}\s+(?:(?:vs\.?|v\.?|at)\s+|\-\s+)[\w.'-]+/i;
const LIVE_MARKER = /(?:^|[|:\-])\s*live(?:\s|[|:\-]|$)/i;
/** Explicit schedule markers in the title — stronger than a bare "listed" status. */
const NAME_NON_CURRENT = /^(?:end(?:ed)?|next|replay)\b/i;
const NON_LIVE_PROGRAM = /\b(?:replay|ended?|preview|highlights?|studio|analysis|review|classic)\b/i;

const F1_ALLOWLIST = new Set(['sky sports f1', 'f1 tv', 'dazn f1', 'viaplay f1']);
const NEWS_ALLOWLIST = new Set([
  'ndtv 24x7', 'india today', 'wion', 'times now',
  'aaj tak', 'ndtv india', 'abp news', 'republic bharat',
  'bbc news', 'sky news', 'al jazeera english', 'nbc news now',
]);
// These are deliberately exact canonical identities from the committed
// curated sports M3U. They are fill channels, never a broad sports keyword
// policy.
const FIFA_STANDING_ALLOWLIST = new Set(['fifa', 'fifa united states']);
const CRICKET_STANDING_ALLOWLIST = new Set([
  'star sports 1', 'star sports 1 hindi', 'star sports 2',
  'willow sports', 'willow cricket', 'dd sports', 'cricket gold',
]);
const SOCCER_STANDING_ALLOWLIST = new Set(['bein sports', 'bein sports usa']);
const CARTOON_ALLOWLIST = new Set([
  'tom and jerry', 'nickelodeon pluto tv', 'nicktoons', 'nick jr',
  'pbs kids eastern central', 'happykids', 'kartoon channel', 'moonbug kids',
]);

function text(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nameText(channel: LiveChannelMeta): string {
  return [channel.name, channel.title].map(text).filter(Boolean).join(' ');
}

function programText(channel: LiveChannelMeta): string {
  // releaseInfo is NexoTV's current-program/EPG field. Description is not proof:
  // it is commonly static channel marketing copy.
  return text(channel.releaseInfo);
}

export function canonicalLiveTitle(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/^(?:live|end(?:ed)?)\s*[|:-]\s*/i, '')
    .replace(/\b(?:8k(?:\s+exclusive)?|4320p?|4k|uhd|ultra\s+hd|2160p?|3840p?|fhd|full\s+hd|1080p?|hd|720p?|sd|576p?|480p?|360p?|hevc|h\.?265|x265|raw)\b/gi, ' ')
    .replace(/[ᴿᴬᵂᵁᴴᴰ³⁸⁴⁰ᴾ⁴³²⁰]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function exactAllowed(channel: LiveChannelMeta, allowlist: ReadonlySet<string>): boolean {
  let key = canonicalLiveTitle(channel.name || channel.title || '').replace(/^prime\s+/, '');
  if (key === 'times now news') key = 'times now';
  return allowlist.has(key);
}

function eventMetadataProvesCurrent(channel: LiveChannelMeta, now = Date.now()): boolean {
  if (!channel.event) return true;
  const status = text(channel.event.status).toLowerCase();
  if (/\b(?:ended?|finished|offline|replay|cancelled|canceled|postponed)\b/.test(status)) {
    return false;
  }
  if (/\b(?:live|current|active|in[ -]?progress|playing)\b/.test(status)) {
    return true;
  }
  const timestamp = (value: string | number | undefined): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 10_000_000_000 ? value * 1000 : value;
    }
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };
  const startsAt = timestamp(channel.event.starts_at);
  const endsAt = timestamp(channel.event.ends_at);
  if (startsAt !== undefined && endsAt !== undefined) {
    return startsAt <= now && now <= endsAt;
  }
  // AREA69 indexes event-shaped rows with status "listed" and no schedule
  // bounds. That must not hard-fail current-event admission — title markers
  // (End/NEXT/Live) and competition+matchup proof decide instead.
  return true;
}

function nameProvesNonCurrent(name: string): boolean {
  const trimmed = name.trim();
  return NAME_NON_CURRENT.test(trimmed) || /^(?:end(?:ed)?|next|replay)\s*[|:-]/i.test(trimmed);
}

function qualifiedCurrentEvent(channel: LiveChannelMeta, competition: RegExp): boolean {
  const name = nameText(channel);
  const program = programText(channel);
  const all = `${name} ${program}`;
  // A named event feed proves itself via competition + matchup. Standing
  // brands alone never qualify here. LIVE| is sufficient but not required —
  // AREA69 PPV rows often omit it ("World Cup 01 : England vs Argentina").
  if (!eventMetadataProvesCurrent(channel) || nameProvesNonCurrent(name) || NON_LIVE_PROGRAM.test(all)) {
    return false;
  }
  const competitionHit = competition.test(name) || competition.test(program);
  const matchupHit = MATCHUP.test(name) || MATCHUP.test(program);
  if (!competitionHit || !matchupHit) {
    return false;
  }
  // Prefer an explicit live marker when present, but competition+matchup on a
  // non-ended/non-next title is enough proof for a current event feed.
  return true;
}

function hasEnglishOrHindiEvidence(channel: LiveChannelMeta): boolean {
  const values = [channel.language, ...(channel.languages ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());
  if (values.length === 0 || values.every((value) => /^(?:und|unknown|un|n\/a|none)$/.test(value))) {
    return true;
  }
  return values.every((value) => /^(?:en(?:[-_][a-z]{2})?|eng|english|hi(?:[-_][a-z]{2})?|hin|hindi)$/.test(value));
}

function standingAllowlistFor(policy: LiveQualificationPolicy): ReadonlySet<string> | undefined {
  switch (policy) {
    case 'fifa_mens_world_cup': return FIFA_STANDING_ALLOWLIST;
    case 'india_cricket': return CRICKET_STANDING_ALLOWLIST;
    case 'main_soccer': return SOCCER_STANDING_ALLOWLIST;
    default: return undefined;
  }
}

function isStandingChannel(channel: LiveChannelMeta, policy: LiveQualificationPolicy): boolean {
  const allowlist = standingAllowlistFor(policy);
  if (!allowlist || !exactAllowed(channel, allowlist)) return false;
  const all = `${nameText(channel)} ${programText(channel)}`;
  if (policy === 'fifa_mens_world_cup' && FIFA_WRONG_EVENT.test(all)) return false;
  if (policy === 'india_cricket'
    && CRICKET.test(programText(channel))
    && MATCHUP.test(programText(channel))
    && !INDIA.test(programText(channel))) {
    return false;
  }
  if (policy === 'main_soccer' && /\bmls\b/i.test(all)) return false;
  return true;
}

export function isCurrentLiveChannel(channel: LiveChannelMeta, policy?: LiveQualificationPolicy): boolean {
  if (!policy) return false;
  const all = `${nameText(channel)} ${programText(channel)}`;
  switch (policy) {
    case 'fifa_mens_world_cup':
      return !FIFA_WRONG_EVENT.test(all) && qualifiedCurrentEvent(channel, FIFA_COMPETITION);
    case 'india_cricket': {
      const name = nameText(channel);
      const program = programText(channel);
      return eventMetadataProvesCurrent(channel)
        && !nameProvesNonCurrent(name)
        && !NON_LIVE_PROGRAM.test(all)
        && (
          (INDIA.test(name) && CRICKET.test(name) && LIVE_MARKER.test(name) && MATCHUP.test(name))
          || (INDIA.test(program) && CRICKET.test(program) && MATCHUP.test(program))
        );
    }
    case 'main_soccer':
      return qualifiedCurrentEvent(channel, MAIN_SOCCER);
    default:
      return false;
  }
}

export function qualifiesLiveChannel(channel: LiveChannelMeta, policy?: LiveQualificationPolicy): boolean {
  if (!policy) return true;
  const all = `${nameText(channel)} ${programText(channel)}`;
  switch (policy) {
    case 'fifa_mens_world_cup':
      return isCurrentLiveChannel(channel, policy) || isStandingChannel(channel, policy);
    case 'india_cricket':
      return isCurrentLiveChannel(channel, policy) || isStandingChannel(channel, policy);
    case 'main_soccer':
      return isCurrentLiveChannel(channel, policy) || isStandingChannel(channel, policy);
    case 'f1_standing_allowlist':
      return exactAllowed(channel, F1_ALLOWLIST);
    case 'balanced_news':
      return exactAllowed(channel, NEWS_ALLOWLIST);
    case 'english_hindi_cartoons':
      return exactAllowed(channel, CARTOON_ALLOWLIST) && hasEnglishOrHindiEvidence(channel);
  }
}

export function canonicalLiveChannelKey(channel: LiveChannelMeta): string {
  return canonicalLiveTitle(channel.name || channel.title || channel.id) || channel.id;
}

export function dedupeLiveChannelsByCanonicalKey<T extends LiveChannelMeta>(channels: T[]): T[] {
  const seen = new Set<string>();
  return channels.filter((channel) => {
    const key = canonicalLiveChannelKey(channel);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
