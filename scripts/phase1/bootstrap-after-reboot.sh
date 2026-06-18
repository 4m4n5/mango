#!/usr/bin/env bash
# One-shot bring-up after Pi reboot. Run on the Pi:
#   bash ~/mango/scripts/phase1/bootstrap-after-reboot.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export HOME="${HOME:-/home/aman}"

rm -f "${HOME}/.cache/mango/launch-launcher.lock"

cd "$REPO_DIR"

echo "=== gamepad (press a button on the Micro if connect is slow) ==="
bash scripts/phase0/gamepad-fresh-start.sh || true
# shellcheck source=phase0/lib/irctl.sh
source "$REPO_DIR/scripts/phase0/lib/irctl.sh"
ir_kill_readers || true

echo "=== openbox + remapper ==="
bash scripts/phase0/install-openbox-stremio-tv.sh
openbox --reconfigure 2>/dev/null || true

echo "=== mango UI ==="
bash scripts/phase1/restart-mango-ui.sh

echo "=== TV pad router ==="
bash scripts/phase0/start-mango-tv-pad.sh || true

echo "=== status ==="
curl -s -o /dev/null -w "launcher HTTP: %{http_code}\n" http://127.0.0.1:3000/ || true
systemctl is-active input-remapper 2>/dev/null || echo "input-remapper: inactive"
pgrep -af 'mango-ui-server|mango-launcher' | head -3 || true

echo "✓ mango ready — D-pad on launcher, then try Stremio"
