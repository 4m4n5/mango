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

python3 - "$SRC/voice-hud.ts" "$SRC/detail.ts" "$SRC/focus.ts" "$SRC/main.ts" "$SRC/next-prompt.ts" "$SRC/playback-return.ts" "$SRC/catalog.ts" "$SRC/search.ts" <<'PY' \
  && gate_pass "launcher source UX contracts" \
  || gate_fail "launcher source UX contracts"
import pathlib
import sys

voice = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
detail = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
focus = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8")
main = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8")
next_prompt = pathlib.Path(sys.argv[5]).read_text(encoding="utf-8")
playback_return = pathlib.Path(sys.argv[6]).read_text(encoding="utf-8")
catalog = pathlib.Path(sys.argv[7]).read_text(encoding="utf-8")
search = pathlib.Path(sys.argv[8]).read_text(encoding="utf-8")

if "MAX_VISIBLE_MS = 12_000" not in voice:
    raise SystemExit("voice-hud missing 12s max-visible timer")
if "moveRow" not in detail or "moveCol" not in detail:
    raise SystemExit("detail.ts missing 2D moveRow/moveCol")
if "getBoundingClientRect" not in detail:
    raise SystemExit("detail.ts missing geometry-based spatial focus (getBoundingClientRect)")
if "class FocusGrid" not in focus:
    raise SystemExit("focus.ts missing FocusGrid class (home rails)")
if "async refreshAfterPlayback" not in detail or "await this.loadEpisodeList(card)" not in detail:
    raise SystemExit("detail.ts missing in-place playback-return progress refresh")
refresh = detail.split("async refreshAfterPlayback", 1)[1].split("restoreAfterPlayback", 1)[0]
if "this.focusEpisodeById(returningEpisodeId)" not in refresh:
    raise SystemExit("detail.ts playback return does not restore exact episode focus")
if refresh.find("await this.loadEpisodeList(card)") > refresh.find("this.focusEpisodeById(returningEpisodeId)"):
    raise SystemExit("detail.ts must finish episode refresh before restoring episode focus")
if "nextEpisodeFocusTarget" not in detail or "this.pendingEpisodeRestore = focusTarget" not in detail:
    raise SystemExit("detail.ts missing completion-to-next-episode focus contract")
for durable_contract in ("localStorage.setItem", "localStorage.getItem", "localStorage.removeItem"):
    if durable_contract not in playback_return:
        raise SystemExit(f"playback-return.ts missing restart-safe storage contract: {durable_contract}")
for false_claim in ("trying alternate release", "caching stream on TorBox"):
    if false_claim in detail:
        raise SystemExit(f"detail.ts contains unverified slow-resolve claim: {false_claim}")
for contract in ("savePlaybackReturnSnapshot", "AbortController", "signal: abort.signal"):
    if contract not in next_prompt:
        raise SystemExit(f"next-prompt.ts missing direct-play return/cancel contract: {contract}")
if "reconcileEpisodePlayTimeout" not in detail:
    raise SystemExit("detail.ts missing frozen-launcher play-timeout reconciliation")
if detail.count("clearPlaybackReturnSnapshot();") < 3:
    raise SystemExit("detail.ts does not clear durable return state on cancel/failure/hide")
failure_block = detail.split("} catch (error) {", 1)[1].split("} finally {", 1)[0]
if failure_block.find("reconcileEpisodePlayTimeout") > failure_block.find("setEpisodeStreamBadge(episodeId, false)"):
    raise SystemExit("detail.ts greys an episode before playback-timeout reconciliation")
if "function setStatus(_message: string): void {}" in main or "showToast(message)" not in main:
    raise SystemExit("main.ts next-prompt failures are not routed to the existing toast")
for session_contract in ("/api/catalog/play-session", "ever_ready", "readPlaybackSession"):
    if session_contract not in catalog:
        raise SystemExit(f"catalog.ts missing playback-session contract: {session_contract}")
for search_contract in (
    "class SearchController",
    "mango.search-session.v1",
    "secondary(kind",
    # Was "PAGE_SIZE = 9". That literal fitted the 9-poster grid exactly and went
    # stale the moment the grid was resized, leaving "More" revealing rows that
    # could not be rendered. Pin the derivation instead of the number.
    "railColumns(landscape) *",
    'setAttribute("aria-label", "Search scope")',
    'setAttribute("aria-pressed"',
    "search-query-shell",
    "search-compose-body",
    "mergeComposeFocusRows(this.keyboardRows, this.starterRows)",
    "shouldClearSuggestions(this.query, this.suggestions.length)",
):
    if search_contract not in search:
        raise SystemExit(f"search.ts missing Search surface contract: {search_contract}")
set_query = search.split("private setQuery", 1)[1].split("private scheduleSuggestions", 1)[0]
if "this.render()" in set_query.split("if (wasSubmitted)", 1)[1].split("} else {", 1)[1]:
    raise SystemExit("Search typing path rebuilds the full DOM")
suggestions = search.split("private scheduleSuggestions", 1)[1].split("private async submit", 1)[0]
if "this.render()" in suggestions:
    raise SystemExit("Search suggestion refresh rebuilds the full DOM")
if "document.activeElement !== target" not in focus:
    raise SystemExit("FocusGrid repeats focus and scroll work for an unchanged target")
if 'origin === "search"' not in playback_return:
    raise SystemExit("playback-return.ts missing Search-origin Detail restoration")
PY

"$REPO_DIR/src/catalog-service/node_modules/.bin/tsx" --test \
  "$SRC/catalog-errors.test.ts" \
  "$SRC/playback-return.test.ts" \
  "$SRC/playback-return-focus.test.ts" \
  "$SRC/playback-reconciliation.test.ts" \
  "$SRC/playback-session-client.test.ts" \
  "$SRC/stream-list-recovery.test.ts" \
  "$SRC/detail-search-queue.test.ts" \
  "$SRC/search.test.ts" \
  "$SRC/pad-nav.test.ts" \
  && gate_pass "launcher playback return + timeout reconciliation tests" \
  || gate_fail "launcher playback return + timeout reconciliation tests"

python3 "$REPO_DIR/scripts/m1-foundation/pad/test_pad_context.py" >/dev/null \
  && gate_pass "contextual X visible-surface ownership" \
  || gate_fail "contextual X visible-surface ownership"

if grep -q '^Environment=MANGO_PAD_NAV_API=1$' \
  "$REPO_DIR/scripts/m1-foundation/ui/systemd/mango-tv-pad.service" \
  && grep -q 'os.environ.get("MANGO_PAD_NAV_API", "1")' \
  "$REPO_DIR/scripts/m1-foundation/pad/mango-tv-pad.py"; then
  gate_pass "pad-nav launcher transport default-on"
else
  gate_fail "pad-nav launcher transport is not default-on"
fi

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
    'id="search-entry"',
    'id="search-view"',
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
    ".search-query-shell",
    ".search-compose-body",
    ".search-key.focused",
    ".search-edit[hidden]",
    "prefers-reduced-motion",
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

PAD_NAV_GATE_ENABLED="${MANGO_PAD_NAV_API:-1}"
if [[ "$PAD_NAV_GATE_ENABLED" == "1" ]] \
  && curl -sf --max-time 2 "$LAUNCHER/api/health" >/dev/null 2>&1; then
  PAD_NAV_OUT="/tmp/mango-gate-pad-nav-$$.json"
  PAD_NAV_SEQ=0
  PAD_NAV_PENDING_BEFORE=-1

  python3 "$REPO_DIR/src/mango-ui-server/test_pad_nav_queue.py" >/dev/null \
    && gate_pass "pad-nav queue/session/probe unit tests" \
    || gate_fail "pad-nav queue/session/probe unit tests"

  python3 "$REPO_DIR/scripts/m1-foundation/pad/test_pad_nav_fallback.py" >/dev/null \
    && gate_pass "pad-nav no-xdotool fallback contract" \
    || gate_fail "pad-nav no-xdotool fallback contract"

  PAD_NAV_PENDING_BEFORE="$(curl -sf --max-time 2 "$LAUNCHER/api/pad/nav?after=0&wait=0" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("commands") or []))' 2>/dev/null || echo 0)"

  # probe=true validates the contract without enqueueing couch FocusGrid moves.
  HTTP_CODE="$(curl -s -o "$PAD_NAV_OUT" -w "%{http_code}" --max-time 5 \
    -X POST "$LAUNCHER/api/pad/nav" \
    -H "content-type: application/json" \
    -d '{"type":"pad_nav","action":"move","direction":"down","probe":true}' 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]] \
    && python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("ok") is True and d.get("probe") is True and isinstance(d.get("seq"), int)' "$PAD_NAV_OUT" 2>/dev/null; then
    PAD_NAV_SEQ="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("seq"))' "$PAD_NAV_OUT")"
    gate_pass "pad-nav POST /api/pad/nav probe seq=$PAD_NAV_SEQ"
  else
    gate_fail "pad-nav POST /api/pad/nav probe"
  fi

  HTTP_CODE="$(curl -s -o "$PAD_NAV_OUT" -w "%{http_code}" --max-time 5 \
    "$LAUNCHER/api/pad/nav?after=0&wait=1" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]] \
    && python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("ok") is True and isinstance(d.get("latest_seq"), int) and d.get("latest_seq",0) >= int(sys.argv[2]) and isinstance(d.get("commands"), list) and len(d.get("commands") or []) == int(sys.argv[3])' "$PAD_NAV_OUT" "$PAD_NAV_SEQ" "$PAD_NAV_PENDING_BEFORE" 2>/dev/null; then
    gate_pass "pad-nav GET /api/pad/nav probe left queue unchanged"
  else
    gate_fail "pad-nav GET /api/pad/nav after probe"
  fi

  # Do not POST /api/pad/session here — last register wins and would steal the
  # TV Chromium consumer. Session+drain coverage lives in test_pad_nav_queue.py.
  HTTP_CODE="$(curl -s -o "$PAD_NAV_OUT" -w "%{http_code}" --max-time 5 \
    -X POST "$LAUNCHER/api/pad/ack" \
    -H "content-type: application/json" \
    -d "{\"last_seq\": $PAD_NAV_SEQ}" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]] \
    && python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("ok") is True and d.get("drained") is False' "$PAD_NAV_OUT" 2>/dev/null; then
    gate_pass "pad-nav POST /api/pad/ack (foreign; no drain)"
  else
    gate_fail "pad-nav POST /api/pad/ack"
  fi

  rm -f "$PAD_NAV_OUT"
fi

gate_finish "gate-m6-ux-smoke" || exit 1
