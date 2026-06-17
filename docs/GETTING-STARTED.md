# Getting started

Phase 0 on Pi 5 CanaKit. Full checklist: [`phase0-checklist.md`](phase0-checklist.md). Gamepad details: [`HARDWARE.md`](HARDWARE.md).

## Done so far

- Pi OS Desktop 64-bit (hostname `mango`, user `aman`, SSH on)
- X11 + Openbox (`switch-to-x11.sh`)
- Kodi + Stremio installed (`bootstrap.sh`)
- **8BitDo Micro** paired over Bluetooth — **Kodi navigation works**
  - D-pad = move · **B** = select · **Y** = back
  - Launch: `bash scripts/phase0/launch-kodi.sh`

## Next steps (finish Phase 0)

### 1. Stremio + gamepad

On the Pi:

```bash
cd ~/mango && git pull
bash scripts/phase0/launch-stremio.sh
```

On the TV: log in, install addons, play something. Confirm **D-pad / B / Y** work the same as Kodi.

### 2. Kodi YouTube + JSON-RPC

**Full walkthrough:** [`docs/kodi-youtube-setup.md`](kodi-youtube-setup.md)

Quick start on the Pi:

```bash
cd ~/mango && git pull
bash scripts/phase0/reset-kodi-youtube.sh   # clean + download addon zip
bash scripts/phase0/launch-kodi.sh
```

Then on the TV: enable **Unknown sources** → **Install from zip** → `~/mango/downloads/plugin.video.youtube-7.4.3.zip` → run YouTube setup wizard → enable JSON-RPC (port 8080).

```bash
bash scripts/phase0/test-kodi-rpc.sh <username> <password>
```

### 3. Sign-off

- [ ] Stremio: login, addons, playback with gamepad
- [ ] Kodi YouTube plays with gamepad
- [ ] `test-kodi-rpc.sh` passes
- [ ] Kodi + Stremio stable 30+ minutes

When those pass, Phase 0 is done → Phase 1 (launcher / app picker).

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
