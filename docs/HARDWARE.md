# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Micro** (Bluetooth) · phone · TV

- **SD card:** flash on Mac via Imager, then insert in Pi underside slot
- **Gamepad:** 8BitDo Micro — D-pad + XYAB only (no stick)
- **Phone:** mic + companion app (later, over WiFi)

## 8BitDo Micro (Bluetooth)

Pair in **Switch mode** (hold START+Y). Linux names it **Pro Controller**.

**MAC:** `E4:17:D8:EB:00:44`

> **Quirk:** The Micro has no analog stick, but in Switch BT mode Linux reports the **D-pad as ABS_X/ABS_Y** axis events (not hat D-pad). `evtest` will show `ABS_X` when you press left/right on the D-pad — that is normal.

### After reboot (start here)

```bash
cd ~/mango && git pull
bash scripts/phase0/gamepad-fresh-start.sh
bash scripts/phase0/launch-kodi.sh
```

### Daily use

```bash
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/launch-kodi.sh      # Kodi
bash scripts/phase0/launch-stremio.sh   # Stremio
```

Both apps use `map-pro-controller.sh` — D-pad → arrows, **A → select**, **B → back** (BackSpace).

If A/B reversed: `bash scripts/phase0/map-pro-controller.sh --swap-ab`

### First-time pair

1. **Unplug** the old FastPad USB dongle.
2. Run: `bash scripts/phase0/setup-8bitdo-bt.sh`  
   Or pair manually: Micro **START+Y** → `bluetoothctl pair/trust/connect E4:17:D8:EB:00:44`

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo Micro. If needed: `map-gamepad-ssh.sh` for keyboard-mode pads.

Details: [`GETTING-STARTED.md`](GETTING-STARTED.md) · [`phase0-checklist.md`](phase0-checklist.md)
