#!/usr/bin/env bash
# Freeze/thaw the launcher Chromium cgroup during playback.
#
# Why: hiding (unmapping) the Chromium launcher keeps its JS state in memory for
# a seamless return, but a live Chromium still holds the VideoCore GPU context
# and rasterizes in the background, contending with mpv's --vo=gpu output and
# dropping frames at 4K. Freezing the whole cgroup (cgroup v2 freezer) suspends
# every launcher process — zero CPU/GPU, same as killing it for smoothness —
# while preserving in-memory state so restore is instant with no cold start.
#
# Mode-switch caveat: freeze-through-xrandr (browse 1080p → matched 4K → back)
# invalidates the VideoCore EGL context. After a matched-mode restore, callers
# must restart the launcher unit (see restore-launcher-after-playback.sh) —
# thaw alone leaves a dead GL context (blank/missing posters).
#
# Degrades gracefully: on kernels/units without freezer support, callers fall
# back to their existing hide/stop path.

LAUNCHER_UNIT="${MANGO_LAUNCHER_UNIT:-mango-launcher-chromium.service}"

launcher_can_freeze() {
  [[ "${MANGO_LAUNCHER_FREEZE:-1}" != "0" ]] || return 1
  [[ "$(systemctl --user show "$LAUNCHER_UNIT" -p CanFreeze --value 2>/dev/null)" == "yes" ]]
}

launcher_is_active() {
  systemctl --user is-active "$LAUNCHER_UNIT" >/dev/null 2>&1
}

# Suspend the launcher cgroup. Returns non-zero if freezing is unavailable so
# the caller can fall back to stopping the service.
launcher_freeze() {
  launcher_can_freeze || return 1
  launcher_is_active || return 1
  systemctl --user freeze "$LAUNCHER_UNIT" 2>/dev/null
}

# Resume the launcher cgroup. Safe no-op if the unit is stopped or not frozen.
launcher_thaw() {
  launcher_is_active || return 0
  systemctl --user thaw "$LAUNCHER_UNIT" 2>/dev/null || true
}

# Cold-start the kiosk after HDMI mode changed under a frozen Chromium.
# Thaw first so systemd can stop a frozen unit cleanly, then restart.
launcher_restart_for_clean_gl() {
  # Prefer kill-while-frozen over thaw-then-restart. Thawing first lets
  # suspended launcher JS resume briefly and clear the durable playback-return
  # snapshot before the process is replaced for EGL rebuild.
  systemctl --user reset-failed "$LAUNCHER_UNIT" 2>/dev/null || true
  if systemctl --user kill -s SIGKILL "$LAUNCHER_UNIT" >/dev/null 2>&1; then
    systemctl --user stop "$LAUNCHER_UNIT" >/dev/null 2>&1 || true
  else
    launcher_thaw 2>/dev/null || true
    systemctl --user stop "$LAUNCHER_UNIT" >/dev/null 2>&1 || true
  fi
  launcher_thaw 2>/dev/null || true
  systemctl --user start "$LAUNCHER_UNIT" >/dev/null 2>&1 || true
}
