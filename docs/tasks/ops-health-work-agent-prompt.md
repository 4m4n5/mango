# Starter prompt — work agent (ops health principled fixes)

Paste into a fresh **work-Mac** agent session (no Pi SSH). Home Mac owns couch
BT/DPMS proof; you own conclusive code diagnosis + patches on
`feat/native-experience`.

```text
Work in the work-Mac Mango clone on branch feat/native-experience only.
You cannot SSH to the Pi. Do not invent Pi passes. Push patches for the home
agent to deploy+prove. Never delete runtime DBs/cache/history in scripts you
add. Never touch YouTube credentials/quota. Prefer smallest principled fixes
over band-aids.

Read first:
  docs/tasks/ops-health-deep-dive-report.md   # full issue map + hypotheses
  docs/HARDWARE.md (controller reconnect contract)
  docs/OPS.md (Pad waiting / Pad dead)
  scripts/m1-foundation/pad/mango-controller-link.py
  scripts/m1-foundation/pad/install-controller-reliability.sh
  scripts/m6-ship/gate-m6-controller-reconnect.sh

If home has already pasted Phase A evidence, treat it as ground truth.
If not, implement from code-confirmed defects (DPMS wake wiring, voice tmux
gate, render_age metric, present-launcher invariant) and leave BT reconnect
behind a clear “needs home A10 evidence” only where the root cause is
ambiguous — but still ship any invariant fixes that are obvious from code
(e.g. pairing_missing permanently blocking Connect without recovery).

══════════════════════════════════════════════════════════════════
MUST FIX CONCRETELY — #10 8BitDo wake reconnect (pairing mode workaround)
══════════════════════════════════════════════════════════════════

Couch report: after the Micro is woken with a normal power press, the D-pad
sometimes does NOT reconnect to the Pi until the user enters pairing mode.
Product contract (HARDWARE/OPS): normal wake reconnects; pairing is only for
absent bond / diagnose-confirmed pairing loss. STATUS still says controller
install/couch proof was pending — treat that seriously.

Diagnose in code (cite files/lines), then fix:

Hypotheses to confirm/refute from code + any home evidence pack:
  H1 BlueZ reconnect policy / install-controller-reliability never applied
  H2 mango-controller-link sets pairing_missing and _try_connect returns
     early forever (DoesNotExist/UnknownObject) until pairing recreates object
  H3 BlueZ Connected but Pro Controller evdev never appears (mode/HID)
  H4 Connect timeout / retry cadence too aggressive for Micro power-on
  H5 Competing BlueZ agents or wrong MAC/device path

Required outcomes:
  1. Normal power-on path must Connect + yield pad input without pairing mode
     when the bond still exists.
  2. Reliability/pad-health must expose distinct states:
     off | connecting | connected_waiting_for_input | needs_re-pair
     Only needs_re-pair may tell the human to pair.
  3. pairing_missing must not silently dead-end Connect forever — re-resolve
     device, bounded scan/page for known MAC, or clear + retry after repair.
  4. gate-m6-controller-reconnect.sh (and/or couch-test) must encode the
     no-pairing contract so home can prove it.
  5. Unit tests for retry/pairing_missing/repair state machine where pure.

Do NOT “fix” by documenting pairing mode as normal. Do NOT unpair as default
repair. Prefer preserving the bonded device.

Files to start from:
  scripts/m1-foundation/pad/mango-controller-link.py
  controller-link-state.py, controller-link-config.py, *-diagnose.sh
  install-controller-reliability.sh, gate-m6-controller-reconnect.sh
  mango-tv-pad.py (input-ready), Reliability Center controller repair hooks

══════════════════════════════════════════════════════════════════
ALSO SHIP from the same report (code-obvious; home will re-prove)
══════════════════════════════════════════════════════════════════

Priority with #10:
  NOTE: Intentional display sleep + CEC (report §11: 30m Settings default,
  pad+companion activity, never during mpv, CEC standby/power-on) is
  **home-agent owned** — do not duplicate unless home asks for a code assist
  patch. Your B1 is controller reconnect.
  B2 Single mango-launcher X window invariant (stop fullscreening all siblings;
     gate window count == 1) — OK if you ship alongside #10
  B3 Live cache background refresh + honest config_ready vs cache_fresh
  B4 verify-voice-ready.sh: systemd OR tmux
  B5/B6/B7 metric clarity (live AI surfaces, render_age after rAF or docs,
      throttle bit decode) as time allows

Return to user / home agent:
  1) Root-cause verdict for #10 (which H*, with citations)
  2) Patch SHAs + test commands
  3) Exact home Pi proof script for Micro: N normal-wake cycles, zero pairing,
     plus diagnose artifacts if a cycle fails
  4) Anything DEFERRED pending home A10 traces
```
