#!/usr/bin/env bash
# Install a user systemd timer for daily playability top-up.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$UNIT_DIR/mango-playability-indexer.service"
TIMER_PATH="$UNIT_DIR/mango-playability-indexer.timer"

mkdir -p "$UNIT_DIR"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=mango playability indexer
After=default.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
Environment=MANGO_REPO_DIR=$REPO_DIR
ExecStart=/usr/bin/env nice -n 10 npm --prefix src/catalog-service exec tsx -- scripts/phase-n3c/playability-indexer.ts top-up --all
EOF

cat >"$TIMER_PATH" <<'EOF'
[Unit]
Description=mango playability indexer timer

[Timer]
OnBootSec=5min
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now mango-playability-indexer.timer
systemctl --user list-timers mango-playability-indexer.timer --no-pager
