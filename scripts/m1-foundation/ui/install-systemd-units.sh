#!/usr/bin/env bash
# Install user systemd units for serve.py + health watchdog.
# Run on the Pi (logged-in desktop session):
#   bash ~/mango/scripts/m1-foundation/ui/install-systemd-units.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
UNIT_SRC="$SCRIPT_DIR/systemd"
UNIT_DST="${HOME}/.config/systemd/user"

mkdir -p "$UNIT_DST" "${HOME}/.cache/mango"

for unit in \
  mango-ui-server.service \
  mango-catalog.service \
  mango-watchdog.service \
  mango-watchdog.timer \
  mango-launcher-chromium.service \
  mango-tv-pad.service \
  mango-vod-recs-worker.service \
  mango-youtube-pot.service \
  mango-youtube-runtime-refresh.service \
  mango-youtube-runtime-refresh.timer \
  mango-youtube-runtime-retry.timer \
  mango-youtube-runtime-refresh.path; do
  install -m 0644 "$UNIT_SRC/$unit" "$UNIT_DST/$unit"
done

chmod +x "$REPO_DIR/scripts/m1-foundation/ui/start-mango-launcher-chromium.sh"
chmod +x "$REPO_DIR/scripts/m1-foundation/pad/run-mango-tv-pad.sh"
chmod +x "$REPO_DIR/scripts/m1-foundation/pad/pad-health.sh"
chmod +x "$REPO_DIR/scripts/m2-catalog/service/run-catalog-service.sh"
chmod +x "$REPO_DIR/scripts/m2-catalog/vod-recs-worker/vod-recs-worker.sh"
chmod +x "$REPO_DIR/scripts/mango-health-repair.sh"
chmod +x "$REPO_DIR/scripts/m6-ship/ensure-youtube-yt-dlp.sh"
chmod +x "$REPO_DIR/scripts/m6-ship/youtube-runtime-refresh.sh"
chmod +x "$REPO_DIR/scripts/m6-ship/youtube-runtime-canary.py"
chmod +x "$REPO_DIR/scripts/m6-ship/youtube-pot-server.sh"

systemctl --user daemon-reload
systemctl --user enable mango-ui-server.service mango-catalog.service mango-watchdog.timer mango-launcher-chromium.service mango-tv-pad.service mango-vod-recs-worker.service mango-youtube-runtime-refresh.timer mango-youtube-runtime-refresh.path
if [[ "${MANGO_YOUTUBE_POT:-1}" != "0" ]]; then
  systemctl --user enable --now mango-youtube-pot.service
else
  systemctl --user disable --now mango-youtube-pot.service
fi
systemctl --user start \
  mango-ui-server.service \
  mango-catalog.service \
  mango-watchdog.timer \
  mango-youtube-runtime-refresh.timer \
  mango-youtube-runtime-refresh.path
# The worker loads compiled ranking code once at process start. Restart it on
# every deploy so an already-running unit cannot keep the previous checkout's
# ranker in memory after the Pi advances to a new SHA.
systemctl --user restart mango-vod-recs-worker.service
# The router executes Python directly from the checkout. Reload it on every
# deploy so newly pulled button behavior cannot remain stale in memory.
systemctl --user restart mango-tv-pad.service

if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  echo "! Tip: enable linger so user units survive logout:"
  echo "  sudo loginctl enable-linger $USER"
fi

echo "✓ systemd user units installed"
systemctl --user status mango-ui-server.service --no-pager -l | head -8 || true
systemctl --user status mango-catalog.service --no-pager -l | head -8 || true
systemctl --user status mango-tv-pad.service --no-pager -l | head -8 || true
systemctl --user status mango-youtube-pot.service --no-pager -l | head -8 || true
systemctl --user list-timers mango-watchdog.timer mango-youtube-runtime-refresh.timer mango-youtube-runtime-retry.timer --no-pager || true
