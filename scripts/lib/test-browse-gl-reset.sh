#!/usr/bin/env bash
# Regression: launcher GL reset is for ≥3k panels only, not every HDMI match.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=mango-browse-display.sh
source "$SCRIPT_DIR/mango-browse-display.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export MANGO_PLAYBACK_DISPLAY_MATCHED_FILE="$TMP/playback-display-matched"
: >"$MANGO_PLAYBACK_DISPLAY_MATCHED_FILE"

# Stub width reporter: film-cadence 1080p match must NOT request GL reset.
browse_display_current_width() { printf '%s\n' 1920; }
if browse_restore_needs_launcher_gl_reset; then
  echo "FAIL: 1080p matched panel incorrectly requested launcher GL reset" >&2
  exit 1
fi

# ≥3k panel still requests GL reset (matched marker optional).
browse_display_current_width() { printf '%s\n' 3840; }
if ! browse_restore_needs_launcher_gl_reset; then
  echo "FAIL: 4K panel did not request launcher GL reset" >&2
  exit 1
fi

rm -f "$MANGO_PLAYBACK_DISPLAY_MATCHED_FILE"
if ! browse_restore_needs_launcher_gl_reset; then
  echo "FAIL: 4K panel without matched marker should still reset" >&2
  exit 1
fi

echo "PASS: launcher GL reset gated on ≥3k panel width"
