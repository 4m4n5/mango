#!/usr/bin/env bash
# Install a user systemd timer for daily playability maintenance refresh.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$UNIT_DIR/mango-playability-indexer.service"
TIMER_PATH="$UNIT_DIR/mango-playability-indexer.timer"

mkdir -p "$UNIT_DIR"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=mango playability maintenance refresh
After=default.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
Environment=MANGO_REPO_DIR=$REPO_DIR
Environment=MANGO_MAINTENANCE_MODE=1
Environment=MANGO_PLAYABILITY_REFRESH_MODE=stale
Environment=MANGO_PLAYABILITY_PROBE_POOL=1
Environment=MANGO_PLAYABILITY_BATCH_DB=1
Environment=MANGO_PLAYABILITY_RESOLVE_CONCURRENCY=8
Environment=MANGO_PLAYABILITY_PROBE_CONCURRENCY=3
Environment=MANGO_PLAYABILITY_PROBE_MS=12000
ExecStart=/usr/bin/env bash scripts/phase-n3c/playability-maintenance.sh --mode stale
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
