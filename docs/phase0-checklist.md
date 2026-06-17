# Phase 0 — Software checklist

**Hardware:** [`GETTING-STARTED.md`](GETTING-STARTED.md) · [`HARDWARE.md`](HARDWARE.md) · [`kodi-youtube-setup.md`](kodi-youtube-setup.md)

Helper scripts: `scripts/phase0/`

## OS & display

- [x] Flash Pi OS Desktop 64-bit (hostname `mango`)
- [x] Boot desktop, network up
- [ ] `sudo apt update && sudo apt full-upgrade -y` (optional)
- [x] `bash scripts/phase0/switch-to-x11.sh` → reboot
- [x] `bash scripts/phase0/verify-system.sh` — all green
- [x] X11 confirmed (`openbox` running)

## Gamepad (8BitDo Micro)

- [x] Bluetooth paired — MAC `E4:17:D8:EB:00:44`, preset `mango-tv`
- [x] **Kodi:** D-pad navigate · **B** select · **Y** back
- [ ] **Stremio:** same layout confirmed
- [ ] Couch navigation stable 30+ min across both apps

## Kodi + YouTube

- [x] Kodi installed
- [x] InputStream Adaptive (`install-kodi-inputstream.sh`)
- [x] YouTube addon installed (zip v7.4.3 + setup wizard)
- [ ] Play a video with gamepad
- [x] JSON-RPC enabled (port 8080, user `mango`)
- [x] `test-kodi-rpc.sh` passes

## Stremio

- [x] Stremio installed
- [ ] Login + addons; play with gamepad
- [ ] `xdg-open 'stremio:///detail/...'` opens title (optional)

## Network & phone

- [x] Pi IP: `10.0.0.174` · SSH: `aman@mango.local`
- [ ] Phone reaches Pi on LAN
- [x] SSH from Mac works

## Sign-off

- [ ] All unchecked items above done
- [ ] Ready for Phase 1 (launcher code)

**Pi IP:** `10.0.0.174` · **SSH:** `aman@mango.local`  
**Gamepad:** 8BitDo Micro · D-pad / B / Y · preset `mango-tv`  
**Kodi RPC user:** `mango` (password on Pi only)  
**Stremio version:** _______________  
**Date completed:** _______________
