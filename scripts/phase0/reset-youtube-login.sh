#!/usr/bin/env bash
# Clear YouTube addon login state and re-apply keys from ~/.config/mango/youtube-api.json
# Run on the Pi: bash scripts/phase0/reset-youtube-login.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADDON_DATA="${HOME}/.kodi/userdata/addon_data/plugin.video.youtube"

echo "=== mango: reset YouTube login ==="

killall kodi kodi.bin 2>/dev/null || true
sleep 2

if [[ -d "$ADDON_DATA" ]]; then
  echo "Removing login tokens and cache..."
  rm -f "${ADDON_DATA}"/access_token*.json
  rm -f "${ADDON_DATA}"/*.sqlite
  rm -f "${ADDON_DATA}"/cache/*
  rmdir "${ADDON_DATA}/cache" 2>/dev/null || true

  if [[ -f "${ADDON_DATA}/settings.xml" ]]; then
    echo "Clearing API fields in settings.xml (GUI overrides api_keys.json)..."
    python3 <<'PY'
import re
from pathlib import Path

path = Path.home() / ".kodi/userdata/addon_data/plugin.video.youtube/settings.xml"
text = path.read_text()
# Empty personal API settings so api_keys.json is used
for sid in ("api_key", "api_id", "api_secret"):
    text = re.sub(
        rf'(<setting id="{sid}"[^>]*>)(.*?)(</setting>)',
        r'\1\3',
        text,
        flags=re.DOTALL,
    )
path.write_text(text)
print("  ✓ Cleared api_key / api_id / api_secret in settings.xml")
PY
  fi
fi

bash "$SCRIPT_DIR/set-youtube-api-keys.sh"

echo
echo "✓ Login reset done"
echo "Next:"
echo "  bash scripts/phase0/launch-kodi.sh"
echo "  YouTube addon → Sign in"
echo "  A popup should show a code + google.com/device — enter it on your Mac"
echo "  You may need to sign in twice; second time click Advanced → Go to (unsafe)"
echo
echo "If Sign in still just refreshes, run this WHILE clicking Sign in in another SSH window:"
echo "  tail -f ~/.kodi/temp/kodi.log | grep -i youtube"
