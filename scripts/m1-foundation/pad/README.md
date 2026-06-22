# M1 foundation — pad scripts

Run on the Pi from `~/mango`. Full context: [docs/OPS.md](../../../docs/OPS.md).

> **Native branch:** daily stack is `mango-stack.sh`. Scripts here support gamepad bring-up and **`mango-tv-pad.py`** (launcher + mpv).

## Daily (native)

| Script | Purpose |
|--------|---------|
| **`mango-tv-pad.py`** | **Pad owner** — launcher · mpv (via `start-mango-tv-pad.sh`) |
| `start-mango-tv-pad.sh` | Idempotent pad start |
| `stop-mango-tv-pad.sh` | Stop pad router |

## Gamepad

| Script | Purpose |
|--------|---------|
| `connect-gamepad.sh` | BT connect 8BitDo Micro |
| **`install-pad-autoreconnect.sh`** | **Once** — BT trust + udev + systemd pad recovery |
| `install-pad-sudoers.sh` | Passwordless sudo for pad grab |
| `map-pro-controller.sh` | Write/apply `mango-tv` preset (input-remapper fallback) |
| `lib/irctl.sh` | Quiet input-remapper-control (Py3.13 noise) |
| `gamepad-fresh-start.sh` | Post-reboot pad + evtest |

## Bring-up

| Script | Purpose |
|--------|---------|
| `bootstrap.sh` | Interactive Pi bring-up after clone |
| `verify-system.sh` | X11 + deps smoke |
| `switch-to-x11.sh` | Switch display manager to X11 |
| `install-base-deps.sh` | apt packages for TV stack |

## Gamepad (locked)

See [docs/HARDWARE.md](../../../docs/HARDWARE.md) · [AGENTS.md](../../../AGENTS.md).
