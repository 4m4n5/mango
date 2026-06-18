#!/usr/bin/env bash
# Phase 0 — install packages needed for bring-up and later phases.

set -euo pipefail

echo "=== Installing base dependencies ==="
sudo apt update
sudo apt install -y \
  curl \
  git \
  joystick \
  antimicrox \
  python3 \
  python3-pip \
  python3-venv \
  python3-evdev \
  ffmpeg \
  mpv \
  socat \
  xdotool \
  wmctrl \
  chromium-browser

echo
echo "=== Optional: verify tools ==="
command -v xdotool && command -v wmctrl && command -v chromium-browser || true

echo
echo "Done. Next steps:"
echo "  1. Map gamepad with antimicrox (GUI — see docs/HARDWARE.md)"
echo "  2. bash scripts/phase0/install-kodi.sh"
