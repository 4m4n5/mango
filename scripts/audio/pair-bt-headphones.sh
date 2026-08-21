#!/usr/bin/env bash
# Pair Bluetooth headphones/speakers for mango audio (mpv + voice TTS later).
#
# Usage:
#   bash scripts/audio/scan-bt-devices.sh [seconds]   # discover first
#   bash scripts/audio/pair-bt-headphones.sh <MAC>  # pair by MAC

set -euo pipefail

GAMEPAD_MAC="e4:17:d8:eb:00:44"

if ! command -v bluetoothctl >/dev/null 2>&1; then
  echo "bluetoothctl not found" >&2
  exit 1
fi

MAC="${1:-}"
if [[ -z "$MAC" ]]; then
  echo "No MAC given. Discover devices first:" >&2
  echo "  bash scripts/audio/scan-bt-devices.sh 60" >&2
  echo "Then:" >&2
  echo "  bash scripts/audio/pair-bt-headphones.sh aa:bb:cc:dd:ee:ff" >&2
  exit 2
fi

MAC="$(echo "$MAC" | tr '[:upper:]' '[:lower:]')"
if [[ "$MAC" == "$GAMEPAD_MAC" ]]; then
  echo "That MAC is the 8BitDo gamepad, not headphones." >&2
  exit 1
fi

bluetoothctl power on
# Headless-friendly agent (avoids 'Failed to register agent object' over SSH).
bluetoothctl agent NoInputNoOutput
bluetoothctl default-agent

echo "Pairing $MAC …"
bluetoothctl pair "$MAC" || true
bluetoothctl trust "$MAC"
bluetoothctl connect "$MAC"

echo
echo "Waiting for A2DP audio profile…"
for _ in $(seq 1 15); do
  if pactl list short sinks 2>/dev/null | grep -qi blue; then
    break
  fi
  sleep 1
done

bash "$(dirname "$0")/list-sinks.sh"

bt_sink="$(pactl list short sinks 2>/dev/null | grep -i blue | awk '{print $2}' | head -1 || true)"
if [[ -n "$bt_sink" ]]; then
  echo
  echo "Setting default sink: $bt_sink"
  bash "$(dirname "$0")/set-default-sink.sh" "$bt_sink"
else
  echo
  echo "No Bluetooth sink yet. Try: bluetoothctl connect $MAC"
  echo "Or use monitor headphone jack (HDMI audio, no pairing)."
fi
