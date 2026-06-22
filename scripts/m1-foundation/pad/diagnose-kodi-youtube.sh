#!/usr/bin/env bash
# Check Kodi YouTube addon health (no secrets printed).
# Run on the Pi: bash scripts/m1-foundation/pad/diagnose-kodi-youtube.sh

set -euo pipefail

KODI_HOME="${HOME}/.kodi"
ADDON_DATA="${KODI_HOME}/userdata/addon_data/plugin.video.youtube"
SETTINGS="${ADDON_DATA}/settings.xml"
API_KEYS="${ADDON_DATA}/api_keys.json"
LOG="${KODI_HOME}/temp/kodi.log"

echo "=== mango: Kodi YouTube diagnostics ==="
echo

echo "Addon install:"
if ls "${KODI_HOME}/addons/plugin.video.youtube"* &>/dev/null; then
  ls -d "${KODI_HOME}/addons/plugin.video.youtube"* 2>/dev/null
else
  echo "  ! plugin.video.youtube not installed"
fi
echo

echo "InputStream Adaptive (apt):"
dpkg -l 2>/dev/null | grep -iE 'inputstream-adaptive|kodi.*inputstream' || echo "  ! not found via dpkg"
echo

check_nonempty() {
  local label=$1 file=$2 key=$3
  if [[ ! -f "$file" ]]; then
    echo "  $label: (file missing)"
    return
  fi
  if grep -q "$key" "$file" 2>/dev/null; then
    if grep "$key" "$file" | grep -qE '""|><|</value>$'; then
      echo "  $label: EMPTY"
    else
      echo "  $label: set"
    fi
  else
    echo "  $label: (not in file)"
  fi
}

echo "API credentials (settings.xml):"
if [[ -f "$SETTINGS" ]]; then
  check_nonempty "API key" "$SETTINGS" "api_key"
  check_nonempty "API id (client)" "$SETTINGS" "api_id"
  check_nonempty "API secret" "$SETTINGS" "api_secret"
else
  echo "  ! no settings.xml — run Setup wizard or enter API keys"
fi
echo

if [[ -f "$API_KEYS" ]]; then
  echo "api_keys.json: present (GUI settings override this file)"
else
  echo "api_keys.json: not present"
fi
echo

echo "Recent YouTube errors in kodi.log:"
if [[ -f "$LOG" ]]; then
  grep -iE 'plugin\.video\.youtube.*(error|exception|quota|403|401|invalid|login)' "$LOG" 2>/dev/null | tail -8 || echo "  (none in tail — try reproducing error then re-run)"
else
  echo "  ! kodi.log not found"
fi
echo

echo "---"
echo "If API key / id / secret show EMPTY, lists will fail."
echo "Fix: docs/kodi-youtube-setup.md → Part 4 (Personal API keys)"
echo "Mac browser: http://$(hostname -I 2>/dev/null | awk '{print $1}'):50152/youtube/api"
echo "  (enable API config page in YouTube addon → Settings → API first)"
