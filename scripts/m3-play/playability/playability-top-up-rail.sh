#!/usr/bin/env bash
# Targeted playability top-up for one rail (maintenance window — stops catalog briefly).
#
# Usage:
#   bash scripts/m3-play/playability/playability-top-up-rail.sh movies-india-trending [--mode grow|incremental] [--pool-target 20]

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

RAIL_ID="${1:-}"
shift || true
POOL_TARGET=""
MODE="${MANGO_TOP_UP_MODE:-grow}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --pool-target) POOL_TARGET="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$RAIL_ID" ]] || { echo "usage: $0 <rail-id> [--mode grow|incremental] [--pool-target N]" >&2; exit 2; }
if [[ "$MODE" != "grow" && "$MODE" != "incremental" ]]; then
  echo "invalid --mode: $MODE (expected grow or incremental)" >&2
  exit 2
fi

RUN_ID="targeted-$(python3 -c 'import uuid; print(uuid.uuid4())')"
if [[ -n "$POOL_TARGET" ]]; then
  echo "note: --pool-target is retained for compatibility; policy-controlled growth bounds apply" >&2
fi
echo "targeted top-up delegates to coordinator run_id=$RUN_ID rail=$RAIL_ID"
export MANGO_PLAYABILITY_TARGET_RAIL="$RAIL_ID"
exec bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id "$RUN_ID" --level grow_quick
