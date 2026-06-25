#!/usr/bin/env bash
# Explicit operator catch-up for playability maintenance after a missed timer.

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

exec bash scripts/m3-play/playability/playability-maintenance.sh --mode "$MODE"
