#!/usr/bin/env bash
# Install companion nightly consolidate timer (04:30 PDT — after playability at 03:00).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$UNIT_DIR/mango-companion-nightly.service"
TIMER_PATH="$UNIT_DIR/mango-companion-nightly.timer"

mkdir -p "$UNIT_DIR"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=mango companion nightly consolidate
After=default.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
Environment=MANGO_REPO_DIR=$REPO_DIR
Environment=MANGO_COMPANION_LLM_NIGHTLY=1
ExecStart=/usr/bin/env bash scripts/phase-n5/companion-nightly-consolidate.sh
StandardOutput=journal
StandardError=journal
EOF

cat >"$TIMER_PATH" <<'EOF'
[Unit]
Description=mango companion nightly timer

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now mango-companion-nightly.timer
systemctl --user list-timers mango-companion-nightly.timer --no-pager

echo "Companion nightly timer installed — 04:30 daily (after playability 03:00)"
