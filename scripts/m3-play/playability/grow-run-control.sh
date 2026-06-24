#!/usr/bin/env bash
# Library Grower run control: start/status/abort/cleanup/benchmark.
#
#   bash scripts/m3-play/playability/grow-run-control.sh start --mode grow --preset quick
#   bash scripts/m3-play/playability/grow-run-control.sh benchmark
#   bash scripts/m3-play/playability/grow-run-control.sh status
#   bash scripts/m3-play/playability/grow-run-control.sh abort
#   bash scripts/m3-play/playability/grow-run-control.sh cleanup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${MANGO_REPO_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
cd "$REPO_DIR"

command="${1:-status}"
shift || true

case "$command" in
  start)
    bash scripts/m3-play/playability/playability-grow.sh "$@" --detach
    ;;
  benchmark)
    MANGO_GROW_PER_PASS="${MANGO_GROW_PER_PASS:-5}" \
    MANGO_GROW_WALL_MS="${MANGO_GROW_WALL_MS:-180000}" \
    MANGO_GROW_MAX_ATTEMPTS="${MANGO_GROW_MAX_ATTEMPTS:-80}" \
      bash scripts/m3-play/playability/playability-grow.sh --mode grow --preset quick --detach
    ;;
  status)
    python3 scripts/diag/grow_monitor.py status "$@"
    ;;
  watch)
    python3 scripts/diag/grow_monitor.py watch "$@"
    ;;
  assess)
    python3 scripts/diag/grow_monitor.py assess "$@"
    ;;
  abort|cleanup)
    bash scripts/m3-play/playability/abort-maintenance-grow.sh
    ;;
  *)
    echo "usage: $0 start|benchmark|status|watch|assess|abort|cleanup [args]" >&2
    exit 2
    ;;
esac
