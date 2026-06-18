#!/usr/bin/env bash
# Explicit native-N0 fallback wrapper for legacy Kodi YouTube.

set -euo pipefail

if [[ "${MANGO_LEGACY_YOUTUBE:-0}" != "1" ]]; then
  echo "Legacy YouTube disabled. Set MANGO_LEGACY_YOUTUBE=1 to use it." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/../launch-kodi.sh"
