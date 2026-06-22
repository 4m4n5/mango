#!/usr/bin/env bash
# One-shot bring-up after Pi reboot. Run on the Pi:
#   bash ~/mango/scripts/m1-foundation/ui/bootstrap-after-reboot.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export HOME="${HOME:-/home/aman}"

rm -f "${HOME}/.cache/mango/launch-launcher.lock"

cd "$REPO_DIR"

echo "=== gamepad (press a button on the Micro if connect is slow) ==="
bash scripts/m1-foundation/pad/gamepad-fresh-start.sh || true
# shellcheck source=m1-foundation/pad/lib/irctl.sh
source "$REPO_DIR/scripts/m1-foundation/pad/lib/irctl.sh"
ir_kill_readers || true

echo "=== openbox + remapper ==="
bash scripts/m1-foundation/pad/install-openbox-stremio-tv.sh
openbox --reconfigure 2>/dev/null || true

echo "=== mango stack ==="
if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi
if [[ "${MANGO_CATALOG:-0}" == "1" && ! -f "$REPO_DIR/src/catalog-service/dist/index.js" ]]; then
  echo "=== catalog-service build (first run) ==="
  (cd "$REPO_DIR/src/catalog-service" && npm ci && npm run build)
fi
bash scripts/mango-stack.sh restart

echo "=== TV pad router ==="
bash scripts/m1-foundation/pad/start-mango-tv-pad.sh || true

echo "=== status ==="
curl -s -o /dev/null -w "launcher HTTP: %{http_code}\n" http://127.0.0.1:3000/ || true
systemctl is-active input-remapper 2>/dev/null || echo "input-remapper: inactive"
pgrep -af 'mango-ui-server|mango-launcher' | head -3 || true

echo "✓ mango ready — launcher + voice (if MANGO_VOICE=1) + catalog (if MANGO_CATALOG=1). D-pad on home."
