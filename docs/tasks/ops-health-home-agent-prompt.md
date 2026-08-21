# Starter prompt — home agent (ops health conclusive dive + fixes)

> **Superseded exact-release starter.** Do not paste or execute it as the
> current deploy contract. The audited deploy helpers are blocked for unattended
> use; reconcile with [`../DEPLOY.md`](../DEPLOY.md),
> [`../STATUS.md`](../STATUS.md), and [`../COUCH_TEST.md`](../COUCH_TEST.md).

Paste into a fresh home-Mac agent session. Read the sibling report first.

```text
Work in the home-Mac Mango clone on branch feat/native-experience only.
Pi deploy remains Git-only, but do not invoke scripts/pi-deploy.sh unattended;
stop at the current docs/DEPLOY.md blocker unless its exception is human-reviewed
or the helper is fixed and tested. Never rsync/scp repo trees,
never delete runtime DBs/cache/history unless a rebuild diagnosis proves the
cache file itself is corrupt/incompatible, never touch YouTube credentials or
quota knobs, and never invent a pass — unavailable proof is DEFERRED with the
exact reason.

TARGET context: Pi was refreshed at commit 7c8c720 (re-fetch tip; if tip moved,
note SHA delta). Prior health sweep + code diagnosis live in:
  docs/tasks/ops-health-deep-dive-report.md

Mission (two phases — do not skip Phase A):

══════════════════════════════════════════════════════════════════
PHASE A — Conclusive root-cause proof on the Pi (measure before coding)
══════════════════════════════════════════════════════════════════

For each issue below, reproduce twice where practical, capture exact commands
+ outputs, and mark CONFIRMED / REFUTED / REFINED against the report’s
hypothesis. Prefer smallest probes; do not “fix” until Phase A is written.

A1. DPMS black TV after stack refresh
  - bash scripts/mango-refresh.sh (or mango-stack restart)
  - BEFORE any pad press: xset q DPMS line; scrot bytes; human TV on/off if
    observable; xrandr mode
  - Prove mango-display-wake.sh alone recovers TV
  - Prove stack start still omits wake (rg call graph)
  - CONFIRMED iff Monitor Off after refresh with non-black scrot and wake
    helper fixes it without Chromium restart

A2. Dual mango-launcher fullscreen windows
  - After cold chromium restart (unit stop → wait zero wids → start → BEFORE
    present): count InputOutput WM_CLASS=mango-launcher + geometries
  - After present-launcher: recount — does present CREATE the second full
    surface or only enlarge an existing orphan?
  - PIDs: one --app= process vs two
  - Whether windowkill of non-canonical wid leaves stable UI + pad session
  - Gate today: browser_apps<=1 while N_windows=2 (show the mismatch)

A3. ai-cricket-channels / live cricket
  - cat /etc/mango/ai-catalogs/slots/cricket-channels.yaml (seed_titles?)
  - curl rails?tab=live vs unfiltered /rails cricket entries
  - curl /rails/items?tab=live | jq cricket rails — NOT VOD /rails/ai-*/items
  - Prove merge: do slot seed ids/titles appear inside live-cricket items?
  - If seeds empty on a later tip: force live rebuild then AI refresh; see
    docs/tasks/ops-health-deep-dive-report.md §3 decision tree
  - Reclassify: false-alarm probe vs real empty merge vs launcher showing a
    dead ai-* row

A4. Live-rails cache stale + demand rebuild
  - health.live.cache before/after curl '/rails/items?tab=live'
  - Confirm no watchdog/nightly live rebuild in scripts
  - If rebuild fails: capture last_rebuild_error, live-diagnostics, and stop
    (do not wipe cache unless incompatible)
  - Confirm live_ready true while fresh false is config-vs-cache semantics

A5. search_health verified=0
  - After quiet period: verified/stale/unknown
  - After one live search proof OR live play: does verified become >0 within
    horizon?
  - Confirm browse-only does not refresh health

A6. pad_nav render_age_ms≈999 idle
  - Sample health for 5s at idle (heartbeat_age, render_age, pending, last_ack)
  - One pad-nav move: pending drains, last_ack updates, render_age behavior
  - CONFIRMED benign iff pending=0 and heartbeat fresh while render_age≈1000

A7. verify-voice-ready tmux FAIL
  - systemctl --user is-active mango-orchestrator mango-companion
  - curl :8766/health ; verify-voice-ready.sh summary
  - Prove start-voice-stack kills tmux when systemd path wins

A8. throttled=0x80000 — decode bits; note active vs sticky; during idle OK

A9. waiting_for_controller while Micro off — confirm expected; not a defect

A10. 8BitDo Micro wake reconnect (CRITICAL couch — coordinate with work agent)
  Contract: normal power-on reconnects; pairing mode must NOT be required
  (HARDWARE.md / OPS.md). STATUS notes controller-link Pi proof was pending.
  Reproduce twice:
    a) Micro off ≥30s → normal power press only (no pairing). Time-to-input.
    b) If (a) fails: capture BEFORE pairing:
         systemctl status mango-controller-link mango-tv-pad --no-pager
         cat ~/.cache/mango/mango-controller-link-status.json
         cat ~/.cache/mango/mango-tv-pad-status.json
         bash scripts/m1-foundation/pad/controller-link-diagnose.sh
         bluetoothctl info "$MANGO_GAMEPAD_BT_MAC" (or MAC from env/docs)
         ls -l /dev/input/by-id/* 2>/dev/null; journalctl --user -u mango-tv-pad -n 40
       Then pairing-mode wake once; capture the same artifacts after success.
  Also run: bash scripts/m6-ship/gate-m6-controller-reconnect.sh
             sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check
  Classify: installer/policy missing vs pairing_missing stuck vs Connected-no-evdev
  vs slow Connect window. Send evidence pack to work agent; after their patch,
  couch-prove N≥5 normal-wake cycles with zero pairing.

Deliverable A: short evidence table (issue → CONFIRMED/REFUTED → proof cmds).

══════════════════════════════════════════════════════════════════
PHASE B — Principled improvements (only after A)
══════════════════════════════════════════════════════════════════

Implement the smallest robust fixes that match CONFIRMED causes. Prefer
invariants and honest metrics over band-aids. Stay on feat/native-experience.
Local tests where code changes; then pi-deploy --fast; re-prove A checks.

Must-fix if A confirms (priority order):

B1. Intentional display sleep + CEC (LOCKED — you own this; see report §11)
  Design (do not reopen unless Pi evidence forces it):
    - Timed idle sleep; default **30 minutes**; configure in **Settings**
      (Off / 15m / 30m / 60m / 2h or equivalent).
    - Idle resets only on **D-pad** and **companion** activity.
    - **Never sleep while mpv is playing.**
    - Sleep: disable accidental Xorg 600s DPMS; mango-owned sleep →
      DPMS Off + **CEC standby**.
    - Wake on pad or companion: DPMS force on + **CEC power-on**.
    - Keep couch-activity maintenance idle (`MANGO_COUCH_IDLE_SEC`) separate.
  Also: stack/UI start must leave the panel On after refresh (no black TV
  until the configured idle elapses). Install cec tooling on Pi if missing.
  Prove: Settings change; idle→TV off; pad wakes; companion wakes; mpv blocks
  sleep; update DECISIONS/OPS after behavior matches.

B2. 8BitDo normal-wake reconnect (no pairing) — prefer work-agent patch;
    home applies installer if --check fails, deploys work SHA, runs couch
    wake matrix. Never document “use pairing mode” as the happy path.

B3. Single launcher window invariant
  - present/start/stop: one canonical InputOutput mango-launcher surface
  - Stop promoting every sibling to fullscreen
  - Gate idle: window count == 1 (not only browser_apps<=1)
  - If Chromium flags are the source, prove with A2 before changing flags

B4. Live cache + health honesty
  - Background/timer or watchdog path to rebuild when !fresh && config ready
    (rate-limit / NexoTV aware — read docs/LIVE_TV.md)
  - Split or document config_ready vs cache_fresh vs serving_stale
  - Persist last rebuild attempt/error across catalog restarts if practical

B5. verify-voice-ready systemd-or-tmux
  - Pass if user units active OR tmux sessions exist
  - Prefer systemd when enabled; journalctl for logs

Should-fix / clarify:

B6. Live AI operator surfaces — stop false “empty rail” from VOD probes;
    expose seed_count / merge target; ensure launcher Live tab uses tab=live
B7. pad render_age — measure after rAF or document idle≈1000; never alert on
    idle 999 alone
B8. throttle decode in resource snapshot / gate (WARN sticky, FAIL active)

Out of scope unless they block proof:
  - YouTube quota/credentials
  - Search cinema redesign
  - Lite-play stream timeout flakiness (separate track)
  - Deleting live-rails-cache.json without incompatible/corrupt proof

Return:
  1) Phase A evidence table
  2) Patch SHAs + what each fixes
  3) Pi re-proof after deploy (display sleep+CEC matrix, window count,
     Micro normal-wake×N, live fresh, voice verify, pad idle metrics)
  4) Remaining DEFERRED with exact reason
```

Also see work-agent prompt: `docs/tasks/ops-health-work-agent-prompt.md`
(especially §10 controller reconnect — work owns the concrete BlueZ fix).
Display sleep + CEC (**§11 / B1**) is **home-owned**.
