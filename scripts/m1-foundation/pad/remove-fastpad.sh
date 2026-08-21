#!/usr/bin/env bash
# Stop FastPad remapping and remove Pi-side hooks. Unplug the USB dongle after.
# Run on the Pi: bash scripts/m1-foundation/pad/remove-fastpad.sh

set -euo pipefail

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
FASTPAD_NAME="FastPad-Studio FastPad-KEY"

echo "=== Removing FastPad setup ==="

input-remapper-control --command stop --device "$FASTPAD_NAME" 2>/dev/null || true

if [[ -f "${CONFIG_ROOT}/config.json" ]]; then
  python3 - "$CONFIG_ROOT/config.json" "$FASTPAD_NAME" <<'PY'
import json, sys
path, device = sys.argv[1:3]
with open(path) as f:
    cfg = json.load(f)
autoload = cfg.get("autoload", {})
if device in autoload:
    del autoload[device]
    cfg["autoload"] = autoload
    with open(path, "w") as f:
        json.dump(cfg, f, indent=4)
        f.write("\n")
    print(f"Removed autoload for {device}")
else:
    print("No FastPad autoload entry")
PY
fi

if [[ -x "$(dirname "$0")/undo-gamepad-stay-awake.sh" ]]; then
  bash "$(dirname "$0")/undo-gamepad-stay-awake.sh" 2>/dev/null || true
fi

echo
echo "Unplug the FastPad USB dongle now."
echo "Done. Pair 8BitDo next: bash scripts/m1-foundation/pad/setup-8bitdo-bt.sh"
