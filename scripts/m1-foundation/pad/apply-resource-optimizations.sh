#!/usr/bin/env bash
# Apply Pi resource optimizations (run on the Pi after git pull).
#   bash scripts/m1-foundation/pad/apply-resource-optimizations.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

echo "=== kill strays ==="
bash scripts/mango-kill-strays.sh || true

echo "=== single pad owner ==="
bash scripts/lib/stop-input-remapper.sh || true

echo "=== kiosk bloat ==="
bash scripts/m1-foundation/pad/disable-kiosk-bloat.sh

echo "=== systemd units ==="
bash scripts/m1-foundation/ui/install-systemd-units.sh
if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi
if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  bash scripts/m5-voice/stack/install-voice-systemd.sh
fi

if [[ -f deploy/aiostreams/compose.yaml ]] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx mango-aiostreams; then
  echo "=== AIOStreams mem_limit (recreate container) ==="
  (cd deploy/aiostreams && docker compose up -d)
fi

echo "=== done ==="
free -h | head -2
