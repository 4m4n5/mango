# Getting started

Phase 0 on Pi 5 CanaKit. Full checklist: [`phase0-checklist.md`](phase0-checklist.md). Gamepad: [`HARDWARE.md`](HARDWARE.md). Kodi YouTube: [`kodi-youtube-setup.md`](kodi-youtube-setup.md).

## Done so far

- Pi OS Desktop 64-bit (hostname `mango`, user `aman`, SSH on)
- X11 + Openbox (`switch-to-x11.sh`)
- Kodi + Stremio installed (`bootstrap.sh`)
- **8BitDo Micro** — Bluetooth paired, preset `mango-tv`
  - D-pad = move · **B** = select · **Y** = back
- **Kodi + YouTube** — InputStream Adaptive (`install-kodi-inputstream.sh`), addon from zip, setup wizard
- Gamepad navigation verified in Kodi

## Next steps (finish Phase 0)

### 1. Kodi JSON-RPC

Enables voice control later. In Kodi (Expert settings):

**Settings → Services → Control** → **Allow remote control via HTTP** ON · port **8080** · set username + password

```bash
bash scripts/phase0/test-kodi-rpc.sh <username> <password>
```

Expect: `✓ Kodi JSON-RPC OK`

### 2. Stremio + gamepad

```bash
cd ~/mango && git pull
bash scripts/phase0/launch-stremio.sh
```

On the TV: log in, install addons (e.g. Torrentio), play something. Confirm **D-pad / B / Y** match Kodi.

### 3. Sign-off

- [ ] YouTube plays a video in Kodi with gamepad
- [ ] `test-kodi-rpc.sh` passes
- [ ] Stremio: login, addons, playback with gamepad
- [ ] Both apps stable 30+ minutes on the couch

When those pass → **Phase 1** (boot launcher / app picker). See [`docs/PLAN.md`](PLAN.md).

## Daily commands

```bash
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/launch-kodi.sh
bash scripts/phase0/launch-stremio.sh
```

## First-time flash (reference)

1. Imager → Pi 5 → Pi OS Desktop 64-bit → hostname `mango`, SSH on.
2. SD in Pi underside slot, HDMI, power.
3. Mac: `ssh aman@mango.local` · `git clone https://github.com/4m4n5/mango.git`
