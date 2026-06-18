# Getting started

Phase 0 on Pi 5 CanaKit. Full checklist: [`phase0-checklist.md`](phase0-checklist.md). Gamepad: [`HARDWARE.md`](HARDWARE.md). Kodi: [`kodi-youtube-setup.md`](kodi-youtube-setup.md).

## Done so far

- Pi OS Desktop 64-bit (hostname `mango`, user `aman`, SSH on)
- X11 + Openbox (`switch-to-x11.sh`)
- Kodi + Stremio installed (`bootstrap.sh`)
- **8BitDo Micro** — D-pad / **B** / **Y** in Kodi ✓
- **Kodi + YouTube** — API keys, sign-in, playback with gamepad ✓
- **Kodi JSON-RPC** — port 8080, user `mango` (`test-kodi-rpc.sh` ✓)
- **Stremio** — installed; launch/reset scripts + pad bridge in repo

## Next steps (finish Phase 0)

### 1. Stremio setup ← **do this now**

```bash
cd ~/mango && git pull
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/reset-stremio.sh
```

**Mouse:** log in, install addons (e.g. Torrentio — your choice), play something.

**Then gamepad** (D-pad / B / Y — Stremio must be focused):

```bash
bash scripts/phase0/focus-stremio.sh
tail -20 /tmp/mango-stremio-pad-bridge.log
```

Switching apps:

```bash
bash scripts/phase0/launch-kodi.sh      # Kodi + remapper (stops Stremio bridge)
bash scripts/phase0/reset-stremio.sh    # Stremio + pad bridge
```

### 2. Sign-off

- [x] Kodi YouTube: playback with gamepad
- [ ] Stremio: login + addons + playback
- [ ] Stremio gamepad (D-pad / B / Y)
- [ ] Both apps stable **30+ minutes** on the couch

When those pass → **Phase 1** (boot launcher). See [`docs/PLAN.md`](PLAN.md) § Phase 1.

## Daily commands

```bash
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/launch-kodi.sh
bash scripts/phase0/reset-stremio.sh
```

## Kodi RPC (reference)

```bash
bash scripts/phase0/test-kodi-rpc.sh mango '<password>'
```

Password is set on the Pi only — never commit it.

## First-time flash (reference)

1. Imager → Pi 5 → Pi OS Desktop 64-bit → hostname `mango`, SSH on.
2. SD in Pi underside slot, HDMI, power.
3. Mac: `ssh aman@mango.local` · `git clone https://github.com/4m4n5/mango.git`
