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

GUI (optional, needs mouse or working keyboard): `install-gamepad-remap.sh` then Input Remapper from the app menu.

**See what keys it sends:**

```bash
bash scripts/phase0/capture-gamepad-keys.sh
```

Details: [`GETTING-STARTED.md`](GETTING-STARTED.md) · checklist: [`phase0-checklist.md`](phase0-checklist.md)
