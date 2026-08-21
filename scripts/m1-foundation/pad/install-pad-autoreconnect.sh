#!/usr/bin/env bash
# Back-compat wrapper. Controller link ownership now lives in the dedicated
# installer rather than udev hooks or the evdev router.
# Run on the Pi:
#   cd ~/mango && git pull
#   sudo bash scripts/m1-foundation/pad/install-pad-autoreconnect.sh
#   bash scripts/m1-foundation/pad/start-mango-tv-pad.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "${SCRIPT_DIR}/install-controller-reliability.sh" "${1:---apply}"
