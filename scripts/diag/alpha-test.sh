#!/usr/bin/env bash
# Legacy Phase 0 couch session (Stremio/Kodi matrix). Native deploy: use gate-lite instead.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/restart-with-diag.sh"
