#!/usr/bin/env bash
# Phase 0 — remap keyboard-mode gamepads (e.g. FastPad-KEY) to TV navigation keys.
# Run on the Pi: bash scripts/phase0/install-gamepad-remap.sh

set -euo pipefail

echo "=== Installing input-remapper + polkit agent (Openbox needs this) ==="
sudo apt update
sudo apt install -y input-remapper input-remapper-gtk lxpolkit

sudo usermod -aG input "$USER" 2>/dev/null || true

OPENBOX_AUTOSTART="${HOME}/.config/openbox/autostart"
mkdir -p "$(dirname "$OPENBOX_AUTOSTART")"
if ! grep -q lxpolkit "$OPENBOX_AUTOSTART" 2>/dev/null; then
  echo "lxpolkit &" >> "$OPENBOX_AUTOSTART"
  echo "Added lxpolkit to $OPENBOX_AUTOSTART"
fi

echo
echo "=== Enabling input-remapper service ==="
sudo systemctl enable --now input-remapper 2>/dev/null \
  || sudo systemctl enable --now input-remapper-daemon 2>/dev/null \
  || true

echo
echo "=== Start polkit agent on the TV session (password prompts) ==="
if pgrep -x lxpolkit >/dev/null; then
  echo "lxpolkit already running"
else
  DISPLAY="${DISPLAY:-:0}" XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}" \
    nohup lxpolkit >/dev/null 2>&1 &
  sleep 1
fi

echo
echo "=== Start reader service (sudo once — avoids pkexec over SSH) ==="
sudo input-remapper-control --command start-reader-service -d 2>/dev/null || true

echo
echo "=== Launch GUI ==="
echo "From SSH:"
echo "  export DISPLAY=:0 XAUTHORITY=\$HOME/.Xauthority"
echo "  input-remapper-gtk"
echo
echo "Or use Raspberry menu → Accessories → Input Remapper on the TV."
echo
echo "Target map (preset: mango-tv):"
echo "  D-pad → Up / Down / Left / Right"
echo "  A → Return   B → Escape   Play → space (optional)"
echo
echo "Apply → enable autoload. Re-login once if group input was added."
