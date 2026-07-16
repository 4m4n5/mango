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

const FIFA_COMPETITION = /\b(?:fifa(?:\s+men'?s)?\s+world\s+cup|copa\s+mundial\s+de\s+la\s+fifa|copa\s+do\s+mundo\s+da\s+fifa)\b/i;
const FIFA_WRONG_EVENT = /\b(?:women'?s|femenin[oa]|u[- ]?(?:17|20)|under[- ]?(?:17|20)|club|futsal|beach|qualif(?:ier|ying|ication))\b/i;
const INDIA = /\b(?:india|ind)\b/i;
const CRICKET = /\b(?:cricket|icc|odi|t20i?|test\s+match|champions\s+trophy|asia\s+cup)\b/i;
const MAIN_SOCCER = /\b(?:premier\s+league|la\s+liga|bundesliga|serie\s+a|ligue\s+1|uefa\s+champions\s+league|ucl|uefa\s+europa\s+league|uel)\b/i;
const MATCHUP = /\b[\w.'-]+(?:\s+[\w.'-]+){0,3}\s+(?:(?:vs\.?|v\.?|at)\s+|\-\s+)[\w.'-]+/i;
const LIVE_MARKER = /(?:^|[|:\-])\s*live(?:\s|[|:\-]|$)/i;
const NON_LIVE_PROGRAM = /\b(?:replay|ended?|preview|highlights?|studio|analysis|review|classic)\b/i;

const F1_ALLOWLIST = new Set(['sky sports f1', 'f1 tv', 'dazn f1', 'viaplay f1']);
const NEWS_ALLOWLIST = new Set([
  'ndtv 24x7', 'india today', 'wion', 'times now',
  'aaj tak', 'ndtv india', 'abp news', 'republic bharat',
  'bbc news', 'sky news', 'al jazeera english', 'nbc news now',
]);
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
  return startsAt !== undefined && endsAt !== undefined && startsAt <= now && now <= endsAt;
}

function qualifiedCurrentEvent(channel: LiveChannelMeta, competition: RegExp): boolean {
  const name = nameText(channel);
  const program = programText(channel);
  // A named event feed proves itself. A standing sports channel must carry
  // qualifying current-program metadata; its brand alone is never enough.
  return eventMetadataProvesCurrent(channel) && !NON_LIVE_PROGRAM.test(`${name} ${program}`) && (
    (competition.test(name) && LIVE_MARKER.test(name) && MATCHUP.test(name))
    || (competition.test(program) && MATCHUP.test(program))
  );
}

function hasEnglishOrHindiEvidence(channel: LiveChannelMeta): boolean {
  const values = [channel.language, ...(channel.languages ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());
  return values.some((value) => /^(?:en(?:[-_][a-z]{2})?|eng|english|hi(?:[-_][a-z]{2})?|hin|hindi)$/.test(value));
}

export function qualifiesLiveChannel(channel: LiveChannelMeta, policy?: LiveQualificationPolicy): boolean {
  if (!policy) return true;
  const all = `${nameText(channel)} ${programText(channel)}`;
  switch (policy) {
    case 'fifa_mens_world_cup':
      return !FIFA_WRONG_EVENT.test(all) && qualifiedCurrentEvent(channel, FIFA_COMPETITION);
    case 'india_cricket': {
      const name = nameText(channel);
      const program = programText(channel);
      return eventMetadataProvesCurrent(channel) && !NON_LIVE_PROGRAM.test(`${name} ${program}`) && (
        (INDIA.test(name) && CRICKET.test(name) && LIVE_MARKER.test(name) && MATCHUP.test(name))
        || (INDIA.test(program) && CRICKET.test(program) && MATCHUP.test(program))
      );
    }
    case 'main_soccer':
      return qualifiedCurrentEvent(channel, MAIN_SOCCER);
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
