# Scripts

Ops: [`docs/PHASE0.md`](../docs/PHASE0.md).

## Pi bring-up

| Script | When |
|--------|------|
| **`phase1/restart-mango-ui.sh`** | Crash / unknown state |
| **`phase1/bootstrap-after-reboot.sh`** | After Pi reboot |

## Mac → Pi

`pi-exec.sh` · `setup-mac-pi-ssh.sh`

## Launch API (`serve.py`)

`launch-launcher.sh` · `launch-stremio.sh` · `launch-kodi.sh`

## `lib/` — TV windows

| Script | Role |
|--------|------|
| `present-launcher.sh` | Launcher 1920×1080 |
| `present-stremio.sh` / `present-kodi.sh` | Media fullscreen, hide lxpanel |
| `mango-window.sh` | hide/show launcher (z-order; Chromium ignores `wmctrl hidden`) |
| `mango-desktop.sh` | lxpanel |
| `mango-cursor.sh` | Hide cursor |

No `xdotool windowactivate --sync`.

## Phase 0

`phase0/tv.sh` · [`phase0/README.md`](phase0/README.md)

## Phase 1

`start-mango-ui.sh` · `stop-mango-ui.sh` · `install-openbox-autostart.sh` · `install-systemd-units.sh` · `../verify-tv.sh`
