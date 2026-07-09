#!/usr/bin/env bash
# Explicit operator catch-up for playability maintenance after a missed/failed
# nightly. This is the supported retry path (no daytime auto-retry timer).
#
# Usage (couch idle):
#   bash scripts/m3-play/playability/playability-catch-up.sh nightly

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

MODE="${1:-nightly}"
case "$MODE" in
  nightly|grow|stale) ;;
  *)
    echo "usage: $0 [nightly|grow|stale]" >&2
    exit 2
    ;;
esac

if [[ "$MODE" == "nightly" ]]; then
  exec bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly
fi

exec bash scripts/m3-play/playability/playability-maintenance.sh --mode "$MODE"
