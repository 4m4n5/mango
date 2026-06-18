#!/usr/bin/env bash
# Set default audio output sink (mpv, Piper, paplay follow this).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <sink-name|sink-index|@DEFAULT_SINK@>" >&2
  echo "List sinks: bash scripts/audio/list-sinks.sh" >&2
  exit 2
fi

TARGET="$1"

if [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  # wpctl numeric id
  wpctl set-default "$TARGET"
  echo "default sink set (wpctl id $TARGET)"
elif pactl list short sinks 2>/dev/null | grep -q .; then
  pactl set-default-sink "$TARGET"
  echo "default sink set: $TARGET"
else
  echo "no sinks found — plug USB DAC, pair Bluetooth, or connect HDMI audio" >&2
  exit 1
fi

# Persist for login sessions (optional)
STATE_DIR="${HOME}/.config/mango"
mkdir -p "$STATE_DIR"
echo "MANGO_AUDIO_SINK=$TARGET" >"${STATE_DIR}/audio.env"
echo "saved ${STATE_DIR}/audio.env"

# Quick test tone (short beep via speaker-test if available)
if command -v speaker-test >/dev/null 2>&1; then
  echo "playing 1s test tone on default sink…"
  timeout 1 speaker-test -t sine -f 440 -l 1 >/dev/null 2>&1 || true
fi
