#!/usr/bin/env bash
# Thin Phase 1 wrapper for Kodi / YouTube.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"

bash "$REPO_DIR/scripts/lib/mango-window.sh" hide

exec bash "$REPO_DIR/scripts/phase0/launch-kodi.sh"
