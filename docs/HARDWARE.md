# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Micro** (Bluetooth) · phone · TV

> **Native branch:** pad routes to **launcher**, **mpv** (N1+), and **fallback** Stremio/Kodi only. See [FOREGROUND.md](FOREGROUND.md).

- **SD card:** flash on Mac via Imager, then insert in Pi underside slot
- **Gamepad:** 8BitDo Micro — D-pad + XYAB only (no stick)
- **Phone:** mic + companion app over WiFi (HTTPS `:3001`)

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
  [ ]  [⌂]    ← right bottom = home (evdev 316, fallback 311)
```

| Label | evdev | Action |
|-------|-------|--------|
| **−** | `314` | — |
| **+** | `315` | — |
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
