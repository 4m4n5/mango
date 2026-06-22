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
PIDFILE="${CACHE_DIR}/playability-grow.pid"

MODE="${MANGO_PLAYABILITY_REFRESH_MODE:-grow}"
PRESET="${MANGO_GROW_PRESET:-}"
DETACH=0

usage() {
  cat <<EOF
usage:
  $0 [--mode grow|stale|nightly] [--preset quick|nightly|overnight]
  $0 --detach   run in background (nohup)
  $0 --status   show pid + recent log
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

if [[ "$DETACH" -eq 1 ]]; then
  mkdir -p "$CACHE_DIR"
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running pid=$(cat "$PIDFILE") log=$LOG"
    exit 0
  fi
  nohup env MANGO_REPO_DIR="$REPO_DIR" MANGO_GROW_PRESET="$PRESET" bash "$0" --mode "$MODE" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  disown -h 2>/dev/null || true
  echo "started pid=$(cat "$PIDFILE") mode=$MODE preset=$PRESET log=$LOG"
  echo "check: bash $0 --status"
  exit 0
fi

mkdir -p "$CACHE_DIR"
touch "$LOG"
echo "playability-grow: mode=$MODE preset=$PRESET" | tee -a "$LOG"
export MANGO_GROW_PRESET="$PRESET"
bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode "$MODE" 2>&1 | tee -a "$LOG"
