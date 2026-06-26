#!/usr/bin/env bash
# Poll Pi grow status from Mac — prints to terminal AND appends to a log file.
#
#   bash scripts/m3-play/playability/monitor-grow-poll.sh              # 15 polls @ 90s
#   bash scripts/m3-play/playability/monitor-grow-poll.sh --interval 60 --max 30
#   bash scripts/m3-play/playability/monitor-grow-poll.sh --log ~/.cache/mango/grow-poll.log
#
# On Pi directly (no SSH):
#   python3 scripts/diag/grow_monitor.py watch --interval 90 2>&1 | tee ~/.cache/mango/grow-watch.log

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
PI_EXEC="$REPO_DIR/scripts/pi-exec.sh"
INTERVAL=90
MAX_POLLS=15
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/mango/grow-poll-mac.log"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="${2:-90}"; shift 2 ;;
    --max) MAX_POLLS="${2:-15}"; shift 2 ;;
    --log) LOG="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$(dirname "$LOG")"
: >>"$LOG"

poll_pi() {
  bash "$PI_EXEC" 'cd ~/mango && python3 scripts/diag/grow_monitor.py status --verbose && echo "--- overnight (last 12) ---" && tail -12 ~/.cache/mango/overnight-fill.log 2>/dev/null'
}

echo "grow poll: log=$LOG interval=${INTERVAL}s max=$MAX_POLLS"
echo "tail -f $LOG   # in another terminal"

for i in $(seq 1 "$MAX_POLLS"); do
  {
    echo ""
    echo "================================================================================"
    echo "POLL $i/$MAX_POLLS — $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "================================================================================"
    poll_pi
  } 2>&1 | tee -a "$LOG"

  if ! bash "$PI_EXEC" 'test -f ~/.cache/mango/overnight-fill.pid && kill -0 "$(cat ~/.cache/mango/overnight-fill.pid)" 2>/dev/null' 2>/dev/null; then
    if ! bash "$PI_EXEC" 'pgrep -f "[p]layability-indexer.ts"' 2>/dev/null; then
      echo "grow/overnight not running — stopping polls" | tee -a "$LOG"
      break
    fi
  fi
  [[ "$i" -lt "$MAX_POLLS" ]] && sleep "$INTERVAL"
done

echo "poll session done $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG"
