#!/usr/bin/env bash
# Library Grower — unified playability growth entrypoint.
#
# Usage:
#   bash scripts/m3-play/playability/playability-grow.sh --mode grow|stale|nightly [--preset quick|nightly|overnight]
#   bash scripts/m3-play/playability/playability-grow.sh --mode grow --preset quick --detach
#   bash scripts/m3-play/playability/playability-grow.sh --status
#
# Modes:
#   grow    — grow pass only (Library Grower inner loop per rail)
#   stale   — re-probe stale titles only
#   nightly — stale all rails, then grow (Pi timer default)
#
# Presets set MANGO_GROW_PRESET wall/attempt limits for grow phases.
# Default: quick for --mode grow, nightly for --mode nightly (override with --preset or env).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOG="${CACHE_DIR}/playability-grow.log"
COORDINATOR="$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh"

MODE="${MANGO_PLAYABILITY_REFRESH_MODE:-grow}"
PRESET="${MANGO_GROW_PRESET:-}"
DETACH=0

usage() {
  cat <<EOF
usage:
  $0 [--mode grow|stale|nightly] [--preset quick|nightly|overnight]
  $0 --detach   run in background (nohup)
  $0 --status   show current/last durable run status
EOF
}

normalize_mode() {
  case "$1" in
    grow|stale|nightly) echo "$1" ;;
    full|growth)
      echo "playability-grow: mode '$1' deprecated — use grow or nightly" >&2
      echo grow
      ;;
    *)
      echo "mode must be grow, stale, or nightly (got: $1)" >&2
      exit 2
      ;;
  esac
}

normalize_preset() {
  case "$1" in
    quick|nightly|overnight) echo "$1" ;;
    *)
      echo "preset must be quick, nightly, or overnight (got: $1)" >&2
      exit 2
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --preset) PRESET="${2:-}"; shift 2 ;;
    --detach) DETACH=1; shift ;;
    --status) MODE=__status; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "$MODE" == "__status" ]]; then
  python3 "$REPO_DIR/scripts/diag/grow_monitor.py" status || true
  exit 0
fi

MODE="$(normalize_mode "$MODE")"
if [[ -z "$PRESET" ]]; then
  PRESET=$([[ "$MODE" == "grow" ]] && echo quick || echo nightly)
fi
PRESET="$(normalize_preset "$PRESET")"

if [[ "${MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD:-0}" != "1" ]]; then
  case "$MODE:$PRESET" in
    stale:*) LEVEL=stale_refresh ;;
    nightly:*) LEVEL=grow_nightly ;;
    grow:quick) LEVEL=grow_quick ;;
    grow:nightly) LEVEL=grow_standard ;;
    grow:overnight) LEVEL=grow_overnight ;;
    *) echo "unsupported coordinated grow mode: $MODE preset=$PRESET" >&2; exit 2 ;;
  esac
  RUN_ID="playability-$(python3 -c 'import uuid; print(uuid.uuid4())')"
  if [[ "$DETACH" -eq 1 ]]; then
    mkdir -p "$CACHE_DIR"
    nohup bash "$COORDINATOR" --run-id "$RUN_ID" --level "$LEVEL" >>"$LOG" 2>&1 &
    CLAIM_FILE="${CACHE_DIR}/playability-runs/${RUN_ID}.claim.json"
    CLAIM_STATE=""
    ACTIVE_RUN_ID=""
    for _ in $(seq 1 100); do
      if [[ -f "$CLAIM_FILE" ]]; then
        read -r CLAIM_STATE ACTIVE_RUN_ID < <(python3 - "$CLAIM_FILE" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    claim = json.load(handle)
print(claim.get("state", ""), claim.get("active_run_id", ""))
PY
        )
        [[ -n "$CLAIM_STATE" ]] && break
      fi
      sleep 0.02
    done
    if [[ "$CLAIM_STATE" == "claimed" ]]; then
      echo "started run_id=$RUN_ID state=claimed mode=$MODE preset=$PRESET log=$LOG"
      exit 0
    fi
    if [[ "$CLAIM_STATE" == "busy" ]]; then
      echo "playability job already running active_run_id=${ACTIVE_RUN_ID:-unknown}" >&2
      exit 75
    fi
    echo "playability coordinator did not acknowledge run_id=$RUN_ID" >&2
    exit 1
  fi
  exec bash "$COORDINATOR" --run-id "$RUN_ID" --level "$LEVEL"
fi

if [[ "$DETACH" -eq 1 ]]; then
  echo "--detach is invalid inside an already claimed coordinator run" >&2
  exit 2
fi

mkdir -p "$CACHE_DIR"
touch "$LOG"

echo "playability-grow: mode=$MODE preset=$PRESET" | tee -a "$LOG"
export MANGO_GROW_PRESET="$PRESET"
MANGO_GROW_LOG_WRAPPED=1 bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode "$MODE" 2>&1 | tee -a "$LOG"
