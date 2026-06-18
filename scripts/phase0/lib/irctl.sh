#!/usr/bin/env bash
# Quiet wrapper for input-remapper-control.
# Pi OS ships Python 3.13; irctl prints harmless threading teardown noise on exit.
#
# Usage (from other phase0 scripts):
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
    sudo input-remapper-control "$@" 2>/dev/null
    sleep 0.35
  ) || true
}

ir_stop_service() {
  sudo systemctl stop input-remapper 2>/dev/null || true
  sleep 0.5
}

irctl_quick() {
  command -v input-remapper-control &>/dev/null || return 0
  input-remapper-control "$@" 2>/dev/null || true
}

# After Stremio pad bridge — service was stopped; wake remapper without systemctl restart.
ir_resume_after_bridge() {
  local device=${1:-"Pro Controller"}
  local preset=${2:-mango-tv}

  if systemctl is-active --quiet input-remapper 2>/dev/null; then
    irctl_quick --command start --device "$device" --preset "$preset"
    return 0
  fi

  sudo -n systemctl start input-remapper 2>/dev/null \
    || sudo systemctl start input-remapper 2>/dev/null \
    || true
  sleep 0.15
  irctl_quick --command start-reader-service -d
  irctl_quick --command start --device "$device" --preset "$preset"
}

ir_start_with_autoload() {
  local device=$1 preset=$2
  if ! systemctl is-active --quiet input-remapper 2>/dev/null; then
    sudo systemctl start input-remapper 2>/dev/null || true
    sleep 0.8
    irctl_sudo --command start-reader-service -d
  fi
  irctl --command stop --device "$device"
  irctl --command stop --device "Pro Controller (IMU)"
  irctl --command start --device "$device" --preset "$preset"
}
