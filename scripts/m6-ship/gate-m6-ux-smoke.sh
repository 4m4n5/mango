#!/usr/bin/env bash
# M6.5 lightweight UX smoke — launcher DOM/CSS/JS contracts, focus surfaces, pad alive.
# Safe on Mac (source checks) and Pi (live launcher HTTP). ~10s on Pi.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR" || exit 1

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init
gate_header "M6.5 UX smoke"

LAUNCHER="${MANGO_LAUNCHER_URL:-http://127.0.0.1:${MANGO_LAUNCHER_PORT:-3000}}"
DIST="$REPO_DIR/src/launcher/dist"
SRC="$REPO_DIR/src/launcher/src"

if [[ -f "$DIST/index.html" ]]; then
  gate_pass "launcher dist/index.html"
else
  gate_fail "launcher dist/index.html missing — cd src/launcher && npm run build"
fi

python3 - "$SRC/voice-hud.ts" "$SRC/detail.ts" "$SRC/focus.ts" <<'PY' \
  && gate_pass "launcher source UX contracts" \
  || gate_fail "launcher source UX contracts"
import pathlib
import sys

voice = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
detail = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
focus = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")

if "MAX_VISIBLE_MS = 12_000" not in voice:
    raise SystemExit("voice-hud missing 12s max-visible timer")
if "moveRow" not in detail or "moveCol" not in detail:
    raise SystemExit("detail.ts missing 2D moveRow/moveCol")
if "getBoundingClientRect" not in detail:
    raise SystemExit("detail.ts missing geometry-based spatial focus (getBoundingClientRect)")
if "class FocusGrid" not in focus:
    raise SystemExit("focus.ts missing FocusGrid class (home rails)")
PY

if [[ -f "$DIST/index.html" ]]; then
  python3 - "$DIST/index.html" <<'PY' \
    && gate_pass "launcher dist HTML ids" \
    || gate_fail "launcher dist HTML ids"
import pathlib
import sys

html = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
required = (
    'id="voice-hud"',
    'id="detail-view"',
    'id="home-view"',
    'id="detail-play"',
    'id="detail-episode-list"',
    'class="voice-hud"',
    'class="browse-brand"',
    'data-visible="false"',
)
missing = [token for token in required if token not in html]
if missing:
    raise SystemExit(f"missing: {', '.join(missing)}")
if "What do you want to watch?" in html:
    raise SystemExit("home masthead prompt must be removed")
PY
fi

css_file=""
if [[ -f "$DIST/index.html" ]]; then
  css_file="$(
    python3 - "$DIST/index.html" "$DIST" <<'PY'
import pathlib
import re
import sys

html = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
root = pathlib.Path(sys.argv[2])
match = re.search(r'href="([^"]+\.css)"', html)
if not match:
    raise SystemExit(1)
path = root / match.group(1).lstrip("/")
if path.is_file():
    print(path)
PY
  )" || true
fi

if [[ -n "$css_file" && -f "$css_file" ]]; then
  python3 - "$css_file" <<'PY' \
    && gate_pass "launcher dist CSS focus + HUD safe-area" \
    || gate_fail "launcher dist CSS focus + HUD safe-area"
import pathlib
import sys

css = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
required = (
    ".card.focused",
    ".detail-button.focused",
    ".detail-episode.focused",
    ".voice-hud",
    "safe-area-inset-bottom",
    "--focus-gutter",
    "overflow:visible",
    ".browse-brand",
    ".card--landscape",
)
missing = [token for token in required if token not in css]
if missing:
    raise SystemExit(f"missing CSS: {', '.join(missing)}")
PY
else
  gate_fail "launcher dist CSS bundle"
fi

js_file=""
if [[ -f "$DIST/index.html" ]]; then
  js_file="$(
    python3 - "$DIST/index.html" "$DIST" <<'PY'
import pathlib
import re
import sys

html = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
root = pathlib.Path(sys.argv[2])
match = re.search(r'src="([^"]+\.js)"', html)
if not match:
    raise SystemExit(1)
path = root / match.group(1).lstrip("/")
if path.is_file():
    print(path)
PY
  )" || true
fi

if [[ -n "$js_file" && -f "$js_file" ]]; then
  python3 - "$js_file" <<'PY' \
    && gate_pass "launcher dist JS focus grid" \
    || gate_fail "launcher dist JS focus grid"
import pathlib
import sys

js = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
required = ("moveRow", "moveCol")
missing = [token for token in required if token not in js]
if missing:
    raise SystemExit(f"missing JS: {', '.join(missing)}")
PY
else
  gate_fail "launcher dist JS bundle"
fi

if curl -sf --max-time 5 "$LAUNCHER/api/health" >/dev/null 2>&1; then
  gate_pass "launcher /api/health"
  live_html="$(curl -sf --max-time 5 "$LAUNCHER/" || true)"
  if [[ -n "$live_html" ]] && grep -q 'id="voice-hud"' <<<"$live_html"; then
    gate_pass "live launcher HTML voice-hud"
  else
    gate_fail "live launcher HTML voice-hud"
  fi
  if systemctl --user is-active mango-tv-pad.service &>/dev/null \
    || pgrep -f '[m]ango-tv-pad\.py' >/dev/null; then
    gate_pass "mango-tv-pad alive"
  else
    gate_fail "mango-tv-pad not running"
  fi
else
  gate_warn "launcher not reachable at $LAUNCHER (source/dist checks only)"
  if systemctl --user is-active mango-tv-pad.service &>/dev/null \
    || pgrep -f '[m]ango-tv-pad\.py' >/dev/null; then
    gate_pass "mango-tv-pad alive"
  else
    gate_warn "mango-tv-pad not running (ok off-Pi)"
  fi
fi

if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  if curl -sf --max-time 3 "$LAUNCHER/" | grep -q voice-hud; then
    gate_pass "voice HUD markup when MANGO_VOICE=1"
  else
    gate_fail "voice HUD markup when MANGO_VOICE=1"
  fi
fi

if [[ "${MANGO_PAD_NAV_API:-0}" == "1" ]]; then
  PAD_NAV_OUT="/tmp/mango-gate-pad-nav-$$.json"
  PAD_NAV_SEQ=0
  PAD_NAV_LATEST=0

  HTTP_CODE="$(curl -s -o "$PAD_NAV_OUT" -w "%{http_code}" --max-time 5 \
    -X POST "$LAUNCHER/api/pad/nav" \
    -H "content-type: application/json" \
    -d '{"type":"pad_nav","action":"move","direction":"down"}' 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]] \
    && python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("ok") is True and isinstance(d.get("seq"), int)' "$PAD_NAV_OUT" 2>/dev/null; then
    PAD_NAV_SEQ="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("seq"))' "$PAD_NAV_OUT")"
    gate_pass "pad-nav POST /api/pad/nav seq=$PAD_NAV_SEQ"
  else
    gate_fail "pad-nav POST /api/pad/nav"
  fi

  HTTP_CODE="$(curl -s -o "$PAD_NAV_OUT" -w "%{http_code}" --max-time 5 \
    "$LAUNCHER/api/pad/nav?after=0&wait=1" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]] \
    && python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("ok") is True and isinstance(d.get("latest_seq"), int) and d.get("latest_seq",0) >= int(sys.argv[2]) and isinstance(d.get("commands"), list) and any(c.get("action")=="move" for c in d.get("commands",[]))' "$PAD_NAV_OUT" "$PAD_NAV_SEQ" 2>/dev/null; then
    PAD_NAV_LATEST="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("latest_seq"))' "$PAD_NAV_OUT")"
    gate_pass "pad-nav GET /api/pad/nav latest_seq=$PAD_NAV_LATEST"
  else
    gate_fail "pad-nav GET /api/pad/nav"
  fi

  HTTP_CODE="$(curl -s -o "$PAD_NAV_OUT" -w "%{http_code}" --max-time 5 \
    -X POST "$LAUNCHER/api/pad/ack" \
    -H "content-type: application/json" \
    -d "{\"last_seq\": $PAD_NAV_LATEST}" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]]; then
    gate_pass "pad-nav POST /api/pad/ack"
  else
    gate_fail "pad-nav POST /api/pad/ack"
  fi

  rm -f "$PAD_NAV_OUT"
fi

gate_finish "gate-m6-ux-smoke" || exit 1
