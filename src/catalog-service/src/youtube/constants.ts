/** Exact cards visible in the launcher's single 16:9 TV row. */
export const YOUTUBE_RAIL_LIMIT = 4;

/** Couch display order. Thin rails are omitted, not reordered. */
export const YOUTUBE_V2_DISPLAY_ORDER = [
  'for_you',
  'new_from_subscriptions',
  'frequently_watched',
  'more_like',
  'beyond',
  'history',
  'saved',
  'live_now',
] as const;

/** Resolve up to this many AI-catalog seeds; display is capped at YOUTUBE_RAIL_LIMIT. */
export const YOUTUBE_AI_SEED_POOL = 20;
