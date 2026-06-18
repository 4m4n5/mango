# Phase 0 — Checklist

Runbook: [`PHASE0.md`](PHASE0.md) · Scripts: [`../scripts/phase0/README.md`](../scripts/phase0/README.md)

## OS & display

- [x] Pi OS Desktop 64-bit · hostname `mango`
- [x] X11 + Openbox (`switch-to-x11.sh`)
- [x] `verify-system.sh` green
- [ ] `sudo apt update && apt full-upgrade` (optional)

## Gamepad (8BitDo Micro)

- [x] Paired · MAC `E4:17:D8:EB:00:44` · preset `mango-tv`
- [x] **Kodi:** D-pad · **B** select · **Y** back
- [x] **Stremio:** same layout (pad bridge + js hide)

## Kodi + YouTube

- [x] Kodi + InputStream + YouTube addon (personal API keys)
- [x] Playback with gamepad
- [x] JSON-RPC `:8080` user `mango` · `test-kodi-rpc.sh` passes

## Stremio

- [x] Installed (fragarray arm64 deb)
- [x] Login + addons + playback
- [x] Gamepad (pad bridge)
- [ ] `xdg-open 'stremio:///detail/...'` (optional)

## Sign-off → Phase 1

- [ ] **30+ min** couch test (switch Kodi ↔ Stremio, no crashes/throttle)
- [ ] Phone reaches Pi on LAN (optional)
- [ ] Ready for launcher (`src/`)

**Pi:** `10.0.0.174` · `aman@mango.local`  
**RPC password / API keys:** on Pi only — never commit
