#!/usr/bin/env bash
# Fast catalog-service unit slice for gate-lite (~30s). Full suite: npm test in catalog-service.

set -euo pipefail

CATALOG_DIR="${1:?catalog-service path}"

(
  cd "$CATALOG_DIR"
  # Always clean+rebuild. A renamed/deleted source test must never leave an
  # orphan dist test executing or let this safety slice trust stale output.
  npm run build >/dev/null
  # The Pi gate inherits voice.env from the parent pre-couch script. Unit tests
  # must exercise their own fixtures, never production rollout/provider flags
  # or runtime database paths.
  env \
    -u MANGO_LIBRARY_DB_PATH \
    -u MANGO_PLAYABILITY_DB \
    -u MANGO_USER_PINS_PATH \
    -u MANGO_YOUTUBE_DB_PATH \
    -u MANGO_FIRE_WATER_RATINGS \
    -u MANGO_FOR_YOU \
    -u MANGO_VOD_RECS_V2 \
    -u MANGO_VOD_BROWSE_V3 \
    -u MANGO_YOUTUBE_RECS_V2 \
    -u MANGO_STORY_DNA \
    -u MANGO_STORY_DNA_WORKER_MODE \
    -u MANGO_STORY_DNA_BATCH \
    -u MANGO_STORY_DNA_FRONTIER_BATCH \
    -u MANGO_STORY_DNA_FRONTIER_COALESCE_MS \
    -u MANGO_STORY_DNA_FRONTIER_NIGHTLY_PER_TYPE \
    -u MANGO_STORY_DNA_FRONTIER_ROLLING_30D \
    -u MANGO_STORY_DNA_FRONTIER_RUN_MS \
    -u MANGO_STORY_DNA_MODEL_VERSION \
    -u MANGO_STORY_DNA_TIMEOUT_MS \
    -u MANGO_STORY_DNA_URL \
    -u MANGO_STORY_GRAPH_RANK_TIMEOUT_MS \
    -u MANGO_TMDB_API_KEY \
    -u MANGO_TMDB_API_KEY_FILE \
    -u MANGO_TMDB_API_TOKEN \
    -u MANGO_TMDB_METADATA \
    -u MANGO_TMDB_REQUESTS_PER_SECOND \
    -u MANGO_VOD_STORY_GRAPH_BOOTSTRAP_MIN \
    -u MANGO_VOD_STORY_GRAPH_COUCH_QUEUE_SCAN \
    -u MANGO_VOD_STORY_GRAPH_FIT_FLOOR \
    -u MANGO_VOD_STORY_GRAPH_PRIORITY_RESERVE \
    node --test \
    dist/play-deadline.test.js \
    dist/play-cancel.test.js \
    dist/play-request-registry.test.js \
    dist/playback-session.test.js \
    dist/episode-playability-reconcile.test.js \
    dist/play-error-classify.test.js \
    dist/playback-telemetry.test.js \
    dist/scoped-child.test.js \
    dist/mpv-policy-args.test.js \
    dist/playback-ownership.test.js \
    dist/stream-flight.test.js \
    dist/aiostreams-policy.test.js \
    dist/core-invalidate-streams.test.js \
    dist/core-stream-resolve.test.js \
    dist/resolve-metrics.test.js \
    dist/core-stream-identity.test.js \
    dist/playability/trigger-consumer.test.js \
    dist/catalog-errors.test.js \
    dist/personalization-coherence.test.js \
    dist/personalization-request.test.js \
    dist/recommendations/*.test.js \
    dist/live-rails.test.js \
    dist/live/qualification.test.js \
    dist/live-rails-cache.test.js \
    dist/play-ladder.test.js \
    dist/play-orchestrator.test.js \
    dist/preflight-playback.test.js \
    dist/library/db.test.js \
    dist/user-pins.test.js \
    dist/progress/progress.test.js \
    dist/progress/next-prompt.test.js \
    dist/episodes.test.js \
    dist/meta-merge.test.js \
    dist/bonus-stream-resolve.test.js \
    dist/voice/search.test.js \
    dist/voice/tools.test.js \
    dist/search/normalize.test.js \
    dist/search/service.test.js \
    dist/youtube/*.test.js \
    dist/core-library-rails.test.js \
    dist/ai-catalogs/store.test.js \
    dist/ai-catalogs/list-source.test.js \
    dist/stream-filters.test.js
)

# Route wiring is intentionally source-gated because index.ts owns the HTTP
# acceptance boundary and is not imported by unit tests (importing it would
# start the production listener). Keep stale Detail actions fail-closed and
# prevent display-only rail labels from ever becoming recommendation metrics.
python3 - "$CATALOG_DIR/src/index.ts" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
ratings = source.split("parts[0] === 'library' && parts[1] === 'ratings'", 1)[1].split(
    "parts[0] === 'recommendations' && parts[1] === 'state'", 1,
)[0]
for contract in (
    "parseExpectedPersonalization(url.searchParams)",
    "parseExpectedPersonalizationBody(body)",
    "before rating state loaded",
    "before rating changed",
    "before rating cleared",
    "personalization_updated_at: personalization.updated_at",
):
    if contract not in ratings:
        raise SystemExit(f"rating route missing profile ownership contract: {contract}")

saved = source.split("parts[0] === 'library' && parts[1] === 'saved'", 1)[1].split(
    "parts[0] === 'library' && parts[1] === 'history'", 1,
)[0]
for contract in (
    "before Saved target resolved",
    "before Saved state changed",
    "saved.source !== SYNTHETIC_LIBRARY_SOURCE",
    "target.source !== SYNTHETIC_LIBRARY_SOURCE",
    "profile_id: personalization.active_profile_id",
    "personalization_updated_at: personalization.updated_at",
):
    if contract not in saved:
        raise SystemExit(f"Saved route missing profile ownership contract: {contract}")

play = source.split("parts[0] === 'play-session'", 1)[1].split(
    "parts[0] === 'play-session'", 1,
)[0]
if "before playback accepted" not in play or "expectedPersonalization" not in play:
    raise SystemExit("play-session route missing immutable profile acceptance")
if "incrementRecommendationMetric('play_starts_for_you')" in source:
    raise SystemExit("play-session trusts client rail_id for recommendation metrics")

youtube_rails = source.split("YouTube recommendation attribution context is unavailable", 1)[1].split(
    "parts[1] === 'impressions'", 1,
)[0]
persist = youtube_rails.find("registerRecommendationServedSlates(servedInputs)")
respond = youtube_rails.find("sendJson(res, 200, publicResult)")
if persist < 0 or respond < 0 or persist > respond:
    raise SystemExit("YouTube rails must persist served slates before the visible response")
if "setImmediate" in youtube_rails:
    raise SystemExit("YouTube rails must not defer served-slate persistence")

play_accept = source.split("async function startPlaybackSession", 1)[1].split(
    "const existing = await getPlaybackSession", 1,
)[0]
if "playbackRecommendationAttributionFromBody" not in play_accept:
    raise SystemExit("play-session must fail-open stale recommendation slates")
PY
