#!/usr/bin/env bash
# Start orchestrator (WSS) + companion HTTPS in tmux. Run on Pi after setup.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if ! command -v tmux >/dev/null 2>&1; then
  echo "Install tmux: sudo apt-get install -y tmux" >&2
  exit 1
fi

tmux kill-session -t mango-orch 2>/dev/null || true
tmux kill-session -t mango-companion 2>/dev/null || true

tmux new-session -d -s mango-orch \
  "cd \"$REPO_DIR\" && MANGO_ORCH_TLS=1 bash scripts/phase2/start-orchestrator.sh"
tmux new-session -d -s mango-companion \
  "cd \"$REPO_DIR\" && bash scripts/phase2/serve-companion-https.sh"

for _ in $(seq 1 30); do
  if curl -skf --max-time 1 https://127.0.0.1:8765/health >/dev/null 2>&1 \
    && curl -skf --max-time 1 https://127.0.0.1:3001/ >/dev/null 2>&1; then
    echo "✓ voice stack up (tmux: mango-orch, mango-companion)"
    echo "  phone: https://${MANGO_PI_IP:-10.0.0.174}:3001"
    exit 0
  fi
  sleep 1
done

echo "voice stack started but health check timed out — tmux attach -t mango-orch" >&2
exit 1
