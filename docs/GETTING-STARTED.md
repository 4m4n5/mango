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
killall kodi 2>/dev/null || true
bash scripts/phase0/launch-stremio.sh
```

On the TV:

1. Log in (or create account)
2. **Addons** → install e.g. **Torrentio** (follow in-app prompts)
3. Search a title → play something
4. Confirm **D-pad / B / Y** work like Kodi

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
