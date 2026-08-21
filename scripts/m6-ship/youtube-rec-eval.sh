#!/usr/bin/env bash
# Offline YouTube recommender holdout eval. Copies DBs when source paths are
# provided so the live catalogs are never mutated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKDIR="$(mktemp -d /tmp/mango-youtube-eval.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

YOUTUBE_SRC="${MANGO_YOUTUBE_EVAL_YOUTUBE_DB:-${MANGO_YOUTUBE_DB_PATH:-}}"
LIBRARY_SRC="${MANGO_YOUTUBE_EVAL_LIBRARY_DB:-${MANGO_LIBRARY_DB_PATH:-}}"

if [[ -n "$YOUTUBE_SRC" && -f "$YOUTUBE_SRC" ]]; then
  cp "$YOUTUBE_SRC" "$WORKDIR/youtube.db"
fi
if [[ -n "$LIBRARY_SRC" && -f "$LIBRARY_SRC" ]]; then
  cp "$LIBRARY_SRC" "$WORKDIR/library.db"
fi

export MANGO_YOUTUBE_DB_PATH="$WORKDIR/youtube.db"
export MANGO_LIBRARY_DB_PATH="$WORKDIR/library.db"
export MANGO_YOUTUBE_EVAL_OUT="${MANGO_YOUTUBE_EVAL_OUT:-$WORKDIR/youtube-rec-eval.json}"

cd "$REPO_ROOT/src/catalog-service"
if [[ ! -f dist/youtube/eval-cli.js ]]; then
  npm run build >/dev/null
fi
node dist/youtube/eval-cli.js
