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

python3 - "$SRC/voice-hud.ts" "$SRC/detail.ts" "$SRC/focus.ts" "$SRC/main.ts" "$SRC/next-prompt.ts" "$SRC/playback-return.ts" "$SRC/catalog.ts" "$SRC/search.ts" "$SRC/pad-nav.ts" "$REPO_DIR/src/mango-ui-server/serve.py" "$SRC/home.ts" "$SRC/toast.ts" "$SRC/ratings.ts" "$SRC/style.css" <<'PY' \
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
pad_nav = pathlib.Path(sys.argv[9]).read_text(encoding="utf-8")
ui_server = pathlib.Path(sys.argv[10]).read_text(encoding="utf-8")
home = pathlib.Path(sys.argv[11]).read_text(encoding="utf-8")
toast = pathlib.Path(sys.argv[12]).read_text(encoding="utf-8")
ratings = pathlib.Path(sys.argv[13]).read_text(encoding="utf-8")
style = pathlib.Path(sys.argv[14]).read_text(encoding="utf-8")

if "MAX_VISIBLE_MS = 12_000" not in voice:
    raise SystemExit("voice-hud missing 12s max-visible timer")
if "moveRow" not in detail or "moveCol" not in detail:
    raise SystemExit("detail.ts missing 2D moveRow/moveCol")
if "detail--youtube" not in detail or "relatedTitlesLimit" not in detail:
    raise SystemExit("detail.ts missing YouTube landscape related surface")
if ".detail--youtube .detail-related-track" not in style:
    raise SystemExit("style.css missing YouTube detail related grid")
if "getBoundingClientRect" not in detail:
    raise SystemExit("detail.ts missing geometry-based spatial focus (getBoundingClientRect)")
# Side-panel focus contract. Both of these are load-bearing and neither is visible in
# a screenshot until it is wrong, which is how they went unnoticed before: this whole
# surface was gated by two selector-presence checks.
# Centred reveal is what keeps the focus ring off the scrollport edge (measured 0px of
# footroom on 9 of 14 rows with scrollIntoView "nearest") AND what makes the per-row
# edge dissolve safe, since a centred row cannot be inside a dissolve band.
if "revealInSidePanel" not in detail:
    raise SystemExit("detail.ts missing centred side-panel reveal (revealInSidePanel)")
focus_el = detail.split("private focusEl(el: HTMLElement)", 1)[1].split("\n  }\n", 1)[0]
if focus_el.find("this.revealInSidePanel(el)") > focus_el.find("el.focus({ preventScroll: true })"):
    raise SystemExit("detail.ts paints focus before centring the side-panel row")
if "requestAnimationFrame" in focus_el:
    raise SystemExit("detail.ts defers side-panel centring and will paint a displaced frame")
if 'scrollIntoView({ block: "nearest", inline: "nearest" })' not in detail:
    raise SystemExit("detail.ts must keep scrollIntoView fallback for rows outside the panel")
# Entry lands at the top of a best-first ladder rather than on the row that happens to
# be beam-aligned with the control focus left (was stream[4] / stream[8] of 14).
if "entryTarget" not in detail or "panel.contains(from)" not in detail:
    raise SystemExit("detail.ts missing side-panel entry contract (entryTarget)")
# The edge mask is only honest if its bands are recomputed from real scroll state.
if "updateEdgeFade" not in detail or "--panel-hidden-bottom" not in detail:
    raise SystemExit("detail.ts missing panel edge-fade measurement (updateEdgeFade)")
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
if "PlayWaitCopy" not in detail or "PLAY_WAIT_ROTATE_MS" not in detail:
    raise SystemExit("detail.ts missing play-wait copy rotator")
play_fn = detail.split("async play(", 1)[1].split("private primaryEpisodeId", 1)[0]
if "setInterval" not in play_fn:
    raise SystemExit("detail.ts play() does not rotate wait copy while resolving")
for stale_copy in (
    "finding stream",
    "starting stream",
    "starting YouTube",
    "resolving YouTube",
    "connecting to channel",
    "still finding a playable stream",
    "this is taking longer than usual",
):
    if stale_copy in detail:
        raise SystemExit(f"detail.ts still uses technical play-wait copy: {stale_copy}")
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
for state_contract in (
    'status: "empty"',
    'status: "offline"',
    'freshness: "stale"',
    "catalogStateAfterSuccess",
    "catalogStateAfterFailure",
    "catalog-skeleton-card",
    'dataCatalogState',
):
    # dataset.catalogState compiles from the source token below; accept either
    # spelling so this source gate remains readable rather than bundle-specific.
    if state_contract == "dataCatalogState":
        if "dataset.catalogState" not in home:
            raise SystemExit("home.ts missing explicit catalog state markers")
    elif state_contract not in home and state_contract not in main:
        raise SystemExit(f"launcher missing catalog state contract: {state_contract}")
catalog_load = main.split("async function loadCatalog", 1)[1].split(
    "async function handlePlaybackReturn", 1,
)[0]
request_phase = catalog_load.split("const itemCount", 1)[0]
if "tabCatalogCache.delete(requestedTab)" in request_phase:
    raise SystemExit("reshuffle deletes last-good catalog cache before request completion")
for refresh_contract in (
    "tabCatalogCache.beginRefresh(",
    "{ bypassRead: reshuffle }",
    "catalogCacheRefresh.lastGoodValue",
    "catalogCacheRefresh.commit(usableRails, completedOwner)",
):
    if refresh_contract not in catalog_load:
        raise SystemExit(f"loadCatalog missing transactional reshuffle cache contract: {refresh_contract}")
for forbidden_copy in ("catalog-service", "N2 prereqs", "when the Pi responds", "nothing resolved yet"):
    if forbidden_copy in home:
        raise SystemExit(f"home.ts leaks internal/dead state copy: {forbidden_copy}")
if "toastToneForStatus" not in main or "showToast(message, { tone })" not in main:
    raise SystemExit("main.ts does not route explicit status severity to toast")
if "couldn|failed|unavailable|timed? out" in main:
    raise SystemExit("main.ts still infers toast severity from message wording")
for toast_contract in ("ToastTone", "toastPolicy", 'role: tone === "error"', 'aria-atomic'):
    if toast_contract not in toast:
        raise SystemExit(f"toast.ts missing typed severity/live-region contract: {toast_contract}")
for rating_contract in (
    'axis === "fire" ? "🔥" : "🌊"',
    "index < 5",
    "markValue * 100",
    'value.toFixed(1)',
    'setAttribute("aria-hidden", "true")',
):
    if rating_contract not in ratings:
        raise SystemExit(f"ratings.ts missing household emoji rating contract: {rating_contract}")
for rating_style_contract in (
    ".rating-mark-empty",
    ".rating-mark-fill",
    "grayscale(1)",
    "overflow: hidden",
):
    if rating_style_contract not in style:
        raise SystemExit(f"style.css missing household emoji rating treatment: {rating_style_contract}")
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
    "persistSoon",
    "restorePersisted",
    "fillResultsView",
    "yieldToPadInput",
    "SEARCH_YIELD_FALLBACK_MS",
    "searchEmptyResultsFocusKey",
    "mergeSearchResultRows",
    "nextPendingSearchRowDelta",
    "resultsPaintDirty",
    "deferPosterSrc",
    "armDeferredPosterSources",
    "slimSearchSnapshot",
    "emptySearchSnapshot",
    "searchQueryCaretLeading",
    "ARTWORK_DWELL_MS",
    "schedulePreview",
    "scheduleResultsAtmosphere",
    "dataset.keyCount",
    "search-preview-fallback",
    "search-atmosphere-image",
):
    if search_contract not in search:
        raise SystemExit(f"search.ts missing Search surface contract: {search_contract}")
if "tryRestoreSearchOnBoot();" not in main or "search.restorePersisted()" not in main:
    raise SystemExit("main.ts does not restore Search after a Chromium self-heal")
detail_return = main.split("function restoreFromDetail", 1)[1].split(
    "async function reloadSavedAndCatalog", 1,
)[0]
if "refreshDirtyCatalogOnVisibleHome();" not in detail_return:
    raise SystemExit("Detail return does not consume deferred YouTube history refreshes")
dirty_refresh = main.split("function refreshDirtyCatalogOnVisibleHome", 1)[1].split(
    "function restoreFromDetail", 1,
)[0]
for dirty_refresh_contract in ("personalizationCatalogDirty", "void loadCatalog({ background: true })"):
    if dirty_refresh_contract not in dirty_refresh:
        raise SystemExit(f"visible Home dirty refresh is missing: {dirty_refresh_contract}")
set_query = search.split("private setQuery", 1)[1].split("private scheduleSuggestions", 1)[0]
if "this.render()" in set_query.split("if (wasSubmitted)", 1)[1].split("} else {", 1)[1]:
    raise SystemExit("Search typing path rebuilds the full DOM")
suggestions = search.split("private scheduleSuggestions", 1)[1].split("private async submit", 1)[0]
if "this.render()" in suggestions:
    raise SystemExit("Search suggestion refresh rebuilds the full DOM")
if "search-degraded" in search or "search:retry-youtube" in search:
    raise SystemExit("Search exposes provider failures instead of isolating them")
refresh_results = search.split("private refreshResults", 1)[1].split("private applyFocusRows", 1)[0]
if "replaceWith" in refresh_results or "this.render()" in refresh_results:
    raise SystemExit("Search progressive refresh replaces the mounted result surface")
yield_fn = search.split("function yieldToPadInput", 1)[1].split(
    "export function searchEmptyResultsFocusKey", 1,
)[0]
if "requestAnimationFrame" not in yield_fn or "SEARCH_YIELD_FALLBACK_MS" not in yield_fn:
    raise SystemExit("Search pad yield is not a real input turn")
if "setTimeout(resolve, 0)" not in yield_fn:
    raise SystemExit("Search pad yield does not drain pad-nav macrotasks before the next rail")
schedule_refresh = search.split("private scheduleResultsRefresh", 1)[1].split(
    "private refreshResults", 1,
)[0]
if "this.resultsPaintDirty = true" not in schedule_refresh:
    raise SystemExit("Search poll refresh does not dirty-flag an in-flight fill")
if "this.abortResultsPaint()" in schedule_refresh:
    raise SystemExit("Search poll refresh hard-aborts an in-flight fill")
if "searchEmptyResultsFocusKey(this.scope)" not in search:
    raise SystemExit("Empty Search results do not land on the active scope chip")
submit = search.split("private async submit", 1)[1].split("private async poll", 1)[0]
if "groups[0]" in submit:
    raise SystemExit("Search submit still prefers a result card before rails exist")
if "searchQueryCaretLeading(this.query)" not in search:
    raise SystemExit("Search compose caret order helper is unused")
preview = search.split("private schedulePreview", 1)[1].split("private applyPreview", 1)[0]
if "ARTWORK_DWELL_MS" not in preview:
    raise SystemExit("Search suggestion preview does not dwell before swapping art")
atmosphere = search.split("private scheduleResultsAtmosphere", 1)[1].split(
    "private applyResultsAtmosphere", 1,
)[0]
if "ARTWORK_DWELL_MS" not in atmosphere or "clearResultsAtmosphere" not in atmosphere:
    raise SystemExit("Search results atmosphere does not dwell or clear on header focus")
for pad_contract in (
    "isPadNavCommandFresh",
    "FRAME_FALLBACK_MS",
    "ACTION_MAX_AGE_MS",
    "/api/pad/heartbeat",
    "searchMoveDelta",
):
    if pad_contract not in pad_nav:
        raise SystemExit(f"pad-nav.ts missing liveness contract: {pad_contract}")
for server_contract in (
    "heartbeat_pad_nav_session",
    "pad_nav_recovery_reason",
    "PAD_NAV_STALL_SEC",
    '["systemctl", "--user", "restart", PAD_NAV_LAUNCHER_UNIT]',
):
    if server_contract not in ui_server:
        raise SystemExit(f"serve.py missing pad recovery contract: {server_contract}")
if "document.activeElement !== target" not in focus:
    raise SystemExit("FocusGrid repeats focus and scroll work for an unchanged target")
if 'origin === "search"' not in playback_return:
    raise SystemExit("playback-return.ts missing Search-origin Detail restoration")
PY

"$REPO_DIR/src/catalog-service/node_modules/.bin/tsx" --test \
  "$SRC/catalog-errors.test.ts" \
  "$SRC/catalog-owner.test.ts" \
  "$SRC/focus.test.ts" \
  "$SRC/home-state.test.ts" \
  "$SRC/personalization.test.ts" \
  "$SRC/playback-return.test.ts" \
  "$SRC/playback-return-focus.test.ts" \
  "$SRC/playback-reconciliation.test.ts" \
  "$SRC/playback-session-client.test.ts" \
  "$SRC/stream-list-recovery.test.ts" \
  "$SRC/detail-search-queue.test.ts" \
  "$SRC/detail-related.test.ts" \
  "$SRC/play-wait-copy.test.ts" \
  "$SRC/search.test.ts" \
  "$SRC/pad-nav.test.ts" \
  "$SRC/ratings.test.ts" \
  "$SRC/recommendation-attribution.test.ts" \
  "$SRC/toast.test.ts" \
  "$SRC/voice-commands.test.ts" \
  && gate_pass "launcher deterministic state + ownership tests" \
  || gate_fail "launcher deterministic state + ownership tests"

python3 "$REPO_DIR/src/mango-ui-server/test_pad_nav_queue.py" >/dev/null \
  && gate_pass "pad-nav lease + recovery tests" \
  || gate_fail "pad-nav lease + recovery tests"

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
    'id="toast"',
    'data-tone="info"',
    'role="status"',
    'aria-atomic="true"',
)
missing = [token for token in required if token not in html]
if missing:
    raise SystemExit(f"missing: {', '.join(missing)}")
if 'id="detail-back"' in html:
    raise SystemExit("detail still exposes a redundant on-screen Back button")
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
    # The stream/episode panel fades its scroll edges with a mask, not opacity: the
    # scrollport cuts rows along a straight line, and dimming a row does not stop it
    # being cut. Losing this brings back a visible rectangular edge across the panel.
    # Exact minified form, verified against dist rather than guessed.
    "min(var(--panel-hidden-top),var(--panel-edge-fade))",
    # The band must stay driven by real hidden content, or the fade starts claiming
    # there is more below when there is not.
    "--panel-hidden-bottom",
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
    ".search-atmosphere-image",
    ".search-preview-fallback",
    "--search-key-width",
    "--search-scroll",
    "prefers-reduced-motion",
    ".catalog-skeleton-card",
    ".catalog-state--offline",
    ".catalog-stale-banner",
    ".toast[data-tone=success]",
    ".toast[data-tone=warning]",
    ".toast[data-tone=error]",
)
missing = [token for token in required if token not in css]
if missing:
    raise SystemExit(f"missing CSS: {', '.join(missing)}")


def rule_body(selector: str) -> str:
    """The declarations of one minified rule, or "" when the selector is gone."""
    start = css.find(selector)
    if start < 0:
        return ""
    start += len(selector)
    return css[start:css.find("}", start)]


# The scrollport has to be the list, never the column that holds it. `.detail-side`
# also holds the "streams · 14 · 4K–SD" heading, so scrolling that element scrolls the
# heading away with the rows -- losing the count and range at exactly the moment the
# user starts scrolling and wants to know how far the ladder reaches. Asserted as a
# structural fact about the two rules rather than as a token, because the failure mode
# is one declaration moving up one level.
side = rule_body(".detail-side{")
lists = rule_body(".detail-stream-list,.detail-episode-list{")
if not side or not lists:
    raise SystemExit("detail side/list rules missing or renamed in dist CSS")
if "overflow-y:auto" in side:
    raise SystemExit(".detail-side scrolls again -- the panel heading will scroll away")
if "overflow-y:auto" not in lists:
    raise SystemExit("stream/episode lists are not scrollports -- panel cannot scroll")

# Rows must not shrink. The lists are column flex containers AND the scrollport, so
# their children are flex items in a height-constrained box: with the default
# flex-shrink they compress to min-height and their content spills past their own
# border, which on a dashed unverified row looks like a line struck through the text.
for selector in (".detail-stream{", ".detail-episode{"):
    body = rule_body(selector)
    if not body:
        raise SystemExit(f"{selector.rstrip('{')} rule missing from dist CSS")
    if "flex:0 0 auto" not in body:
        raise SystemExit(
            f"{selector.rstrip('{')} can shrink -- its content will overflow its border"
        )

for selector in (".detail-season-list{", ".detail-episodes-label,.detail-streams-label{"):
    body = rule_body(selector)
    if not body or "flex:0 0 auto" not in body:
        raise SystemExit(f"{selector.rstrip('{')} can collapse while its list scrolls")
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

  python3 "$REPO_DIR/src/mango-ui-server/test_pad_nav_queue.py" >/dev/null \
    && gate_pass "pad-nav queue/session/probe unit tests" \
    || gate_fail "pad-nav queue/session/probe unit tests"

  python3 "$REPO_DIR/scripts/m1-foundation/pad/test_pad_nav_fallback.py" >/dev/null \
    && gate_pass "pad-nav no-xdotool fallback contract" \
    || gate_fail "pad-nav no-xdotool fallback contract"

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

  # A foreign GET must remain read-only and receive no commands. Queue depth is
  # checked through health because only the active TV lease may inspect entries.
  HTTP_CODE="$(curl -s -o "$PAD_NAV_OUT" -w "%{http_code}" --max-time 5 \
    "$LAUNCHER/api/pad/nav?after=0&wait=1" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]] \
    && python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); assert d.get("ok") is True and d.get("owner") is False and isinstance(d.get("latest_seq"), int) and d.get("latest_seq",0) >= int(sys.argv[2]) and d.get("commands") == []' "$PAD_NAV_OUT" "$PAD_NAV_SEQ" 2>/dev/null; then
    gate_pass "pad-nav foreign GET cannot inspect or drain queue"
  else
    gate_fail "pad-nav GET /api/pad/nav after probe"
  fi

  # Do not POST /api/pad/session here. The live TV lease correctly rejects a
  # foreign claimant; takeover and drain coverage lives in test_pad_nav_queue.py.
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
