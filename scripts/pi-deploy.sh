#!/usr/bin/env bash
# Mac: git pull on Pi, build, restart. Never rsync — see docs/OPERATIONS.md
#
# Usage:
#   bash scripts/pi-deploy.sh [--fast] [--full] [--gate]
#
#   --fast   default for agent iteration — build + restart; npm ci only when
#            package-lock.json changes (see scripts/lib/pi-npm-deps.sh)
#   --full   always npm ci both apps (deps change, first boot, handoff)
#   --gate   run gate-lite after deploy (MANGO_GATE_FULL=1 for per-rail play sweep)
#   MANGO_CONTROLLER_LINK_INSTALL=1 installs controller BlueZ policy before restart
#   MANGO_SYNC_AIOMETADATA=1 opts into the AIOMetadata rail catalog sync
#   MANGO_DEPLOY_SHA=<full sha> pins the exact commit on Mac and Pi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/pi-deploy-preflight.sh
source "$SCRIPT_DIR/lib/pi-deploy-preflight.sh"

HOST="${MANGO_SSH_HOST:-mango}"
BRANCH="${MANGO_BRANCH:-$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || true)}"
RUN_GATE=0
FAST=1

usage() {
  sed -n '2,16p' "$0" >&2
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --full) FAST=0 ;;
    --gate) RUN_GATE=1 ;;
    -h|--help) usage ;;
    *)
      echo "unknown arg: $arg" >&2
      usage
      ;;
  esac
done

if [[ "${MANGO_PI_DEPLOY_FULL:-}" == "1" ]]; then
  FAST=0
elif [[ "${MANGO_PI_DEPLOY_FAST:-}" == "1" ]]; then
  FAST=1
fi

mango_require_deploy_branch "$BRANCH"
mango_refuse_unexpected_dirty "$REPO_DIR" "Mac"
mango_fetch_origin_branch "$REPO_DIR" "$BRANCH"
LOCAL="$(git -C "$REPO_DIR" rev-parse HEAD)"
EXPECTED="$(mango_expected_deploy_sha "$REPO_DIR" "$BRANCH")"
mango_require_sha "Mac HEAD" "$LOCAL" "$EXPECTED"

SYNC_AIOMETADATA="${MANGO_SYNC_AIOMETADATA:-0}"
SKIP_AIOMETADATA=1
if [[ "$SYNC_AIOMETADATA" == "1" ]]; then
  SKIP_AIOMETADATA=0
fi

DEPLOY_MODE="fast"
[[ "$FAST" == "0" ]] && DEPLOY_MODE="full"
echo "pi-deploy: mode=${DEPLOY_MODE} gate=${RUN_GATE} branch=${BRANCH} sha=${EXPECTED} aiometadata=${SYNC_AIOMETADATA}"

REMOTE_SCRIPT="$(cat <<EOF
set -euo pipefail
cd ~/mango
git fetch origin "$(printf '%q' "$BRANCH")"
mango_status="\$(git status --porcelain)"
if [[ -n "\$mango_status" && "${MANGO_DEPLOY_ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "Pi has uncommitted changes — refuse deploy" >&2
  echo "\$mango_status" >&2
  exit 1
fi
git checkout $(printf '%q' "$BRANCH")
git merge --ff-only $(printf '%q' "$EXPECTED")
actual="\$(git rev-parse HEAD)"
if [[ "\$actual" != $(printf '%q' "$EXPECTED") ]]; then
  echo "Pi SHA \$actual does not match expected $(printf '%q' "$EXPECTED")" >&2
  exit 1
fi
echo "Pi at \$actual"
bash scripts/lib/sync-etc-mango-config.sh || true
if [[ "${SKIP_AIOMETADATA}" == "0" ]]; then
  MANGO_SKIP_AIOMETADATA_SYNC=0 bash scripts/m4-addons/sync-aiometadata-rail-catalogs.sh
else
  MANGO_SKIP_AIOMETADATA_SYNC=1 bash scripts/m4-addons/sync-aiometadata-rail-catalogs.sh
fi
bash scripts/m5-voice/ai/sync-companion-example.sh || true
bash scripts/m4-addons/ensure-bharat-binge-export.sh || true
bash scripts/m6-ship/ensure-youtube-yt-dlp.sh || true
if [[ "${MANGO_CONTROLLER_LINK_INSTALL:-0}" == "1" ]]; then
  sudo -n bash scripts/m1-foundation/pad/install-controller-reliability.sh --apply
fi
if [[ -f ~/.config/mango/voice.env ]]; then
  # shellcheck disable=SC1091
  source ~/.config/mango/voice.env
fi
if [[ $(printf '%q' "$FAST") == "1" ]]; then
  bash scripts/lib/pi-npm-deps.sh build src/catalog-service
  bash scripts/lib/pi-npm-deps.sh build src/launcher
  bash scripts/lib/pi-npm-deps.sh build src/companion
else
  cd src/catalog-service && npm ci --silent && npm run build
  cd ~/mango/src/launcher && npm ci --silent && npm run build
  cd ~/mango/src/companion && npm ci --silent && npm run build
fi
cd ~/mango
bash scripts/m1-foundation/ui/install-systemd-units.sh || true
if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  bash scripts/m5-voice/stack/install-voice-systemd.sh || true
fi
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
if systemctl --user is-enabled mango-launcher-chromium.service &>/dev/null; then
  # shellcheck source=/dev/null
  source scripts/lib/mango-browse-display.sh
  if playback_surface_active; then
    echo "pi-deploy: skip launcher restart (playback active)"
  else
    bash scripts/lib/mango-display-mode.sh ensure-launcher 2>/dev/null || true
    systemctl --user restart mango-launcher-chromium.service || true
    sleep 2
  fi
fi
if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  python3 scripts/m5-voice/ai/sync-hinglish-stt-config.py || true
  bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh
  bash scripts/m5-voice/stack/start-voice-stack.sh || true
fi
bash scripts/mango-stack.sh status
readback="\$(git rev-parse HEAD)"
if [[ "\$readback" != $(printf '%q' "$EXPECTED") ]]; then
  echo "Pi readback SHA \$readback does not match expected $(printf '%q' "$EXPECTED")" >&2
  exit 1
fi
EOF
)"

ssh -o ConnectTimeout=12 "$HOST" "bash -lc $(printf '%q' "$REMOTE_SCRIPT")"

if [[ "$RUN_GATE" == "1" ]]; then
  MANGO_DEPLOY_SHA="$EXPECTED" bash "$SCRIPT_DIR/pi-exec-gate.sh"
fi
