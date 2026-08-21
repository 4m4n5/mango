#!/usr/bin/env bash
# Library Grower monitor — baseline, status, watch, assess.
#
# Usage:
#   python3 scripts/diag/grow_monitor.py baseline
#   python3 scripts/diag/grow_monitor.py status [--json]
#   python3 scripts/diag/grow_monitor.py watch [--interval 30] [--max-polls 20]
#   python3 scripts/diag/grow_monitor.py assess [--refresh-json path] [--json]
#
# Mac → Pi:
#   bash scripts/pi-exec.sh 'cd ~/mango && python3 scripts/diag/grow_monitor.py status'

set -euo pipefail
REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
exec python3 "$REPO_DIR/scripts/diag/grow_monitor.py" "$@"
