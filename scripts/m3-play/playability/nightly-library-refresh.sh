#!/usr/bin/env bash
# Run movie/TV playability maintenance, then independently refresh YouTube.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOG="${CACHE_DIR}/nightly-library-refresh.log"
PIDFILE="${CACHE_DIR}/nightly-library-refresh.pid"
LOCK_FILE="${CACHE_DIR}/playability-maintenance.lock"
SCRIPT_PATH="$REPO_DIR/scripts/m3-play/playability/nightly-library-refresh.sh"
MODE="${MANGO_PLAYABILITY_REFRESH_MODE:-nightly}"
PRESET="${MANGO_GROW_PRESET:-}"
DETACH=0
STATUS=0

usage() {
  cat <<EOF
usage: $0 [--mode nightly|grow|stale] [--preset quick|nightly|overnight] [--detach] [--status]

Runs playability maintenance first, then runs scripts/m6-ship/youtube-refresh-cache.sh
even when playability exits non-zero. If another playability maintenance lock is
still held after the attempt, YouTube is skipped to avoid overlapping indexers.
EOF
}

normalize_mode() {
  case "$1" in
    nightly|grow|stale) echo "$1" ;;
    *) echo "mode must be nightly, grow, or stale (got: $1)" >&2; exit 2 ;;
  esac
}

normalize_preset() {
  case "$1" in
    quick|nightly|overnight) echo "$1" ;;
    *) echo "preset must be quick, nightly, or overnight (got: $1)" >&2; exit 2 ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --preset) PRESET="${2:-}"; shift 2 ;;
    --detach) DETACH=1; shift ;;
    --status) STATUS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

MODE="$(normalize_mode "$MODE")"
if [[ -n "$PRESET" ]]; then
  PRESET="$(normalize_preset "$PRESET")"
fi

if [[ "$STATUS" -eq 1 ]]; then
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "running pid=$(cat "$PIDFILE")"
  else
    echo "not running"
  fi
  echo "log: $LOG"
  [[ -f "$LOG" ]] && tail -40 "$LOG"
  exit 0
fi

if [[ "$DETACH" -eq 1 ]]; then
  mkdir -p "$CACHE_DIR"
  if [[ -f "$PIDFILE" ]] && ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    rm -f "$PIDFILE"
  fi
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running pid=$(cat "$PIDFILE") log=$LOG"
    exit 0
  fi
  env_args=(MANGO_REPO_DIR="$REPO_DIR" MANGO_PLAYABILITY_REFRESH_MODE="$MODE")
  if [[ -n "$PRESET" ]]; then
    env_args+=(MANGO_GROW_PRESET="$PRESET")
  fi
  env_args+=(MANGO_NIGHTLY_REFRESH_LOG_WRAPPED=1)
  run_args=(--mode "$MODE")
  if [[ -n "$PRESET" ]]; then
    run_args+=(--preset "$PRESET")
  fi
  nohup env "${env_args[@]}" bash "$SCRIPT_PATH" "${run_args[@]}" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  disown -h 2>/dev/null || true
  echo "started pid=$(cat "$PIDFILE") mode=$MODE preset=${PRESET:-auto} log=$LOG"
  echo "check: bash $0 --status"
  exit 0
fi

mkdir -p "$CACHE_DIR"
touch "$LOG"
echo $$ >"$PIDFILE"
if [[ "${MANGO_NIGHTLY_REFRESH_LOG_WRAPPED:-0}" != "1" ]]; then
  exec > >(tee -a "$LOG") 2>&1
fi

cleanup_pidfile() {
  if [[ -f "$PIDFILE" ]] && [[ "$(cat "$PIDFILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "$PIDFILE"
  fi
}
trap cleanup_pidfile EXIT

cd "$REPO_DIR"

if [[ -n "$PRESET" ]]; then
  export MANGO_GROW_PRESET="$PRESET"
fi
export MANGO_PLAYABILITY_REFRESH_MODE="$MODE"

echo "== mango nightly library refresh (mode=$MODE preset=${PRESET:-auto}) =="
PLAYABILITY_RC=0
bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode "$MODE" || PLAYABILITY_RC=$?
echo "nightly library refresh: playability_rc=$PLAYABILITY_RC"

playability_lock_busy() (
  exec 201>"$LOCK_FILE"
  ! flock -n 201
)

YOUTUBE_RC=0
if [[ "${MANGO_NIGHTLY_YOUTUBE_REFRESH:-1}" != "1" ]]; then
  echo "nightly library refresh: youtube skipped (MANGO_NIGHTLY_YOUTUBE_REFRESH=${MANGO_NIGHTLY_YOUTUBE_REFRESH:-})"
elif playability_lock_busy; then
  echo "nightly library refresh: youtube skipped because playability maintenance is still running" >&2
  YOUTUBE_RC=2
else
  bash "$REPO_DIR/scripts/m6-ship/youtube-refresh-cache.sh" \
      --reason "${MANGO_YOUTUBE_REFRESH_REASON:-nightly_after_playability_${MODE}}" \
    || YOUTUBE_RC=$?
fi

echo "nightly library refresh: complete playability_rc=$PLAYABILITY_RC youtube_rc=$YOUTUBE_RC"
if [[ "$PLAYABILITY_RC" -ne 0 || "$YOUTUBE_RC" -ne 0 ]]; then
  exit 1
fi
