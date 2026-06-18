#!/usr/bin/env bash
# Explicit native-N0 fallback wrapper for Stremio desktop.

set -euo pipefail

if [[ "${MANGO_FALLBACK_STREMIO:-0}" != "1" ]]; then
  echo "Stremio fallback disabled. Set MANGO_FALLBACK_STREMIO=1 to use it." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/../launch-stremio.sh"
