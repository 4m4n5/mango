# Phase 1 — UI shell

**Status:** Verified on Pi (`mango`, 2026-06). **Ops:** [`PHASE0.md`](PHASE0.md).

## Built

| Path | Purpose |
|------|---------|
| `src/launcher/` | Tile UI at `:3000` |
| `src/overlay/` | Idle badge at `/overlay/` (off on Pi: `MANGO_SKIP_OVERLAY=1`) |
| `src/mango-ui-server/serve.py` | Static server + launch API |
| `scripts/launch-*.sh` | API wrappers — hide launcher, TV present |
| `scripts/phase1/start-mango-ui.sh` | Server + Chromium kiosk |

## API

| Method | Path | Script |
|--------|------|--------|
| `GET` | `/api/info` | — |
| `GET` | `/api/health` | launcher, chromium, remapper, openbox |
| `POST` | `/api/launch/stremio` | `launch-stremio.sh` |
| `POST` | `/api/launch/kodi` | `launch-kodi.sh` |
| `POST` | `/api/launch/launcher` | `launch-launcher.sh` |

**Verify:** `bash scripts/verify-tv.sh` · logs: `~/.cache/mango/mango.log`

**systemd (optional):** `bash scripts/phase1/install-systemd-units.sh` — `mango-ui-server` + 3‑min watchdog timer

Env: `DISPLAY=:0`, `XAUTHORITY=/home/aman/.Xauthority`, `HOME=/home/aman`.

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

## Verified on Pi

- [x] Launcher fullscreen · D-pad + B on tiles
- [x] Stremio tile → pad bridge · YouTube tile → Kodi Videos (addon)
- [x] ⌂ home fast · `kill-stremio.sh` works

## Notes

- `dist/` not in git; Pi builds if missing.
- Settings API keys UI → Phase 2.
- Spec: [`tasks/phase1-ui-shell.md`](tasks/phase1-ui-shell.md)
