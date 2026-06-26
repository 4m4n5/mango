#!/usr/bin/env bash
# Stop stray mpv / playability indexer / gate leftovers / debug shells. Safe during couch use.
# Usage: bash scripts/mango-kill-strays.sh [--dry-run]

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,3p' "$0"
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

clean_pattern() {
  local pattern="$1"
  if (( DRY_RUN == 1 )); then
    pgrep -af "$pattern" 2>/dev/null || true
    return 0
  fi
  pkill -f "$pattern" 2>/dev/null || true
}

clean_pattern 'playability-indexer'
clean_pattern 'tsx.*m3-play/playability'
clean_pattern 'gate-m3-verified-rails'
clean_pattern 'gate-m3-verified'
clean_pattern 'curl.*127.0.0.1:3020/play'
clean_pattern 'node --input-type=module -e.*CatalogCore'
clean_pattern '[b]luetoothctl connect E4:17:D8:EB:00:44'

if (( DRY_RUN == 0 )) && [[ -x "$REPO_DIR/scripts/m2-catalog/service/mpv-stop.sh" ]]; then
  bash "$REPO_DIR/scripts/m2-catalog/service/mpv-stop.sh" 2>/dev/null || true
fi
if (( DRY_RUN == 1 )); then
  pgrep -ax mpv 2>/dev/null || true
else
  pkill -x mpv 2>/dev/null || true
fi

sleep 0.3
remaining=0
if pgrep -x mpv >/dev/null 2>&1; then
  remaining=1
  pgrep -a mpv 2>/dev/null || true
fi
if pgrep -f playability-indexer >/dev/null 2>&1; then
  remaining=1
  pgrep -af playability 2>/dev/null || true
fi
if pgrep -f 'node --input-type=module -e.*CatalogCore' >/dev/null 2>&1; then
  remaining=1
  pgrep -af 'node --input-type=module' 2>/dev/null || true
fi
if pgrep -f '[b]luetoothctl connect E4:17:D8:EB:00:44' >/dev/null 2>&1; then
  remaining=1
  pgrep -af '[b]luetoothctl connect E4:17:D8:EB:00:44' 2>/dev/null || true
fi

if (( remaining != 0 && DRY_RUN == 0 )); then
  echo "strays: some processes remain" >&2
  exit 1
fi

if (( DRY_RUN == 1 )); then
  echo "strays: dry-run complete"
  exit 0
fi

if [[ -x "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" ]]; then
  bash "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" || true
fi

echo "strays: cleared"
