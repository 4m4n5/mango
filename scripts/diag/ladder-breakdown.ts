#!/usr/bin/env -S npm --prefix src/catalog-service exec tsx --

import { CatalogCore } from '../../src/catalog-service/src/core.js';
import {
  expandPlayLadder,
  filterStreamsForLadderStep,
} from '../../src/catalog-service/src/play-ladder.js';

async function main(): Promise<void> {
  const [type, id] = process.argv.slice(2);
  if (!type || !id) {
    console.error('usage: ladder-breakdown.ts <movie|series> <id>');
    process.exit(2);
  }

  const core = await CatalogCore.create();
  const resolved = await core.resolveForPlay(type, id);
  const ladder = resolved.filters.play_ladder;
  const ctx = resolved.filterContext;
  const strict = resolved.filters.strict_unknown_cache !== false;

  const perStep = Object.fromEntries(
    ladder.map((step) => [
      step.step,
      filterStreamsForLadderStep(resolved.streams, step, ctx, {
        strict_unknown_cache: strict,
        preferred_quality: resolved.filters.preferred_quality,
      }).length,
    ]),
  );

  const candidates = expandPlayLadder(resolved.streams, ladder, ctx, {
    strict_unknown_cache: strict,
    preferred_quality: resolved.filters.preferred_quality,
    max_candidates: resolved.filters.auto_play_max_attempts,
  });

  const picker = await core.streams(type, id);

  console.log(JSON.stringify({
    type,
    id,
    metaTitle: ctx.metaTitle,
    metaRuntimeMinutes: ctx.metaRuntimeMinutes,
    raw: resolved.streams.length,
    per_step: perStep,
    play_candidates: candidates.length,
    play_order: candidates.slice(0, 8).map((c) => ({
      step: c.ladder_step,
      label: c.stream.display_label,
      cache: c.stream.cache_status,
      filename: (c.stream as { behaviorHints?: { filename?: string } }).behaviorHints?.filename,
    })),
    picker_returned: picker.streams.length,
    picker_preview: picker.filters.play_ladder_preview ?? false,
    picker_top: picker.streams[0]
      ? {
        step: (picker.streams[0] as { ladder_step?: string }).ladder_step,
        label: picker.streams[0].display_label,
        filename: (picker.streams[0] as { behaviorHints?: { filename?: string } }).behaviorHints?.filename,
      }
      : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
