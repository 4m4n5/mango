# Ops health deep-dive — post-refresh findings @ `7c8c720`

Diagnosis after `bash scripts/mango-refresh.sh` on the Pi (2026-08-01).
Handoff for **work agent** (code diagnosis + patches) and **home agent**
(Pi BT/DPMS couch proof). Do **not** treat every health WARN as a product bug —
several are metric/gate false alarms.

## Executive map

| # | Symptom | Classification | Root cause (current best) | Independence |
|---|---------|----------------|---------------------------|--------------|
| 1 | DPMS Monitor Off after refresh | **Boot gap / real couch defect** | `mango-display-wake.sh` never called on stack start; cursor-hide disables DPMS policy but does not `force on` | Independent |
| 2 | Dual `mango-launcher` fullscreen windows | **Invariant gap / amplifier** | Chromium multi-window + `present-launcher` resizes *all* siblings to TV size; gates count processes not X windows | Amplifies pad/paint |
| 3 | `ai-cricket-channels` “empty” | **Mostly false alarm + API confusion** | Live AI slots are seed-only (`sources=[]`); seeds merge into `live-cricket`. Slot YAML on Pi has seeds. VOD `/rails/ai-…/items` is the wrong surface | Weak link to live cache |
| 4 | Live-rails cache stale (~14h) | **Design: demand-only rebuild** | Rebuild only inside `liveTabRailItems()`; idle > TTL → `fresh=false` while `live_ready=true` (config OK). Forced tab fetch refreshed cache immediately | Independent of search_health |
| 5 | `search_health` verified=0 | **Expected after quiet TTL** | All 28 health records older than ~30m horizon; browse does not re-verify | Independent |
| 6 | `render_age_ms≈999` at idle | **Benign metric quirk** | Heartbeat reports age *before* rAF pulse lands (~1s interval) | Not a stall |
| 7 | `verify-voice-ready` tmux FAIL | **Stale gate** | Start path uses systemd and kills tmux; verify still requires tmux sessions | False FAIL |
| 8 | `throttled=0x80000` | **Sticky soft-temp history** | Bit 19 only; not actively throttling | Ops hygiene |
| 9 | `waiting_for_controller` (Micro off) | **Expected** | Router healthy while powered down | Not a defect |
| 10 | Micro wake needs pairing mode sometimes | **Real reconnect defect (couch-reported)** | Docs/OPS claim normal power-on reconnects; user must sometimes enter pairing. Suspect: BlueZ policy/installer not applied, link stuck in `pairing_missing`/`needs_repair`, Connected≠input-ready, or Connect() failing until advertise | Independent; needs Pi BT traces |

---

## 1. DPMS Monitor Off after refresh

### Evidence
- After refresh: `xset q` → **Monitor is Off**; `scrot` still non-black (Chromium paints X FB).
- Manual `xset dpms force on` → Monitor On (human TV recovers).
- Pad path can wake on input; stack boot does not.

### Mechanism
```
mango-refresh → mango-stack start → start-mango-ui
  → mango-cursor.sh hide   # xset -dpms / s off  — NO force on
  → ensure-launcher / present-launcher
  → (never calls mango-display-wake.sh)
```

`scripts/lib/mango-display-wake.sh` already has the full policy + `xset dpms force on`.
It is effectively unused on couch boot (`rg` shows definition + unused pad constant).
`xset -dpms` does not reliably recover an already-Off panel → black TV + painting FB.

### Principled fix
1. SSOT: call `mango-display-wake.sh` from `start-mango-ui.sh` (and/or end of `mango-stack.sh start` / refresh).
2. Optionally fold `force on` into cursor-hide **or** stop treating cursor-hide as display power policy.
3. Gate: post-refresh `xset q` must not show Monitor Off.
4. Keep pad’s low-latency inline wake for input; boot must not depend on a button press.

### Files
`scripts/lib/mango-display-wake.sh` · `scripts/m1-foundation/ui/start-mango-ui.sh` · `scripts/mango-stack.sh` · `scripts/lib/mango-cursor.sh` · docs OPS/ARCHITECTURE alignment.

---

## 2. Dual fullscreen `mango-launcher` windows

### Evidence
- Post-refresh: two InputOutput wids both `1920x1080`.
- `present-launcher.sh` comments admit Chromium keeps several `WM_CLASS=mango-launcher` windows and **intentionally** resizes all of them to TV size.
- Idle hygiene gates count `browser_apps <= 1` (processes), not X windows → dual fullscreen **passes**.

### Mechanism
1. Chromium `--kiosk --app=… --class=mango-launcher` often creates a multi-window tree.
2. Hide shrinks all siblings; present maps/resizes **all** back to fullscreen.
3. `all_launcher_windows_tv_sized` treats “every sibling full-size” as success.
4. Pad `find_launcher_wid` picks largest area — ambiguous when two are equal.

### Principled fix
1. Single-surface invariant: present/activate **one** canonical wid; unmap or kill orphans after proven-safe policy.
2. Cold start hygiene: stop waits for zero matching windows; prefer unit restart over soft start-when-already-up.
3. Experiment: `--kiosk` vs `--app` alone as multi-window source.
4. Gate: InputOutput `mango-launcher` window count == 1 at idle.
5. Treat N>1 as repair (restart chromium unit), not as “resize everyone.”

### Files
`scripts/lib/present-launcher.sh` · `scripts/lib/launcher-window.sh` · `scripts/lib/mango-window.sh` · `start-mango-launcher-chromium.sh` · chromium user unit · `gate-common.sh` idle hygiene · pad wid picker.

---

## 3. `ai-cricket-channels` “empty”

### Pi evidence (conclusive enough to reclassify)
- `/etc/mango/ai-catalogs/slots/cricket-channels.yaml` exists with **many `seed_titles`** (Cricket Gold, Star Sports, Willow, …) and `sources: []`.
- Unfiltered `GET /rails` shows `ai-cricket-channels` with `sources: []` — **by design** for live AI adapter.
- Live AI slots **merge into** `live-cricket` (`LIVE_AI_MERGE_TARGETS`), not as a separate live shelf row.
- VOD `GET /rails/ai-cricket-channels/items` → 0 items — **wrong probe**; live shelf is `/rails/items?tab=live`.
- After forced live rebuild: `live-cricket` has **8 items**.

### Mechanism
Live compose returns `sources: []` and seeds from live-rails disk cache / slot YAML.
Unfiltered `/rails` lists AI slots with empty sources → looks “broken.”
`/rails/{ai-id}/items` uses VOD playability path; live/YouTube AI are not growable that way.

### Remaining open questions for home agent
1. Confirm launcher Live tab never shows a useless standalone `ai-cricket-channels` rail.
2. Confirm merge path actually injects slot seeds into `live-cricket` (item IDs / titles overlap).
3. Whether unfiltered `/rails` should omit seed-only live AI slots or expose `seed_count`.

### Principled fix
- Operator/health: probe live AI via slot YAML + `/rails/items?tab=live`, never VOD per-rail items.
- API: don’t advertise live AI as empty VOD rails; expose seed_count / merge target.
- Bootstrap: live seed refresh must not use VOD `verified_pool` fullness checks.

---

## 4. Live-rails cache stale (~14h)

### Pi evidence
- Before: `fresh=false`, `age_sec≈51368`, `expires_in_sec` negative, `rail_counts` non-empty, `last_rebuild_error=null`.
- `GET /rails/items?tab=live` → rails populated; after: **`fresh=true`, age=0, expires=1800**.
- Rebuild works when demanded; nothing demanded it for ~14h.

### Mechanism
- `live_ready` = config loaded, **not** cache freshness.
- `stale_fallback_available` = non-empty compatible disk cache (policy: stale shelf > empty).
- Rebuild only inside `liveTabRailItems()` when memory+disk not fresh.
- Watchdog / `/health` / diagnostics **do not** rebuild.
- `last_rebuild_error` is in-process and clears on catalog restart.

### Principled fix
1. Background/timer or watchdog hook: refresh when `!fresh && live_ready` (rate-limit aware).
2. Persist last rebuild attempt + error on disk.
3. Split health fields: `config_ready` / `cache_fresh` / `serving_stale`.

---

## 5. Live `search_health` verified=0

### Mechanism
`summarizeLiveChannelHealth`: records older than freshness horizon (~live cache TTL, ~1800s) count as stale/unknown.
`verified` only from live search proof or live playback ladder — **not** from browse (`verify_streams: false` by default).
After live rebuild, search_health stayed `verified=0, stale=28, unknown=28` → **independent of shelf rebuild**.

### Principled fix
- Separate “ever verified” vs “fresh verified” in health.
- Optionally longer health horizon than rail TTL; or document as expected after quiet periods.
- Do not gate couch handoff on `verified>0` unless a live play/search was just exercised.

---

## 6. `pad_nav.render_age_ms≈999` at idle

### Mechanism
```ts
requestRenderPulse(); // schedules rAF to update lastRenderAt
postPadHeartbeat(..., performance.now() - lastRenderAt); // age since PREVIOUS pulse
```
1 Hz heartbeat ⇒ ~999ms reported every tick while healthy.
Server clamp is 60s, not 999. Recovery keys off pending+stall, not render_age alone.
After a move: pending drains, `last_ack_age_ms` updates — confirmed healthy.

### Principled fix
- Await rAF before measuring, or document idle ~1000ms as normal.
- Alerts: `(pending>0 && last_ack_age_ms > stall)` only.

---

## 7. `verify-voice-ready` tmux FAIL

### Mechanism
`start-voice-stack.sh` prefers systemd and **kills** tmux sessions.
`verify-voice-ready.sh` still `bad` unless `tmux has-session mango-orch/companion`.
Orchestrator `:8766/health` OK; WSS smoke OK; companion HTTPS OK.

### Principled fix
Accept systemd **or** tmux for each role; prefer systemd when units enabled.
Tail `journalctl --user -u mango-orchestrator` when not on tmux.

---

## 8. `throttled=0x80000`

Bit 19 = soft temperature limit **occurred since boot** (sticky). No active undervolt/throttle bits in low nibble.
Action: decode in snapshots; WARN sticky; FAIL only on active bits. Not a mango logic bug.

---

## 9. `waiting_for_controller` (Micro powered off)

Expected when Micro is off. Documented green. Escalate only on stale waiting / pid mismatch / link needs_repair.

---

## 10. D-pad / 8BitDo Micro — wake does not reconnect; pairing mode required

### Couch symptom (user-reported)
After the Micro has been off (or asleep), turning it on with a **normal power
press** sometimes does **not** restore pad input. The user must put the Micro
into **pairing mode** before the Pi grabs it again. This contradicts the
product contract.

### Contract (what code/docs promise)
- [`docs/HARDWARE.md`](../HARDWARE.md) / [`docs/OPS.md`](../OPS.md): wake normally —
  **do not** enter pairing mode; `mango-controller-link` retries indefinitely
  (immediate burst, then ~5s maintenance probe); pairing only if diagnostics
  show the pairing record is absent.
- Ownership split: `mango-controller-link` = BlueZ connect; `mango-tv-pad` =
  evdev grab after the `Pro Controller` node appears.
- [`docs/STATUS.md`](../STATUS.md): controller-link “Pi install/couch proof
  **pending** home-agent handoff” — installer/`gate-m6-controller-reconnect`
  may never have been proven on this Pi.

### Ranked hypotheses (work agent must confirm/refute)

**H1 — Reliability installer / BlueZ policy not applied (or drifted)**  
`install-controller-reliability.sh` sets BlueZ reconnect policy and removes
obsolete Phase 0 udev. If `--apply` never ran (or policy reverted), Connect()
from the supervisor fails until the Micro advertises in pairing mode.
Evidence: `bash scripts/m6-ship/gate-m6-controller-reconnect.sh`,
`controller-link-diagnose.sh`, BlueZ policy files vs installer expectations.

**H2 — Supervisor stuck with `pairing_missing` / `needs_repair`**  
In `mango-controller-link.py`, `_try_connect` **returns early** when
`pairing_missing` is set (DoesNotExist / UnknownObject). Auto-repair restarts
`bluetooth.service` on a 15‑minute cooldown. If the device object is transiently
missing or the path/MAC is wrong, the link stops attempting Connect until repair
or a pairing cycle recreates the object.
Evidence: `~/.cache/mango/mango-controller-link-status.json` during a failed
wake (`state`, `last_error`, `pairing_missing`, `repair_count`).

**H3 — BlueZ Connected but no evdev / wrong HID mode**  
HARDWARE notes Bluetooth may show Connected before Linux registers the pad —
“press any button.” Micro can also wake in keyboard/other mode vs Pro Controller.
Pad stays `waiting_for_controller` until the expected event node appears; user
interprets that as “needs pairing.”
Evidence: `bluetoothctl info <MAC>`, `mango-tv-pad-status.json` `device_path`,
`/dev/input/event*` names before/after normal wake vs pairing wake.

**H4 — Fast-retry window too short / Connect timeout too aggressive**  
`CONNECT_ATTEMPT_TIMEOUT_SEC = 3.0` + fast burst then 5s maintenance. If the
Micro takes longer to become connectable after power-on, attempts fail; pairing
mode makes it continuously advertise so a later Connect succeeds.
Evidence: timeline of Connect errors vs Micro power-on; compare success latency
on good vs bad wakes.

**H5 — Dual owners / race**  
Pad start starts controller-link; something else (gnome-bluetooth, manual
bluetoothctl, input-remapper) interferes with the dedicated MAC.
Evidence: `systemctl status mango-controller-link`, competing agents,
`controller-link-diagnose.sh`.

### Principled fix directions (not “tell the user to pair”)
1. Prove installer + BlueZ policy applied; make gate fail if policy missing.
2. Never silently stop Connect attempts: recover from `pairing_missing` by
   re-resolving device path / adapter scan for the known MAC without forcing
   the user into pairing UI unless the bond is actually gone.
3. Distinguish states in Reliability Center / pad-health: `off`,
   `connecting`, `connected_no_input`, `needs_re-pair` (bond lost) — only the
   last should instruct pairing.
4. Widen wake handling: on adapter/device PropertiesChanged, force an immediate
   retry burst; optionally trigger a brief page/scan for the known MAC.
5. Couch proof: `controller-link-couch-test.sh` / `gate-m6-controller-reconnect.sh`
   must pass with **normal power-on only** (no pairing mode) across N wake cycles.

### Files
`scripts/m1-foundation/pad/mango-controller-link.py` ·
`controller-link-state.py` · `controller-link-config.py` ·
`install-controller-reliability.sh` · `controller-link-diagnose.sh` ·
`controller-link-couch-test.sh` · `gate-m6-controller-reconnect.sh` ·
`mango-tv-pad.py` (input-ready handoff) · Reliability Center controller repair ·
`docs/HARDWARE.md` / `OPS.md` (only after behavior matches).

### Split of labour
| Role | Job |
|------|-----|
| **Work agent** | Code/policy diagnosis, principled patch, unit tests, push |
| **Home agent** | Reproduce failed normal-wake vs pairing-wake with diagnose logs; apply installer if missing; couch-prove N wake cycles after deploy |

---

## Priority for principled work

1. **Wire display wake into stack boot** + post-refresh DPMS gate (couch-blocking).
2. **8BitDo normal-wake reconnect** (no pairing mode) — prove installer + fix link supervisor gaps.
3. **Single launcher window invariant** + gate (reliability amplifier).
4. **Live cache background refresh** + honest health semantics (ops clarity + cricket seed freshness).
5. **Fix verify-voice-ready systemd-or-tmux** (false alarms).
6. **Clarify live AI / search_health / render_age metrics** (stop chasing ghosts).
7. Throttle bit decode (hygiene).

## What this report is not
- Not a license to redesign Search cinema or touch YouTube credentials/quota.
- Not permission to delete runtime DBs/cache/history without an explicit failed-rebuild diagnosis.
- Lite-play stream timeouts from earlier gates are **out of scope** here unless they reappear after live/cache work.
