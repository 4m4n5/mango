# Content and playback

**Status:** [STATUS.md](../STATUS.md) · **Rail sources:**
[../../config/catalog-rail-curation.md](../../config/catalog-rail-curation.md)

## Topology

AIOStreams is the intended sole stream-capable VOD aggregate. Cinemeta,
AIOMetadata, optional regional catalogs, and Live addons provide metadata or
Live roles. Nested indexers and debrid accounts stay behind AIOStreams.

Catalog-service still contains an optional legacy direct MediaFusion
thin-pool supplement when `MANGO_MEDIAFUSION_MANIFEST` or
`$HOME/.config/mango/mediafusion.manifest` is present. Treat that as an
unresolved exception: remove it or feature-gate it before calling the runtime
AIO-only.

## Playback

`mpv-play.sh` owns the daily player. Resolve and probe stay display-neutral.
The launcher hides only after advancing media is proven. Failed candidates
restore the exact launcher state.

- YouTube is capped at 1080p. VOD may source-match 4K SDR HEVC; native HDR
  is unsupported on X11/mpv.
- Split YouTube audio/video must prove real AO and aligned audio PTS before
  unpause. See `wait_mpv_split_audio_ready` in `mpv-play.sh`.
- The HUD is `mango-hud.lua` inside mpv. The Tk OSD is not the default path.
- Deferred `vo=null` applies to every non-live VOD (movies, series, YouTube).
- Uncached Real-Debrid stays excluded upstream; uncached TorBox remains a
  last-resort playback candidate. Garbage debrid failures are session-blacklisted
  by service-scoped stable release identity.

## Playability and grow

`/etc/mango/playability.db` stores verified titles, rail membership, and
URL-free path evidence. Browse rails show only currently verified members.

Grow is couch-silent maintenance: it uses a staged work DB, publishes
atomically, and defers when the activity marker shows real pad, launcher,
voice, or playback use. `grow_per_pass` defaults to 20. Missing a per-rail
target is an SLA warning, not a publish blocker if the run completes cleanly.

## Shuffle and recommendations

Browse v3 deals from a complete eligibility index. X is a cached weighted
sample (95% relevance, 5% uniform) with no provider or rank work.

Household VOD rails learn from Fire/Water ratings, Saved, and bounded watch
evidence. StoryDNA enrichment is content-only; it never sees household state.
Modes: `MANGO_VOD_RECS_V2=off|shadow|serve`.

Fire and Water are independent 0–5 ratings in half-point increments.

## Deep ops

Timer and grow procedures: [../../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md](../../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md).
Addon topology: [../reference/addon-stack.md](../reference/addon-stack.md).
