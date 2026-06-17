# Getting started

Phase 0 on Pi 5 CanaKit. Full checklist: [`phase0-checklist.md`](phase0-checklist.md). Gamepad: [`HARDWARE.md`](HARDWARE.md). Kodi: [`kodi-youtube-setup.md`](kodi-youtube-setup.md).

## Done so far

- Pi OS Desktop 64-bit (hostname `mango`, user `aman`, SSH on)
- X11 + Openbox (`switch-to-x11.sh`)
- Kodi + Stremio installed (`bootstrap.sh`)
- **8BitDo Micro** — D-pad / **B** / **Y** in Kodi ✓
- **Kodi + YouTube** — InputStream, addon zip, setup wizard
- **Kodi JSON-RPC** — port 8080, user `mango` (`kodi-enable-rpc.sh`, `test-kodi-rpc.sh` ✓)
- **Stremio** — installed; launch/reset scripts + pad bridge in repo (`stremio-pad-bridge.py`)

## Blocked (waiting on hardware)

**Stremio gamepad** — xdotool evdev bridge runs but D-pad/B/Y not confirmed working on device. **USB mouse on order** — use it first to log into Stremio, install addons, and verify playback. Revisit pad bridge after mouse setup.

## Next steps (finish Phase 0)

### 1. Kodi YouTube playback ← **do this now**

```bash
cd ~/mango && git pull
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/launch-kodi.sh
```

Open **YouTube** addon → play one full video with **gamepad only** (D-pad / B / Y).

If **all lists error**, you need personal Google API keys first — see [`kodi-youtube-setup.md`](kodi-youtube-setup.md) Part 4 (`diagnose-kodi-youtube.sh` on the Pi).

### 2. Stremio setup (when mouse arrives)

```bash
bash scripts/phase0/reset-stremio.sh
```

Use the **mouse** to log in, install addons, play something. Then retry gamepad:

```bash
bash scripts/phase0/focus-stremio.sh
tail -20 /tmp/mango-stremio-pad-bridge.log
```

Kodi still uses input-remapper — run `launch-kodi.sh` (stops the Stremio bridge).

### 3. Sign-off

- [ ] Kodi YouTube: one video with gamepad
- [ ] Stremio: login + addons + playback (mouse OK for now)
- [ ] Stremio gamepad (after mouse setup / bridge debug)
- [ ] Both apps stable **30+ minutes** on the couch

When those pass → **Phase 1** (boot launcher). See [`docs/PLAN.md`](PLAN.md) § Phase 1.

## Daily commands

```bash
bluetoothctl connect E4:17:D8:EB:00:44
bash scripts/phase0/launch-kodi.sh
bash scripts/phase0/reset-stremio.sh   # Stremio + pad bridge
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
