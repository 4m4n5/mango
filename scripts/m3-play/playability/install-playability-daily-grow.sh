#!/usr/bin/env bash
# Install a user systemd timer for daily quick grow (grow pass only, quick preset).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$UNIT_DIR/mango-playability-daily-grow.service"
TIMER_PATH="$UNIT_DIR/mango-playability-daily-grow.timer"

mkdir -p "$UNIT_DIR"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=mango playability daily quick grow
After=default.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
Environment=MANGO_REPO_DIR=$REPO_DIR
Environment=MANGO_MAINTENANCE_MODE=1
Environment=MANGO_PLAYABILITY_REFRESH_MODE=grow
Environment=MANGO_GROW_PRESET=quick
Environment=MANGO_PLAYABILITY_BOOTSTRAP=0
Environment=MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY=0
Environment=MANGO_MAINTENANCE_SKIP_GATE=1
Environment=MANGO_PLAYABILITY_PROBE_POOL=1
Environment=MANGO_PLAYABILITY_BATCH_DB=1
Environment=MANGO_PLAYABILITY_RESOLVE_CONCURRENCY=4
Environment=MANGO_PLAYABILITY_PROBE_CONCURRENCY=3
Environment=MANGO_GROW_REQUIRE_TARGET=0
Environment=MANGO_GROW_HITRATE_WEIGHTS=1
Environment=MANGO_SOURCE_HITRATE_PREFLIGHT=1
Environment=MANGO_SOURCE_HITRATE_QUICK_PER_SOURCE=1
Environment=MANGO_GROW_SOURCE_RESET_CYCLES=6
Environment=MANGO_GROW_HEAD_ADVANCE_PAGES=5
Environment=MANGO_PLAYABILITY_GROW_INGEST_BATCH=80
Environment=MANGO_PLAYABILITY_MAX_INGEST_SCAN=1800
Environment=MANGO_GROW_NO_STREAM_RETRY_MS=604800000
ExecStart=/usr/bin/bash $REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh --mode grow
EOF

cat >"$TIMER_PATH" <<'EOF'
[Unit]
Description=mango playability daily quick grow timer

[Timer]
OnBootSec=20min
OnCalendar=*-*-* 15:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now mango-playability-daily-grow.timer
systemctl --user list-timers mango-playability-daily-grow.timer --no-pager
