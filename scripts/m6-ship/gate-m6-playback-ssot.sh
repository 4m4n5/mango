#!/usr/bin/env bash
# Playback SSOT hardening — mpv-only ship path, 1080p browse invariant, idle display.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR" || exit 1

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init
gate_header "M6 playback SSOT hardening"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

backend="${MANGO_PLAYBACK_BACKEND:-mpv}"
case "$backend" in
  mpv | "")
    gate_pass "playback backend is mpv (unified engine)"
    ;;
  vlc)
    gate_fail "playback backend is vlc (removed — use set-playback-engine.sh mpv-hifi)"
    ;;
  *)
    gate_fail "unknown playback backend: ${backend}"
    ;;
esac

if pgrep -x vlc >/dev/null 2>&1 || pgrep -x cvlc >/dev/null 2>&1; then
  gate_fail "vlc/cvlc process running on couch stack"
else
  gate_pass "no vlc/cvlc process"
fi

[[ "${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}" == "1920x1080" ]] \
  && gate_pass "launcher display policy is 1920x1080" \
  || gate_fail "launcher display policy is not 1920x1080 (${MANGO_LAUNCHER_DISPLAY_MODE:-unset})"

[[ "${MANGO_LAUNCHER_DISPLAY_RATE:-60}" == "60" ]] \
  && gate_pass "launcher refresh policy is 60 Hz" \
  || gate_fail "launcher refresh policy is not 60 Hz (${MANGO_LAUNCHER_DISPLAY_RATE:-unset})"

if [[ -f "${HOME}/.config/mango/voice.env" ]] \
  && grep -qE '^export MANGO_LAUNCHER_DISPLAY_MODE=.*3840' "${HOME}/.config/mango/voice.env"; then
  gate_fail "voice.env sets 4K launcher display (forbidden)"
else
  gate_pass "voice.env does not pin 4K launcher"
fi

PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
if [[ -f "$PLAYBACK_ACTIVE_FILE" ]] || pgrep -x mpv >/dev/null 2>&1; then
  gate_warn "playback active — skip idle browse display enforcement"
else
  bash scripts/lib/mango-display-mode.sh ensure-launcher 2>/dev/null || true
  if current="$(bash scripts/lib/mango-display-mode.sh status 2>/dev/null || true)"; then
    echo "idle display: ${current:-unknown}"
    if [[ "$current" == *"1920x1080"* ]]; then
      gate_pass "idle HDMI output is 1080p browse mode"
    else
      gate_fail "idle HDMI output is not 1080p browse (${current:-unknown})"
    fi
  else
    gate_warn "could not read idle display status"
  fi
fi

command -v mpv >/dev/null 2>&1 \
  && gate_pass "mpv installed" \
  || gate_fail "mpv missing"

[[ "${MANGO_MPV_STOP_LAUNCHER:-}" == "1" ]] \
  && grep -q 'mango-window.sh" hide' scripts/m2-catalog/service/mpv-play.sh \
  && gate_pass "mpv hides launcher surface during fullscreen" \
  || gate_fail "mpv does not hide launcher during fullscreen (expected mango-window.sh hide)"

grep -q 'launcher_freeze' scripts/m2-catalog/service/mpv-play.sh \
  && grep -q 'launcher_thaw' scripts/lib/restore-launcher-after-playback.sh \
  && gate_pass "launcher cgroup frozen during playback (GPU clear for mpv)" \
  || gate_fail "launcher freeze/thaw not wired (expected launcher_freeze on play, launcher_thaw on restore)"

grep -q 'mango-browse-display.sh' scripts/lib/restore-launcher-after-playback.sh \
  && grep -q 'require_browse_display_before_launcher_reveal' scripts/lib/restore-launcher-after-playback.sh \
  && grep -q 'require_browse_display_before_launcher_reveal' scripts/lib/mango-window.sh \
  && gate_pass "browse HDMI restored before launcher reveal (black-screen-first)" \
  || gate_fail "browse-before-show restore contract not wired"

grep -q 'teardown_mpv' scripts/m2-catalog/service/mpv-stop.sh \
  && grep -E 'restore-launcher-after-playback\.sh" finish|\$RESTORE_SH" finish' scripts/m2-catalog/service/mpv-stop.sh \
  && ! grep -E 'restore-launcher-after-playback\.sh" prepare|\$RESTORE_SH" prepare' scripts/m2-catalog/service/mpv-stop.sh \
  && ! grep -q 'restore-launcher-after-playback.sh" prepare' scripts/m2-catalog/service/mpv-play.sh \
  && gate_pass "mpv stop uses teardown-then-finish restore (no pre-show at 4K)" \
  || gate_fail "mpv stop restore order invalid (expected teardown → finish only)"

grep -q 'hide_desktop_chrome' scripts/lib/restore-launcher-after-playback.sh \
  && grep -q 'hide_desktop_chrome' scripts/lib/mango-browse-display.sh \
  && gate_pass "desktop chrome hidden during browse restore transition" \
  || gate_fail "desktop chrome not hidden during browse restore"

# Desktop chrome must be hidden BEFORE mpv teardown, so the frame that
# uncovers when mpv unmaps is pure black — no lxpanel/wallpaper flash.
_hide_line="$(grep -n 'mango-desktop\.sh.*hide' scripts/m2-catalog/service/mpv-stop.sh | head -1 | cut -d: -f1 || true)"
_teardown_call_line="$(grep -n '^[[:space:]]*teardown_mpv[[:space:]]*$' scripts/m2-catalog/service/mpv-stop.sh | head -1 | cut -d: -f1 || true)"
if [[ -n "${_hide_line:-}" && -n "${_teardown_call_line:-}" && "${_hide_line}" -lt "${_teardown_call_line}" ]]; then
  gate_pass "desktop chrome hidden before mpv teardown (no wallpaper flash)"
else
  gate_fail "mpv-stop.sh must hide desktop chrome BEFORE teardown_mpv (hide=${_hide_line:-?} teardown=${_teardown_call_line:-?})"
fi
unset _hide_line _teardown_call_line

grep -q 'xsetroot -solid black' scripts/lib/mango-desktop.sh \
  && gate_pass "X root painted black on chrome hide (exposure = black)" \
  || gate_fail "mango-desktop.sh hide must paint X root black (xsetroot -solid black)"

if [[ -f "$PLAYBACK_ACTIVE_FILE" ]] || pgrep -x mpv >/dev/null 2>&1; then
  gate_warn "playback active — skip launcher freezer capability probe"
else
  can_freeze="$(systemctl --user show mango-launcher-chromium.service -p CanFreeze --value 2>/dev/null || echo unknown)"
  [[ "$can_freeze" == "yes" ]] \
    && gate_pass "launcher unit supports cgroup freeze" \
    || gate_warn "launcher unit CanFreeze=${can_freeze} (falls back to stop)"
fi

[[ "${MANGO_MPV_DEFER_FOREGROUND:-}" == "1" ]] \
  && gate_pass "mpv deferred foreground handoff enabled" \
  || gate_fail "mpv deferred foreground handoff disabled"

gate_finish "gate-m6-playback-ssot"
