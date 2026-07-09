#!/usr/bin/env bash
# Install the single scheduled library-maintenance timer.
#
# Schedule (local time):
#   03:00  mango-playability-indexer — nightly stale → grow → YouTube → proof
#
# Catch-up after a failed/deferred nightly is an explicit operator action:
#   bash scripts/m3-play/playability/playability-catch-up.sh nightly
# The old 7×/day mango-playability-catchup-watch.timer is retired (disabled/removed
# below) so daytime couch hours are not consumed by automatic full-nightly retries.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="$UNIT_DIR/mango-playability-indexer.service"
TIMER_PATH="$UNIT_DIR/mango-playability-indexer.timer"
CATCHUP_SERVICE_PATH="$UNIT_DIR/mango-playability-catchup-watch.service"
CATCHUP_TIMER_PATH="$UNIT_DIR/mango-playability-catchup-watch.timer"
LEGACY_DAILY_GROW_SERVICE="$UNIT_DIR/mango-playability-daily-grow.service"
LEGACY_DAILY_GROW_TIMER="$UNIT_DIR/mango-playability-daily-grow.timer"

mkdir -p "$UNIT_DIR"

# Keep scheduled library maintenance single-path: movie/TV playability first,
# then YouTube refresh. The old 15:00 quick-grow timer skipped YouTube and made
# operator state harder to reason about.
systemctl --user disable --now mango-playability-daily-grow.timer >/dev/null 2>&1 || true
rm -f "$LEGACY_DAILY_GROW_SERVICE" "$LEGACY_DAILY_GROW_TIMER"

# Retire the daytime catch-up watcher (was 09/11/13/15/17/19/21). Failed nightlies
# surface via Reliability Center; operators retry with playability-catch-up.sh.
# Never stop an active catchup oneshot here — that SIGTERMs grow (rc=143) and
# discards the staged work DB. Disable the timer so it cannot fire again; remove
# unit files only when the service is idle.
systemctl --user disable --now mango-playability-catchup-watch.timer >/dev/null 2>&1 || true
rm -f "$CATCHUP_TIMER_PATH"
if systemctl --user is-active --quiet mango-playability-catchup-watch.service 2>/dev/null; then
  echo "warn: mango-playability-catchup-watch.service still active — leaving unit until idle"
  echo "      after grow finishes: systemctl --user stop mango-playability-catchup-watch.service"
  echo "      then re-run this installer to remove the leftover service unit"
else
  systemctl --user reset-failed mango-playability-catchup-watch.service >/dev/null 2>&1 || true
  rm -f "$CATCHUP_SERVICE_PATH"
fi

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=mango nightly library and YouTube refresh
After=default.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
# Nightly grow can run 60-90m; killing it discards the staged work DB.
TimeoutStartSec=infinity
Environment=MANGO_REPO_DIR=$REPO_DIR
Environment=MANGO_MAINTENANCE_MODE=1
Environment=MANGO_PLAYABILITY_REFRESH_MODE=nightly
Environment=MANGO_GROW_PRESET=nightly
Environment=MANGO_GROW_HITRATE_WEIGHTS=1
Environment=MANGO_SOURCE_HITRATE_PREFLIGHT=1
Environment=MANGO_SOURCE_HITRATE_NIGHTLY_PER_SOURCE=3
Environment=MANGO_PLAYABILITY_BOOTSTRAP=0
Environment=MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY=0
Environment=MANGO_MAINTENANCE_SKIP_GATE=1
Environment=MANGO_PLAYABILITY_PROBE_POOL=1
Environment=MANGO_PLAYABILITY_BATCH_DB=1
Environment=MANGO_PLAYABILITY_RESOLVE_CONCURRENCY=4
Environment=MANGO_PLAYABILITY_PROBE_CONCURRENCY=3
Environment=MANGO_MAINTENANCE_PHASE_COOLDOWN_SEC=45
Environment=MANGO_GROW_REQUIRE_TARGET=0
Environment=MANGO_GROW_SOURCE_RESET_CYCLES=10
Environment=MANGO_GROW_SOURCE_ADVANCE_PAGES=25
Environment=MANGO_PLAYABILITY_GROW_INGEST_BATCH=80
Environment=MANGO_PLAYABILITY_MAX_INGEST_SCAN=2400
Environment=MANGO_GROW_NO_STREAM_RETRY_MS=604800000
Environment=MANGO_NIGHTLY_YOUTUBE_REFRESH=1
ExecStart=/usr/bin/bash $REPO_DIR/scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly
EOF

cat >"$TIMER_PATH" <<'EOF'
[Unit]
Description=mango playability indexer timer

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now mango-playability-indexer.timer
systemctl --user list-timers mango-playability-indexer.timer --no-pager

echo "Playability timer installed — 03:00 nightly only"
echo "Catch-up (manual): bash scripts/m3-play/playability/playability-catch-up.sh nightly"
