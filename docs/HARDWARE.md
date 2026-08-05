# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Micro** (Bluetooth) · phone

> **Native branch:** pad routes to **launcher** and mpv during active playback.
> See [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Current hardware/display boundary

| Area | Current supported truth | Still to prove/decide |
|------|-------------------------|-----------------------|
| Host | Pi 5 8GB is the V1 Mango host | Sustained release workload/resource margin |
| Launcher | `1920×1080@60` Chromium/Openbox | Final-TV overscan/focus/readability |
| Native playback | mpv with smooth 1080p and an older-proven source-matched 4K SDR HEVC path | Current-SHA picture/mode/drops/audio/lip-sync matrix |
| HDR | Not supported by the daily X11/mpv product path | Integrate a credible HDR engine or explicitly ship without HDR |
| Kodi/GBM | Separate research proved HDR signaling/hardware feasibility | Parked until Mango HUD/input/progress/lifecycle/security integration exists |
| Audio | HDMI, USB DAC, or Bluetooth; TTS off | Target TV/soundbar sink, lip sync, direct-ALSA fallback |

Do not translate Pi codec capability, an EDID mode, or a separate Kodi test into
a claim that current Mango is a ship-ready 4K HDR box. The launcher remains
1080p60; compatible 4K SDR is mpv-only and must retain a safe 1080p fallback.

### Addon hosting (catalog + streams)

M4 runs AIOStreams and AIOMetadata locally on the Pi:
[`reference/addon-stack.md`](reference/addon-stack.md). ElfHosted is a paid fallback only:
[`reference/elfhosted.md`](reference/elfhosted.md).

M3 playability indexing still required — addon hosting fixes browse/resolve
availability, not play guarantees.

### Optional hardware (when optimizing for SOTA)

| Item | Why |
|------|-----|
| **NVMe HAT + SSD** | Faster boot, model cache, smoother OS under load |
| **Active cooler** | Sustained 4K decode + voice (you have CanaKit cooling) |
| **4K TV + soundbar (eARC)** | Real living-room target; ARC returns DD/Atmos to bar |
| **USB DAC** (desk) | Pi 5 has **no 3.5 mm jack** — clean headphone monitoring while on 1080p monitor |
| **Bluetooth headphones** | Built-in BT; pair for wireless desk/couch tests |

---

## Audio routing (Pi 5)

Pi 5 outputs audio **only via HDMI** (two ports) unless you add **USB DAC** or **Bluetooth**.

| Your headphones | How to connect |
|-----------------|----------------|
| **Plugged into monitor** | HDMI carries audio to monitor → use monitor’s 3.5 mm out (easiest on desk) |
| **USB wired** | Plug USB DAC or USB headset → set default sink |
| **Bluetooth** | Pair once → set BT sink default |

```bash
cd ~/mango
bash scripts/audio/list-sinks.sh                    # see HDMI / USB / BT sinks
bash scripts/audio/scan-bt-devices.sh 60            # find headphone MAC (pairing mode!)
bash scripts/audio/pair-bt-headphones.sh <MAC>      # pair by MAC
bash scripts/audio/set-default-sink.sh <sink-name>  # mpv + system audio follow
```

If PipeWire only exposes `Dummy Output` but `aplay -l` shows `vc4-hdmi-0`,
route playback directly to HDMI0:

```bash
bash scripts/audio/set-default-sink.sh 'alsa/hdmi:CARD=vc4hdmi0,DEV=0'
```

Saved sink: `~/.config/mango/audio.env` (`MANGO_AUDIO_SINK=…`; direct routes
also save `MANGO_MPV_AO` / `MANGO_MPV_AUDIO_DEVICE`). Stack reapplies on restart.

**TTS (Piper):** stays off until soundbar/TV audio path is validated (`audio.tts_enabled: false`). Voice replies on launcher HUD + phone until then.

---

## Display and target-TV profile

- **Launcher:** `1920x1080@60` through `scripts/lib/mango-display-mode.sh`
- **Playback:** mpv owns fullscreen playback and switches to source-matched
  EDID modes. The hifi policy may choose compatible 4K SDR HEVC/REMUX; risky
  HDR/software-decoded paths stay behind smooth choices. Source-matched 1080p
  film/TV modes remain the couch-safe fallback, followed by launcher restore to
  `1920x1080@60`.
- **Policy:** stream quality/HDR preference lives in catalog filters, not Chromium
- **Hifi profile:** the historically named `apply-4k-hdr-profile.sh` sets the
  display/audio base but does not prove HDR;
  `set-playback-engine.sh mpv-hifi` installs the ship stream policy
  (`catalog-filters.4k-hifi.json`). Browse is always `1920x1080@60`—never 4K
  Chromium. Compatible 4K SDR is mpv playback only; native HDR remains outside
  the supported daily architecture.

Pi apply/revert:

```bash
cd ~/mango
bash scripts/m6-ship/apply-4k-hdr-profile.sh apply
bash scripts/m6-ship/gate-m6-4k-hdr-profile.sh

# if the TV path is unstable
bash scripts/m6-ship/apply-4k-hdr-profile.sh revert
```

The profile writes user-owned runtime config under `~/.config/mango`; it does
not mutate `/etc/mango/*.db`, YouTube cache, or playability data. `mpv-stop.sh`
returns the launcher to `1920x1080@60` after playback.

### SSD decision rule

Do not install the spare 128GB SSD just because Stage 2 exists. Install it if
resource snapshots show one of these repeatedly:

- Root filesystem above 85% used, or `/etc/mango` caches leaving little growth headroom.
- Swap usage or memory pressure during 4K playback/grow.
- High I/O wait, slow boot, or slow SQLite/cache writes during nightly grow.
- SD-card reliability concerns after sustained unattended refreshes.

Check current headroom:

```bash
bash scripts/diag/pi-resource-snapshot.sh
```

---

## 8BitDo Micro (Bluetooth)

Pair in **Switch mode** (hold START+Y). Linux names it **Pro Controller**.

**MAC:** `E4:17:D8:EB:00:44`

### Face buttons (right cluster)

Clockwise from the **leftmost** button: **Y → X → A → B**

```
      X
    Y   A
      B
```

| Label | Position | Linux evdev | Action |
|-------|----------|-------------|--------|
| **Y** | left | `308` (BTN_WEST) | **Back** (in-app / playback stop → launcher) |
| **X** | top | `307` (BTN_NORTH) | **Shuffle** (Home); delete/clear (Search); open/close **Streams** (movie/series playback); temporary stream **Undo** after a successful switch |
| **A** | right | `305` (BTN_EAST) | **Show HUD** then **cycle audio** while HUD visible (playback) |
| **B** | bottom | `304` (BTN_SOUTH) | **Select** / playback pause-play + progress bar |

### Center buttons (between D-pad and face cluster)

```
  [−]  [+]
  [317] [⌂]   ← 317 unused during playback; Home = right bottom (316)
```

| Label | evdev | Action |
|-------|-------|--------|
| **−** | `314` | **Volume down** |
| **+** | `315` | **Volume up** |
| **Bottom-left center button** | `317` | Unused (playback + launcher) |
| **L** shoulder | `310` | **Prev browse tab** (launcher); playback large seek back |
| **R** shoulder | `311` | **Next browse tab** (launcher); playback large seek forward |
| **⌂** (right, below −/+) | `316` | **Home → launcher** |

**D-pad** → navigate. During playback, **←/→** skip ±10s and show the progress
HUD; holding **←/→** accelerates seek (10s → 30s → 120s). **↑** is the sole
subtitle control: first press shows the playback HUD only; while the HUD is
visible, further ↑ presses force subtitles on and cycle languages. **A** is
show-first for audio (first press shows HUD; while visible, cycles audio).
Playback-only **L/R** jumps by the large seek step (120s default). In the
Streams panel, **Up/Down** moves, **B** validates/selects, and **Y** closes the
panel before normal playback Back handling.

> Do **not** use Xbox-style “A=bottom confirm” naming — on this pad **B is bottom** and is select. **A** is audio during playback (show-first). **X** is contextual: Home shuffles only the current tab; Search tap deletes and a 600 ms hold clears; movie/series playback opens Streams or briefly undoes a successful switch. Live and YouTube ignore X.

> **Quirk:** In Switch BT mode Linux reports the **D-pad as ABS_X/ABS_Y** (not hat axes). `evtest` shows `ABS_X` on left/right — normal.

### Remapping

| Surface | Method |
|---------|--------|
| **Launcher + playback** | **`mango-tv-pad.py`** — single pad owner |

### After reboot or pad drop

Bluetooth may show **Connected** before Linux registers the pad. **Press any button** on the Micro.

If the Micro is powered off, Mango keeps the pad router waiting and the root
`mango-controller-link` service owns Bluetooth reconnection. `pad-health:
waiting for controller` is expected in that state; wake the controller normally
(do not enter pairing mode) and it should grab the new `Pro Controller` event
node without a stack restart. The wait state is indefinite; normal power-on uses
an immediate retry burst followed by bounded asleep/maintenance probes. Exact
probe cadence is implementation policy, not a viewer contract.

Source and automated gates do not close physical Bluetooth behavior. The
release gate remains five ordinary power-off/power-on reconnect cycles without
pairing mode, stack restart, or focus loss.

**One-time setup** (auto-recover after this):

First deploy the intended revision through the normal Git-only flow in
[DEPLOY.md](DEPLOY.md). Then run the installer from the already-built Pi
checkout:

```bash
cd ~/mango
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --apply
```

The installer backs up the BlueZ policy before changing it, removes only the
obsolete Mango Phase 0 udev hook, and preserves pairing. The intended normal
path is one power-button wake followed by silent reconnect—no SSH or pairing
mode—but that claim remains subject to the five-cycle physical release gate.

**Manual fallback:**

```bash
bash scripts/m1-foundation/pad/start-mango-tv-pad.sh
```

If input still misses, collect
`bash scripts/m1-foundation/pad/controller-link-diagnose.sh`. The backend has a
controller-repair API, but the current Settings renderer does not expose its
button; do not instruct a viewer to find it until the UI is reconciled.
Do not unpair or enter pairing mode unless the diagnostics confirm pairing loss.

### Daily use

Restarting daily use does not update source. A repository revision change needs
the Git-only pull/build/restart contract in [DEPLOY.md](DEPLOY.md); a bare Pi pull
can leave compiled services stale. The current deploy wrapper has an active
branch/SHA and AIOMetadata-mutation blocker, so do not invoke it unattended.

```bash
cd ~/mango
bash scripts/mango-stack.sh restart    # native default
```

Legacy `tv.sh stremio|kodi` helpers are retained as historical diagnostics, not
the supported daily viewer or automatic recovery path.

See [OPS.md](OPS.md) for full runbook.

### First-time pair

1. **Unplug** the old FastPad USB dongle.
2. Run: `bash scripts/m1-foundation/pad/setup-8bitdo-bt.sh`  
   Or pair manually: Micro **START+Y** → `bluetoothctl pair/trust/connect E4:17:D8:EB:00:44`

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo Micro.

Details: [`OPS.md`](OPS.md) · [`archive/phase0-checklist.md`](archive/phase0-checklist.md)
