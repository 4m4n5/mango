# Starter prompt — home agent (Search cinema canvas)

Paste into a fresh home-Mac agent session after the work Mac has pushed.

```text
Work in the home-Mac Mango clone and deploy + couch-validate Search cinema polish:
TARGET_SHA=d005612

Branch: feat/native-experience only. Deploy that exact SHA by git through
scripts/pi-deploy.sh (--fast --gate is fine unless deps changed). Never rsync/scp,
never delete runtime DBs/cache/history, never touch YouTube credentials/quota, and
never invent a pass — unavailable proof is DEFERRED with the exact reason.

Read first: docs/DEPLOY.md, docs/SEARCH.md §Visual and focus contract,
docs/COUCH_TEST.md Unified D-pad Search (especially S20–S26, P9–P10), and the
Mac reference shots in docs/tasks/ux-round/shots/11-search-empty.png through
12g-search-more.png.

Desired UX (tweak only if Pi evidence disagrees with these shots/contracts):
1. Empty compose: leading caret before “search mango”; equal-width QWERTY;
   focused key is the only bright amber; quieter scopes/starter icons.
2. Suggestion preview under the keyboard: ~180ms dwell before art swap;
   poster/landscape at native ratio; typographic fallback for no-art recents;
   no blur/parallax/entrance motion; reduced-motion skips dwell animations.
3. Results: pinned query + Edit + scopes; no “Search results” title; rail titles
   at 24–28px; Searching/More/empty chrome neutral (amber = focus only).
4. Focused-card atmosphere after ~180ms dwell, very low opacity under strong
   scrims; clears on Edit/scope focus; no flicker while scrubbing D-pad.
5. Scroll fade under the pinned head appears only after content has scrolled.
6. Contracts that must not break: progressive updateResultsView (no full rebuild),
   silent partial failures, persistence + boot restore after Chromium self-heal,
   pad freshness (stale moves dropped; ~3s self-heal restores Search).

Loop:
1. git fetch && git checkout feat/native-experience && git rev-parse --short HEAD
   must equal TARGET_SHA (or stop).
2. bash scripts/pi-deploy.sh --fast --gate
3. bash scripts/pi-exec-gate.sh (or pi-pre-couch-gate.sh) — do not hand off on
   Mac-only green.
4. Real 8BitDo couch pass of S1–S4, S7–S8, S19–S26, P9–P12. Watch rapid typing,
   suggestion dwell, results scroll, YouTube Detail Y-return, reduced motion if
   available, and no focus/backdrop flicker.
5. If Pi-only UX defect: reproduce twice, smallest source fix in Search CSS/TS
   (or pad recovery if that is the failure), local gates, commit+push on
   feat/native-experience, redeploy, re-prove. Keep patches inside Search/pad
   recovery scope.

Return a short report: SHA parity Mac/Pi, gate results, D-pad observations vs
the reference shots, any source-fix SHA, and blockers/DEFERRED items.
```
