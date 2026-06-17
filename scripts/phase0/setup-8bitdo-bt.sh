#!/usr/bin/env bash
# Pair 8BitDo over Bluetooth and map D-pad + A/B for TV navigation.
# Run on the Pi: bash scripts/phase0/setup-8bitdo-bt.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== mango: 8BitDo Bluetooth setup ==="
echo

# --- 1. Drop FastPad ---
if lsusb 2>/dev/null | grep -qiE '1a86:fe18|FastPad'; then
  bash "$SCRIPT_DIR/remove-fastpad.sh"
  echo
  read -r -p "Unplug FastPad dongle, then press Enter..."
else
  bash "$SCRIPT_DIR/remove-fastpad.sh" 2>/dev/null || true
fi

# --- 2. Bluetooth ---
echo "=== Bluetooth ==="
sudo apt update
sudo apt install -y bluez bluetooth pi-bluetooth evtest joystick python3 input-remapper

sudo modprobe joydev 2>/dev/null || true
grep -q '^joydev' /etc/modules-load.d/joydev.conf 2>/dev/null || echo joydev | sudo tee /etc/modules-load.d/joydev.conf >/dev/null

echo
echo "Pair the controller:"
echo "  1. On 8BitDo: Switch mode → hold START + Y ~3s (LEDs flash)"
echo "  2. On Pi:"
echo
cat <<'BT'
     bluetoothctl
     power on
     agent on
     default-agent
     scan on
     # find MAC for "8BitDo" / "Pro 2"
     pair AA:BB:CC:DD:EE:FF
     trust AA:BB:CC:DD:EE:FF
     connect AA:BB:CC:DD:EE:FF
     quit
BT
echo
read -r -p "Press Enter after bluetoothctl shows 'Connected: yes'..."

# --- 3. Find device ---
echo
echo "=== Detecting controller ==="
sudo systemctl start bluetooth input-remapper 2>/dev/null || true
sudo input-remapper-control --command start-reader-service -d 2>/dev/null || true
sleep 2

mapfile -t DEVICES < <(sudo input-remapper-control --list-devices 2>/dev/null | tr -d '"' | grep -iE '8bitdo|8bit|pro 2' | grep -vi fastpad || true)

if [[ ${#DEVICES[@]} -eq 0 ]]; then
  echo "8BitDo not listed. All devices:"
  sudo input-remapper-control --list-devices 2>/dev/null || true
  echo "Try: bluetoothctl connect <MAC> then re-run."
  exit 1
fi

DEVICE_NAME="${DEVICES[0]}"
echo "Device: $DEVICE_NAME"

EVENT_DEV=""
for path in /dev/input/event*; do
  [[ -e "$path" ]] || continue
  name=$(cat "/sys/class/input/$(basename "$path")/device/name" 2>/dev/null || true)
  if echo "$name" | grep -qiE '8bitdo|8bit|pro 2'; then
    EVENT_DEV="$path"
    break
  fi
done
[[ -n "$EVENT_DEV" ]] || EVENT_DEV="/dev/input/$(grep -l -iE '8bitdo|8bit' /sys/class/input/event*/device/name 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)"
echo "Event: $EVENT_DEV"

# --- 4. Map ---
echo
echo "Press D-pad UP once (5s)..."
SAMPLE=$(timeout 5 sudo evtest "$EVENT_DEV" 2>&1 | grep -m1 -E 'EV_ABS.*code 17|EV_KEY' || true)

if echo "$SAMPLE" | grep -q 'EV_ABS'; then
  echo "Using hat-axis D-pad (normal for 8BitDo Switch/BT)."
  CONFIG_ROOT="${HOME}/.config/input-remapper-2"
  PRESET="${CONFIG_ROOT}/presets/${DEVICE_NAME}/mango-tv.json"
  mkdir -p "$(dirname "$PRESET")"
  cat >"$PRESET" <<'EOF'
[
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": -50}], "target_uinput": "keyboard", "output_symbol": "Up"},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": 50}], "target_uinput": "keyboard", "output_symbol": "Down"},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": -50}], "target_uinput": "keyboard", "output_symbol": "Left"},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": 50}], "target_uinput": "keyboard", "output_symbol": "Right"}
]
EOF
  echo ">>> Press A (confirm), then B (back):"
  bash "$SCRIPT_DIR/map-gamepad-ssh.sh" --device "$EVENT_DEV" --name "$DEVICE_NAME" --buttons-only
else
  echo "Using button D-pad — capture all six buttons:"
  bash "$SCRIPT_DIR/map-gamepad-ssh.sh" --device "$EVENT_DEV" --name "$DEVICE_NAME"
fi

sudo systemctl enable bluetooth input-remapper 2>/dev/null || true

echo
echo "=== Done ==="
echo "Test on TV. Launch: DISPLAY=:0 kodi &   DISPLAY=:0 stremio &"
echo "Reconnect after idle: bluetoothctl connect <MAC>"
