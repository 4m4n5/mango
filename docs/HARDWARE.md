# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Micro** (Bluetooth) · phone · TV

- **SD card:** flash on Mac via Imager, then insert in Pi underside slot
- **Gamepad:** 8BitDo Micro — D-pad + XYAB only (no stick)
- **Phone:** mic + companion app (later, over WiFi)

## 8BitDo Micro (Bluetooth)

Pair in **Switch mode** (hold START+Y). Linux names it **Pro Controller**.

**MAC:** `E4:17:D8:EB:00:44`

### Controller layout (verified in Kodi)

| Button | Action |
|--------|--------|
| **D-pad** | Navigate (up / down / left / right) |
| **B** (right) | Select |
| **Y** (left) | Back |

A and X are unmapped. Remapping is via `input-remapper` preset `mango-tv` (D-pad → arrow keys, B → Return, Y → BackSpace).

> **Quirk:** The Micro has no analog stick, but in Switch BT mode Linux reports the **D-pad as ABS_X/ABS_Y** axis events (not hat D-pad). `evtest` will show `ABS_X` when you press left/right — that is normal.

### After reboot

Bluetooth may show **Connected** before Linux registers the pad. **Press any button** on the Micro, then:

```bash
cd ~/mango && git pull
bash scripts/phase0/gamepad-fresh-start.sh
```

If input still missing: `bluetoothctl disconnect E4:17:D8:EB:00:44` → press a pad button → `bluetoothctl connect E4:17:D8:EB:00:44`

### Daily use

```bash
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/launch-kodi.sh      # Kodi
bash scripts/phase0/launch-stremio.sh   # Stremio
```

Both launchers apply gamepad mapping automatically.

- **Kodi** — `input-remapper` preset `mango-tv`
- **Stremio** — `stremio-pad-bridge` (xdotool; Qt ignores remapper)

### First-time pair

1. **Unplug** the old FastPad USB dongle.
2. Run: `bash scripts/phase0/setup-8bitdo-bt.sh`  
   Or pair manually: Micro **START+Y** → `bluetoothctl pair/trust/connect E4:17:D8:EB:00:44`

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo Micro.

Details: [`GETTING-STARTED.md`](GETTING-STARTED.md) · [`phase0-checklist.md`](phase0-checklist.md)
