# Getting started

Phase 0 on Pi 5 CanaKit. Full checklist: [`phase0-checklist.md`](phase0-checklist.md).

## Done so far

- Pi OS Desktop 64-bit flashed (hostname `mango`, user `aman`, SSH on)
- X11 + Openbox (`switch-to-x11.sh`, rebooted)
- Repo cloned at `~/mango` on the Pi
- FastPad gamepad remapped via `map-gamepad-ssh.sh` (preset `mango-tv`, autoload)

## Next: bootstrap (Kodi + Stremio)

On the Pi (SSH):

```bash
cd ~/mango
git pull
bash scripts/phase0/bootstrap.sh
```

Answer **Y** to base deps, Kodi, and Stremio. Then on the **TV screen** (gamepad):

1. **Kodi** — install YouTube addon, enable JSON-RPC (port 8080, user/pass)
2. **Stremio** — login, install addons, play something
3. Back in SSH: `bash scripts/phase0/test-kodi-rpc.sh <user> <pass>`

## First-time flash (reference)

1. Imager → Pi 5 → Pi OS Desktop 64-bit → hostname `mango`, SSH on.
2. SD in Pi underside slot, HDMI, gamepad dongle, power.
3. Mac: `ssh aman@mango.local` · `git clone https://github.com/4m4n5/mango.git`
