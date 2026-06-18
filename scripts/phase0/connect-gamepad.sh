#!/usr/bin/env bash
# Connect 8BitDo Micro. Run on the Pi: bash scripts/phase0/connect-gamepad.sh

set -euo pipefail

BT_MAC="E4:17:D8:EB:00:44"

bluetoothctl connect "$BT_MAC" 2>/dev/null || true
sleep 2
