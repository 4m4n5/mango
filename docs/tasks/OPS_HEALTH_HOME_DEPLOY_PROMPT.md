# Mango ops-health home deployment, TV proof, and improvement prompt

Paste the short starter at the end of this file into a fresh home agent. This
document is the complete execution contract. The agent must read it top to
bottom before running commands or editing code.

## 1. Role and mission

You are the **home Mac + Raspberry Pi execution agent** for Mango. You have:

- a home-Mac clone of the Mango repository;
- LAN access to the Pi through Mango's checked-in `scripts/pi-*.sh` helpers;
- a human tester who can see the physical TV and use the 8BitDo Micro and voice
  companion;
- authority to diagnose, deploy, make narrowly scoped principled improvements,
  commit them, push them, redeploy, and repeat until the contract below is
  genuinely proved or honestly `DEFERRED`.

Your mission is to deploy the completed S1-S6 ops-health patch series, prove it
on the real Pi/TV, implement the already-locked intentional display-sleep + CEC
policy, and collaborate with the human tester on visible behavior. Do not claim
a couch pass from logs alone. Do not stop after the first green automated gate
if required physical-TV evidence is still missing.

The work-Mac source implementation report is
`docs/tasks/OPS_HEALTH_CODEX_REPORT.md`. Treat it as evidence and context, not
as Pi proof.

## 2. Immutable authority and safety boundaries

These rules are absolute:

1. Work only on `feat/native-experience`. Verify the branch; **do not switch
   branches**.
2. Pull `origin/feat/native-experience` and require that commit `4ca208b` is an
   ancestor before deployment. Deploy the latest reviewed branch tip, not an
   older cherry-pick.
3. Deploy by Git only. **Never use `rsync`, `scp`, copy/paste, or hand-edit repo
   source on the Pi.** Source edits happen in the clean home-Mac clone, are
   committed and pushed, then the Pi pulls through the checked-in deploy script.
4. Preserve all pre-existing home-Mac and Pi dirt. Stop and report exact paths
   if they overlap the task. Never use `git reset --hard`, destructive checkout,
   broad cleanup, or stash someone else's work.
5. Never delete runtime databases, cache, history, pairings, or evidence to make
   a test pass. In particular, do not delete Live cache to manufacture staleness.
6. Never inspect, edit, rotate, log, or consume YouTube credentials or quota.
7. Never invent Pi, CouchDB, provider, CEC, or Bluetooth credentials. Use only
   already-configured repo helpers and operator-owned runtime state.
8. Pairing mode is explicit break-glass recovery, never the Micro happy path.
   Do not unpair/re-pair as a routine reconnect fix. Capture the full A10 bundle
   before any human-approved recovery pairing.
9. Do not change locked pad mappings or replace the input stack. The Micro map
   remains B=select, Y=back, X=context, -/+=volume, L/R=tabs, Home=home.
10. Do not disrupt active playback, maintenance, grow, a couch session, or a
    human's testing step. Establish an idle window first.
11. Do not broaden this into Search, YouTube, catalog curation, or visual
    redesign. Fix only observed causes within S1-S6, display sleep/CEC, their
    tests, gates, status, and operational documentation.
12. A missing dependency, permission, provider response, physical observation,
    or human choice is `DEFERRED` with the exact command and evidence still
    needed. It is never an inferred pass.

## 3. Required reading before action

Read these files completely in this order:

1. `AGENTS.md`
2. `docs/tasks/OPS_HEALTH_CODEX_REPORT.md`
3. `docs/DEPLOY.md`
4. `docs/DEPLOY-SPLIT-MACHINE.md`
5. `docs/OPS.md`
6. `docs/DECISIONS.md`
7. `docs/ARCHITECTURE.md`
8. `docs/RELIABILITY.md`
9. `docs/HARDWARE.md`
10. `docs/COUCH_TEST.md`
11. `docs/LIVE_TV.md`
12. `docs/tasks/ops-health-deep-dive-report.md` section 11
13. `docs/tasks/ops-health-home-agent-prompt.md` section B1

Then inspect the current implementations before changing them:

- `scripts/pi-deploy.sh`, `scripts/pi-exec.sh`, `scripts/pi-exec-gate.sh`, and
  `scripts/pi-pre-couch-gate.sh`;
- `scripts/m1-foundation/pad/install-controller-reliability.sh`,
  `mango-controller-link.py`, `controller_link_state.py`,
  `controller-link-couch-test.sh`, and `controller-link-diagnose.sh`;
- `scripts/m6-ship/gate-m6-controller-reconnect.sh`;
- `scripts/lib/mango-display-wake.sh`, `scripts/lib/mango-cursor.sh`,
  `scripts/m1-foundation/pad/mango-tv-pad.py`, and the companion activity path;
- launcher Settings and activity code in `src/launcher/src/`;
- localhost UI service routes in `src/mango-ui-server/serve.py`;
- relevant systemd installer/unit patterns under `scripts/`;
- Live diagnostics, voice verifier, Reliability model, and resource snapshot
  files named in the implementation report.

Before relying on remembered behavior, use `rg` to locate the live source.

## 4. Human collaboration protocol

The human tester is the sole authority for what the TV physically did. Work in
small, observable steps:

1. Tell the human exactly what is about to happen, whether the TV might blank,
   sleep, wake, switch input, interrupt audio, or require a pad/voice action.
2. Ask for one physical action or observation at a time. Do not bundle five
   observations into one vague question.
3. Wait for the human's direct answer before marking that row. Record their
   concise observation and the matching timestamp/log/status sample.
4. If logs and the human disagree, the row fails. Preserve both pieces of
   evidence and diagnose the mismatch.
5. For a visible defect, first reproduce it once and capture evidence. Form one
   falsifiable cause, apply the smallest principled fix on the home Mac, run the
   focused local tests, commit/push, deploy, rerun the failing row, then rerun
   the proportional regression gate.
6. Do not tune arbitrary timeouts just to turn a row green. Change reconnect or
   display timing only when timestamped evidence identifies timing as the cause.
7. Keep a live evidence table with `PASS`, `FAIL`, or `DEFERRED`; command output;
   human observation; and next action.

Suggested human phrasing is concrete: “The deploy is about to restart the UI.
Please watch without touching the pad and tell me whether the physical panel
stays on and the Mango launcher appears by itself.”

## 5. Phase 0 - home Mac and Pi preflight

### 5.1 Home Mac source truth

From the home-Mac repo root:

```bash
git fetch origin feat/native-experience
git branch --show-current
git status --short
git pull --ff-only origin feat/native-experience
git merge-base --is-ancestor 4ca208b HEAD
git rev-parse HEAD
git rev-parse origin/feat/native-experience
git log --oneline --decorate -12
```

Required:

- branch is exactly `feat/native-experience`;
- the status is clean, or all pre-existing dirt is listed and confirmed
  non-overlapping;
- `merge-base --is-ancestor` exits 0;
- local and origin tips match before deployment.

The expected implementation sequence includes these commits or descendants:

| Commit | Workstream |
|---|---|
| `825d77c` | S1 controller reconnect recovery/state/gate |
| `8a57cdc` | S2 deterministic display wake at UI start |
| `6a6ae6e` | S3 one launcher surface |
| `98c9e61` | S4 stale Live background refresh/health |
| `adae1f6` | S5 systemd-or-tmux voice verification |
| `ef1de24` | S6 Live/hardware metric clarity |
| `8842dd2` | S6 decoded throttle exit-status preservation |
| `4ca208b` | completed work-Mac report |

### 5.2 Establish an idle deployment window

Ask the human to confirm nobody is watching content and no maintenance/grow job
is intentionally running. Then capture, without changing state:

```bash
bash scripts/pi-exec.sh 'hostname; cd ~/mango && git branch --show-current && git rev-parse HEAD && git status --short'
bash scripts/pi-exec.sh 'pgrep -af "[m]pv|[y]t-dlp|[g]row|[m]aintenance" || true; test -e ~/.cache/mango/playback-active && echo playback-marker-present || true; test -e ~/.cache/mango/maintenance-active && echo maintenance-marker-present || true'
```

If playback or intentional maintenance is active, wait for a new idle window.
Do not kill it to gain the window.

### 5.3 Capture the before-state

Run and save the output in the eventual report:

```bash
bash scripts/pi-exec.sh 'export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; xset q | sed -n "/Screen Saver:/,/Monitor/p"'
bash scripts/pi-exec.sh 'systemctl is-active bluetooth mango-controller-link.service || true; systemctl --user is-active mango-tv-pad.service mango-ui-server.service mango-catalog.service mango-launcher-chromium.service mango-orchestrator.service mango-companion.service 2>/dev/null || true'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m1-foundation/pad/controller-link-diagnose.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/stack/verify-voice-ready.sh' || true
bash scripts/pi-exec.sh 'curl -fsS http://127.0.0.1:3020/health | python3 -m json.tool' || true
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/diag/pi-resource-snapshot.sh' || true
```

Also ask the human what is currently visible: panel power, HDMI input, launcher
or wallpaper, duplicate/stray windows, and whether the Micro works after a
normal power press. This is a baseline, not acceptance proof.

## 6. Phase 1 - deploy S1-S6 through Git only

Complete the controller-installer decision in section 6.1 **before** invoking an
apply. If the installer is already compliant, deploy through Mango's supported
path with `MANGO_CONTROLLER_LINK_INSTALL=1`; if it is not, fix its convergence
path on the home Mac first.

### 6.1 Known controller-installer convergence hazard

Review the current `install-controller-reliability.sh` control flow before the
first apply. The S1 version may call its full `check` before patching BlueZ. Since
that same `check` now correctly fails missing/drifted managed BlueZ values,
`--apply` can fail before it gets a chance to converge the exact state it owns.

Handle this as code, not as a Pi workaround:

1. Run the read-only check and capture precisely which prerequisite or managed
   value failed:

   ```bash
   bash scripts/pi-exec.sh 'cd ~/mango && sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check'
   ```

2. If the bond/device prerequisite is missing, stop before pairing, capture A10,
   mark H1/H5 as applicable, and request explicit operator recovery authority.
3. If the only failure is missing/drifted BlueZ values or owned units, **do not
   hand-edit `/etc/bluetooth/main.conf` and do not patch the Pi checkout**.
4. On the home Mac, split installer validation into:
   - a non-mutating prerequisite check suitable before apply (supported OS,
     tools, configured controller identity, existing trusted/paired bond); and
   - the complete post-convergence `--check` (exact BlueZ values, units, one
     owner, bond, enabled/active status).
5. Make `--apply` run prerequisites, create its existing backup, atomically
   converge only the managed settings/units, restart deliberately, and then run
   the complete check. Preserve rollback and pairing.
6. Add a local contract test proving apply is not blocked by pre-apply policy
   drift and remains idempotent. Run shell syntax and focused tests.
7. Commit and push the fix, redeploy through Git, then rerun `--check` and the
   controller gate.

Do not bypass the failure with an undocumented manual edit. The installer must
be able to converge the policy it advertises.

Once `--check` is compliant or the reviewed convergence fix is at origin, run:

```bash
MANGO_CONTROLLER_LINK_INSTALL=1 bash scripts/pi-deploy.sh --fast --gate
```

Capture the full installer, restart, and gate output.

After deployment, prove source identity:

```bash
git rev-parse HEAD
bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse HEAD && git branch --show-current && git status --short'
```

The home Mac, origin, and Pi must resolve to the same intended commit before
runtime verdicts are recorded.

## 7. Phase 2 - automated Pi proof

Run all of these after a successful deployment:

```bash
bash scripts/pi-exec-gate.sh
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-controller-reconnect.sh'
bash scripts/pi-exec.sh 'cd ~/mango && sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/stack/verify-voice-ready.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/live/live-diagnostics.sh && bash scripts/live/gate-live-diagnostics.sh'
bash scripts/pi-exec.sh 'curl -fsS http://127.0.0.1:3020/health | python3 -m json.tool'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/diag/pi-resource-snapshot.sh'
bash scripts/pi-exec.sh 'export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; xset q | sed -n "/Screen Saver:/,/Monitor/p"'
bash scripts/pi-exec.sh 'cd ~/mango && export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; source scripts/lib/launcher-window.sh; printf "viewable_launcher_windows="; launcher_viewable_input_output_count'
```

Record full gate counts and every WARN/FAIL. A WARN is not automatically a
failure, but it must be decoded and explained. Do not make a gate green by
deleting state, turning off a subsystem, or hiding a metric.

## 8. Phase 3 - human couch proof for S1-S6

### A. S2 boot/display wake

With the human watching and not touching the pad, restart/refresh the UI through
the supported script. Capture `xset q` immediately after. Pass requires:

- the physical panel remains/wakes On;
- Mango appears without a pad press;
- X does not report `Monitor is Off`;
- no accidental blanking occurs around the old 600-second Xorg timeout during
  the later display-sleep proof.

### B. S3 single launcher surface and focus

Capture the window count and ask the human to inspect the screen. Pass requires:

- exactly `viewable_launcher_windows=1`;
- one fullscreen launcher, no wallpaper gap or duplicate/stray Chromium
  surface;
- D-pad focus stays visible and deterministic;
- opening and leaving one playback returns to the same single launcher surface.

### C. S1 Micro normal reconnect - five cycles, zero pairing

Run the interactive checked-in test:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m1-foundation/pad/controller-link-couch-test.sh'
```

For each of five cycles, have the human turn the Micro off for at least 30
seconds, then use only the ordinary power press. Never enter pairing mode. Record
time to `ready`, first successful D-pad action, and public controller state. Pass
requires `5/5` ordinary wakes and zero pairing entries.

Add one real playback row: start playback normally, power-cycle the controller,
prove volume/back control returns, exit playback, and prove launcher focus.

If any wake fails, stop before pairing and capture section 11 immediately.

### D. S5 voice ownership and visible behavior

Prove the verifier accepts active user-systemd ownership without demanding tmux,
while retaining real HTTPS/WSS/listener checks. Ask the human for a normal PTT
query. Pass requires the HUD appears, acknowledges, responds, and dismisses on
the TV; logs show the actual owner and no false tmux failure.

### E. S4 Live background freshness and playback yield

Use the existing cache naturally. Never remove or rewrite it.

- If the cache is fresh, record its expiry and wait for a safe natural stale
  window; do not manufacture one by deletion.
- Without opening the Live tab, prove a bounded background rebuild attempt is
  persisted and survives catalog restart.
- Prove success moves `cache_fresh` true and stale-but-servable health is yellow,
  not falsely green or red.
- During actual mpv playback, prove no background provider rebuild competes;
  after playback, prove the scheduler can resume.
- In the UI, ask the human to open Live and confirm the rendered target shelf.
  Correlate it with unfiltered `/rails`, the Live slot YAML, and
  `/rails/items?tab=live`. Do not infer VOD-looking `/rails/ai-*/items` endpoints
  are the Live rendered rail.

Provider outage/rate limits are valid `DEFERRED` evidence if recorded honestly.

### F. S6 pad render-age interpretation

Capture the pad status during at least 10 seconds of idle, then immediately
around a D-pad move. A roughly one-second idle render age is normal heartbeat
telemetry. Pass/fail must use pending-input age plus heartbeat/ack evidence, not
an idle sample alone. The human must confirm focus moves promptly with no visible
stall.

### G. S6 throttle decoding

Capture raw and decoded `vcgencmd get_throttled` data. Pass the decoder contract
only when active undervoltage/throttling bits are absent. Sticky history such as
`0x80000` is WARN and must remain visible; it is not a current failure. Active
undervoltage or throttling is a real FAIL to investigate, not suppress.

## 9. Phase 4 - implement locked intentional display sleep + CEC

This product decision is closed. Implement it; do not reopen the policy design:

- Settings choices: `Off`, `15m`, `30m` (**default**), `60m`, `2h`;
- idle resets **only** on D-pad activity and companion activity;
- never sleep while mpv is playing;
- sleep transition = DPMS Off followed by CEC standby;
- wake transition = DPMS On followed by CEC power-on;
- remove the accidental Xorg 600-second automatic DPMS timeout;
- keep maintenance idle (`MANGO_COUCH_IDLE_SEC`) completely separate;
- UI/stack start must still leave the display On;
- update `docs/DECISIONS.md` and the final `docs/OPS.md` policy only after real
  Pi/TV proof passes.

### 9.1 Required implementation properties

Use current repo patterns, but preserve these behavioral boundaries:

1. **Separate display activity from generic couch activity.** Do not reuse
   `~/.cache/mango/couch-activity.json`: launcher click/key events, mpv/progress,
   voice turns, and other sources already touch it. Create a distinct atomically
   written display-activity/status contract. Only D-pad directions/actions and
   companion/PTT/text activity may reset the display timer.
2. **Persist Settings atomically and validate them.** Use a user-owned Mango
   config file and a localhost-only GET/PUT API following existing `serve.py`
   patterns. Accept only the five locked values. Missing/invalid config resolves
   visibly and deterministically to 30 minutes. Settings changes should become
   effective without a repository redeploy.
3. **Keep policy logic pure and tested.** Isolate the decision from side effects:
   current time, last permitted activity, configured timeout, playback-active
   truth, and current display state should produce a deterministic next action.
   Test Off, exact timeout boundaries, clock anomalies, playback inhibition,
   wake, repeated ticks, and invalid config.
4. **Use one user-systemd supervisor owner.** Install it through the existing
   systemd installation path. It must publish an atomic fresh status including
   `awake`, `sleeping`, `inhibited_playback`, or `off`, the active timeout, last
   permitted activity, last transition, and separate DPMS/CEC errors. The normal
   gate must inspect health/config/status without putting the TV to sleep.
5. **Own DPMS explicitly.** Existing wake/cursor helpers use `xset -dpms`, but
   explicit `xset dpms force off` requires DPMS to be enabled on X. Configure X
   for no automatic blanking and explicit control, for example `xset +dpms`,
   `xset dpms 0 0 0`, and screen-saver off, then force On/Off only on Mango state
   transitions. Verify the actual Pi's `xset q`; do not assume source equals
   runtime. Refactor all competing Mango DPMS owners consistently.
6. **Serialize and bound CEC.** Use one wrapper/owner with locking and a bounded
   timeout. Send power commands only on state transitions, never every polling
   tick. Capture command, exit status, duration, and sanitized error. A missing
   CEC binary/device is an honest feature failure, not a silent DPMS-only pass.
7. **Keep D-pad latency low.** DPMS wake on the input hot path may remain fast;
   CEC must not block pad event handling. Decide with the human whether the first
   wake press also navigates or is consumed, document the observed choice, and
   add a regression test for it.
8. **Companion wake is independent of launcher visibility.** PTT/text companion
   activity must reset/wake even while playback or another surface is foreground.
9. **mpv is a hard inhibitor.** Use the established playback SSOT/marker and
   process evidence carefully. Never send standby while playback is active.
10. **Rollback is non-destructive.** A reviewed rollback disables the supervisor
    and restores deterministic display On with zero accidental automatic timeout.
    It must not delete Settings, logs, cache, history, or pairings.

Installing `cec-utils`/libCEC or changing an OS package is an operator-visible
runtime mutation: inspect first, explain it, and obtain the human's approval.
Never install a second competing CEC daemon. Determine the adapter/logical
address from the target Pi/TV rather than hard-coding an invented topology.

Reference principles for implementation review:

- Android TV treats controller disconnect/reconnect as normal and D-pad as the
  primary navigation contract: <https://developer.android.com/training/tv/get-started/controllers>
- BlueZ's authoritative device state is the `org.bluez.Device1` API:
  <https://bluez.readthedocs.io/en/latest/device-api/>
- HDMI-CEC behavior varies by TV/vendor, so target-hardware observation is part
  of acceptance: <https://source.android.com/docs/devices/tv/hdmi-cec>
- X DPMS force levels require an enabled DPMS extension:
  <https://www.x.org/archive/X11R7.5/doc/man/man3/DPMSForceLevel.3.html>
- systemd is the intended single-owner service model: <https://systemd.io/>

### 9.2 Local verification before each display-sleep deployment

Run all existing tests affected by the changed paths plus, at minimum:

- the new pure display policy/state tests;
- localhost Settings API validation/persistence tests;
- pad and companion activity-routing tests proving forbidden sources do not
  reset the timer;
- systemd installer/unit and shell syntax checks;
- launcher pad-nav tests and production build if TypeScript changes;
- Python compile/tests for changed Python;
- catalog tests only if catalog code changes;
- `git diff --check` and a secrets scan of the staged diff.

Do not commit generated build output, runtime cache, credentials, screenshots
with private data, or raw provider payloads.

### 9.3 Commit, push, deploy, repeat

For each coherent fix:

```bash
git status --short
git diff --check
git diff --cached --stat
git commit -m "<scoped reason>"
git push origin feat/native-experience
bash scripts/pi-deploy.sh --fast --gate
```

Stage only intentional files. If dependencies or unit installation require a
full deploy, use the documented `--full` path. After any display-systemd change,
verify the installed unit and enablement rather than assuming the deploy did it.

### 9.4 Physical display-sleep/CEC proof matrix

For every row capture the configured value, display supervisor status/journal,
`xset q`, `pgrep -af '[m]pv'`, CEC wrapper result, and the human's physical-TV
observation.

1. **Default and no accidental 600s:** with a fresh/missing config, prove the UI
   displays 30m and `xset q` shows zero uncontrolled automatic timeouts. During a
   controlled interval past 600 seconds but below the chosen Mango timeout, the
   TV must remain on.
2. **Intentional sleep:** select 15m in Settings and perform one real 15-minute
   idle proof. The supervisor transitions once; DPMS becomes Off; the physical
   TV enters standby via one bounded CEC transition.
3. **D-pad wake:** use one ordinary D-pad action. DPMS becomes On and CEC powers
   the TV on. Record whether the first action navigates or is consumed, plus
   wake-to-picture time.
4. **Companion wake:** sleep again, then use normal PTT/text companion activity.
   Prove DPMS On + CEC power-on and normal HUD/response behavior.
5. **Forbidden activity does not reset:** without D-pad/companion activity, prove
   generic launcher click/key instrumentation, progress/heartbeat, catalog work,
   or background service churn does not move the display activity timestamp.
   Do not fake user inputs on the production UI merely to test instrumentation;
   use unit/integration evidence where physical input is inappropriate.
6. **mpv inhibition:** start real playback, wait beyond the selected timeout,
   and prove no DPMS Off or CEC standby. End playback without D-pad/companion
   activity; prove the timer behavior matches the locked permitted-activity
   contract and eventually sleeps.
7. **Off:** select Off, wait beyond the short preset, and prove no intentional
   sleep. UI/stack restart still leaves the panel On.
8. **Persistence:** restart launcher, supervisor, and then perform a normal Pi
   reboot during an approved window. Prove the selected setting persists and
   only one supervisor/CEC owner exists.
9. **Restore product default:** set 30m, prove Settings/status agree, and leave
   the system in that state.

An accelerated timeout may be used only as an explicit temporary test hook if
the real 15-minute row is also run. Remove the hook, redeploy, and reprove an
actual preset before acceptance.

## 10. Evidence-driven tweak loop

When a required row fails:

1. freeze the failing state long enough to capture status, journal, process,
   X/BlueZ/CEC evidence, and the human observation;
2. identify the owning layer and one falsifiable root-cause hypothesis;
3. change the smallest source-owned surface on the home Mac;
4. add or strengthen a test that fails before and passes after;
5. run focused local checks and the relevant full build;
6. commit/push, deploy through Git, and prove all three SHAs match;
7. rerun the smallest failing couch row;
8. rerun the relevant workstream gate, then `pi-exec-gate.sh` before handoff;
9. document the failed attempt as evidence rather than erasing it.

Stop and ask the human before package installation, intentional TV standby/reboot,
pairing recovery, OS-level rollback, or any action that could interrupt their
session. Do not ask approval for ordinary read-only diagnostics or scoped repo
edits already authorized by this prompt.

## 11. Controller A10 failure capture - before pairing

Run this bundle immediately after a failed ordinary wake:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m1-foundation/pad/controller-link-diagnose.sh'
bash scripts/pi-exec.sh 'cat ~/.cache/mango/mango-controller-link-status.json; echo; cat ~/.cache/mango/mango-tv-pad-status.json'
bash scripts/pi-exec.sh 'bluetoothctl info "${MANGO_GAMEPAD_BT_MAC:-E4:17:D8:EB:00:44}"'
bash scripts/pi-exec.sh 'ls -l /dev/input/by-id/* /dev/input/event* 2>/dev/null; python3 - <<"PY"
import evdev
for path in evdev.list_devices():
    dev = evdev.InputDevice(path)
    print(path, dev.name, dev.uniq or "-")
    dev.close()
PY'
bash scripts/pi-exec.sh 'journalctl -u mango-controller-link.service -n 100 --no-pager; journalctl --user -u mango-tv-pad.service -n 100 --no-pager; journalctl -u bluetooth.service -n 100 --no-pager'
bash scripts/pi-exec.sh 'ps -eo pid,ppid,etimes,args | grep -E "[m]ango-controller-link|[m]ango-tv-pad|[b]luetoothctl|[i]nput-remapper"'
```

Record timestamps around normal power-on; public state (`off`, `connecting`,
`connected_waiting_for_input`, `needs-re-pair`, or `ready`); `paired`,
`device_present`, `connected`, and `input_ready`; retry phase/index; discovery
and repair timestamps; exact D-Bus errors; `/dev/input` identity; configured MAC;
and competing owners. This evidence decides H1/H3/H4/H5. If the human later
authorizes pairing recovery, label it separately; it cannot convert the failed
ordinary-wake row into a pass.

## 12. Final regression and acceptance

After all fixes and focused rows:

```bash
bash scripts/pi-deploy.sh --full --gate
bash scripts/pi-exec-gate.sh
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-controller-reconnect.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/stack/verify-voice-ready.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/live/live-diagnostics.sh && bash scripts/live/gate-live-diagnostics.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/diag/pi-resource-snapshot.sh'
```

Perform a final human walk-through: boot/refresh without pad, launcher D-pad,
play/volume/back/return, five-cycle Micro normal reconnect (or retain the already
fresh complete evidence), PTT/HUD response, Live shelf, intentional sleep,
D-pad wake, companion wake, mpv inhibition, Off, and restored 30m default.

Acceptance requires:

- all three source tips match the intended final commit;
- required automated gates pass, with WARNs explained;
- S1 ordinary reconnect is `5/5` with zero pairing-mode entries;
- one fullscreen launcher surface and stable visible focus;
- boot/refresh wake is physically observed without input;
- voice systemd/tmux ownership and real PTT/HUD path pass;
- Live freshness/yield and rendered shelf are proved or provider-blocked with
  exact `DEFERRED` evidence;
- render-age and throttle conclusions use the corrected semantics;
- every display-sleep/CEC matrix row passes on the actual TV;
- default is restored to 30m and no accidental Xorg 600s timeout remains;
- `docs/DECISIONS.md` and `docs/OPS.md` describe only the policy actually proved;
- no secrets, runtime state, cache/history, or unrelated user dirt is committed.

## 13. Required final report and Git handoff

Write `docs/tasks/OPS_HEALTH_HOME_DEPLOY_REPORT.md`. It must include:

1. date, home-Mac/OS, Pi hostname/model/OS, TV model if the human provides it,
   branch, starting SHA, and final home/origin/Pi SHAs;
2. exact deploy commands and gate counts;
3. every new patch SHA, subject, changed paths, reason, and rollback;
4. H1-H5 verdicts with direct Pi evidence:
   - H1 installed BlueZ policy absent/drifted;
   - H2 permanent `pairing_missing` dead-end (source-fixed, runtime regression);
   - H3 BlueZ connected without evdev/input;
   - H4 reconnect timeout/cadence;
   - H5 competing owner or wrong identity/path;
5. S1-S6 table with automated result, human-TV result, and evidence;
6. all five controller cycle timings and whether pairing was entered (`no` is
   required for pass);
7. display-sleep/CEC implementation design, unit/config/status contract, package
   changes, and the nine-row physical proof matrix;
8. the first-wake-action decision and measured wake-to-picture behavior;
9. before/after screenshots only if sanitized and useful; prefer text evidence;
10. every failed attempt and the evidence-driven fix;
11. remaining `DEFERRED` items with exact reason, owner, and next command/action;
12. final human tester observations, clearly identified as human observations;
13. confirmation that 30m is restored, playback is stopped, the launcher is
    usable, and the system is left in a safe state.

Do not include IP addresses, MAC addresses beyond the repo's already-public
configured controller identifier, tokens, cookies, provider URLs with secrets,
voice transcripts containing private content, or credentials.

Run local documentation checks, stage only intentional source/docs, commit the
sanitized report and any final documentation, and push:

```bash
git status --short
git diff --check
git diff --cached --stat
git commit -m "docs(ops): record home TV health proof"
git push origin feat/native-experience
```

If the report-only commit makes the Pi SHA differ, perform a final Git-only fast
pull/deploy or explicitly distinguish the runtime code SHA from the docs-only
tip. Never conceal the distinction.

Finish your chat handoff with:

- patch SHAs and final home/origin/Pi identities;
- H1-H5 verdicts;
- S1-S6 and display-sleep/CEC results;
- the completed human proof checklist;
- all `DEFERRED` items and exact next actions;
- report path;
- confirmation of safe final state.

## 14. Paste-ready starter prompt

```text
Work from the home-Mac Mango clone on branch feat/native-experience. Pull the
latest origin tip and read docs/tasks/OPS_HEALTH_HOME_DEPLOY_PROMPT.md top to
bottom before doing anything; it is the complete contract. Deploy only through
Mango's Git-based scripts, prove S1-S6 on the Pi/physical TV, implement and prove
the locked Settings-driven display-sleep + DPMS/CEC policy, and collaborate with
me one physical observation at a time. You may make narrowly scoped principled
home-Mac source fixes, commit/push them, and redeploy as the prompt directs. Do
not pair the Micro as a normal reconnect fix, hand-edit Pi repo source, use
rsync/scp, delete runtime state, touch YouTube credentials/quota, or infer couch
passes. Write and push the required home deployment report when the full matrix
is proved or honestly DEFERRED.
```
