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

ir_start_with_autoload() {
  local device=$1 preset=$2
  sudo systemctl restart input-remapper 2>/dev/null || sudo systemctl start input-remapper 2>/dev/null || true
  sleep 1.5
  irctl_sudo --command start-reader-service -d
  irctl --command stop --device "$device"
  irctl --command stop --device "Pro Controller (IMU)"
  sleep 0.5
  irctl --command start --device "$device" --preset "$preset"
}
