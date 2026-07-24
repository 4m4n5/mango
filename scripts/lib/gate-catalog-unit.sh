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
    dist/core-stream-identity.test.js \
    dist/playability/trigger-consumer.test.js \
    dist/catalog-errors.test.js \
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
    dist/youtube/db.test.js \
    dist/youtube/api.test.js \
    dist/youtube/playback.test.js \
    dist/youtube/service.test.js \
    dist/core-library-rails.test.js \
    dist/ai-catalogs/store.test.js \
    dist/ai-catalogs/list-source.test.js \
    dist/stream-filters.test.js
)
