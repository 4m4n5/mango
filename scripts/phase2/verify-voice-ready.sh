#!/usr/bin/env bash
# Automated voice + overlay readiness checks (run on Pi).
# Usage: bash scripts/phase2/verify-voice-ready.sh

set -uo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

PASS=0
FAIL=0
WARN=0
SHOT_DIR="${MANGO_VERIFY_SHOT_DIR:-/tmp/mango-verify-$(date +%Y%m%d-%H%M%S)}"

ok() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }
wrn() { echo "  WARN: $*"; WARN=$((WARN + 1)); }

echo "========== mango voice verify $(date -Iseconds) =========="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

echo "--- git ---"
if LOCAL=$(git rev-parse HEAD 2>/dev/null) && REMOTE=$(git rev-parse origin/main 2>/dev/null); then
  [[ "$LOCAL" == "$REMOTE" ]] && ok "in sync ($LOCAL)" || bad "out of sync local=$LOCAL remote=$REMOTE"
else
  wrn "could not compare git refs"
fi

echo "--- config & secrets ---"
[[ -f /etc/mango/config.yaml ]] && ok config-yaml || bad config-yaml-missing
grep -q "tts_enabled: false" /etc/mango/config.yaml 2>/dev/null && ok tts-disabled-config || wrn tts-not-disabled-in-config
grep -q "local_ws_port: 8766" /etc/mango/config.yaml 2>/dev/null && ok local-ws-port || bad local-ws-port-missing
[[ -s /etc/mango/stt.key ]] && ok stt-key || bad stt-key-empty
[[ -s /etc/mango/llm.key ]] && ok llm-key || bad llm-key-empty
if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi
[[ "${MANGO_VOICE:-}" == "1" ]] && ok voice-env || bad "MANGO_VOICE!=1"
[[ "${MANGO_TTS_DISABLED:-}" == "1" ]] && ok tts-disabled-env || wrn MANGO_TTS_DISABLED-not-set

echo "--- HTTP health ---"
curl -sf http://127.0.0.1:3000/api/health >/tmp/mango-launcher-health.json && ok launcher-health || bad launcher-health
curl -sf http://127.0.0.1:3000/ | grep -q voice-hud && ok launcher-voice-hud || bad launcher-voice-hud-missing
curl -sf http://127.0.0.1:8766/health >/tmp/mango-orch-local.json && ok orch-local-ws || bad orch-local-ws
curl -skf https://127.0.0.1:8765/health >/tmp/mango-orch-tls.json && ok orch-tls-wss || bad orch-tls-wss
COMP_CODE=$(curl -skf -o /dev/null -w "%{http_code}" https://127.0.0.1:3001/ 2>/dev/null || echo 000)
[[ "$COMP_CODE" == "200" ]] && ok companion-https || bad "companion-https code=$COMP_CODE"

echo "--- overlay websocket ---"
CLIENTS=$(python3 -c 'import json; print(json.load(open("/tmp/mango-orch-local.json"))["clients"])' 2>/dev/null || echo 0)
if [[ "$CLIENTS" -ge 1 ]]; then
  ok "overlay-connected clients=$CLIENTS"
else
  bad "overlay-not-connected clients=$CLIENTS"
fi

echo "--- processes ---"
pgrep -f "mango-launcher.*127.0.0.1:3000" >/dev/null && ok launcher-chromium || bad launcher-chromium
pgrep -f "mango-overlay.*127.0.0.1:3000/overlay" >/dev/null && ok overlay-chromium || bad overlay-chromium
pgrep -f "orchestrator.main" >/dev/null && ok orchestrator || bad orchestrator
tmux has-session -t mango-orch 2>/dev/null && ok tmux-orch || bad tmux-orch
tmux has-session -t mango-companion 2>/dev/null && ok tmux-companion || bad tmux-companion

echo "--- X11 windows ---"
OVERLAY_WID=""
if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -lx 2>/dev/null | grep -q mango-launcher && ok wmctrl-launcher || bad wmctrl-launcher
  wmctrl -lx 2>/dev/null | grep -q mango-overlay && ok wmctrl-overlay || bad wmctrl-overlay
  OVERLAY_WID=$(wmctrl -lx 2>/dev/null | awk '/mango-overlay/ {print $1; exit}')
  if [[ -n "$OVERLAY_WID" ]] && command -v xdotool >/dev/null 2>&1; then
    # shellcheck disable=SC1090
    eval "$(xdotool getwindowgeometry --shell "$OVERLAY_WID" 2>/dev/null)" || true
    echo "  INFO: overlay ${WIDTH:-?}x${HEIGHT:-?} @ ${X:-?},${Y:-?} wid=$OVERLAY_WID"
    [[ "${WIDTH:-0}" -ge 600 ]] && ok overlay-window-width || wrn overlay-window-narrow
    [[ "${HEIGHT:-0}" -ge 200 ]] && ok overlay-window-height || bad overlay-window-collapsed
    if [[ "${Y:-0}" -gt 840 ]]; then
      wrn "overlay-y=${Y:-?} may clip on 1080p — run present-overlay.sh"
    fi
  fi
else
  wrn wmctrl-missing
fi

echo "--- overlay static assets ---"
curl -sf http://127.0.0.1:3000/overlay/ | grep -q overlay-shell && ok overlay-html || bad overlay-html
[[ -f src/overlay/dist/index.html ]] && ok overlay-dist || bad overlay-dist-missing
JS_FILE=$(ls src/overlay/dist/assets/*.js 2>/dev/null | head -1)
if [[ -n "$JS_FILE" ]] && grep -q "8766" "$JS_FILE" 2>/dev/null; then
  ok overlay-bundle-ws-8766
else
  wrn overlay-bundle-may-be-stale
fi

echo "--- overlay chromium log ---"
if [[ -f "${HOME}/.cache/mango/mango-overlay-chromium.log" ]]; then
  SSL_COUNT=$(tail -30 "${HOME}/.cache/mango/mango-overlay-chromium.log" | grep -c handshake || true)
  [[ "$SSL_COUNT" -eq 0 ]] && ok no-recent-ssl-errors || wrn "ssl-handshake-errors-in-log=$SSL_COUNT"
else
  wrn overlay-chromium-log-missing
fi

echo "--- pad ---"
systemctl --user is-active mango-tv-pad.service >/dev/null 2>&1 && ok pad-service || bad pad-service

echo "--- websocket smoke ---"
if python3 -c "import websockets" 2>/dev/null; then
  python3 <<'PY'
import asyncio, json, sys
import websockets

async def main():
    async with websockets.connect("ws://127.0.0.1:8766/ws") as ws:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
        assert msg.get("type") == "status", msg
        print("  PASS: ws-smoke state=" + str(msg.get("state")))

asyncio.run(main())
PY
  ok ws-python-smoke
else
  wrn "websockets pkg missing — pip install websockets in orch venv for ws smoke"
fi

echo "--- deepgram auth smoke ---"
if [[ -d src/orchestrator/.venv ]]; then
  (
    cd src/orchestrator
    # shellcheck disable=SC1091
    source .venv/bin/activate
    python3 <<'PY'
import numpy as np
from orchestrator.config import load_settings
from orchestrator.audio.deepgram_stt import transcribe

settings = load_settings()
try:
    transcribe(np.zeros(8000, dtype=np.float32), settings)
except RuntimeError as exc:
    if "no speech" in str(exc).lower():
        print("  PASS: deepgram-reachable")
    else:
        print("  FAIL: deepgram " + str(exc))
        raise SystemExit(1)
PY
  ) && ok deepgram-reachable || bad deepgram-smoke
else
  wrn orchestrator-venv-missing
fi

echo "--- screenshots ---"
mkdir -p "$SHOT_DIR"
SHOT_OK=0
if command -v scrot >/dev/null 2>&1; then
  scrot "$SHOT_DIR/full.png" 2>/dev/null && SHOT_OK=1
elif command -v import >/dev/null 2>&1; then
  import -window root "$SHOT_DIR/full.png" 2>/dev/null && SHOT_OK=1
elif command -v xwd >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then
  xwd -root -out "$SHOT_DIR/full.xwd" 2>/dev/null \
    && convert "$SHOT_DIR/full.xwd" "$SHOT_DIR/full.png" 2>/dev/null && SHOT_OK=1
fi

if [[ "$SHOT_OK" == "1" && -f "$SHOT_DIR/full.png" ]]; then
  ok "screenshot $SHOT_DIR/full.png ($(wc -c < "$SHOT_DIR/full.png") bytes)"
  if [[ -n "${X:-}" && -n "${WIDTH:-}" && -n "${HEIGHT:-}" ]] && command -v convert >/dev/null 2>&1; then
    convert "$SHOT_DIR/full.png" -crop "${WIDTH}x${HEIGHT}+${X}+${Y}" "$SHOT_DIR/overlay-crop.png" 2>/dev/null \
      && ok "overlay-crop $SHOT_DIR/overlay-crop.png" || wrn overlay-crop-failed
  fi
  if [[ -n "$OVERLAY_WID" ]] && command -v xwd >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then
    xwd -id "$OVERLAY_WID" -out "$SHOT_DIR/overlay-window.xwd" 2>/dev/null \
      && convert "$SHOT_DIR/overlay-window.xwd" "$SHOT_DIR/overlay-window.png" 2>/dev/null \
      && ok "overlay-window-shot $SHOT_DIR/overlay-window.png" || wrn overlay-window-shot-failed
  fi
else
  wrn "no screenshot tool (install scrot or imagemagick)"
fi

echo "--- orchestrator log ---"
tmux capture-pane -t mango-orch -p 2>/dev/null | tail -6 | sed 's/^/  /' || wrn tmux-orch-unreadable

echo
echo "========== SUMMARY pass=$PASS fail=$FAIL warn=$WARN =========="
echo "screenshots: $SHOT_DIR"
[[ "$FAIL" -eq 0 ]]
