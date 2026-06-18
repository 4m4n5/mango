#!/usr/bin/env bash
# List PipeWire/Pulse audio sinks on the Pi (HDMI, USB DAC, Bluetooth).

set -euo pipefail

echo "=== default sink ==="
pactl get-default-sink 2>/dev/null || wpctl status 2>/dev/null | grep -E '^\s+\*' || true

echo
echo "=== sinks (pactl) ==="
pactl list short sinks 2>/dev/null || true

echo
echo "=== sinks (wpctl) ==="
wpctl status 2>/dev/null | sed -n '/Audio/,/Video/p' || true

echo
echo "=== ALSA playback cards ==="
aplay -l 2>/dev/null || true

echo
echo "Tip: Pi 5 has no 3.5 mm jack — use monitor headphone out, USB DAC, or Bluetooth."
echo "Set sink: bash scripts/audio/set-default-sink.sh <sink-name-or-id>"
