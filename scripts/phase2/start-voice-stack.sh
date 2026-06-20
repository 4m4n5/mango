#!/usr/bin/env bash
# Start orchestrator (WSS) + companion HTTPS — prefers systemd, falls back to tmux.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"
mkdir -p "${HOME}/.cache/mango"

export MANGO_SKIP_OVERLAY=1

bash "$REPO_DIR/scripts/phase2/ensure-orchestrator-venv.sh"

start_via_systemd() {
  systemctl --user is-enabled mango-orchestrator.service &>/dev/null 2>&1 \
    && systemctl --user is-enabled mango-companion.service &>/dev/null 2>&1
}

wait_voice_healthy() {
  for _ in $(seq 1 30); do
    if curl -skf --max-time 1 https://127.0.0.1:8765/health >/dev/null 2>&1 \
      && curl -skf --max-time 1 https://127.0.0.1:3001/ >/dev/null 2>&1 \
      && ss -tlnp 2>/dev/null | grep -q '127.0.0.1:8766'; then
      pkill -f "chromium.*mango-overlay.*127.0.0.1:3000/overlay/" 2>/dev/null || true
      return 0
    fi
    sleep 1
  done
  return 1
}

if start_via_systemd; then
  tmux kill-session -t mango-orch 2>/dev/null || true
  tmux kill-session -t mango-companion 2>/dev/null || true
  systemctl --user start mango-orchestrator.service mango-companion.service
  if wait_voice_healthy; then
    echo "✓ voice stack up (systemd: mango-orchestrator, mango-companion; launcher HUD only)"
    echo "  phone: https://${MANGO_PI_IP:-10.0.0.174}:3001"
    exit 0
  fi
  echo "voice systemd units started but health check timed out" >&2
  systemctl --user status mango-orchestrator.service --no-pager -l | head -12 >&2 || true
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "Install tmux or run: bash scripts/phase2/install-voice-systemd.sh" >&2
  exit 1
fi

tmux kill-session -t mango-orch 2>/dev/null || true
tmux kill-session -t mango-companion 2>/dev/null || true

tmux new-session -d -s mango-orch \
  "cd \"$REPO_DIR\" && MANGO_ORCH_TLS=1 bash scripts/phase2/start-orchestrator.sh 2>&1 | tee -a \"${HOME}/.cache/mango/orchestrator.log\""
tmux new-session -d -s mango-companion \
  "cd \"$REPO_DIR\" && bash scripts/phase2/serve-companion-https.sh 2>&1 | tee -a \"${HOME}/.cache/mango/companion.log\""

if wait_voice_healthy; then
  echo "✓ voice stack up (tmux: mango-orch, mango-companion; launcher HUD only)"
  echo "  phone: https://${MANGO_PI_IP:-10.0.0.174}:3001"
  exit 0
fi

echo "voice stack started but health check timed out — tmux attach -t mango-orch" >&2
exit 1
