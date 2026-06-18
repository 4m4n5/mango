# Phase 0 scripts

Run on the Pi from `~/mango`. Full context: [`docs/PHASE0.md`](../../docs/PHASE0.md).

## Daily

| Script | Purpose |
|--------|---------|
| **`tv.sh`** `kodi\|stremio` | Connect pad + launch app (use this) |
| **`mango-tv-pad.py`** | **Primary pad** — launcher + Stremio + Kodi (via `start-mango-tv-pad.sh`) |
| `connect-gamepad.sh` | BT connect 8BitDo Micro |
| `launch-kodi.sh` | Kodi + YouTube RPC · hides Stremio (`hide-media`) |
| `open-kodi-youtube.sh` | Open YouTube addon (window 10025) |
| `focus-kodi.sh` / `present-kodi.sh` | TV focus + fullscreen |
| `lib/kodi-rpc.sh` | JSON-RPC client |
| `reset-stremio.sh` | Kill zombies + Stremio + pad + focus (maintenance only) |
| `launch-stremio.sh` | Cold Stremio (API uses `scripts/launch-stremio.sh` for refocus) |
| `present-stremio.sh` | Fullscreen; `--after-back` after Y/Escape |

## Gamepad

| Script | Purpose |
|--------|---------|
| `start-mango-tv-pad.sh` | Idempotent pad start (do not restart on every home) |
| `map-pro-controller.sh` | Write/apply `mango-tv` preset (fallback remapper) |
| `stremio-pad-bridge.py` | **Legacy** — prefer unified `mango-tv-pad.py` |
| `lib/irctl.sh` | Quiet input-remapper-control (Py3.13 noise) |
| `lib/gamepad-js.sh` | Hide `/dev/input/js*` for Stremio |
| `gamepad-fresh-start.sh` | Post-reboot pad + evtest |
| `focus-stremio.sh` | Focus main Stremio window + click webview |
| `stop-stremio-pad-bridge.sh` | Stop legacy bridge |

## Kodi / YouTube

| Script | Purpose |
|--------|---------|
| `set-youtube-api-keys.sh` | `~/.config/mango/youtube-api.json` → addon |
| `reset-youtube-login.sh` | Clear login + re-apply keys |
| `diagnose-kodi-youtube.sh` | Health check |
| `kodi-enable-rpc.sh` | JSON-RPC user/password |
| `test-kodi-rpc.sh` | curl ping |
| `kodi-keyboard-only.sh` | Disable Kodi native joysticks |
| `install-kodi-inputstream.sh` | apt InputStream Adaptive |
| `reset-kodi-youtube.sh` | Clean addon + download zip |

## Stremio maintenance

| Script | Purpose |
|--------|---------|
| `kill-stremio.sh` | Kill all Stremio/node + free ports (zombie recovery only) |
| `test-stremio-input.sh` | xdotool key test |

## One-time / bootstrap

| Script | Purpose |
|--------|---------|
| `bootstrap.sh` | Phase 0 install entry |
| `switch-to-x11.sh` | Wayland → X11 |
| `verify-system.sh` | Green-light checks |
| `setup-8bitdo-bt.sh` | Pair Micro |
| `install-gamepad-remap.sh` | input-remapper + polkit (fallback) |
| `install-kodi.sh` / `install-stremio.sh` | App install |

## Legacy (avoid unless debugging)

`map-gamepad-ssh.sh` · `map-pro-controller-sticks.sh` · `remove-fastpad.sh` · FastPad dongle retired.
