#!/usr/bin/env bash
# Legacy name — unified TV pad router (Stremio + Kodi + launcher).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/start-mango-tv-pad.sh"
