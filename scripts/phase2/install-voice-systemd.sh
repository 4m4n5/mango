#!/usr/bin/env bash
# Install user systemd units for voice orchestrator + companion.
# Run on the Pi: bash ~/mango/scripts/phase2/install-voice-systemd.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
UNIT_SRC="$SCRIPT_DIR/systemd"
UNIT_DST="${HOME}/.config/systemd/user"

mkdir -p "$UNIT_DST" "${HOME}/.cache/mango"

for unit in mango-orchestrator.service mango-companion.service; do
  install -m 0644 "$UNIT_SRC/$unit" "$UNIT_DST/$unit"
done

chmod +x "$REPO_DIR/scripts/phase1/start-mango-launcher-chromium.sh" 2>/dev/null || true

systemctl --user daemon-reload

if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t mango-orch 2>/dev/null || true
  tmux kill-session -t mango-companion 2>/dev/null || true
fi

systemctl --user enable --now mango-orchestrator.service mango-companion.service

echo "✓ voice systemd units installed"
systemctl --user status mango-orchestrator.service --no-pager -l | head -8 || true
