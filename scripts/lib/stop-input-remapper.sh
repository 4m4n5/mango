#!/usr/bin/env bash
# Stop input-remapper when mango-tv-pad owns the pad. Safe to call repeatedly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../phase0/lib/irctl.sh
source "$REPO_DIR/scripts/phase0/lib/irctl.sh"

if pgrep -f '[m]ango-tv-pad\.py' >/dev/null 2>&1 \
  || systemctl --user is-active mango-tv-pad.service &>/dev/null 2>&1; then
  ir_stop_service
fi
