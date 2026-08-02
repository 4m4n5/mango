# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Micro** (Bluetooth) · phone

> **Native branch:** pad routes to **launcher** and mpv during active playback.
> See [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Product target vs dev lab (2026-07)

| | **Target (M6.3 ship)** | **Dev lab today (M1–M5)** |
|--|----------------------|---------------------------|
| **Vision** | World-class **4K AI-first TV box** — native browse, voice, mpv playback | Same software path; validate on desk before living room |
| **Display** | **4K TV** · HDMI 2.0/2.1 · tuned mode + EDID | Launcher forced to **1920×1080@60** for smooth couch UI |
| **Audio** | **Soundbar** (HDMI eARC/ARC or optical) · Piper TTS on TV | **No soundbar yet** — headphones for couch/dev audio |
| **Stream cap** | 4K WEB-DL / cached RD when Pi profile proven | Default `max_quality: 1080p`; Stage 2 couch profile stays 1080p after 4K visible-picture failures |
| **mpv** | 4K HEVC profile · visible-picture gate | `hwdec=drm-copy` · source-matched 1080p smoke passed · 4K remains experimental |

**North star unchanged:** Pi 5 8GB is the V1 platform. M6.3 validates target-TV playback fidelity first; 4K reopens only after a visible-picture gate proves smooth video. If hardware limits block the desired playback bar (DV/REMUX, HDMI bandwidth), document upgrades (NVMe OS, USB DAC for desk, or future SoC) without abandoning the lean stack.

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

## Display and Target-TV Stage 2

- **Launcher:** `1920x1080@60` through `scripts/lib/mango-display-mode.sh`
- **Playback:** mpv owns fullscreen playback and switches to source-matched
  EDID modes. The couch-safe default uses 1080p streams and matching film/TV
  rates such as `1920x1080@23.98/24/25/29.97/30`, then restores launcher
  `1920x1080@60`.
- **Policy:** stream quality/HDR preference lives in catalog filters, not Chromium
- **Stage 2 profile:** `apply-4k-hdr-profile.sh` sets display/audio base;
  `set-playback-engine.sh mpv-hifi` installs the ship stream policy
  (`catalog-filters.4k-hifi.json`). Browse is always `1920x1080@60` — never 4K
  Chromium (Pi GPU budget). 4K is mpv playback only.

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
  [317] [⌂]   ← 317 unused during playback; home = right bottom (316, fallback 311)
```

| Label | evdev | Action |
|-------|-------|--------|
| **−** | `314` | **Volume down** |
| **+** | `315` | **Volume up** |
| **Bottom-left center button** | `317` | Unused (playback + launcher) |
| **L** shoulder | `310` | **Prev browse tab** (launcher); playback large seek back |
| **R** shoulder | `311` | **Next browse tab** (launcher); playback large seek forward |
| **⌂** (right, below −/+) | `316` (`311` fallback) | **Home → launcher** |

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
an immediate retry burst followed by a five-second maintenance probe.

**One-time setup** (auto-recover after this):

```bash
cd ~/mango && git pull
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --apply
```

The installer backs up the BlueZ policy before changing it, removes only the
obsolete Mango Phase 0 udev hook, and preserves pairing. A single normal power
button press then reconnects silently — no SSH or pairing mode.

**Manual fallback:**

```bash
bash scripts/m1-foundation/pad/start-mango-tv-pad.sh
```

If input still missing, open Settings → Reliability Center → **Repair
controller** while idle, or collect `bash scripts/m1-foundation/pad/controller-link-diagnose.sh`.
Do not unpair or enter pairing mode unless the diagnostics confirm pairing loss.

### Daily use

```bash
cd ~/mango && git pull
bash scripts/mango-stack.sh restart    # native default
# legacy fallback only:
bash scripts/m1-foundation/pad/tv.sh stremio
bash scripts/m1-foundation/pad/tv.sh kodi
```

See [OPS.md](OPS.md) for full runbook.

### First-time pair

1. **Unplug** the old FastPad USB dongle.
2. Run: `bash scripts/m1-foundation/pad/setup-8bitdo-bt.sh`  
   Or pair manually: Micro **START+Y** → `bluetoothctl pair/trust/connect E4:17:D8:EB:00:44`

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo Micro.

Details: [`OPS.md`](OPS.md) · [`archive/phase0-checklist.md`](archive/phase0-checklist.md)
