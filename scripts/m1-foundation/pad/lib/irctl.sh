#!/usr/bin/env bash
# Quiet wrapper for input-remapper-control.
# Pi OS ships Python 3.13; irctl prints harmless threading teardown noise on exit.
#
# Usage (from other m1-foundation/pad scripts):
#   source "$(dirname "$0")/lib/irctl.sh"
#   irctl --command start --device "Pro Controller" --preset mango-tv

irctl() {
  command -v input-remapper-control &>/dev/null || return 0
  (
    input-remapper-control "$@" 2>/dev/null
    sleep 0.35
  ) || true
}

irctl_sudo() {
  command -v input-remapper-control &>/dev/null || return 0
  (
    sudo -n input-remapper-control "$@" 2>/dev/null
    sleep 0.35
  ) || true
}

ir_stop_service() {
  irctl_quick --command stop --device "Pro Controller" 2>/dev/null || true
  irctl_quick --command stop --device "Pro Controller (IMU)" 2>/dev/null || true
  sudo -n systemctl stop input-remapper 2>/dev/null || true
  ir_kill_readers
  sleep 0.5
}

irctl_quick() {
  command -v input-remapper-control &>/dev/null || return 0
  input-remapper-control "$@" 2>/dev/null || true
}

# Orphan reader daemons keep evdev busy and can inherit launch-launcher.lock (fd leak).
ir_kill_readers() {
  pkill -f input-remapper-reader-service 2>/dev/null || true
  sudo -n pkill -f input-remapper-reader-service 2>/dev/null || true
  sleep 0.2
}

# After Stremio pad bridge — wake remapper without spawning orphan reader daemons.
ir_resume_after_bridge() {
  local device=${1:-"Pro Controller"}
  local preset=${2:-mango-tv}

  ir_kill_readers

  if ! systemctl is-active --quiet input-remapper 2>/dev/null; then
    sudo -n systemctl start input-remapper 2>/dev/null || true
    sleep 0.3
  fi

  irctl_quick --command start --device "$device" --preset "$preset"
}

ir_start_with_autoload() {
  local device=$1 preset=$2
  ir_kill_readers
  if ! systemctl is-active --quiet input-remapper 2>/dev/null; then
    sudo -n systemctl start input-remapper 2>/dev/null || true
    sleep 0.5
  fi
  irctl --command stop --device "$device"
  irctl --command stop --device "Pro Controller (IMU)"
  irctl --command start --device "$device" --preset "$preset"
}
