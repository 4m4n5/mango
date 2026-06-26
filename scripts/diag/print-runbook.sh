#!/usr/bin/env bash
# Print legacy fallback couch-test steps (after restart-with-diag.sh or alpha-test.sh).
# Current native couch checks live in docs/COUCH_TEST.md.

cat <<'EOF'
══════════════════════════════════════════════════════════════════
  MANGO LEGACY FALLBACK TEST — your part (couch + one SSH window)
══════════════════════════════════════════════════════════════════

Keep an SSH session open to the Pi. After EACH step below, run the
mark command (copy/paste). Then note what you saw (ok / broken / slow).

  bash ~/mango/scripts/diag/mark.sh "<step name>"

──────────────────────────────────────────────────────────────────
STEP 0 — baseline (already done if you ran alpha-test.sh)
──────────────────────────────────────────────────────────────────
  TV should show the launcher. Pad should move tile focus.

──────────────────────────────────────────────────────────────────
STEP 1 — launcher idle
──────────────────────────────────────────────────────────────────
  On TV: D-pad around tiles · press B once on a tile (don't need to
         launch) · press ⌂ once.

  Then SSH:
    bash ~/mango/scripts/diag/mark.sh "step-1 launcher idle"

  Tell agent: Did D-pad work? Did ⌂ stay on launcher?

──────────────────────────────────────────────────────────────────
STEP 2 — open Stremio
──────────────────────────────────────────────────────────────────
  On TV: focus Stremio tile · B to launch · wait for Stremio UI.
         D-pad once · Y once (back) · ⌂ once (home).

  Then SSH:
    bash ~/mango/scripts/diag/mark.sh "step-2 stremio"

  Tell agent: Fullscreen? Y behavior? ⌂ speed? D-pad after ⌂?

──────────────────────────────────────────────────────────────────
STEP 3 — open legacy Kodi YouTube
──────────────────────────────────────────────────────────────────
  On TV: focus legacy YouTube tile · B · wait for YouTube in Kodi
         (Subscriptions/Recommendations — NOT Kodi home menu).
         D-pad once · Y once.

  Then SSH:
    bash ~/mango/scripts/diag/mark.sh "step-3 youtube"

  Tell agent: Landed in legacy YouTube addon or Kodi home? Any flash/blank?

──────────────────────────────────────────────────────────────────
STEP 4 — home from Kodi (press 1)
──────────────────────────────────────────────────────────────────
  On TV: press ⌂ once · wait 5 seconds.

  Then SSH:
    bash ~/mango/scripts/diag/mark.sh "step-4 home press 1"

  Tell agent: Back on launcher? Still in Kodi? How long?

──────────────────────────────────────────────────────────────────
STEP 5 — home from Kodi (press 2, if needed)
──────────────────────────────────────────────────────────────────
  If NOT on launcher: press ⌂ again · wait 5 seconds.

  Then SSH:
    bash ~/mango/scripts/diag/mark.sh "step-5 home press 2"

──────────────────────────────────────────────────────────────────
STEP 6 — finish
──────────────────────────────────────────────────────────────────
  SSH:
    bash ~/mango/scripts/diag/stop-session.sh

  On Mac (or ask agent): agent runs fetch-session and reads logs.

  Reply to agent with one line per step, e.g.:
    step-1: ok
    step-2: ⌂ took 3s, dpad dead 2s after
    step-3: youtube ok
    step-4: stuck on kodi home
    ...

══════════════════════════════════════════════════════════════════
EOF
