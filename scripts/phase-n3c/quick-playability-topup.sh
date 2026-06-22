#!/usr/bin/env bash
# Quick playability top-up — ~10 min additive pass when stepping away.
#
# One full refresh: up to 10 fresh probes per rail, +8 verified cap per rail.
# Couch down for the run; stack restored automatically on exit.
#
# Usage:
#   bash scripts/phase-n3c/quick-playability-topup.sh
#   bash scripts/phase-n3c/quick-playability-topup.sh --detach
#   bash scripts/phase-n3c/quick-playability-topup.sh --status
#
# Env (defaults tuned for ~10 min on 12 rails):
#   MANGO_PLAYABILITY_FRESH_PER_RAIL=10
#   MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH=8
#   MANGO_PLAYABILITY_PROBE_CONCURRENCY=3
#   MANGO_PLAYABILITY_RESOLVE_CONCURRENCY=8

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOG="${CACHE_DIR}/quick-topup.log"
PIDFILE="${CACHE_DIR}/quick-topup.pid"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"
}

usage() {
  cat <<EOF
usage:
  $0 --detach    start in background (~10 min); safe if SSH drops
  $0 --status    show pid + recent log
  $0             run in foreground
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--status" ]]; then
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "running pid=$(cat "$PIDFILE")"
  else
    echo "not running"
  fi
  echo "log: $LOG"
  if [[ -f "$LOG" ]]; then
    echo "--- last 25 lines ---"
    tail -25 "$LOG"
  fi
  exit 0
fi

run_topup() {
  mkdir -p "$CACHE_DIR"
  touch "$LOG"

  if [[ -f "${CACHE_DIR}/overnight-fill.pid" ]] && kill -0 "$(cat "${CACHE_DIR}/overnight-fill.pid")" 2>/dev/null; then
    log "skip: overnight fill running"
    echo "overnight fill already running — try later" >&2
    exit 2
  fi

  export MANGO_PLAYABILITY_FRESH_PER_RAIL="${MANGO_PLAYABILITY_FRESH_PER_RAIL:-10}"
  export MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH="${MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH:-8}"
  export MANGO_PLAYABILITY_MAX_INGEST_SCAN="${MANGO_PLAYABILITY_MAX_INGEST_SCAN:-600}"
  export MANGO_PLAYABILITY_PROBE_POOL=1
  export MANGO_PLAYABILITY_BATCH_DB=1
  export MANGO_PLAYABILITY_RESOLVE_CONCURRENCY="${MANGO_PLAYABILITY_RESOLVE_CONCURRENCY:-8}"
  export MANGO_PLAYABILITY_PROBE_CONCURRENCY="${MANGO_PLAYABILITY_PROBE_CONCURRENCY:-3}"
  export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-6000}"
  export MANGO_PLAYABILITY_BOOTSTRAP=0
  export MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY=0
  export MANGO_MAINTENANCE_SKIP_GATE=1
  export MANGO_MAINTENANCE_ALLOW_PARTIAL=1

  log "=== quick top-up start fresh_per_rail=$MANGO_PLAYABILITY_FRESH_PER_RAIL growth=$MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH ==="

  cd "$REPO_DIR"
  rm -f "${CACHE_DIR}/playability-maintenance.lock"

  set +e
  export MANGO_GROW_PRESET=quick
  bash "$REPO_DIR/scripts/phase-n3c/playability-maintenance.sh" --mode grow >>"$LOG" 2>&1
  local rc=$?
  set -e

  log "=== quick top-up done rc=$rc ==="
  if command -v python3 >/dev/null 2>&1 && [[ -f "$REPO_DIR/scripts/diag/playability-status.py" ]]; then
    python3 "$REPO_DIR/scripts/diag/playability-status.py" >>"$LOG" 2>&1 || true
  fi
  rm -f "$PIDFILE"
  return "$rc"
}

if [[ "${1:-}" == "--detach" ]]; then
  mkdir -p "$CACHE_DIR"
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running pid=$(cat "$PIDFILE") log=$LOG"
    exit 0
  fi
  nohup env MANGO_REPO_DIR="$REPO_DIR" bash "$0" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  disown -h 2>/dev/null || true
  echo "started pid=$(cat "$PIDFILE") log=$LOG (~10 min)"
  echo "check: bash $0 --status"
  exit 0
fi

echo $$ >"$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT
run_topup
