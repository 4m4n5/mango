# Phase 0 — Pi TV box runbook

**Status (2026-06):** Bring-up **complete** on device `mango` — Kodi + YouTube + Stremio, 8BitDo Micro in both apps. Remaining: optional stability soak, phone-on-LAN check, then **Phase 1** launcher.

| | |
|--|--|
| **Pi** | `aman@mango.local` · `10.0.0.174` · user `aman` |
| **Repo on Pi** | `~/mango` (`git clone https://github.com/4m4n5/mango.git`) |
| **Display** | X11 + Openbox (not Wayland) |
| **Gamepad** | 8BitDo Micro · BT MAC `E4:17:D8:EB:00:44` · Switch mode → Linux name **Pro Controller** |

Checklist: [`phase0-checklist.md`](phase0-checklist.md) · Scripts: [`../scripts/phase0/README.md`](../scripts/phase0/README.md)

---

## Daily use (one command)

```bash
cd ~/mango && git pull
bash scripts/phase0/tv.sh kodi      # YouTube via Kodi
bash scripts/phase0/tv.sh stremio   # Stremio
```

`tv.sh` connects the pad, then launches the app with the correct gamepad stack.

---

## Gamepad layout (canonical)

Face buttons on the **right cluster**, clockwise from **left**: **Y · X · A · B**

```
      X
    Y   A
      B
```

| Button | Position | evdev | Action |
|--------|----------|-------|--------|
| D-pad | left side | ABS_X/Y | Navigate |
| **Y** | left | `308` | **Back** |
| **B** | bottom | `304` | **Select** |
| X, A | top, right | `307`, `305` | unmapped |

**Do not** assume Xbox naming (A=bottom confirm). On this pad **B is bottom** = select.

---

## Two gamepad paths (do not mix)

| App | Mechanism | Why |
|-----|-----------|-----|
| **Kodi** | `input-remapper` preset `mango-tv` | Kodi accepts uinput keyboard |
| **Stremio** | `stremio-pad-bridge.py` → xdotool | Qt WebEngine ignores remapper |

**Stremio extras:** bridge runs as `sudo` (evdev grab), hides `/dev/input/js*` so Stremio cannot use native gamepad (which would map A=select). See `lib/gamepad-js.sh`.

**Switching apps:** always use `tv.sh` / `launch-kodi.sh` / `reset-stremio.sh` — never bare `stremio &` twice (zombie ports).

---

## YouTube (Kodi)

Requires **personal Google API keys** (lists fail without them).

```bash
# Keys live on Pi only — never commit
nano ~/.config/mango/youtube-api.json   # api_key, client_id, client_secret
bash scripts/phase0/set-youtube-api-keys.sh
bash scripts/phase0/tv.sh kodi
# YouTube addon → Sign in (device code on Mac)
```

Full install/repair: [`kodi-youtube-setup.md`](kodi-youtube-setup.md)

**Kodi JSON-RPC:** user `mango`, port `8080`, password on Pi only (`kodi-enable-rpc.sh`, `test-kodi-rpc.sh`).

---

## Stremio

```bash
bash scripts/phase0/tv.sh stremio
```

Log in / addons with mouse if needed. Gamepad: D-pad · **B** select · **Y** back (Stremio window must be focused).

If pad dead: `bash scripts/phase0/focus-stremio.sh` · log: `/tmp/mango-stremio-pad-bridge.log`

Clean restart: `bash scripts/phase0/reset-stremio.sh` (kills zombies on ports 11470/12470/11471/7000).

---

## After reboot

```bash
# Press any button on the pad, then:
bash scripts/phase0/connect-gamepad.sh
bash scripts/phase0/gamepad-fresh-start.sh   # if /dev/input/event* missing
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| D-pad dead in Kodi | `bash scripts/phase0/map-pro-controller.sh` → `tv.sh kodi` |
| Stremio pad dead | `reset-stremio.sh` → `focus-stremio.sh` |
| Wrong face buttons | Re-read layout above; `git pull` (B=`304`, Y=`308`) |
| Stremio A selects not B | Native js not hidden — `reset-stremio.sh` |
| YouTube lists error | API keys — `diagnose-kodi-youtube.sh`, `kodi-youtube-setup.md` |
| YouTube sign-in loops | `reset-youtube-login.sh` |
| Stremio won't start / ports busy | `kill-stremio.sh` then `reset-stremio.sh` |
| SSH threading tracebacks | Harmless Py3.13 + input-remapper; suppressed via `lib/irctl.sh` |

---

## First-time Pi (reference)

1. Raspberry Pi Imager → Pi 5 → **Pi OS Desktop 64-bit** → hostname `mango`, SSH on.
2. `ssh aman@mango.local` · `git clone https://github.com/4m4n5/mango.git`
3. `bash scripts/phase0/bootstrap.sh` · `switch-to-x11.sh` · reboot
4. `setup-8bitdo-bt.sh` · pair Micro (START+Y)
5. Follow [`kodi-youtube-setup.md`](kodi-youtube-setup.md) · `install-stremio.sh`
6. Verify with `tv.sh kodi` and `tv.sh stremio`

---

## Phase 1 gate

Phase 0 sign-off when checklist green → boot launcher in `src/`. See [`PLAN.md`](PLAN.md) § Phase 1.
