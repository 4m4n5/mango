# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · **8BitDo Bluetooth controller** · phone · TV

- **SD card:** flash on Mac via Imager, then insert in Pi underside slot
- **Gamepad:** 8BitDo over **Bluetooth** (primary TV remote)
- **Phone:** mic + companion app (later, over WiFi)

## 8BitDo Bluetooth (recommended)

1. **Unplug** the old FastPad USB dongle.
2. Run on the Pi:

```bash
cd ~/mango && git pull
bash scripts/phase0/setup-8bitdo-bt.sh
```

3. Pair in **Switch mode**: hold **START + Y** ~3s until LEDs flash, then `bluetoothctl` → `pair` / `trust` / `connect`.
4. Linux often shows it as **`Pro Controller`** (not "8BitDo") — that's correct.
4. Script maps **D-pad → arrows**, **A → Return**, **B → Escape** (preset `mango-tv`).

**Reconnect after sleep:**

```bash
bluetoothctl connect AA:BB:CC:DD:EE:FF   # your controller MAC
input-remapper-control --command autoload
```

**Launch apps from SSH (until Phase 1 launcher):**

```bash
DISPLAY=:0 kodi &
DISPLAY=:0 stremio &
```

**Pad controls:** D-pad = move focus · A = select · B = back

To remove old FastPad config only: `bash scripts/phase0/remove-fastpad.sh`

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo. If needed: `map-gamepad-ssh.sh` for keyboard-mode pads.

Details: [`GETTING-STARTED.md`](GETTING-STARTED.md) · [`phase0-checklist.md`](phase0-checklist.md)
