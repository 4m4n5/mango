#!/usr/bin/env bash
# Fast catalog-service unit slice for gate-lite (~30s). Full suite: npm test in catalog-service.

set -euo pipefail

CATALOG_DIR="${1:?catalog-service path}"

(
  cd "$CATALOG_DIR"
  # Always clean+rebuild. A renamed/deleted source test must never leave an
  # orphan dist test executing or let this safety slice trust stale output.
  npm run build >/dev/null
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
    dist/recommendations/attribution-request.test.js \
    dist/recommendations/ai.test.js \
    dist/recommendations/background-refresh.test.js \
    dist/recommendations/engine.test.js \
    dist/recommendations/evaluation.test.js \
    dist/recommendations/mutation-attribution.test.js \
    dist/recommendations/rank-worker-client.test.js \
    dist/recommendations/service.test.js \
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
    dist/youtube/db.test.js \
    dist/youtube/api.test.js \
    dist/youtube/playback.test.js \
    dist/youtube/service.test.js \
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
PY
