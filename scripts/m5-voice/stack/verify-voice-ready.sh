#!/usr/bin/env bash
# Automated voice + launcher-HUD readiness checks (run on Pi).
# Usage: bash scripts/m5-voice/stack/verify-voice-ready.sh

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
BRANCH="$(git branch --show-current 2>/dev/null || echo main)"
REMOTE_REF="origin/${BRANCH}"
git fetch origin "$BRANCH" >/dev/null 2>&1 || true
if LOCAL=$(git rev-parse HEAD 2>/dev/null) && REMOTE=$(git rev-parse "$REMOTE_REF" 2>/dev/null); then
  [[ "$LOCAL" == "$REMOTE" ]] && ok "in sync with $REMOTE_REF ($LOCAL)" || bad "out of sync local=$LOCAL remote=$REMOTE_REF:$REMOTE"
else
  wrn "could not compare git refs"
fi

echo "--- config & secrets ---"
[[ -f /etc/mango/config.yaml ]] && ok config-yaml || bad config-yaml-missing
grep -q "tts_enabled: false" /etc/mango/config.yaml 2>/dev/null && ok tts-disabled-config || wrn tts-not-disabled-in-config
if grep -q "local_ws_port" /etc/mango/config.yaml 2>/dev/null; then
  ok local-ws-port-config
else
  wrn local-ws-port-missing-in-config
fi
[[ -s /etc/mango/stt.key ]] && ok stt-key || bad stt-key-empty
[[ -s /etc/mango/llm.key ]] && ok llm-key || bad llm-key-empty
MAX_TOKENS="$(python3 - <<'PY' 2>/dev/null || echo 0
import yaml
from pathlib import Path
p = Path("/etc/mango/config.yaml")
if not p.is_file():
    print(0)
    raise SystemExit
raw = yaml.safe_load(p.read_text()) or {}
print(int((raw.get("llm") or {}).get("max_tokens") or 0))
PY
)"
if [[ "${MAX_TOKENS:-0}" -ge 192 ]]; then
  ok "llm-max-tokens ($MAX_TOKENS)"
else
  bad "llm-max-tokens too low ($MAX_TOKENS) — voice tools need >= 192 on Pi"
fi
if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi
[[ "${MANGO_VOICE:-}" == "1" ]] && ok voice-env || bad "MANGO_VOICE!=1"
[[ "${MANGO_TTS_DISABLED:-}" == "1" ]] && ok tts-disabled-env || wrn MANGO_TTS_DISABLED-not-set
[[ "${MANGO_SKIP_OVERLAY:-1}" == "1" ]] && ok skip-overlay-env || bad MANGO_SKIP_OVERLAY-not-1

python3 <<'PY' && ok hinglish-stt-config || bad hinglish-stt-config
import sys
import yaml
from pathlib import Path

path = Path("/etc/mango/config.yaml")
raw = yaml.safe_load(path.read_text()) if path.is_file() else {}
stt = raw.get("stt") or {}
model = str(stt.get("model", ""))
language = str(stt.get("language", ""))
strategy = str(stt.get("strategy", "multilingual_with_detect_fallback"))
if "nova-3" not in model:
    sys.exit(f"model={model!r}")
if language != "multi":
    sys.exit(f"language={language!r}")
if strategy not in {"multilingual", "multilingual_with_detect_fallback", "detect"}:
    sys.exit(f"strategy={strategy!r}")
PY

echo "--- HTTP health ---"
curl -sf http://127.0.0.1:3000/api/health >/tmp/mango-launcher-health.json && ok launcher-health || bad launcher-health
curl -sf http://127.0.0.1:3000/ | grep -q voice-hud && ok launcher-voice-hud || bad launcher-voice-hud-missing
curl -skf https://127.0.0.1:8765/health >/tmp/mango-orch.json && ok orch-wss-health || bad orch-wss-health
if ss -tlnp 2>/dev/null | grep -q '127.0.0.1:8766'; then
  ok loopback-8766-listener
else
  bad loopback-8766-missing
fi
COMP_CODE=$(curl -skf -o /dev/null -w "%{http_code}" https://127.0.0.1:3001/ 2>/dev/null || echo 000)
[[ "$COMP_CODE" == "200" ]] && ok companion-https || bad "companion-https code=$COMP_CODE"

echo "--- launcher HUD websocket ---"
CLIENTS=$(python3 -c 'import json; print(json.load(open("/tmp/mango-orch.json"))["clients"])' 2>/dev/null || echo 0)
if [[ "$CLIENTS" -ge 1 ]]; then
  ok "hud-connected clients=$CLIENTS"
else
  bad "hud-not-connected clients=$CLIENTS"
fi

echo "--- processes ---"
pgrep -f "mango-launcher.*127.0.0.1:3000" >/dev/null && ok launcher-chromium || bad launcher-chromium
if pgrep -f "mango-overlay.*127.0.0.1:3000/overlay" >/dev/null; then
  bad overlay-chromium-running
else
  ok overlay-chromium-absent
fi
pgrep -f "orchestrator.main" >/dev/null && ok orchestrator || bad orchestrator
tmux has-session -t mango-orch 2>/dev/null && ok tmux-orch || bad tmux-orch
tmux has-session -t mango-companion 2>/dev/null && ok tmux-companion || bad tmux-companion

echo "--- X11 windows ---"
if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -lx 2>/dev/null | grep -q mango-launcher && ok wmctrl-launcher || bad wmctrl-launcher
  if wmctrl -lx 2>/dev/null | grep -q mango-overlay; then
    bad wmctrl-overlay-present
  else
    ok wmctrl-overlay-absent
  fi
else
  wrn wmctrl-missing
fi

echo "--- overlay route retired ---"
OVERLAY_CODE=$(curl -s -o /tmp/mango-overlay-retired.json -w "%{http_code}" http://127.0.0.1:3000/overlay/ 2>/dev/null || echo 000)
[[ "$OVERLAY_CODE" == "410" ]] && ok overlay-route-410 || wrn "overlay-route code=$OVERLAY_CODE"

echo "--- pad ---"
systemctl --user is-active mango-tv-pad.service >/dev/null 2>&1 && ok pad-service || bad pad-service

echo "--- websocket smoke ---"
python3 scripts/m1-foundation/gate/ws-stress.py --url wss://127.0.0.1:8765/ws --count 3 --insecure \
  && ok ws-smoke || bad ws-smoke

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
else
  wrn "no screenshot tool (install scrot or imagemagick)"
fi

echo "--- orchestrator log ---"
if tmux has-session -t mango-orch 2>/dev/null; then
  tmux capture-pane -t mango-orch -p 2>/dev/null | tail -6 | sed 's/^/  /' || wrn tmux-orch-unreadable
elif [[ -f "${HOME}/.cache/mango/orchestrator.log" ]]; then
  tail -6 "${HOME}/.cache/mango/orchestrator.log" | sed 's/^/  /'
else
  wrn orchestrator-log-missing
fi

echo "--- voice turns (recent) ---"
VOICE_LOG="${HOME}/.cache/mango/voice-turns.jsonl"
if [[ -f "$VOICE_LOG" ]]; then
  tail -4 "$VOICE_LOG" | sed 's/^/  /'
else
  wrn voice-turns-missing
fi

echo
echo "========== SUMMARY pass=$PASS fail=$FAIL warn=$WARN =========="
echo "screenshots: $SHOT_DIR"
[[ "$FAIL" -eq 0 ]]
