# Phase 0 — Software checklist

**Hardware first:** complete [`GETTING-STARTED.md`](GETTING-STARTED.md) (flash SD, insert in Pi, boot desktop).

Helper scripts: `scripts/phase0/`

## OS & display

- [ ] Flash Pi OS Desktop 64-bit (hostname `mango`) — see GETTING-STARTED
- [ ] Boot desktop, network up, `sudo apt update && sudo apt full-upgrade -y`
- [ ] `bash scripts/phase0/switch-to-x11.sh` → `sudo reboot`
- [ ] `bash scripts/phase0/verify-system.sh` — all green
- [ ] `echo $XDG_SESSION_TYPE` prints `x11`

## Gamepad

- [ ] Receiver in Pi USB port (`lsusb` shows FastPad-KEY or `js0` for joystick pads)
- [ ] **Joystick pad:** `jstest /dev/input/js0` + antimicrox
- [ ] **Keyboard-mode pad (FastPad):** `bash scripts/phase0/map-gamepad-ssh.sh` (SSH, no mouse) — or GUI via `install-gamepad-remap.sh`
- [ ] Gamepad navigates desktop apps (file manager, menus)

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

- [ ] Pi IP noted: `hostname -I`
- [ ] Phone reaches Pi on LAN
- [ ] SSH from Mac works

## Sign-off

- [ ] Kodi + Stremio stable 30+ min
- [ ] Gamepad-only couch navigation OK
- [ ] Ready for Phase 1 (launcher code)

**Pi IP:** _______________  
**Kodi user:** _______________  
**Stremio version:** _______________  
**Date completed:** _______________
