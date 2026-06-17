# Phase 0 — Device bring-up checklist

Complete on the Pi **before writing application code**. Check off in order.

## OS & display

- [ ] Flash Pi OS Desktop 64-bit to 128GB SD
- [ ] Boot, connect network (Ethernet preferred), `sudo apt update && sudo apt full-upgrade -y`
- [ ] `sudo raspi-config` → Advanced → Wayland → **X11 Openbox** → reboot
- [ ] `echo $XDG_SESSION_TYPE` prints `x11`
- [ ] `vcgencmd measure_temp` stable under load (< 80°C)

## Gamepad

- [ ] Receiver plugged in; `ls /dev/input/js0` exists
- [ ] `jstest /dev/input/js0` — all buttons respond
- [ ] antimicrox profile: D-pad → arrows, A → Return, B → Escape
- [ ] Gamepad navigates desktop apps

## Kodi + YouTube

- [ ] `sudo apt install kodi`
- [ ] YouTube addon installed and signed in (if needed)
- [ ] Play a video with gamepad only
- [ ] Web server + JSON-RPC enabled (port 8080, user/pass set)
- [ ] `curl` JSONRPC.Ping succeeds on localhost

## Stremio

- [ ] Install fragarray `stremio_*_arm64.deb` from [releases](https://github.com/fragarray/stremio-rpi5/releases)
- [ ] `stremio` launches; login succeeds
- [ ] Addons installed manually
- [ ] Play content with gamepad
- [ ] `xdg-open 'stremio:///detail/...'` opens correct title

## Network & phone

- [ ] Note Pi IP: `hostname -I`
- [ ] Phone browser reaches Pi (ping / simple HTTP test)
- [ ] SSH from dev machine works (optional)

## Sign-off

- [ ] Kodi + Stremio stable 30+ minutes
- [ ] Gamepad-only navigation comfortable from couch
- [ ] Ready for Phase 1 (launcher code)

**Pi IP:** _______________  
**Kodi user:** _______________  
**Stremio version:** _______________  
**Date completed:** _______________
