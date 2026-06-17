# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Bluetooth controller** · phone · TV

- **SD card:** flash on Mac via Imager, then insert in Pi underside slot
- **Gamepad:** 8BitDo over **Bluetooth** (primary TV remote)
- **Phone:** mic + companion app (later, over WiFi)

## 8BitDo Bluetooth (recommended)

**MAC:** `E4:17:D8:EB:00:44` · Linux name: **Pro Controller**

### After reboot (start here)

```bash
cd ~/mango && git pull
bash scripts/phase0/gamepad-fresh-start.sh
bash scripts/phase0/launch-kodi.sh
```

In Kodi: **Settings → Input → Peripherals → joysticks → ON**

### Daily use

```bash
bash scripts/phase0/launch-kodi.sh      # Kodi — native pad, remapper OFF
bash scripts/phase0/launch-stremio.sh   # Stremio — keyboard remap ON
bluetoothctl connect E4:17:D8:EB:00:44
```

### First-time pair

1. **Unplug** the old FastPad USB dongle.
2. Run: `bash scripts/phase0/setup-8bitdo-bt.sh`  
   Or pair manually: pad **START+Y** → `bluetoothctl pair/trust/connect E4:17:D8:EB:00:44`

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo. If needed: `map-gamepad-ssh.sh` for keyboard-mode pads.

Details: [`GETTING-STARTED.md`](GETTING-STARTED.md) · [`phase0-checklist.md`](phase0-checklist.md)
