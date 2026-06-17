#!/usr/bin/env bash
# Fixed TV map for 8BitDo / Switch "Pro Controller" on Linux (hat D-pad + A/B).
# Run on the Pi: bash scripts/phase0/map-pro-controller.sh

set -euo pipefail

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
DEVICE_NAME="Pro Controller"
PRESET_NAME="mango-tv"
PRESET_DIR="${CONFIG_ROOT}/presets/${DEVICE_NAME}"
PRESET_FILE="${PRESET_DIR}/${PRESET_NAME}.json"

echo "=== mango: Pro Controller preset (hat D-pad + A/B) ==="
echo
echo "Linux D-pad is hat axes, not keys — SSH capture maps face buttons by mistake."
echo "This writes the correct preset for Switch-mode 8BitDo."
echo

mkdir -p "$PRESET_DIR"

# ABS_HAT0X=16, ABS_HAT0Y=17 — D-pad
# BTN_SOUTH=304 (A), BTN_EAST=305 (B) — standard Switch layout on Pi
cat >"$PRESET_FILE" <<'EOF'
[
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": -50}], "target_uinput": "keyboard", "output_symbol": "Up"},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": 50}], "target_uinput": "keyboard", "output_symbol": "Down"},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": -50}], "target_uinput": "keyboard", "output_symbol": "Left"},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": 50}], "target_uinput": "keyboard", "output_symbol": "Right"},
  {"input_combination": [{"type": 1, "code": 304}], "target_uinput": "keyboard", "output_symbol": "Return"},
  {"input_combination": [{"type": 1, "code": 305}], "target_uinput": "keyboard", "output_symbol": "Esc"}
]
EOF

python3 - "$CONFIG_ROOT/config.json" "$DEVICE_NAME" "$PRESET_NAME" <<'PY'
import json, os, sys
path, device, preset = sys.argv[1:4]
cfg = {"version": "2.2.1", "autoload": {}}
if os.path.isfile(path):
    with open(path) as f:
        cfg = json.load(f)
cfg.setdefault("autoload", {})[device] = preset
with open(path, "w") as f:
    json.dump(cfg, f, indent=4)
    f.write("\n")
print(f"Autoload: {device} -> {preset}")
PY

sudo systemctl start input-remapper 2>/dev/null || true
sudo input-remapper-control --command start-reader-service -d 2>/dev/null || true
input-remapper-control --command stop --device "$DEVICE_NAME" 2>/dev/null || true
input-remapper-control --command start --device "$DEVICE_NAME" --preset "$PRESET_NAME"

echo
echo "Applied. On TV:"
echo "  D-pad     → move"
echo "  A (south) → Return"
echo "  B (east)  → Escape"
echo
echo "Test: DISPLAY=:0 kodi &"
echo "If A/B are swapped, say so — we can flip 304/305."
