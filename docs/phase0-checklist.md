# Phase 0 — Software checklist

**Hardware first:** complete [`GETTING-STARTED.md`](GETTING-STARTED.md) (flash SD, insert in Pi, boot desktop).

Helper scripts: `scripts/phase0/`

## OS & display

- [x] Flash Pi OS Desktop 64-bit (hostname `mango`) — see GETTING-STARTED
- [x] Boot desktop, network up
- [ ] `sudo apt update && sudo apt full-upgrade -y` (run during bootstrap if not done)
- [x] `bash scripts/phase0/switch-to-x11.sh` → `sudo reboot`
- [x] `bash scripts/phase0/verify-system.sh` — all green
- [x] X11 confirmed (`openbox` running; `verify-system.sh` passes over SSH)

## Gamepad

- [x] ~~FastPad USB~~ → replaced by **8BitDo Bluetooth**
- [ ] `bash scripts/phase0/setup-8bitdo-bt.sh` — pair + map `mango-tv`
- [ ] Gamepad navigates desktop, Kodi, Stremio

## Kodi + YouTube

- [ ] `bash scripts/phase0/install-kodi.sh`
- [ ] YouTube addon installed; play a video with gamepad
- [ ] JSON-RPC enabled (port 8080, user/pass set)
- [ ] `bash scripts/phase0/test-kodi-rpc.sh <user> <pass>`

## Stremio

- [ ] `bash scripts/phase0/install-stremio.sh`
- [ ] Login + addons; play with gamepad
- [ ] `xdg-open 'stremio:///detail/...'` opens title

## Network & phone

- [x] Pi IP noted: `10.0.0.174` (SSH: `aman@mango.local`)
- [ ] Phone reaches Pi on LAN
- [x] SSH from Mac works

## Sign-off

- [ ] Kodi + Stremio stable 30+ min
- [ ] Gamepad-only couch navigation OK
- [ ] Ready for Phase 1 (launcher code)

**Pi IP:** `10.0.0.174` · **SSH:** `aman@mango.local`  
**Gamepad:** 8BitDo Micro BT `E4:17:D8:EB:00:44` · preset `mango-tv`  
**Kodi user:** _______________  
**Stremio version:** _______________  
**Date completed:** _______________
