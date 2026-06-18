#!/usr/bin/env bash
# Check N1 prerequisites without installing. Exit 0 when ready for S0+S1.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

ERRORS=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }
warn() { echo "WARN: $*" >&2; }

echo "=== N1 prereq check $(date -Iseconds) ==="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

command -v mpv >/dev/null && pass "mpv $(mpv --version 2>/dev/null | head -1)" || fail "mpv not installed — run: bash scripts/phase-n1/install-n1-prereqs.sh"
command -v socat >/dev/null && pass "socat" || fail "socat not installed — run: bash scripts/phase-n1/install-n1-prereqs.sh"

if command -v node >/dev/null; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    pass "node $(node --version)"
  else
    warn "node $(node --version) < 20 — catalog-service may fail"
  fi
else
  fail "node not installed"
fi

[[ -f /etc/mango/config.yaml ]] && pass "/etc/mango/config.yaml" || warn "missing /etc/mango/config.yaml (optional for S0)"

if [[ -f /etc/mango/stremio-export.json ]]; then
  pass "/etc/mango/stremio-export.json"
  python3 - <<'PY' || fail "stremio-export.json invalid JSON"
import json, pathlib
p = pathlib.Path("/etc/mango/stremio-export.json")
data = json.loads(p.read_text(encoding="utf-8"))
if not isinstance(data.get("addons"), list) or len(data["addons"]) < 1:
    raise SystemExit("addons[] missing or empty")
print(f"  addons: {len(data['addons'])} entries")
PY
else
  fail "missing /etc/mango/stremio-export.json"
  echo "  fix: bash scripts/phase-n1/setup-stremio-export.sh --from-local" >&2
  echo "    or: Stremio Settings → Export → setup-stremio-export.sh <file>" >&2
fi

if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
  if [[ -f src/catalog-service/dist/index.js ]]; then
    pass "catalog-service dist built"
  else
    fail "catalog-service dist missing — cd src/catalog-service && npm ci && npm run build"
  fi
  if curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null 2>&1; then
    pass "catalog-service :3020 health"
  else
    warn "catalog-service not reachable — MANGO_CATALOG=1 bash scripts/mango-stack.sh restart"
  fi
fi

echo "--- N0 regression (quick) ---"
curl -sf --max-time 3 http://127.0.0.1:3000/api/health >/dev/null \
  && pass "launcher health" || warn "launcher not up — bash scripts/mango-stack.sh restart"

pgrep -x stremio >/dev/null && warn "stremio running (idle should be 0)" || pass "stremio idle"

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "N1 prereqs: READY for S0+S1"
  exit 0
fi
echo "N1 prereqs: NOT READY ($ERRORS blocking)"
exit 1
