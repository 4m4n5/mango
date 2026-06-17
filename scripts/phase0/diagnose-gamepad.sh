#!/usr/bin/env bash
# Phase 0 — diagnose USB / wireless gamepad visibility on the Pi.
# Run on the Pi: bash scripts/phase0/diagnose-gamepad.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

section() { echo -e "\n${CYAN}=== $* ===${NC}"; }
ok() { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
bad() { echo -e "${RED}✗${NC} $*"; }

section "USB devices (lsusb)"
if command -v lsusb &>/dev/null; then
  lsusb
  USB_COUNT=$(lsusb | wc -l | tr -d ' ')
  if (( USB_COUNT <= 2 )); then
    warn "Only root hubs visible — dongle may be unplugged or dead port"
  fi
else
  warn "lsusb not installed (sudo apt install usbutils)"
fi

section "Input nodes (/dev/input)"
ls -la /dev/input/ 2>&1 || true
if ls /dev/input/js* &>/dev/null; then
  ok "Joystick API: $(ls /dev/input/js* | tr '\n' ' ')"
else
  warn "No /dev/input/js* yet"
fi

section "Kernel modules (hid / joydev / xpad)"
lsmod | grep -iE '^(hid|input|joydev|xpad|xone|nintendo)' || echo "(none matched)"

if ! lsmod | grep -q '^joydev'; then
  warn "joydev not loaded — many gamepads only appear as event* until this loads"
  if sudo modprobe joydev 2>/dev/null; then
    ok "Loaded joydev via modprobe"
    ls /dev/input/js* 2>/dev/null && ok "js* now present" || warn "Still no js* after joydev"
  else
    bad "Could not load joydev — try: sudo apt install joystick && sudo modprobe joydev"
  fi
fi

section "Registered input devices (/proc/bus/input/devices)"
if [[ -r /proc/bus/input/devices ]]; then
  awk '
    /^N: / { name=$0; sub(/^N: Name="/, "", name); sub(/"$/, "", name) }
    /^H: / {
      handlers=$0; sub(/^H: Handlers=/, "", handlers)
      if (handlers ~ /js[0-9]/ || name ~ /[Gg]ame|[Pp]ad|[Xx]box|[Pp]lay[Ss]tation|8BitDo|Controller|joystick/) {
        print name
        print "  " handlers
        print ""
      }
    }
  ' /proc/bus/input/devices

  GAMEPAD_LINES=$(grep -ciE 'gamepad|xbox|playstation|8bitdo|controller|joystick' /proc/bus/input/devices || true)
  if (( GAMEPAD_LINES == 0 )); then
    warn "No gamepad-like names in input registry"
    echo "All input device names:"
    grep '^N: ' /proc/bus/input/devices | sed 's/^N: //'
  fi
else
  bad "Cannot read /proc/bus/input/devices"
fi

section "Recent kernel messages (usb / hid / input)"
if sudo dmesg -T 2>/dev/null | grep -iE 'usb|hid|input|joystick|xpad|gamepad|wireless' | tail -30; then
  :
else
  dmesg 2>/dev/null | grep -iE 'usb|hid|input|joystick|xpad|gamepad|wireless' | tail -30 || warn "dmesg unavailable"
fi

section "Quick tests"
if command -v jstest &>/dev/null && ls /dev/input/js* &>/dev/null; then
  ok "jstest available — run: jstest /dev/input/js0"
elif ! command -v jstest &>/dev/null; then
  warn "jstest not installed — run: bash scripts/phase0/install-base-deps.sh"
fi

if command -v evtest &>/dev/null; then
  ok "evtest available — pick event device: sudo evtest"
else
  warn "evtest optional — sudo apt install evtest"
fi

section "Likely causes if still missing"
cat <<'EOF'
1. Dongle not seated / try another USB port (direct Pi port, not through hub)
2. Wireless pad not paired to dongle — power on controller, hold sync/pair button
3. Dongle is Bluetooth-only — pair via Pi Bluetooth settings instead of USB
4. joydev not loaded — only needed for true joystick HID (not keyboard-mode pads)
5. Keyboard-mode gamepad (e.g. FastPad-KEY) — shows as kbd event*, no js*; use D-pad on desktop
EOF

echo
if ls /dev/input/js* &>/dev/null; then
  ok "Gamepad ready for jstest / antimicrox"
  exit 0
fi

if grep -qi fastpad /proc/bus/input/devices 2>/dev/null; then
  ok "FastPad detected as USB keyboard (event5) — navigate desktop with D-pad; antimicrox optional"
  exit 0
fi

if grep -qiE 'gamepad|xbox|playstation|8bitdo|controller|joystick' /proc/bus/input/devices 2>/dev/null; then
  warn "Gamepad may be on event* only — load joydev or use evtest"
  exit 0
fi

bad "No gamepad detected at USB/input level — check dongle, pairing, and port"
exit 1
