#!/usr/bin/env bash
# Run a catalog playability refresh level in the background (spawned from catalog-service).
#
# All levels are additive: verified titles stay unless status=stale.
#
# Usage: bash scripts/phase-n3c/playability-refresh-level.sh <level-id>
# Levels: stale_refresh | topup_low_rails | quick_topup | full_maintenance | overnight_grow

set -euo pipefail

LEVEL="${1:-}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export MANGO_MAINTENANCE_SKIP_GATE=1
export MANGO_PLAYABILITY_BOOTSTRAP=0
export MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY=0

case "$LEVEL" in
  stale_refresh)
    exec bash scripts/phase-n3c/playability-maintenance.sh --mode stale
    ;;
  topup_low_rails)
    exec bash scripts/phase-n3c/playability-maintenance.sh --mode grow
    ;;
  quick_topup)
    exec bash scripts/phase-n3c/quick-playability-topup.sh --detach
    ;;
  full_maintenance|growth_pass)
    export MANGO_GROW_PRESET="${MANGO_GROW_PRESET:-nightly}"
    exec bash scripts/phase-n3c/playability-maintenance.sh --mode nightly
    ;;
  overnight_grow)
    exec bash scripts/phase-n3c/overnight-playability-grow.sh --detach
    ;;
  *)
    echo "unknown refresh level: $LEVEL" >&2
    exit 2
    ;;
esac
