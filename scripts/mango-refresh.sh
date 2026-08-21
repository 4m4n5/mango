#!/usr/bin/env bash
# Lean Pi refresh — stop orphans, start minimal native stack, verify health.
# Usage: bash scripts/mango-refresh.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export MANGO_SKIP_OVERLAY=1
export MANGO_PLAYABILITY_TOPUP_ON_START=0

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

echo "=== mango refresh $(git rev-parse --short HEAD 2>/dev/null) ==="

# Orphans that compete with mpv / stremio-core during couch use.
bash scripts/mango-kill-strays.sh 2>/dev/null || true
pkill -x stremio 2>/dev/null || true
pkill -x kodi 2>/dev/null || true
if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t mango-orch 2>/dev/null || true
  tmux kill-session -t mango-companion 2>/dev/null || true
fi

bash scripts/mango-stack.sh stop
bash scripts/m2-catalog/service/mpv-stop.sh 2>/dev/null || true
rm -f "${HOME}/.cache/mango/catalog-service.pid" "${HOME}/.cache/mango/mpv.pid"

bash scripts/mango-stack.sh start

for _ in $(seq 1 24); do
  if pgrep -f "chromium.*mango-launcher.*127.0.0.1:3000/|firefox.*127.0.0.1:3000/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo "--- status ---"
bash scripts/mango-stack.sh status
python3 - <<'PY'
import json, urllib.request
try:
    h = json.load(urllib.request.urlopen("http://127.0.0.1:3000/api/health", timeout=3))
    print("launcher health:", "ok" if h.get("ok") else h)
except Exception as e:
    print("launcher health: FAIL", e)
PY

if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
  curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null \
    || { echo "FAIL: catalog-service not healthy after refresh" >&2; exit 1; }
fi

echo "refresh: ok"
