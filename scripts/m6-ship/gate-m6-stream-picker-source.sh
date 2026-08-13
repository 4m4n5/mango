#!/usr/bin/env bash
# Mac-safe source gate for the mpv HUD and Streams drawer. No Pi/runtime access.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$PWD}"
cd "$REPO_DIR"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

HUD="scripts/m2-catalog/service/mango-hud.lua"
SESSION="src/catalog-service/src/active-stream-session.ts"
MPV="src/catalog-service/src/mpv.ts"
PAD="scripts/m1-foundation/pad/mango-tv-pad.py"

grep -q 'HUD_X, HUD_Y, HUD_W, HUD_H = 160, 728, 1600, 292' "$HUD" \
  || fail "floating-card HUD geometry missing"
grep -q 'SHEET_X, SHEET_Y, SHEET_W, SHEET_H = 160, 228, 1600, 780' "$HUD" \
  || fail "inset Streams sheet geometry missing"
grep -q 'local function draw_control' "$HUD" \
  || fail "named subtitle/audio control chips missing"
grep -q 'noun = "Quality"' "$HUD" \
  && grep -q 'local function quality_control' "$HUD" \
  || fail "Quality chip missing from the A/V row"
grep -q 'local function matching_chip_width' "$HUD" \
  || fail "equal-width A/V chip strip missing"
grep -q 'local function draw_legend' "$HUD" \
  || fail "complete pad legend helper missing"
grep -q 'label = "Skip"' "$HUD" \
  && grep -q 'label = "Subtitles"' "$HUD" \
  && grep -q 'label = "Audio"' "$HUD" \
  && grep -q 'label = "Volume"' "$HUD" \
  || fail "footer legend is missing primary playback controls"
grep -q 'overlay.hidden = false' "$HUD" \
  || fail "HUD must unhide the overlay to reappear after A/↑"
! grep -q 'overlay:remove()' "$HUD" \
  || fail "overlay remove() prevents the HUD from returning after hide"
grep -q 'local function draw_volume' "$HUD" \
  || fail "persistent volume meter missing"
! grep -q 'local function draw_pill' "$HUD" \
  || fail "glyph-only language pills must not return"
! grep -q 'Subtitles ·\|Audio ·' "$HUD" \
  || fail "title-hijacking subtitle/audio copy remains"
grep -q 'mp.observe_property("paused-for-cache"' "$HUD" \
  || fail "event-driven buffering observer missing"
grep -q 'mp.add_timeout(1.0' "$HUD" \
  || fail "buffering anti-flicker delay missing"
grep -q 'switch_undo_candidate_id' "$HUD" \
  || fail "contextual stream Undo missing"
! grep -q 'Try smoother source\|FINAL FALLBACK' "$HUD" \
  || fail "removed drawer preference/fallback copy remains"
pass "HUD, drawer, buffering, and contextual Undo source contracts"

grep -q 'slice(0, 5)' "$SESSION" \
  || fail "public candidate roster is not bounded to five"
grep -q 'Number(left.unavailable) - Number(right.unavailable)' "$SESSION" \
  || fail "unavailable-last public ordering missing"
grep -q 'MANGO_PLAYBACK_TITLE' "$MPV" \
  && grep -q 'MANGO_PLAYBACK_CONTEXT' "$MPV" \
  && grep -q 'MANGO_PLAYBACK_KIND' "$MPV" \
  || fail "sanitized HUD context environment missing"
pass "five-choice URL-free session and playback metadata source contracts"

grep -q 'seek_hud_reason(direction, seconds)' "$PAD" \
  || fail "exact signed seek reason is not wired"
python3 scripts/m1-foundation/pad/test_pad_context.py >/dev/null
python3 scripts/m2-catalog/service/test_mango_hud_contract.py >/dev/null
bash -n scripts/m6-ship/render-mpv-hud-fixtures.sh
pass "controller, deterministic HUD, and actual-render fixture contracts"

(
  cd src/catalog-service
  npm run build >/dev/null
  node --test \
    dist/active-stream-session.test.js \
    dist/mpv-policy-args.test.js \
    dist/playback-hud-context.test.js \
    >/dev/null
)
pass "stream session, switch/Undo, restoration, and HUD metadata tests"
pass "stream picker source gate"
