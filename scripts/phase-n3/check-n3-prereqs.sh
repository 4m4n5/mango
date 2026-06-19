#!/usr/bin/env bash
# Phase N3a prerequisite check — filters, built artifacts, mpv probe support.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

ERRORS=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }
warn() { echo "WARN: $*" >&2; }

echo "=== N3 prereq check $(date -Iseconds) ==="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

FILTERS="config/catalog-filters.example.json"
if [[ -f "$FILTERS" ]]; then
  python3 - "$FILTERS" <<'PY' && pass "catalog-filters.example.json N3a fields" || fail "catalog-filters.example.json N3a fields"
import json
import sys
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
required = {
    "exclude_uncached_debrid": True,
    "strict_unknown_cache": False,
    "max_quality": "1080p",
    "exclude_remux": True,
    "auto_play_max_attempts": 2,
    "auto_play_wall_ms": 15000,
    "auto_play_probe_ms": 8000,
}
for key, expected in required.items():
    actual = data.get(key)
    if actual != expected:
        raise SystemExit(f"{key}: expected {expected!r}, got {actual!r}")
tiers = data.get("auto_play_tiers")
if not isinstance(tiers, list) or len(tiers) < 2:
    raise SystemExit("auto_play_tiers must contain at least two tiers")
if any("AIOStreams | ElfHosted" not in tier.get("addons", []) for tier in tiers[:2]):
    raise SystemExit("first two tiers must target AIOStreams | ElfHosted")
print("  tiers:", ", ".join(tier.get("require_cache", "?") for tier in tiers[:2]))
PY
else
  fail "missing $FILTERS"
fi

[[ -f src/catalog-service/dist/index.js ]] && pass "catalog-service dist built" || fail "catalog-service dist missing — cd src/catalog-service && npm run build"
[[ -f src/catalog-service/dist/play-orchestrator.js ]] && pass "play-orchestrator dist built" || fail "play-orchestrator dist missing — cd src/catalog-service && npm run build"
[[ -f src/launcher/dist/index.html ]] && pass "launcher dist built" || fail "launcher dist missing — cd src/launcher && npm run build"

if grep -q -- "--probe" scripts/phase-n1/mpv-play.sh && grep -q -- "--timeout-ms" scripts/phase-n1/mpv-play.sh; then
  pass "mpv-play.sh probe flags"
else
  fail "mpv-play.sh missing --probe/--timeout-ms"
fi

command -v mpv >/dev/null && pass "mpv $(mpv --version 2>/dev/null | head -1)" || fail "mpv not installed"
command -v socat >/dev/null && pass "socat" || fail "socat not installed"

if curl -sf --max-time 3 http://127.0.0.1:3020/health >/tmp/mango-n3-health.json 2>/dev/null; then
  pass "catalog-service :3020 health"
else
  fail "catalog-service :3020 not reachable (MANGO_CATALOG=1 bash scripts/mango-stack.sh restart)"
fi

PROBE_URL="${MANGO_N3_PROBE_MP4_URL:-https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4}"
if [[ "${MANGO_N3_SKIP_PROBE_SMOKE:-0}" == "1" ]]; then
  warn "skipping mpv probe smoke by env"
elif bash scripts/phase-n1/mpv-play.sh --url "$PROBE_URL" --probe --timeout-ms 4000; then
  pass "mpv-play --probe smoke"
else
  fail "mpv-play --probe smoke"
fi

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "N3 prereqs: READY"
  exit 0
fi
echo "N3 prereqs: NOT READY ($ERRORS blocking)"
exit 1
