# Phase 0 — Pi TV box

> **Native branch (`feat/native-experience`):** Daily stack is **`mango-stack.sh`** — launcher + voice, **no** Stremio/Kodi at idle. See [FOREGROUND.md](FOREGROUND.md) and [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md). Sections below marked **legacy** describe the Phase 0–2 tile → Stremio/Kodi flow (still used for fallback).

**Status:** Complete · pad + launcher + voice foundation shipped  
**Pi:** `aman@10.0.0.174` · SSH `mango` · `~/mango`

| | |
|--|--|
| **Display** | X11 + Openbox · `DISPLAY=:0` |
| **Launcher** | `http://127.0.0.1:3000/` · Chromium `mango-launcher` |
| **Gamepad** | 8BitDo Micro · **Pro Controller** · MAC `E4:17:D8:EB:00:44` |
| **Stack** | `bash scripts/mango-stack.sh restart` |

Checklist (historical): [phase0-checklist.md](phase0-checklist.md) · Scripts: [../scripts/README.md](../scripts/README.md)

---

## Bring-up (Pi)

**After crash or unknown state:**

```bash
cd ~/mango && git pull
bash scripts/mango-stack.sh restart
# or UI only:
bash scripts/phase1/restart-mango-ui.sh
```

**After reboot** (press a pad button if BT is slow):

```bash
cd ~/mango && git pull
bash scripts/phase1/bootstrap-after-reboot.sh
```

**From Mac:**

```bash
bash scripts/pi-exec.sh 'cd ~/mango && git pull && bash scripts/mango-stack.sh restart'
```

**Gates before couch test:**

```bash
bash scripts/phase-n0/gate-n0.sh
bash scripts/phase-n1/check-n1-prereqs.sh   # N1 addons + mpv
```

---

## Daily use — native branch

1. TV shows **mango launcher** (catalog placeholder until N2)
2. **B** select · **Y** back · **⌂** home · D-pad navigate
3. Phone **PTT** when `MANGO_VOICE=1` — HUD on launcher
4. Playback (N1+): `catalog-service` → **mpv** fullscreen · **⌂** returns home

| Control | Action |
|---------|--------|
| D-pad | Move focus |
| **B** (`304`) | Select |
| **Y** (`308`) | Back |
| **⌂** (`316`) | Home → launcher |

**Fallback only** (opt-in env): `MANGO_FALLBACK_STREMIO=1` · `MANGO_LEGACY_YOUTUBE=1`

---

## Daily use — legacy (main / Phase 1.5)

1. Launcher tiles: **Stremio** · **YouTube**
2. **B** select · **⌂** home
3. CLI: `bash scripts/phase0/tv.sh stremio` · `tv.sh kodi`

| Tile | Lands in |
|------|----------|
| Stremio | Stremio fullscreen |
| YouTube | Kodi Videos window (YouTube addon) |

---

## Architecture

### Native foreground (`feat/native-experience`)

```
mango-stack.sh
  ├── serve.py :3000 + Chromium launcher
  ├── mango-tv-pad.py  (launcher | mpv | fallback_stremio)
  ├── orchestrator :8765 WSS + :8766 loopback (voice)
  ├── companion :3001 (phone)
  └── catalog-service :3020 (N1+) → mpv
```

See [FOREGROUND.md](FOREGROUND.md).

### Legacy app switching (Phase 1.5)

```
Chromium launcher ← mango-tv-pad.py       serve.py :3000
        │ POST /api/launch/*
        ├─ launch-stremio.sh → Stremio
        └─ launch-kodi.sh    → Kodi / YouTube addon
⌂ → launch-launcher.sh
```

| Rule | Why |
|------|-----|
| **Hide-not-kill** | Never `killall` sibling app on switch |
| Refocus fail → show launcher | No wallpaper |
| Pad stays grabbed on home | Sub-300 ms warm path |

---

## Gamepad (locked)

Diagram: [HARDWARE.md](HARDWARE.md)

| Button | evdev | Launcher | mpv (N1+) | Stremio fallback |
|--------|-------|----------|-----------|------------------|
| **B** | `304` | Select | Select / pause | Select |
| **Y** | `308` | Back | Back / stop | Escape |
| **⌂** | `316` | Home (noop if already home) | Stop mpv → launcher | Home |

Do **not** change evdev codes without approval.

---

## YouTube (Kodi) — legacy fallback

[`kodi-youtube-setup.md`](kodi-youtube-setup.md) · RPC user `mango`, port `8080`

---

## Stremio — legacy fallback

`scripts/fallback/launch-stremio.sh` · `reset-stremio.sh` · Pad log: `/tmp/mango-tv-pad.log`

**N1 addons on Pi:** `/etc/mango/stremio-export.json` — `bash scripts/phase-n1/setup-stremio-export.sh --from-local`

---

## Key scripts

| Script | When |
|--------|------|
| **`mango-stack.sh`** | Native daily start/stop/restart |
| **`phase1/bootstrap-after-reboot.sh`** | After Pi reboot |
| **`phase1/restart-mango-ui.sh`** | UI-only recovery |
| **`phase-n0/gate-n0.sh`** | Automated base gate |
| **`phase-n1/check-n1-prereqs.sh`** | mpv + addons ready |
| **`pi-pre-couch-gate.sh`** | Pre-couch automation |
| **`launch-launcher.sh`** | Home |

---

## Deploy (Mac → Pi)

```bash
git push   # Mac
bash scripts/pi-exec.sh 'cd ~/mango && git pull && bash scripts/mango-stack.sh restart'
```

**Git only** for deploy. Never commit: `keys/`, API keys, Stremio export.

---

## Verification

```bash
bash scripts/verify-tv.sh
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
bash scripts/phase2/verify-voice-ready.sh   # when MANGO_VOICE=1
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Blank / stuck UI | `mango-stack.sh restart` or `restart-mango-ui.sh` |
| Pad dead | `systemctl --user restart mango-tv-pad.service` |
| Controller works in UI but not home | Pull latest pad fix (`foreground_app` launcher) |
| ⌂ hang | Kill orphan `input-remapper-reader-service` |
| Wallpaper, no launcher | Refocus failed — `launch-launcher.sh` |
| Voice HUD missing | `verify-voice-ready.sh` · loopback `:8766` |
| After reboot, no pad | `bootstrap-after-reboot.sh` · wake Micro · BT connect |

Full legacy table: see git history or `main` branch PHASE0.md if needed.

---

## First-time Pi

1. Imager → Pi 5 → Pi OS Desktop 64-bit · hostname `mango`
2. `git clone https://github.com/4m4n5/mango.git` · `feat/native-experience`
3. `bash scripts/phase0/bootstrap.sh` · `switch-to-x11.sh` · reboot
4. `setup-8bitdo-bt.sh` · pair Micro (START+Y)
5. `bash scripts/phase-n1/install-n1-prereqs.sh` (mpv, socat)
6. `bash scripts/phase-n1/setup-stremio-export.sh --from-local`
7. `bash scripts/phase1/install-openbox-autostart.sh`
8. `bash scripts/phase1/bootstrap-after-reboot.sh`
