# Scripts

| Path | Purpose |
|------|---------|
| **`pi-exec.sh`** | Run commands on Pi from Mac (`bash scripts/pi-exec.sh '…'`) |
| **`setup-mac-pi-ssh.sh`** | One-time passwordless SSH for agents |
| [**phase0/**](phase0/README.md) | Pi bring-up — **`tv.sh`** is the daily entry |
| `launch-stremio.sh` | Phase 1 thin wrapper around `phase0/reset-stremio.sh` |
| `launch-kodi.sh` | Phase 1 thin wrapper around `phase0/launch-kodi.sh` |
| `launch-launcher.sh` | Return focus to Chromium launcher and restore launcher remapper |
| `phase1/` | Launcher server, Chromium start, Openbox autostart |
| `install.sh` | Planned bootstrap (Phase 5) |
| `systemd/` | Planned unit files |

Phase 1 launcher shell: see [`docs/PHASE1.md`](../docs/PHASE1.md).
