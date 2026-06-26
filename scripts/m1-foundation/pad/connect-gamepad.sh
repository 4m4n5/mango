#!/usr/bin/env bash
# Connect 8BitDo Micro. Run on the Pi: bash scripts/m1-foundation/pad/connect-gamepad.sh

set -euo pipefail

BT_MAC="${MANGO_GAMEPAD_BT_MAC:-E4:17:D8:EB:00:44}"
CONNECT_TIMEOUT_SEC="${MANGO_GAMEPAD_CONNECT_TIMEOUT_SEC:-6}"
CONNECT_WAIT_STEPS="${MANGO_GAMEPAD_CONNECT_WAIT_STEPS:-6}"

bt() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${CONNECT_TIMEOUT_SEC}s" bluetoothctl "$@"
  else
    bluetoothctl "$@"
  fi
}

is_connected() {
  bt info "$BT_MAC" 2>/dev/null | grep -q "Connected: yes"
}

bt power on 2>/dev/null || true
bt trust "$BT_MAC" 2>/dev/null || true

if is_connected; then
  exit 0
fi

bt connect "$BT_MAC" 2>/dev/null || true
for _ in $(seq 1 "$CONNECT_WAIT_STEPS"); do
  is_connected && exit 0
  sleep 0.5
done

exit 1
