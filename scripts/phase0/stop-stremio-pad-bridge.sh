#!/usr/bin/env bash
# Legacy name — stop unified TV pad router.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/stop-mango-tv-pad.sh"
