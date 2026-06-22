#!/usr/bin/env bash
# Restore input-remapper mango-tv after Stremio pad bridge (no preset rewrite).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/irctl.sh
source "$SCRIPT_DIR/lib/irctl.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

ir_resume_after_bridge "Pro Controller" "mango-tv"

echo "✓ Pro Controller remapper resumed"
