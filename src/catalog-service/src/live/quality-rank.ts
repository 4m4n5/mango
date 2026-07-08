import type { LiveChannelMeta } from '../live-rails.js';

/** Higher score = prefer earlier in live rails (quality + liveness). */
export function liveChannelQualityScore(name: string): number {
  const text = name.toLowerCase();
  let score = 0;

  if (/\blive\s*\|/.test(text) || /^live\b/.test(text)) {
    score += 2000;
  } else if (/\bend\s*\|/.test(text) || /^end\b/.test(text) || /\bended\b/.test(text)) {
    score -= 800;
  }

  if (/\b8k\b|3840|2160p|³⁸⁴⁰|8k exclusive/.test(text)) {
    score += 900;
  } else if (/\b4k\b|uhd|ᵁᴴᴰ|ultra hd/.test(text)) {
    score += 700;
  } else if (/\bfhd\b|1080|full hd|ᴴᴰ\b|1080p/.test(text)) {
    score += 500;
  } else if (/\bhd\b|720|720p/.test(text)) {
    score += 300;
  } else if (/\bsd\b|576|480p|360p/.test(text)) {
    score += 100;
  }

  if (/\bhevc\b|h265|x265/.test(text)) {
    score += 80;
  }
  if (/\braw\b|ᴿᴬᵂ/.test(text)) {
    score -= 40;
  }

  return score;
}

export function compareLiveChannelsByQuality(
  left: LiveChannelMeta,
  right: LiveChannelMeta,
): number {
  const leftScore = liveChannelQualityScore(left.name || left.title || '');
  const rightScore = liveChannelQualityScore(right.name || right.title || '');
  return rightScore - leftScore;
}

export function sortLiveChannelsByQuality<T extends LiveChannelMeta>(channels: T[]): T[] {
  return channels
    .map((channel, index) => ({ channel, index }))
    .sort((left, right) => {
      const byQuality = compareLiveChannelsByQuality(left.channel, right.channel);
      if (byQuality !== 0) {
        return byQuality;
      }
      return left.index - right.index;
    })
    .map(({ channel }) => channel);
}
