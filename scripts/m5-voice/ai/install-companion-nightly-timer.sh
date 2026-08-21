#!/usr/bin/env bash
# Install companion nightly consolidate timer.
#
# Schedule: 06:00 local — after the playability indexer (03:00, ~60–90m → typically
# done by ~04:30–05:00). Prior 05:30 slot still risked overlap on heavy grow nights;
# 06:00 leaves more buffer. RandomizedDelaySec avoids tight-second collisions if
# grow slips. The consolidate script also gates on the playability maintenance
# lock as a belt-and-braces safeguard.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$UNIT_DIR/mango-companion-nightly.service"
TIMER_PATH="$UNIT_DIR/mango-companion-nightly.timer"

mkdir -p "$UNIT_DIR"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=mango companion nightly consolidate
After=default.target mango-playability-indexer.service

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
Environment=MANGO_REPO_DIR=$REPO_DIR
Environment=MANGO_COMPANION_LLM_NIGHTLY=1
ExecStart=/usr/bin/env bash scripts/m5-voice/ai/companion-nightly-consolidate.sh
StandardOutput=journal
StandardError=journal
EOF

cat >"$TIMER_PATH" <<'EOF'
[Unit]
Description=mango companion nightly timer

[Timer]
OnCalendar=*-*-* 06:00:00
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable mango-companion-nightly.timer
# Restart (not just enable --now) so an already-active timer picks up the
# new OnCalendar / RandomizedDelaySec on re-install.
systemctl --user restart mango-companion-nightly.timer
systemctl --user list-timers mango-companion-nightly.timer --no-pager

echo "Companion nightly timer installed — 06:00 daily (after playability grow)"
