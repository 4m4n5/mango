# Phase 0 — Pi TV box

**Status:** Complete on `mango`. Phase 1 launcher is the daily UI. **Phase 1.5 launch polish** in progress — [`PLAN.md`](PLAN.md) § Phase 1.5. Launcher dev/API: [`PHASE1.md`](PHASE1.md).

| | |
|--|--|
| **Pi** | `aman@10.0.0.174` · SSH `mango` · `~/mango` |
| **Display** | X11 + Openbox · `DISPLAY=:0` · `XAUTHORITY=/home/aman/.Xauthority` |
| **Launcher** | `http://127.0.0.1:3000/` · Chromium class `mango-launcher` |
| **Gamepad** | 8BitDo Micro · **Pro Controller** · MAC `E4:17:D8:EB:00:44` |

Checklist: [`phase0-checklist.md`](phase0-checklist.md) · Scripts: [`../scripts/README.md`](../scripts/README.md)

---

## Bring-up (Pi)

After crash or unknown state:

```bash
cd ~/mango && git pull
bash scripts/phase1/restart-mango-ui.sh
```

After **reboot** (press a pad button if BT is slow):

```bash
cd ~/mango && git pull
bash scripts/phase1/bootstrap-after-reboot.sh
```

**From Mac (agent):** `bash scripts/setup-mac-pi-ssh.sh` once, then:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && git pull && bash scripts/phase1/restart-mango-ui.sh'
```

---

## Daily use

1. Launcher tiles: **Stremio** · **YouTube**
2. **B** (bottom) = select · **⌂** = home (~instant)
3. In apps: D-pad · **B** select · **Y** back · **⌂** home

| Tile | Lands in |
|------|----------|
| Stremio | Stremio fullscreen · `mango-tv-pad.py` |
| YouTube | Kodi **Videos** window (YouTube addon), not Kodi home |

CLI bypass: `bash scripts/phase0/tv.sh stremio` · `bash scripts/phase0/tv.sh kodi`

---

## Architecture

```
Chromium launcher ← mango-tv-pad.py       serve.py :3000
        │ POST /api/launch/*
        ├─ launch-stremio.sh → phase0 + mango-tv-pad.py → Stremio
        └─ launch-kodi.sh    → phase0 + Kodi JSON-RPC    → YouTube addon
Home ⌂ → launch-launcher.sh directly (pad keeps evdev grab — no remapper handoff)
```

| Surface | Input |
|---------|--------|
| Launcher, Kodi, Stremio | `mango-tv-pad.py` → xdotool (fallback: `input-remapper` `mango-tv`) |

**TV window helpers** (`scripts/lib/`): `present-*.sh`, `mango-window.sh` (Chromium ignores `wmctrl hidden` — use z-order `below`), `mango-desktop.sh` (lxpanel), `mango-cursor.sh`.

**Pi:** `MANGO_SKIP_OVERLAY=1` — overlay Chromium caused white-screen bugs.

**YouTube:** RPC `ExecuteAddon` → poll Kodi window id **10025** (Videos). Warm start skips `killall kodi` when RPC is up. Client: `phase0/lib/kodi-rpc.sh` (Python JSON; bash params must be quoted).

**Never** use `xdotool windowactivate --sync` on Openbox (~15s hang).

### App switch contract (Phase 1.5)

| Rule | Why |
|------|-----|
| **Hide-not-kill** | `hide-media.sh` on switch — never `killall` sibling app (ghost X11 windows, slow refocus) |
| Refocus needs live process | `stremio_process_running` / Kodi RPC before hide launcher |
| Refocus fail → show launcher | Never leave wallpaper with no chrome |
| `flock` released before `&` | Child must not inherit launch lock |
| Stremio Y-back | Escape only — no `windowactivate`; `present-stremio.sh --after-back` (no F11) |
| Home warm path | Pad stays grabbed; skip remapper restart; `launch-launcher` noop if already home |

```
Tile pick → flock → hide sibling (hide-media) → present target → hide launcher below
⌂ home    → launch-launcher.sh → show launcher · hide media below · pad noop
```

---

## Gamepad (locked)

Face cluster, clockwise from **left**: **Y · X · A · B** — diagram in [`HARDWARE.md`](HARDWARE.md).

| Button | evdev | Launcher / Kodi | Stremio |
|--------|-------|-----------------|---------|
| **B** bottom | `304` | Select | Select |
| **Y** left | `308` | BackSpace | **Escape** |
| **⌂** | `316` / `311` | `launch-launcher.sh` | `launch-launcher.sh` |

Do **not** use Xbox “A = bottom confirm”. Never bare `stremio &` twice (zombie ports).

---

## YouTube (Kodi)

Keys on Pi only: `~/.config/mango/youtube-api.json` → `set-youtube-api-keys.sh`

Install/repair: [`kodi-youtube-setup.md`](kodi-youtube-setup.md) · RPC: user `mango`, port `8080` (`kodi-enable-rpc.sh`)

---

## Stremio

`bash scripts/phase0/reset-stremio.sh` · `focus-stremio.sh` if pad dead · `kill-stremio.sh` for zombies

Log: `/tmp/mango-tv-pad.log`

---

## Scripts (index)

| Path | Purpose |
|------|---------|
| `phase1/restart-mango-ui.sh` | **Bring-up** after crash |
| `phase1/bootstrap-after-reboot.sh` | **Bring-up** after reboot |
| `launch-launcher.sh` | Home |
| `launch-stremio.sh` / `launch-kodi.sh` | API wrappers (refocus + hide-not-kill) |
| `lib/hide-media.sh` | Stack media below without kill |
| `diag/alpha-test.sh` | Couch session logging |
| `phase0/tv.sh` | CLI launch |
| `pi-exec.sh` | Mac → Pi |

Phase 0 detail: [`../scripts/phase0/README.md`](../scripts/phase0/README.md)

---

## Deploy (Mac → Pi)

```bash
bash scripts/pi-exec.sh 'cd ~/mango && git pull'    # after commit
rsync -avR scripts/ aman@mango:~/mango/             # fast iterate
```

Never commit: `keys/`, `youtube-api.json`, Kodi RPC password.

---

## Verification

```bash
bash scripts/verify-tv.sh
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

**Health:** `input_remapper: tv_pad` is healthy (pad owns evdev). `inactive` fails verify. Kodi RPC errors are non-fatal when Kodi is idle.

**Couch harness:**

```bash
bash scripts/diag/alpha-test.sh              # Pi
bash scripts/diag/fetch-session.sh           # Mac — pull ~/.cache/mango/diag/sessions/
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Blank / stuck UI | `restart-mango-ui.sh` |
| Launcher tiny / behind app | `scripts/lib/present-launcher.sh` |
| ⌂ hang / busy | Orphan `input-remapper-reader-service` held `launch-launcher.lock` — `ir_kill_readers` + pull latest |
| Pad bridge EBUSY | Kill orphan readers before bridge start (`ir_stop_service`) |
| Y goes home in Stremio | Remove global Openbox Escape→launcher (`install-openbox-stremio-tv.sh`) |
| ⌂ dead in Kodi | Home must be Control+Alt+m not F12/Super+h — rerun `map-pro-controller.sh` |
| YouTube → Kodi home | `kodi-rpc.sh` quoted JSON; poll window 10025 |
| Stremio pad dead | `reset-stremio.sh` |
| Y-back white hang in Stremio | Pad sends Escape + `present-stremio.sh --after-back` (delayed, no F11 toggle) |
| lxpanel flash | `mango-desktop.sh hide` |
| Kodi pad dead | `map-pro-controller.sh` |
| Cursor visible | `sudo apt install -y unclutter-xfixes` · `install-tv-cursor.sh` |
| SSH threading traceback | Harmless Py3.13 + input-remapper (`lib/irctl.sh`) |
| Wallpaper, no launcher | Refocus failed after hide — pull latest `launch-kodi.sh` / `launch-stremio.sh` (restore launcher on fail) |
| Stremio won't reopen after Kodi | Was `killall stremio` — must use `hide-media.sh stremio` |
| Double Y-back in title | Remove `windowactivate` before Escape in pad |
| `launch-launcher` 5–8 s | Pad restart on every home — use warm noop path |
| Watchdog mid-couch | Health must accept `tv_pad` |
| `flock: Resource temporarily unavailable` | Orphan child held lock — kill stale launch scripts |

**Implementer pitfalls:** (1) bash `params="${2-}"` not `params=${2:-{}}` for JSON-RPC. (2) Chromium: stack media `above`, launcher `below`. (3) Pad bridge needs passwordless sudo for evdev.

---

## First-time Pi

1. Imager → Pi 5 → Pi OS Desktop 64-bit → hostname `mango`, SSH on.
2. `git clone https://github.com/4m4n5/mango.git`
3. `bash scripts/phase0/bootstrap.sh` · `switch-to-x11.sh` · reboot
4. `setup-8bitdo-bt.sh` · pair Micro (START+Y)
5. [`kodi-youtube-setup.md`](kodi-youtube-setup.md) · `install-stremio.sh`
6. `bash scripts/phase1/install-openbox-autostart.sh`
7. `bash scripts/phase1/bootstrap-after-reboot.sh`
