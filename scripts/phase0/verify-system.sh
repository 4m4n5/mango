#!/usr/bin/env bash
# Phase 0 — verify Pi OS is ready for mango development.
# Run on the Pi: bash scripts/phase0/verify-system.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; ERRORS=$((ERRORS + 1)); }
warn() { echo -e "${YELLOW}!${NC} $*"; }

ERRORS=0

echo "=== mango Phase 0: system verify ==="
echo

# Architecture
if [[ "$(uname -m)" == "aarch64" ]]; then
  pass "Architecture: aarch64 (64-bit)"
else
  fail "Expected aarch64 — flash Pi OS 64-bit Desktop"
fi

# Session type (must be X11 for xdotool / overlay)
# SSH shells have no XDG_SESSION_TYPE — check the desktop instead.
if [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
  pass "Display session: x11"
elif pgrep -x openbox >/dev/null 2>&1; then
  pass "Display session: x11 (openbox running)"
elif pgrep -x labwc >/dev/null 2>&1 || pgrep -x wayfire >/dev/null 2>&1; then
  fail "Display session: Wayland — switch to X11 Openbox:"
  echo "    bash scripts/phase0/switch-to-x11.sh && sudo reboot"
else
  warn "Display session: unknown (desktop may be idle) — check monitor after reboot"
fi

# Temperature
if command -v vcgencmd &>/dev/null; then
  TEMP=$(vcgencmd measure_temp | cut -d= -f2 | cut -d\' -f1)
  TEMP_INT=${TEMP%.*}
  if (( TEMP_INT < 80 )); then
    pass "CPU temp: ${TEMP} (idle OK)"
  else
    warn "CPU temp: ${TEMP} — check cooling"
  fi
else
  warn "vcgencmd not found"
fi

# Network
IP=$(hostname -I | awk '{print $1}')
if [[ -n "$IP" ]]; then
  pass "IP address: $IP"
else
  fail "No IP — connect WiFi or Ethernet"
fi

# Memory
MEM_GB=$(free -g | awk '/^Mem:/{print $2}')
if (( MEM_GB >= 7 )); then
  pass "RAM: ${MEM_GB}GB"
else
  warn "RAM: ${MEM_GB}GB — 8GB recommended"
fi

# Disk
DISK_AVAIL=$(df -BG / | awk 'NR==2{print $4}' | tr -d G)
if (( DISK_AVAIL >= 50 )); then
  pass "Disk free: ${DISK_AVAIL}GB on /"
else
  warn "Disk free: ${DISK_AVAIL}GB — may be tight after models"
fi

# Gamepad — js* (true joystick) or keyboard-emulating pads (FastPad, many 2.4G dongles)
if ls /dev/input/js* &>/dev/null; then
  pass "Gamepad (joystick): $(ls /dev/input/js* | tr '\n' ' ')"
elif grep -qiE 'fastpad|gamepad|xbox|playstation|8bitdo|controller|joystick' /proc/bus/input/devices 2>/dev/null; then
  PAD_NAME=$(grep -iE 'fastpad|gamepad|xbox|playstation|8bitdo|controller|joystick' /proc/bus/input/devices | head -1 | sed 's/^N: Name="//;s/"$//')
  if grep -qi fastpad /proc/bus/input/devices 2>/dev/null; then
    pass "Gamepad (keyboard mode): ${PAD_NAME:-FastPad} — no js* needed; test D-pad on desktop"
  else
    warn "Gamepad on event* but no js* — try: sudo modprobe joydev"
  fi
else
  warn "No gamepad detected — plug dongle, pair controller, then: bash scripts/phase0/diagnose-gamepad.sh"
fi

# SSH (informational)
if systemctl is-active ssh &>/dev/null || systemctl is-active sshd &>/dev/null; then
  pass "SSH service: active"
else
  warn "SSH not active — enable via raspi-config for remote help"
fi

echo
if (( ERRORS > 0 )); then
  echo -e "${RED}Failed $ERRORS check(s). Fix before continuing.${NC}"
  exit 1
fi

echo -e "${GREEN}System checks passed. Next: gamepad mapping, Kodi, Stremio.${NC}"
