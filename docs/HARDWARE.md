# Hardware — mango

**Have:** Pi 5 8GB CanaKit · 128GB SD · USB gamepad · phone · TV

- **SD card:** flash on Mac via Imager, then insert in Pi underside slot
- **Gamepad:** USB receiver in Pi — primary TV remote
- **Phone:** mic + companion app (later, over WiFi)

## FastPad (keyboard-mode dongle)

The FastPad dongle (`1a86:fe18`, `FastPad-KEY`) registers as a **USB keyboard**, not `/dev/input/js*`. Wrong letters on D-pad/buttons are normal — remap them.

**Try first:** mode / home button on the pad (some firmwares have a second layout).

**Fix (recommended):** input-remapper — **no mouse needed**, map over SSH:

```bash
bash scripts/phase0/map-gamepad-ssh.sh
```

Follow prompts: press each D-pad direction, A, and B once. Reboot-safe autoload is configured automatically.

**Captured raw map (this unit):**

| Pad | Raw key | Code |
|-----|---------|------|
| D-pad up | `A` | 30 |
| D-pad down | `D` | 32 |
| D-pad left | `S` | 31 |
| D-pad right | `W` | 17 |
| A | `T` | 20 |
| B | `Y` | 21 |

Remapped to ↑ ↓ ← → Return Esc via preset `mango-tv` in `~/.config/input-remapper-2/`.

## Disconnects / goes idle

**If connect/disconnect loop after `fix-gamepad-stay-awake.sh`:**

```bash
bash scripts/phase0/undo-gamepad-stay-awake.sh
```

Then re-run the safe USB-only fix:

```bash
bash scripts/phase0/fix-gamepad-stay-awake.sh
```

**Pi (dongle USB sleep)** — disables autosuspend only (no udev autoload hooks):

```bash
bash scripts/phase0/fix-gamepad-stay-awake.sh
```

**Controller (pad ↔ dongle wireless):** the Pi cannot keep the pad awake. If it drops after idle:

- Replace or charge batteries
- Press any button to wake
- Hold **pair/sync** on the pad until linked to the dongle
- Keep dongle in a **direct** Pi USB port

After a drop, wait 2s and press a button — remap should return automatically if `fix-gamepad-stay-awake.sh` ran.

**See what keys it sends:**

```bash
bash scripts/phase0/capture-gamepad-keys.sh
```

Details: [`GETTING-STARTED.md`](GETTING-STARTED.md) · checklist: [`phase0-checklist.md`](phase0-checklist.md)
