#!/usr/bin/env bash
# Thin Phase 1 wrapper for Kodi / YouTube.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WINDOW_SH="$REPO_DIR/scripts/lib/mango-window.sh"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"

restore_shell() {
  bash "$WINDOW_SH" show 2>/dev/null || true
}
trap restore_shell ERR

bash "$REPO_DIR/scripts/phase0/launch-kodi.sh"
sleep 2
bash "$WINDOW_SH" hide
trap - ERR
