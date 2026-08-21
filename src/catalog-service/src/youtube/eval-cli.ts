import { writeFileSync } from 'node:fs';
import { householdWatchAnchors } from './taste.js';
import { initYoutubeDb, latestYoutubeV2Generation } from './db.js';
import { rebuildYoutubeV2Generation } from './v2.js';
import type { YoutubeScoringVariant } from './taste.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_WEEKS = Math.max(1, Number(process.env.MANGO_YOUTUBE_EVAL_HOLD_WEEKS || 4));
const K = Math.max(1, Number(process.env.MANGO_YOUTUBE_EVAL_K || 40));
const VARIANTS: YoutubeScoringVariant[] = ['legacy', 'v3', 'v3-embed'];

function hitRate(holdout: ReadonlySet<string>, recommended: readonly string[]): number {
  if (holdout.size === 0) return 0;
  let hits = 0;
  for (const id of recommended) {
    if (holdout.has(id)) hits += 1;
  }
  return hits / holdout.size;
}

function coverage(recommended: readonly string[], universe: number): number {
  if (universe <= 0) return 0;
  return new Set(recommended).size / universe;
}

export function evaluateYoutubeVariants(at = Date.now()): Record<string, unknown> {
  initYoutubeDb();
  const watchUntil = at - HOLD_WEEKS * 7 * DAY_MS;
  const all = householdWatchAnchors({ at });
  const holdout = all.filter((watch) => watch.watched_at > watchUntil);
  const holdoutVideos = new Set(holdout.map((watch) => watch.id));
  const holdoutChannels = new Set(holdout.map((watch) => watch.channel_id).filter(Boolean) as string[]);
  const variants = VARIANTS.map((variant) => {
    rebuildYoutubeV2Generation({
      force: true,
      at,
      watchUntil,
      scoringVariant: variant,
    });
    const generation = latestYoutubeV2Generation();
    const ranked = (generation?.items ?? [])
      .filter((item) => (
        item.rail_id === 'for_you'
        || item.rail_id === 'frequently_watched'
        || item.rail_id === 'more_like'
      ))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, K);
    const ids = ranked.map((item) => item.id);
    const channels = ranked.map((item) => item.channel_id).filter(Boolean) as string[];
    return {
      variant,
      model_version: generation?.model_version ?? null,
      candidate_count: generation?.candidate_count ?? 0,
      k: K,
      video_hit_rate_at_k: Number(hitRate(holdoutVideos, ids).toFixed(4)),
      channel_hit_rate_at_k: Number(hitRate(holdoutChannels, channels).toFixed(4)),
      coverage: Number(coverage(ids, Math.max(1, generation?.candidate_count ?? 0)).toFixed(4)),
    };
  });
  return {
    ok: true,
    at,
    hold_weeks: HOLD_WEEKS,
    holdout_videos: holdoutVideos.size,
    holdout_channels: holdoutChannels.size,
    variants,
  };
}

function main(): void {
  const report = evaluateYoutubeVariants();
  const out = process.env.MANGO_YOUTUBE_EVAL_OUT?.trim();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (out) writeFileSync(out, serialized);
  process.stdout.write(serialized);
}

if (process.argv[1] && /eval-cli\.js$/.test(process.argv[1])) {
  main();
}
