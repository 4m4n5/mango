#!/usr/bin/env bash
# Install user systemd units for serve.py + health watchdog.
# Run on the Pi (logged-in desktop session):
#   bash ~/mango/scripts/phase1/install-systemd-units.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
UNIT_SRC="$SCRIPT_DIR/systemd"
UNIT_DST="${HOME}/.config/systemd/user"

mkdir -p "$UNIT_DST" "${HOME}/.cache/mango"

for unit in mango-ui-server.service mango-watchdog.service mango-watchdog.timer; do
  install -m 0644 "$UNIT_SRC/$unit" "$UNIT_DST/$unit"
done

systemctl --user daemon-reload
systemctl --user enable mango-ui-server.service mango-watchdog.timer
systemctl --user start mango-ui-server.service mango-watchdog.timer

if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  echo "! Tip: enable linger so user units survive logout:"
  echo "  sudo loginctl enable-linger $USER"
fi

echo "✓ systemd user units installed"
systemctl --user status mango-ui-server.service --no-pager -l | head -8 || true
systemctl --user list-timers mango-watchdog.timer --no-pager || true
