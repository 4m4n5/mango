#!/usr/bin/env bash
# Dispatcher for settings UI / POST /playability/refresh (Library Grower PR4).
#
# Usage: bash scripts/m3-play/playability/playability-refresh-level.sh <level-id>
#
# Levels:
#   shuffle_rails   — instant reshuffle (inline, no shell grow)
#   stale_refresh   — stale re-probe
#   grow_quick      — grow pass, quick preset (~10 min)
#   grow_nightly    — nightly sequence (stale → grow)
#   grow_overnight  — grow pass, overnight preset (~4 h)
#
# Legacy aliases: quick_topup, topup_low_rails, full_maintenance, growth_pass, overnight_grow

set -euo pipefail

LEVEL="${1:-}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export MANGO_MAINTENANCE_SKIP_GATE=1
export MANGO_PLAYABILITY_BOOTSTRAP=0
export MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY=0

resolve_level() {
  case "$1" in
    shuffle_rails) echo shuffle_rails ;;
    stale_refresh) echo stale_refresh ;;
    grow_quick|quick_topup|topup_low_rails) echo grow_quick ;;
    grow_nightly|full_maintenance|growth_pass) echo grow_nightly ;;
    grow_overnight|overnight_grow) echo grow_overnight ;;
    *)
      echo "unknown refresh level: $1" >&2
      exit 2
      ;;
  esac
}

RESOLVED="$(resolve_level "$LEVEL")"

case "$RESOLVED" in
  shuffle_rails)
    echo "shuffle_rails is handled inline by catalog-service" >&2
    exit 2
    ;;
  stale_refresh)
    exec bash scripts/m3-play/playability/playability-grow.sh --mode stale
    ;;
  grow_quick)
    exec bash scripts/m3-play/playability/playability-grow.sh --mode grow --preset quick --detach
    ;;
  grow_nightly)
    exec bash scripts/m3-play/playability/playability-grow.sh --mode nightly --preset nightly --detach
    ;;
  grow_overnight)
    exec bash scripts/m3-play/playability/overnight-playability-grow.sh --detach
    ;;
esac
