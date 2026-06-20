# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Micro** (Bluetooth) · phone

> **Native branch:** pad routes to **launcher**, **mpv** (N1+), and **fallback** Stremio/Kodi only. See [FOREGROUND.md](FOREGROUND.md).

---

## Product target vs dev lab (2026-06)

| | **Target (N7 ship)** | **Dev lab today (N1–N6)** |
|--|----------------------|---------------------------|
| **Vision** | World-class **4K AI-first TV box** — native browse, voice, mpv playback | Same software path; validate on desk before living room |
| **Display** | **4K TV** · HDMI 2.0/2.1 · tuned mode + EDID | **1080p monitor** · 1920×1080@60 |
| **Audio** | **Soundbar** (HDMI eARC/ARC or optical) · Piper TTS on TV | **No soundbar yet** — headphones for couch/dev audio |
| **Stream cap** | 4K WEB-DL / cached RD when Pi profile proven | `max_quality: 1080p` in `/etc/mango/catalog-filters.json` |
| **mpv** | 4K HEVC profile · visible-picture gate | `v4l2m2m-copy` · 1080p smoke passed |

**North star unchanged:** Pi 5 8GB is the V1 platform. N7 proves 4K on your TV; if hardware limits block SOTA (DV/REMUX, HDMI bandwidth), we document upgrades (NVMe OS, USB DAC for desk, or future SoC) without abandoning the lean stack.

### Addon hosting (catalog + streams)

N3d runs AIOStreams and AIOLists locally on the Pi:
[`N3d-INVENTORY.md`](N3d-INVENTORY.md). ElfHosted is a paid fallback only:
[`ELFHOSTED.md`](ELFHOSTED.md).

N3c playability indexing still required — addon hosting fixes browse/resolve
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

Saved sink: `~/.config/mango/audio.env` (`MANGO_AUDIO_SINK=…`). Stack reapplies on restart.

**TTS (Piper):** stays off until soundbar/TV audio path is validated (`audio.tts_enabled: false`). Voice replies on launcher HUD + phone until then.

---

## Display (current)

- **Connected:** 1080p monitor on HDMI (lab)
- **Later (N7):** 4K TV + soundbar — `raspi-config` / `kmsprint` / mpv profile in [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) §N7

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
| **Y** | left | `308` (BTN_WEST) | **Back** (in-app / mpv quit → launcher) |
| **X** | top | `307` (BTN_NORTH) | — |
| **A** | right | `305` (BTN_EAST) | — |
| **B** | bottom | `304` (BTN_SOUTH) | **Select** |

### Center buttons (between D-pad and face cluster)

```
  [−]  [+]
  [↻]  [⌂]    ← shuffle = left bottom (evdev 317); home = right bottom (316, fallback 311)
```

| Label | evdev | Action |
|-------|-------|--------|
| **−** | `314` | — |
| **+** | `315` | — |
| **↻ shuffle** (left, below −/+) | `317` | **Reshuffle library** (launcher) |
| **⌂** (right, below −/+) | `316` (`311` fallback) | **Home → launcher** |

**D-pad** → navigate (arrow keys).

> Do **not** use Xbox-style “A=bottom confirm” naming — on this pad **B is bottom** and is select. A and X are intentionally unmapped.

> **Quirk:** In Switch BT mode Linux reports the **D-pad as ABS_X/ABS_Y** (not hat axes). `evtest` shows `ABS_X` on left/right — normal.

### Remapping

| Surface | Method |
|---------|--------|
| **Launcher + mpv + fallback apps** | **`mango-tv-pad.py`** — single pad owner |
| **Legacy Kodi** | `input-remapper` preset `mango-tv` if pad fails to grab |
| **Legacy Stremio** | `stremio-pad-bridge.py` when using fallback desktop app |

### After reboot or pad drop

Bluetooth may show **Connected** before Linux registers the pad. **Press any button** on the Micro.

**One-time setup** (auto-recover after this):

```bash
cd ~/mango && git pull
sudo bash scripts/phase0/install-pad-autoreconnect.sh
```

Then a single button press wakes BT, reconnects, and restarts the pad router — no SSH.

**Manual fallback:**

```bash
bash scripts/phase0/start-mango-tv-pad.sh
```

If input still missing: `bluetoothctl disconnect E4:17:D8:EB:00:44` → press a pad button → `bluetoothctl connect E4:17:D8:EB:00:44`

### Daily use

```bash
cd ~/mango && git pull
bash scripts/mango-stack.sh restart    # native default
# legacy fallback only:
bash scripts/phase0/tv.sh stremio
bash scripts/phase0/tv.sh kodi
```

See [PHASE0.md](PHASE0.md) for full runbook.

### First-time pair

1. **Unplug** the old FastPad USB dongle.
2. Run: `bash scripts/phase0/setup-8bitdo-bt.sh`  
   Or pair manually: Micro **START+Y** → `bluetoothctl pair/trust/connect E4:17:D8:EB:00:44`

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo Micro.

Details: [`PHASE0.md`](PHASE0.md) · [`phase0-checklist.md`](phase0-checklist.md)
