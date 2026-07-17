#!/usr/bin/env bash
# SSOT: restore browse launcher after mpv playback ends.
#
# Contract (black-screen-first — no 4K launcher flash):
#   1. Caller tears down mpv and clears playback-active before invoking finish.
#   2. finish restores HDMI to browse mode while the launcher stays hidden.
#   3. finish reveals the launcher at browse geometry.
#      - Same-width play (stayed ≤1080p, including film-cadence match): thaw
#        frozen Chromium (fast).
#      - ≥3k panel (matched 4K): restart Chromium after HDMI restore so
#        VideoCore EGL is recreated (thaw-after-xrandr leaves blank posters).
#
# Usage:
#   restore-launcher-after-playback.sh finish
#
# Env:
#   MANGO_MPV_STOP_HOME=1  run launch-launcher (pad home path)
#   MANGO_LAUNCHER_GPU_RESET=1  force Chromium restart (set by mpv-stop when
#     matched-4K / wide panel was active before teardown)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export MANGO_SKIP_OVERLAY="${MANGO_SKIP_OVERLAY:-1}"

PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"
STEP_SEC="${MANGO_LAUNCHER_RESTORE_STEP_SEC:-0.05}"
MAX_ATTEMPTS="${MANGO_LAUNCHER_RESTORE_ATTEMPTS:-60}"
GPU_RESET="${MANGO_LAUNCHER_GPU_RESET:-0}"

# shellcheck source=launcher-window.sh
source "$REPO_DIR/scripts/lib/launcher-window.sh"
# shellcheck source=launcher-power.sh
source "$REPO_DIR/scripts/lib/launcher-power.sh"
# shellcheck source=mango-browse-display.sh
source "$REPO_DIR/scripts/lib/mango-browse-display.sh"

ensure_launcher_browser() {
  if pgrep -f "$(launcher_browser_pattern)" >/dev/null 2>&1; then
    return 0
  fi
  systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
}

resume_or_recreate_launcher() {
  if [[ "$GPU_RESET" == "1" ]]; then
    launcher_restart_for_clean_gl
    return 0
  fi
  launcher_thaw
}

show_launcher_surface() {
  require_browse_display_before_launcher_reveal
  ensure_launcher_browser
  bash "$REPO_DIR/scripts/lib/mango-window.sh" show 2>/dev/null || true
}

present_launcher_ready() {
  local attempt wid
  resume_or_recreate_launcher
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    show_launcher_surface
    wid="$(find_launcher_wid 2>/dev/null || true)"
    if [[ -n "$wid" ]]; then
      # Always full present after playback — never --quick. Hide shrinks Chromium
      # siblings to ~1x1/200x200; --quick can latch onto a stale large wid and
      # leave the visible surface tiny (couch lag / broken navigation).
      if bash "$REPO_DIR/scripts/lib/present-launcher.sh" 2>/dev/null; then
        return 0
      fi
    fi
    sleep "$STEP_SEC"
  done
  return 1
}

focus_launcher_home() {
  [[ "${GO_HOME}" == "1" ]] || return 0
  bash "$REPO_DIR/scripts/launch-launcher.sh" >/dev/null 2>&1 &
}

phase_restore_browse_hdmi() {
  rm -f "$PLAYBACK_ACTIVE_FILE"
  # Keep lxpanel/wallpaper hidden during the xrandr gap so the Pi desktop never flashes.
  hide_desktop_chrome
  # Always force browse HDMI here — finish runs only after foreground mpv teardown.
  # Do not use playback_surface_active guards (probe workers must not skip restore).
  ensure_browse_display
}

phase_reveal_launcher_at_browse() {
  hide_desktop_chrome
  present_launcher_ready || true
}

cmd_finish() {
  phase_restore_browse_hdmi
  phase_reveal_launcher_at_browse
  focus_launcher_home
  bash "$REPO_DIR/scripts/lib/mango-cursor.sh" hide 2>/dev/null || true
}

case "${1:-finish}" in
  finish|full) cmd_finish ;;
  prepare)
    echo "restore-launcher-after-playback: prepare is removed — caller must teardown mpv, then run finish" >&2
    exit 2
    ;;
  *)
    echo "usage: $0 finish" >&2
    exit 2
    ;;
esac
