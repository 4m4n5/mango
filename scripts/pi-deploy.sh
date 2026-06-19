#!/usr/bin/env bash
# Mac: git pull on Pi, build, restart. Never rsync — see docs/DEPLOY.md
# Usage: bash scripts/pi-deploy.sh [--gate]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST="${MANGO_SSH_HOST:-mango}"
BRANCH="${MANGO_BRANCH:-$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo feat/native-experience)}"
RUN_GATE=0
[[ "${1:-}" == "--gate" ]] && RUN_GATE=1

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

REMOTE_SCRIPT="$(cat <<EOF
set -euo pipefail
cd ~/mango
git fetch origin
git checkout $(printf '%q' "$BRANCH")
git pull --ff-only
echo "Pi at \$(git rev-parse --short HEAD)"
if [[ -f ~/.config/mango/voice.env ]]; then
  # shellcheck disable=SC1091
  source ~/.config/mango/voice.env
fi
cd src/catalog-service && npm ci --silent && npm run build
cd ../launcher && npm ci --silent && npm run build
cd ~/mango
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
if [[ "\${MANGO_VOICE:-0}" == "1" ]]; then
  bash scripts/phase2/ensure-orchestrator-venv.sh
  bash scripts/phase2/start-voice-stack.sh || true
fi
bash scripts/mango-stack.sh status
EOF
)"

ssh -o ConnectTimeout=12 "$HOST" "bash -lc $(printf '%q' "$REMOTE_SCRIPT")"

if [[ "$RUN_GATE" == "1" ]]; then
  bash "$SCRIPT_DIR/pi-exec-gate.sh"
fi
