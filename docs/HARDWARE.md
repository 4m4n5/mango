# Hardware — ai-tv-box V1

## On hand

| Item | Notes |
|------|-------|
| Raspberry Pi 5 8GB | CanaKit case + active cooling |
| 128GB microSD | Pi OS Desktop 64-bit |
| USB gamepad + receiver | **Primary TV navigation** — map D-pad to arrow keys |
| Phone/tablet | Mic + companion remote (`https://<pi-ip>:3001` after mkcert) |
| TV | HDMI from Pi |

## Not in kit (optional)

| Item | When |
|------|------|
| Ethernet cable | Prefer over WiFi for 4K streaming |
| FLIRC + IR remote | V2 optional — gamepad covers V1 |

## Gamepad setup (Phase 0)

1. Verify: `ls /dev/input/js*` · `jstest /dev/input/js0`
2. Map buttons: `sudo apt install antimicrox` (or joystick + xbindkeys)
3. Target mapping: D-pad → arrows · A → Enter · B → Escape · Start → Home (optional)

## Phone setup (Phase 2)

1. Install mkcert CA on phone after Pi generates cert (one-time)
2. Add companion PWA to home screen

See [PLAN.md](PLAN.md) Phase 0 checklist.
