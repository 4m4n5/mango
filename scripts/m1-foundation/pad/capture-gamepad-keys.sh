#!/usr/bin/env bash
# Log which Linux key codes the gamepad sends (keyboard-mode pads).
# Run on the Pi: bash scripts/m1-foundation/pad/capture-gamepad-keys.sh

set -euo pipefail

DEVICE=""
for path in /dev/input/by-id/*FastPad* /dev/input/event*; do
  [[ -e "$path" ]] || continue
  if grep -qi fastpad "/sys/class/input/$(basename "$path")/device/name" 2>/dev/null; then
    DEVICE="$path"
    break
  fi
done

if [[ -z "$DEVICE" ]]; then
  DEVICE=$(grep -l -i fastpad /sys/class/input/event*/device/name 2>/dev/null | head -1 | xargs -I{} dirname {} | xargs -I{} basename {})
  [[ -n "$DEVICE" ]] && DEVICE="/dev/input/$DEVICE"
fi

if [[ -z "$DEVICE" || ! -e "$DEVICE" ]]; then
  echo "FastPad event device not found. Plug dongle, then:"
  echo "  grep -i fastpad /proc/bus/input/devices"
  echo "  sudo evtest   # pick the FastPad eventN"
  exit 1
fi

echo "Listening on $DEVICE — press each pad button once. Ctrl+C when done."
echo "Use the KEY_* names in input-remapper Output (e.g. KEY_UP → Up)."
echo

if ! command -v evtest &>/dev/null; then
  sudo apt install -y evtest
fi

sudo evtest "$DEVICE" 2>&1 | grep --line-buffered 'Event:.*EV_KEY' | while read -r line; do
  key=$(echo "$line" | sed -n 's/.*EV_KEY, \([^ ]*\).*/\1/p')
  val=$(echo "$line" | sed -n 's/.*value \([0-9]*\).*/\1/p')
  [[ "$val" == "1" ]] && echo "$key"
done
