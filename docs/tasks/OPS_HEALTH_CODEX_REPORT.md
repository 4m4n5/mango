# Ops health Codex implementation report

Date: 2026-08-01

Branch: `feat/native-experience`

Base: `3544a74` (includes locked intentional display-sleep §11 / home B1)

Authority boundary: work Mac only; no Pi SSH, deploy, couch test, Bluetooth trace,
CEC test, or TV observation was performed.

## Outcome

S1–S6 are implemented and locally verified. The patches restore bonded
controller recovery without teaching pairing as normal wake, force the display
on at UI start, enforce one viewable launcher surface, refresh stale Live rails
off-couch with honest health, accept either supported voice runtime owner, and
clarify the remaining false-alarm metrics. All runtime/Pi verdicts are listed as
`DEFERRED` below rather than inferred from source or Mac tests.

Intentional display sleep and CEC are a separate locked, **home-owned** B1 per
`docs/tasks/ops-health-deep-dive-report.md` §11 and
`docs/tasks/ops-health-home-agent-prompt.md` B1. This work preserves boot wake;
the home agent must implement and prove the Settings-driven policy before
updating `docs/DECISIONS.md` / the final `docs/OPS.md` policy.

## S1 — bonded controller normal-wake recovery

Patch: `825d77c` — `fix(pad): recover bonded controller without pairing`

Changed:

- `scripts/m1-foundation/pad/controller_link_state.py`
- `scripts/m1-foundation/pad/mango-controller-link.py`
- `scripts/m1-foundation/pad/pad-health.sh`
- `scripts/m1-foundation/pad/controller-link-diagnose.sh`
- `scripts/m1-foundation/pad/controller-link-couch-test.sh`
- `scripts/m1-foundation/pad/install-controller-reliability.sh`
- `scripts/m6-ship/gate-m6-controller-reconnect.sh`
- `scripts/m1-foundation/pad/test-controller-link-state.py`
- catalog Reliability model/service/tests

The public state is now `off | connecting | connected_waiting_for_input |
needs-re-pair | ready`; only explicit `Device1.Paired=false` produces
`needs-re-pair` (`controller_link_state.py:113-124`). Reliability only gives
pairing copy for that state (`src/catalog-service/src/reliability/model.ts:111-127`).
A missing BlueZ object is re-resolved, briefly discovered for the configured MAC
only, and retried without making the adapter pairable
(`mango-controller-link.py:166-189,246-292`). BlueZ repair and SIGUSR1 both
discard/re-resolve the stale object and force a retry
(`mango-controller-link.py:303-334`). Status records device presence, paired
evidence, retry phase, discovery, and `pairing_policy=explicit_recovery_only`
(`mango-controller-link.py:336-383`).

The installer/gate now require the exact managed BlueZ values
(`install-controller-reliability.sh:73-99`; `gate-m6-controller-reconnect.sh:44-96`).
The couch test defaults to five ordinary power cycles and explicitly prohibits
pairing mode (`controller-link-couch-test.sh:8-60`).

### H1–H5 verdicts

| Hypothesis | Verdict | Evidence and boundary |
|---|---|---|
| H1 — installer/BlueZ policy absent or drifted | **DEFERRED** | Pi `/etc/bluetooth/main.conf`, installed units, and bond state are not visible from the work Mac. Source expectations are exact at `controller-link-config.py:11-18`, and `--check` now fails drift at `install-controller-reliability.sh:73-99`. Home must run the commands below. |
| H2 — `pairing_missing` permanently dead-ends Connect | **CONFIRMED, FIXED** | At base `a321a40`, `scripts/m1-foundation/pad/mango-controller-link.py:179-181` returned immediately whenever `pairing_missing` was set. The replacement re-resolves and performs bounded known-device discovery instead of stopping (`mango-controller-link.py:275-292`). |
| H3 — BlueZ Connected but no evdev/HID input | **DEFERRED; now independently observable** | Source already treated BlueZ and evdev as separate owners. The new state reports `connected_waiting_for_input` when connected without a ready pad node (`controller_link_state.py:116-124`), and diagnostics enumerate `/dev/input` names (`controller-link-diagnose.sh:21-34`). Only home A10 can establish whether this caused a failed wake. |
| H4 — 3 s attempt timeout / cadence too aggressive | **DEFERRED** | The supervisor still records a 3 s attempt timeout but continues the fast burst and indefinite 5 s maintenance cadence (`mango-controller-link.py:37-39,391-409`; `controller_link_state.py:14-15,83-100`). Good/bad power-on timing and D-Bus errors are required before changing the timeout. |
| H5 — competing owner or wrong MAC/path | **DEFERRED** | The configured MAC/path is exact (`mango-controller-link.py:29-32`); the gate requires one link owner, one pad owner, no orphan `bluetoothctl`, and no stale udev hook (`gate-m6-controller-reconnect.sh:14-37`). Actual Pi processes/agents require A10 capture. |

## S2 — deterministic display wake at UI start

Patch: `8a57cdc` — `fix(ui): force display awake on stack start`

`start-mango-ui.sh` invokes the existing SSOT wake helper immediately after
launcher display mode (`scripts/m1-foundation/ui/start-mango-ui.sh:28-36`). The
pad’s lower-latency wake path remains intact. `gate_display_awake` fails a
reachable X display reporting `Monitor is Off`, but gives an explicit soft-skip
when X/xset is unavailable (`scripts/lib/gate-common.sh:190-205`). OPS and
Architecture describe the current boot-wake behavior.

Pi result: **DEFERRED** — home must observe the real panel after refresh without
pressing the pad. This boot wake is compatible with §11: it prevents accidental
post-refresh black screen; the future Mango-owned 30-minute timer decides later
intentional sleep.

## S3 — one launcher InputOutput surface

Patch: `6a6ae6e` — `fix(ui): enforce one launcher surface`

`present-launcher.sh` chooses one canonical viewable InputOutput window, unmaps
sibling surfaces, and fails with a Chromium-unit repair instruction unless the
canonical surface is TV-sized and the viewable count is exactly one
(`scripts/lib/present-launcher.sh:27-78,81-107`). Window helpers distinguish
candidate windows from viewable surfaces; `mango-window.sh show` maps only the
canonical candidate. Idle hygiene retains the browser process assertion and
adds the one-viewable-InputOutput assertion (`scripts/lib/gate-common.sh:207-224,240-244`).

Pi result: **DEFERRED** — X11 geometry/window ownership is not available on the
work Mac.

## S4 — stale Live background refresh and honest health

Patch: `98c9e61` — `fix(live): refresh stale rails in background`

Catalog startup now starts a cheap periodic metadata check. It rebuilds only
when config is ready and memory/disk cache is stale, yields during playback,
joins an existing rebuild, and honors a persisted minimum-attempt interval
(`src/catalog-service/src/core.ts:1096-1140,1836-1865`). Attempt/success/error
state is atomically persisted beside the cache and survives process-local state.
Health exposes `config_ready`, `cache_fresh`, and `serving_stale`, while
`ready`/`live_ready` remain config-readiness aliases
(`src/catalog-service/src/core.ts:1182-1233`). Reliability maps fresh to green,
policy-compatible stale serving to yellow, and no usable cache/config to red
(`src/catalog-service/src/reliability/model.ts:145-160`). Diagnostics and
`docs/LIVE_TV.md` document the shape; no cache is deleted.

Pi/provider result: **DEFERRED** — cache age, NexoTV response, provider rate
limits, and playback-yield behavior require the installed catalog and runtime.

## S5 — voice verifier runtime ownership

Patch: `adae1f6` — `fix(voice): verify systemd or legacy tmux runtime`

Orchestrator and companion now pass when their corresponding user systemd unit
is active or their legacy tmux session exists
(`scripts/m5-voice/stack/verify-voice-ready.sh:22-49,141-149`). Systemd is
reported first and its journal is used for logs/hints
(`verify-voice-ready.sh:218-230`). The HTTPS/WSS/listener/HUD checks remain
separate readiness gates.

Pi result: **DEFERRED** — the work Mac has neither the Pi user units nor voice
listeners.

## S6 — metric clarity

Patches: `ef1de24` — `fix(ops): clarify live and hardware health metrics`;
`8842dd2` — `fix(ops): preserve throttle snapshot verdict`

- Live AI: unfiltered `/rails` summaries for Live AI slots now expose
  `seed_count` and, when applicable, `merge_target`; tests cover
  `ai-cricket-channels -> live-cricket`. `docs/LIVE_TV.md` documents the correct
  `/rails/items?tab=live` plus slot-YAML probe and rejects the VOD-looking
  `/rails/ai-*/items` interpretation.
- Pad render age: `docs/ARCHITECTURE.md` documents why an idle sample near the
  one-second heartbeat is normal. Recovery remains based on a pending input
  exceeding the stall budget, with heartbeat/ack telemetry used together; no
  launcher code change was needed.
- Throttle: `scripts/diag/pi-resource-snapshot.sh:6-44,70-83` decodes current
  and sticky bits. Only active undervoltage (`bit 0`) or active throttling
  (`bit 2`) returns `FAIL`; active cap/temp and all sticky history, including
  `0x80000`, report `WARN`. A pure shell contract test covers OK/WARN/FAIL.

Pi values remain **DEFERRED**; the decoder behavior itself is locally proven.

## Patch series

Apply in order (all are descendants of `3544a74`):

1. `825d77c` — controller reconnect recovery/state/gate
2. `8a57cdc` — display wake on UI start
3. `6a6ae6e` — single launcher surface
4. `98c9e61` — Live background refresh/health
5. `adae1f6` — voice systemd-or-tmux verification
6. `ef1de24` — metric clarity
7. `8842dd2` — preserve decoded throttle exit status through process sampling

## Local verification

Commands run from the repo root:

```bash
python3 scripts/m1-foundation/pad/test-controller-link-state.py
python3 scripts/m1-foundation/pad/test-controller-link-config.py

src/catalog-service/node_modules/.bin/tsx --test \
  src/catalog-service/src/reliability/model.test.ts \
  src/catalog-service/src/live-rails-cache.test.ts \
  src/catalog-service/src/live/ai-catalog-rails.test.ts

(cd src/catalog-service && npm run build)

bash -n scripts/m1-foundation/ui/start-mango-ui.sh \
  scripts/lib/mango-display-wake.sh \
  scripts/lib/present-launcher.sh \
  scripts/lib/launcher-window.sh \
  scripts/lib/mango-window.sh \
  scripts/lib/gate-common.sh \
  scripts/lib/restore-launcher-after-playback.sh \
  scripts/m1-foundation/pad/controller-link-couch-test.sh \
  scripts/m1-foundation/pad/controller-link-diagnose.sh \
  scripts/m1-foundation/pad/install-controller-reliability.sh \
  scripts/m1-foundation/pad/pad-health.sh \
  scripts/m5-voice/stack/verify-voice-ready.sh \
  scripts/m6-ship/gate-m6-controller-reconnect.sh \
  scripts/live/live-diagnostics.sh \
  scripts/live/gate-live-diagnostics.sh \
  scripts/diag/pi-resource-snapshot.sh \
  scripts/diag/test-pi-resource-snapshot.sh

bash scripts/diag/test-pi-resource-snapshot.sh
bash scripts/lib/test-gate-common-repo-dir.sh
python3 -m py_compile \
  scripts/m1-foundation/pad/controller_link_state.py \
  scripts/m1-foundation/pad/mango-controller-link.py
```

Evidence: controller state `7/7` pass; controller config `1/1` pass; catalog /
Reliability / Live `26/26` pass; catalog TypeScript build pass; throttle decoder
contract pass; gate-common repo-dir test pass; all named `bash -n` and Python
compile checks pass. Launcher pad-nav and UI-server tests were not required
because S6 documented existing render-age semantics without touching either
implementation.

## Home deploy and proof checklist

Run only from the home Mac/Pi LAN, during an idle couch window. Preserve Pi dirt
and deploy by git only:

```bash
git branch --show-current
git pull --ff-only origin feat/native-experience
bash scripts/pi-deploy.sh --fast --gate
```

### Controller A10 — five normal-wake cycles, zero pairing

Before cycling:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-controller-reconnect.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m1-foundation/pad/controller-link-couch-test.sh'
```

The interactive couch test requires five cycles: Micro off for at least 30 s,
then a normal power press. Do not enter pairing mode. Record time-to-ready for
all five. A passing handoff requires `5/5` and zero pairing-mode entries.

If `--check` fails only because managed BlueZ policy/unit installation is
missing or drifted, home owns the reviewed idle-window apply and recheck:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --apply'
bash scripts/pi-exec.sh 'cd ~/mango && sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check'
```

Never unpair as a default repair. If any normal wake fails, stop before pairing
and capture the A10 bundle in the next section.

### Boot display, single surface, voice, and Live

After refresh and before touching the pad:

```bash
bash scripts/pi-exec.sh 'export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; xset q | sed -n "/DPMS/,/Monitor/p"'
bash scripts/pi-exec.sh 'cd ~/mango && export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; source scripts/lib/launcher-window.sh; printf "viewable_launcher_windows="; launcher_viewable_input_output_count'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/stack/verify-voice-ready.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/live/live-diagnostics.sh && bash scripts/live/gate-live-diagnostics.sh'
bash scripts/pi-exec.sh 'curl -s http://127.0.0.1:3020/health | python3 -m json.tool'
```

Required evidence:

- physical panel is On after deploy/refresh without a pad press, and X does not
  report `Monitor is Off`;
- `viewable_launcher_windows=1`, one fullscreen launcher surface, and pad focus
  remains stable;
- voice verifier has zero false tmux failures while systemd units are active,
  plus real WSS/HTTPS/HUD checks pass;
- when Live cache starts stale, a bounded background attempt occurs without
  opening the Live tab, `last_rebuild_attempt_at` persists across restart, and a
  success moves `cache_fresh` true; while playback is active no background
  provider rebuild contends with mpv;
- unfiltered `/rails` reports the Live AI seed count/merge target and
  `/rails/items?tab=live` contains the rendered target shelf.

### Locked display sleep + CEC (§11 / home B1)

This is intentionally not implemented or claimed from the work Mac. Home must
implement the locked policy on top of the boot-wake patch: Settings presets
Off/15m/30m(default)/60m/2h; only D-pad and companion reset idle; mpv blocks
sleep; sleep performs DPMS Off then CEC standby; pad/companion wake performs
DPMS on plus CEC power-on; uncontrolled Xorg 600 s DPMS is disabled. Keep the
maintenance `MANGO_COUCH_IDLE_SEC` clock separate.

Home proof matrix, with `xset q`, `pgrep -af mpv`, the new supervisor status or
journal, and physical TV observation captured for every row:

1. Set a short reviewed test timeout in Settings; idle to DPMS Off + TV standby.
2. Wake with one D-pad action; prove DPMS On + CEC power-on and document whether
   that first action is consumed or navigates.
3. Sleep again; wake via companion/PTT and prove both display and TV power.
4. Start mpv, wait beyond the test timeout, and prove no sleep/CEC standby.
5. Stop mpv; prove the timer restarts from permitted activity and eventually
   sleeps.
6. Set Off and prove no intentional sleep; restore the 30-minute default.
7. Only after all rows pass, update `docs/DECISIONS.md` and `docs/OPS.md` from
   the transitional anti-sleep wording to the proven policy.

## A10 failure artifacts (capture before pairing)

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

Record which public state appeared (`off`, `connecting`,
`connected_waiting_for_input`, or `needs-re-pair`), timestamps around normal
power-on, `paired/device_present/connected/input_ready`, retry phase/index,
discovery/repair timestamps, exact D-Bus errors, device names, and competing
owners. If pairing mode is later used as an explicit recovery, capture the same
bundle afterward and label it separately; it does not count as a passing wake.

## DEFERRED

| Item | Exact reason / next evidence |
|---|---|
| H1 installed BlueZ policy | No Pi filesystem/system bus on work Mac; run installer `--check`, reconnect gate, and `bluetoothctl info`. |
| H3 Connected-without-evdev cause | Requires a failed physical wake with simultaneous BlueZ status and `/dev/input` enumeration. |
| H4 timeout/cadence cause | Requires timestamped power-on, Connect errors, and good-vs-bad latency. |
| H5 competing owner | Requires Pi process/unit/udev capture during failure. |
| Micro normal-wake acceptance | Requires five physical normal-wake cycles with zero pairing. |
| DPMS/physical boot wake | Requires refresh on the target X11/HDMI TV before any input. |
| Single launcher window | Requires target X server/window manager and human surface check. |
| Live provider freshness/yield | Requires installed Live config/cache/provider and an mpv-active observation. |
| Voice systemd-only readiness | Requires Pi user units and loopback voice listeners. |
| Intentional display sleep + CEC | Locked and home-owned; requires Settings implementation, CEC tooling/TV, mpv exclusion, pad+companion hooks, and the seven-row proof matrix above. |

No Pi/couch pass is implied by the local results in this report.
