#!/usr/bin/env bash
# N5a voice tools gate — manifest + search smoke (no LLM API, no play).
# Usage: bash scripts/phase-n5/gate-voice-tools.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
PASS=0
FAIL=0

ok() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

echo "=== N5 voice tools gate $(date -Iseconds) ==="
echo "catalog: $CATALOG"
echo

if curl -sf --max-time 5 "$CATALOG/health" >/dev/null; then
  ok catalog-health
else
  bad catalog-health
  echo "SUMMARY pass=$PASS fail=$FAIL"
  exit 1
fi

TOOLS_JSON="$(curl -sf --max-time 10 "$CATALOG/voice/tools" || true)"
if [[ -n "$TOOLS_JSON" ]] && echo "$TOOLS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True; names={t["name"] for t in d["tools"]}; assert "mango_open_title" in names and "mango_search" in names and "mango_play" not in names' 2>/dev/null; then
  ok voice-tools-manifest
else
  bad voice-tools-manifest
fi

SEARCH_JSON="$(curl -sf --max-time 10 "$CATALOG/voice/search?q=test&limit=3" || true)"
if [[ -n "$SEARCH_JSON" ]] && echo "$SEARCH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True and isinstance(d.get("results"), list)' 2>/dev/null; then
  ok voice-search-endpoint
else
  bad voice-search-endpoint
fi

NOW_JSON="$(curl -sf --max-time 10 "$CATALOG/voice/now-playing" || true)"
if [[ -n "$NOW_JSON" ]] && echo "$NOW_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' 2>/dev/null; then
  ok voice-now-playing
else
  bad voice-now-playing
fi

LIB_JSON="$(curl -sf --max-time 15 "$CATALOG/voice/library?overview=1" || true)"
if [[ -n "$LIB_JSON" ]] && echo "$LIB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True and "verified_count" in d' 2>/dev/null; then
  ok voice-library-overview
else
  bad voice-library-overview
fi

NOTES_JSON="$(curl -sf --max-time 10 "$CATALOG/voice/library/notes" || true)"
if [[ -n "$NOTES_JSON" ]] && echo "$NOTES_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' 2>/dev/null; then
  ok voice-librarian-notes
else
  bad voice-librarian-notes
fi

LAUNCHER_PORT="${MANGO_LAUNCHER_PORT:-3000}"
VOICE_POST="$(curl -sf --max-time 5 -X POST "http://127.0.0.1:${LAUNCHER_PORT}/api/voice/command" \
  -H 'content-type: application/json' \
  -d '{"type":"launcher_command","action":"tab","tab":"movies"}' || true)"
if [[ -n "$VOICE_POST" ]] && echo "$VOICE_POST" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True and d.get("seq", 0) > 0' 2>/dev/null; then
  ok launcher-voice-command-post
else
  bad launcher-voice-command-post
fi

STATE_JSON="$(curl -sf --max-time 5 "http://127.0.0.1:${LAUNCHER_PORT}/api/voice/state" || true)"
DRAIN_JSON="$(curl -sf --max-time 5 "http://127.0.0.1:${LAUNCHER_PORT}/api/voice/commands?after=0" || true)"
REPLAY_JSON="$(curl -sf --max-time 5 "http://127.0.0.1:${LAUNCHER_PORT}/api/voice/commands?after=99999" || true)"
if [[ -n "$STATE_JSON" ]] && echo "$STATE_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' 2>/dev/null \
  && [[ -n "$DRAIN_JSON" ]] && echo "$DRAIN_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' 2>/dev/null \
  && [[ -n "$REPLAY_JSON" ]] && echo "$REPLAY_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True and d.get("commands")==[]' 2>/dev/null; then
  ok launcher-voice-command-drain
else
  bad launcher-voice-command-drain
fi

if [[ -d src/orchestrator/.venv ]]; then
  (
    cd src/orchestrator
    # shellcheck disable=SC1091
    source .venv/bin/activate
    MANGO_VOICE_TOOLS=1 MANGO_SKIP_WARMUP=1 python3 <<'PY'
from orchestrator.config import load_settings
from orchestrator.tools.launcher import build_launcher_command

settings = load_settings()
cmd = build_launcher_command("mango_navigate", {"action": "tab", "tab": "series"})
assert cmd["type"] == "launcher_command"
assert cmd["action"] == "tab"
print("launcher-command-ok")
PY
  ) && ok orchestrator-launcher-command || bad orchestrator-launcher-command
else
  echo "  WARN: orchestrator venv missing — skip python smoke"
fi

echo
echo "SUMMARY pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
