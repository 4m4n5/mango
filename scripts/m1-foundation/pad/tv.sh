#!/usr/bin/env bash
# Daily TV launcher — connect pad + Kodi or Stremio with correct gamepad stack.
# Run on the Pi: bash scripts/m1-foundation/pad/tv.sh kodi|stremio

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  echo "Usage: bash scripts/m1-foundation/pad/tv.sh {kodi|stremio}"
  exit 1
}

[[ $# -eq 1 ]] || usage

bash "$SCRIPT_DIR/connect-gamepad.sh"

case "$1" in
  kodi|youtube)
    bash "$SCRIPT_DIR/launch-kodi.sh"
    ;;
  stremio)
    bash "$SCRIPT_DIR/reset-stremio.sh"
    ;;
  *)
    usage
    ;;
esac
