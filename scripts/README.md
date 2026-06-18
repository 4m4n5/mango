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

| Script | Notes |
|--------|-------|
| `launch-launcher.sh` | Home · warm noop · debounced 2 s in API |
| `launch-stremio.sh` | Refocus or cold · hide Kodi · flock |
| `launch-kodi.sh` | Hide Stremio (`hide-media`) · present Kodi |

## `lib/` — TV windows

| Script | Role |
|--------|------|
| `hide-media.sh` | Stack Stremio/Kodi below without kill |
| `present-launcher.sh` | Launcher 1920×1080 |
| `present-stremio.sh` | Fullscreen; `--after-back` = no F11 |
| `present-kodi.sh` | Media fullscreen, hide lxpanel |
| `mango-window.sh` | hide/show launcher (z-order; Chromium ignores `wmctrl hidden`) |
| `mango-desktop.sh` | lxpanel |
| `mango-cursor.sh` | Hide cursor |

No `xdotool windowactivate --sync`.

## Diagnostics

| Script | Role |
|--------|------|
| `diag/alpha-test.sh` | Couch test + session log on Pi |
| `diag/fetch-session.sh` | Pull session tarball to Mac |
| `diag/print-runbook.sh` | Step list |
| `verify-tv.sh` | Health gate (`tv_pad` OK) |

## Phase 0

`phase0/tv.sh` · [`phase0/README.md`](phase0/README.md)

## Phase 1

`start-mango-ui.sh` · `stop-mango-ui.sh` · `install-openbox-autostart.sh` · `install-systemd-units.sh`
