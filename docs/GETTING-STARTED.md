# Getting started

Phase 0 on Pi 5 CanaKit. Full checklist: [`phase0-checklist.md`](phase0-checklist.md). Gamepad: [`HARDWARE.md`](HARDWARE.md). Kodi: [`kodi-youtube-setup.md`](kodi-youtube-setup.md).

## Done so far

- Pi OS Desktop 64-bit (hostname `mango`, user `aman`, SSH on)
- X11 + Openbox (`switch-to-x11.sh`)
- Kodi + Stremio installed (`bootstrap.sh`)
- **8BitDo Micro** — D-pad / **B** / **Y** in Kodi
- **Kodi + YouTube** — InputStream, addon zip, setup wizard
- **Kodi JSON-RPC** — port 8080, user `mango` (`kodi-enable-rpc.sh`, `test-kodi-rpc.sh` ✓)

## Next steps (finish Phase 0)

### 1. Stremio + gamepad

```bash
cd ~/mango && git pull
bash scripts/phase0/reset-stremio.sh
```

This kills zombie processes, starts Stremio, starts the **pad bridge**, and focuses the window.

On the TV: log in, install addons, play something — **D-pad / B / Y** (Stremio must be the focused window).

If the controller does nothing:

```bash
bash scripts/phase0/focus-stremio.sh
```

Kodi still uses input-remapper — run `bash scripts/phase0/launch-kodi.sh` (stops the Stremio bridge).

### 2. Kodi YouTube playback

```bash
bash scripts/phase0/launch-kodi.sh
```

Open **YouTube** addon → play one full video with gamepad only.

### 3. Sign-off

- [ ] Stremio: login, addons, playback with gamepad
- [ ] Kodi YouTube: one video with gamepad
- [ ] Both apps stable **30+ minutes** on the couch

When those pass → **Phase 1** (boot launcher). See [`docs/PLAN.md`](PLAN.md) § Phase 1.

## Daily commands

```bash
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/launch-kodi.sh
bash scripts/phase0/launch-stremio.sh
```

## Kodi RPC (reference)

```bash
bash scripts/phase0/test-kodi-rpc.sh mango '<password>'
```

Password is set on the Pi only (`kodi-enable-rpc.sh`) — never commit it.

## First-time flash (reference)

1. Imager → Pi 5 → Pi OS Desktop 64-bit → hostname `mango`, SSH on.
2. SD in Pi underside slot, HDMI, power.
3. Mac: `ssh aman@mango.local` · `git clone https://github.com/4m4n5/mango.git`
