#!/usr/bin/env bash
# Test whether the YouTube addon API config page is listening.
# Run on the Pi while Kodi is open: bash scripts/m1-foundation/pad/test-youtube-api-page.sh

set -euo pipefail

PORT="${1:-50152}"
PI_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

echo "=== mango: YouTube API page reachability (port ${PORT}) ==="
echo

echo "Listeners on ${PORT}:"
if ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  ss -tlnp 2>/dev/null | grep ":${PORT} " || ss -tln | grep ":${PORT} "
else
  echo "  ! nothing listening on ${PORT}"
  echo "  → Kodi running? Enable API page in YouTube → Configure → API"
  echo "  → Open YouTube addon once, or restart Kodi after enabling"
fi
echo

try_url() {
  local label=$1 url=$2
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "200" ]]; then
    echo "  ✓ ${label}: HTTP ${code} — ${url}"
  else
    echo "  ! ${label}: HTTP ${code} — ${url}"
  fi
}

echo "HTTP checks (/youtube/api path is required):"
try_url "localhost" "http://127.0.0.1:${PORT}/youtube/api"
if [[ -n "$PI_IP" ]]; then
  try_url "LAN (${PI_IP})" "http://${PI_IP}:${PORT}/youtube/api"
fi
echo

echo "---"
echo "If localhost works but LAN fails:"
echo "  YouTube → Configure → Advanced → HTTP Server → Select listen IP"
echo "  Set to ${PI_IP:-your Pi IP} (not 127.0.0.1), or re-run Setup wizard"
echo
echo "Skip the web UI — use SSH instead:"
echo "  bash scripts/m1-foundation/pad/set-youtube-api-keys.sh"
echo "  (see docs/kodi-youtube-setup.md Part 4)"
