#!/usr/bin/env bash
# Browse display invariants for the couch launcher.
#
# Browse mode is always MANGO_LAUNCHER_DISPLAY_MODE (default 1920x1080@60).
# Playback may source-match HDMI to film/4K cadence; the launcher must never
# become visible until browse mode is restored (brief black frame is OK).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPLAY_MODE_SH="${MANGO_DISPLAY_MODE_SH:-$SCRIPT_DIR/mango-display-mode.sh}"
PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
BROWSE_WIDTH_SLACK_PX="${MANGO_BROWSE_DISPLAY_WIDTH_SLACK_PX:-80}"

browse_display_policy_mode() {
  printf '%s\n' "${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}"
}

browse_display_policy_width() {
  local mode width
  mode="$(browse_display_policy_mode)"
  width="${mode%%x*}"
  [[ "$width" =~ ^[0-9]+$ ]] || width=1920
  printf '%s\n' "$width"
}

browse_display_current_width() {
  local status width
  [[ -x "$DISPLAY_MODE_SH" ]] || return 0
  status="$("$DISPLAY_MODE_SH" status 2>/dev/null || true)"
  width="$(printf '%s\n' "$status" | awk '{print $2}' | awk -Fx '{print $1}')"
  [[ "$width" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$width"
}

playback_surface_active() {
  [[ -f "$PLAYBACK_ACTIVE_FILE" ]] || pgrep -x mpv >/dev/null 2>&1
}

browse_display_is_active() {
  local current_w policy_w
  policy_w="$(browse_display_policy_width)"
  current_w="$(browse_display_current_width 2>/dev/null || true)"
  [[ -n "${current_w:-}" ]] || return 0
  (( current_w <= policy_w + BROWSE_WIDTH_SLACK_PX ))
}

ensure_browse_display() {
  [[ -x "$DISPLAY_MODE_SH" ]] || return 0
  "$DISPLAY_MODE_SH" ensure-launcher 2>/dev/null || true
}

ensure_browse_display_when_idle() {
  playback_surface_active && return 0
  browse_display_is_active && return 0
  ensure_browse_display
}

require_browse_display_before_launcher_reveal() {
  # Post-playback restore and any launcher show path: HDMI first, UI second.
  playback_surface_active && return 0
  ensure_browse_display
}
