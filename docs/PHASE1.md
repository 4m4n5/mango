# Phase 1 — UI shell

**Status:** Complete on Pi (`mango`, 2026-06). **Next:** Phase 1.5 launch polish — [`PLAN.md`](PLAN.md) § Phase 1.5.  
**Ops:** [`PHASE0.md`](PHASE0.md).

## Built

| Path | Purpose |
|------|---------|
| `src/launcher/` | Tile UI at `:3000` (Vite + vanilla TS) |
| `src/overlay/` | Historical badge app — removed from native branch runtime in N0 |
| `src/mango-ui-server/serve.py` | Static server + launch API + health |
| `scripts/launch-*.sh` | Refocus/cold launch, hide launcher, TV present |
| `scripts/phase1/start-mango-ui.sh` | Server + Chromium kiosk |
| `scripts/diag/` | Couch-test session logging |

## API

| Method | Path | Script / notes |
|--------|------|----------------|
| `GET` | `/api/info` | hostname, IP, ports |
| `GET` | `/api/health` | launcher_dist, chromium, input path, openbox, kodi_rpc |
| `POST` | `/api/launch/stremio` | `launch-stremio.sh` — always queued (no debounce) |
| `POST` | `/api/launch/kodi` | `launch-kodi.sh` — always queued |
| `POST` | `/api/launch/launcher` | `launch-launcher.sh` — debounced 2 s |

**Health `input_remapper` values:** `tv_pad` (normal) · `active` (remapper fallback) · `inactive` (unhealthy).

**Verify:** `bash scripts/verify-tv.sh` · logs: `~/.cache/mango/mango.log`

**systemd (optional):** `bash scripts/phase1/install-systemd-units.sh` — `mango-ui-server` + 3‑min watchdog timer (`--repair-server` only on real outage).

Env: `DISPLAY=:0`, `XAUTHORITY=/home/aman/.Xauthority`, `HOME=/home/aman`.

## Launch behavior

| Case | Path |
|------|------|
| Stremio running | `launch-stremio.sh` → refocus (reveal + present, hide launcher) |
| Stremio dead | cold launch via `phase0/launch-stremio.sh` |
| Switch to Kodi | hide Stremio (`hide-media.sh`), **do not kill** |
| Switch to Stremio | hide Kodi, refocus or cold |
| Refocus fails | `mango-window.sh show` — restore launcher |
| ⌂ home | `launch-launcher.sh` · pad sets `MANGO_SKIP_REMAPPER=1` |
| Already on launcher | noop (~150 ms) |

**Locks:** `flock` per launch script — released before background children.

## Dev (Mac)

```bash
cd src/launcher && npm install && npm run build
python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000
cd src/launcher && npm run dev   # proxies /api → :3000
```

## Pi

```bash
cd ~/mango && git pull && bash scripts/phase1/restart-mango-ui.sh
```

Autostart: `install-openbox-autostart.sh` · optional cursor: `unclutter-xfixes`

Fast iterate (no commit): `rsync -avR scripts/ src/mango-ui-server/serve.py aman@mango:~/mango/`

## Verified on Pi

- [x] Launcher fullscreen · D-pad + B on tiles
- [x] Stremio tile → pad · YouTube tile → Kodi Videos (window 10025)
- [x] ⌂ home fast · refocus Stremio after home
- [x] `tv_pad` health · no false watchdog during couch use
- [ ] Full couch matrix C1–C6 — [`PLAN.md`](PLAN.md) Phase 1.5

## Diagnostics

```bash
bash scripts/diag/alpha-test.sh    # on Pi — couch test with logging
bash scripts/diag/fetch-session.sh # on Mac — pull session tarball
bash scripts/diag/print-runbook.sh # step list
```

## Notes

- `dist/` not in git; Pi runs `npm run build` if missing.
- Launcher client: no 2 s debounce on media tiles (refocus must always fire).
- Settings API keys UI → Phase 2.
- Historical spec: [`tasks/phase1-ui-shell.md`](tasks/phase1-ui-shell.md)
