#!/usr/bin/env bash
# Mac: git pull on Pi, build, restart. Never rsync — see docs/DEPLOY.md
#
# Usage:
#   bash scripts/pi-deploy.sh [--fast] [--full] [--gate]
#
#   --fast   default for agent iteration — build + restart; npm ci only when
#            package-lock.json changes (see scripts/lib/pi-npm-deps.sh)
#   --full   always npm ci both apps (deps change, first boot, handoff)
#   --gate   run gate-lite after deploy (MANGO_GATE_FULL=1 for per-rail play sweep)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST="${MANGO_SSH_HOST:-mango}"
BRANCH="${MANGO_BRANCH:-$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo feat/native-experience)}"
RUN_GATE=0
FAST=1

usage() {
  sed -n '2,12p' "$0" >&2
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

LOCAL="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")"
git -C "$REPO_DIR" fetch origin "$BRANCH" 2>/dev/null || true
REMOTE="$(git -C "$REPO_DIR" rev-parse "origin/${BRANCH}" 2>/dev/null || echo "")"
if [[ -n "$LOCAL" && -n "$REMOTE" && "$LOCAL" != "$REMOTE" ]]; then
  echo "Mac is behind origin/${BRANCH} — pull or push from Mac first" >&2
  exit 1
fi
if git -C "$REPO_DIR" status --porcelain | grep -q .; then
  echo "Mac has uncommitted changes — commit and push before Pi deploy" >&2
  exit 1
fi

DEPLOY_MODE="fast"
[[ "$FAST" == "0" ]] && DEPLOY_MODE="full"
echo "pi-deploy: mode=${DEPLOY_MODE} gate=${RUN_GATE} branch=${BRANCH}"

REMOTE_SCRIPT="$(cat <<EOF
set -euo pipefail
cd ~/mango
git fetch origin
git checkout $(printf '%q' "$BRANCH")
git pull --ff-only
echo "Pi at \$(git rev-parse --short HEAD)"
bash scripts/lib/sync-etc-mango-config.sh || true
bash scripts/m4-addons/sync-aiometadata-rail-catalogs.sh || true
bash scripts/m5-voice/ai/sync-companion-example.sh || true
bash scripts/m4-addons/ensure-bharat-binge-export.sh || true
if [[ -f ~/.config/mango/voice.env ]]; then
  # shellcheck disable=SC1091
  source ~/.config/mango/voice.env
fi
if [[ $(printf '%q' "$FAST") == "1" ]]; then
  bash scripts/lib/pi-npm-deps.sh build src/catalog-service
  bash scripts/lib/pi-npm-deps.sh build src/launcher
else
  cd src/catalog-service && npm ci --silent && npm run build
  cd ~/mango/src/launcher && npm ci --silent && npm run build
fi
cd ~/mango
bash scripts/m1-foundation/ui/install-systemd-units.sh || true
if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  bash scripts/m5-voice/stack/install-voice-systemd.sh || true
fi
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
if systemctl --user is-enabled mango-launcher-chromium.service &>/dev/null; then
  systemctl --user restart mango-launcher-chromium.service || true
  sleep 2
fi
if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  python3 scripts/m5-voice/ai/sync-hinglish-stt-config.py || true
  bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh
  bash scripts/m5-voice/stack/start-voice-stack.sh || true
fi
bash scripts/mango-stack.sh status
EOF
)"

ssh -o ConnectTimeout=12 "$HOST" "bash -lc $(printf '%q' "$REMOTE_SCRIPT")"

if [[ "$RUN_GATE" == "1" ]]; then
  bash "$SCRIPT_DIR/pi-exec-gate.sh"
fi
