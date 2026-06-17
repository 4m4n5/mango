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

3. Pair in **Switch mode**: hold **START + Y** ~3s until LEDs flash, then `bluetoothctl` → `pair` / `trust` / `connect`. Linux lists it as **`Pro Controller`** — that's your 8BitDo.
4. Script maps **D-pad → arrows**, **A → Return**, **B → Escape** (preset `mango-tv`).

**Reconnect after sleep:**

```bash
bluetoothctl connect AA:BB:CC:DD:EE:FF   # your controller MAC
input-remapper-control --command autoload
```

**Launch apps (important — Kodi vs Stremio differ):**

```bash
bash scripts/phase0/launch-kodi.sh      # native gamepad — A=select, B=back
bash scripts/phase0/launch-stremio.sh # keyboard remap for Qt UI
```

Do **not** use input-remapper for Kodi — it breaks the D-pad. `launch-kodi.sh` turns remapper off first.

**Desktop/Stremio remap only:**

```bash
bash scripts/phase0/map-pro-controller.sh
bash scripts/phase0/map-pro-controller.sh --swap-ab   # if A/B reversed
```

---

## FastPad (retired)

Unstable 2.4G dongle — replaced by 8BitDo. If needed: `map-gamepad-ssh.sh` for keyboard-mode pads.

Details: [`GETTING-STARTED.md`](GETTING-STARTED.md) · [`phase0-checklist.md`](phase0-checklist.md)
