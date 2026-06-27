#!/usr/bin/env bash
# Fast catalog-service unit slice for gate-lite (~30s). Full suite: npm test in catalog-service.

set -euo pipefail

CATALOG_DIR="${1:?catalog-service path}"

(
  cd "$CATALOG_DIR"
  if [[ ! -f dist/play-ladder.test.js ]]; then
    npm run build >/dev/null
  fi
  node --test \
    dist/catalog-errors.test.js \
    dist/live-rails.test.js \
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
    dist/youtube/playback.test.js \
    dist/youtube/service.test.js \
    dist/core-library-rails.test.js \
    dist/ai-catalogs/store.test.js \
    dist/ai-catalogs/list-source.test.js \
    dist/stream-filters.test.js
)
