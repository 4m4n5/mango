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
