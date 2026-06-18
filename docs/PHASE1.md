# Phase 1 — UI shell

**Status:** implemented and locally verified; Pi verification still required on `aman@mango.local`.

Phase 1 adds the TV launcher shell around the working Phase 0 media stack. It does not add voice, companion controls, orchestration, API-key forms, or new gamepad mappings.

## What was built

| Path | Purpose |
|------|---------|
| `src/launcher/` | Vite + vanilla TypeScript launcher served at `http://127.0.0.1:3000/` |
| `src/overlay/` | Vite + vanilla TypeScript idle badge served at `http://127.0.0.1:3000/overlay/` |
| `src/mango-ui-server/` | Stdlib-only Python static server and fixed launch API |
| `scripts/launch-stremio.sh` | Thin wrapper around `scripts/phase0/reset-stremio.sh` |
| `scripts/launch-kodi.sh` | Thin wrapper around `scripts/phase0/launch-kodi.sh` |
| `scripts/launch-launcher.sh` | Returns focus to the Chromium launcher and restores the launcher remapper |
| `scripts/phase1/start-mango-ui.sh` | Starts the server, launcher kiosk, and overlay window |
| `scripts/phase1/install-openbox-autostart.sh` | Installs Openbox autostart and Escape-to-launcher keybind |

The overlay is served from the same local Python server under `/overlay/` instead of a separate `3002` process. The companion placeholder remains `https://<pi-ip>:3001`.

## Runtime contract

The browser launcher only emits keyboard-style actions:

- Arrow keys move tile focus with wraparound.
- `Enter` / `Space` activates the focused tile.
- Settings is an in-app subview.
- Stremio posts to `/api/launch/stremio`.
- YouTube posts to `/api/launch/kodi`.

The Python server binds to `127.0.0.1` only and exposes:

| Method | Path | Result |
|--------|------|--------|
| `GET` | `/` | Launcher build |
| `GET` | `/overlay/` | Overlay build |
| `GET` | `/api/info` | Hostname, IP, launcher port, companion port |
| `POST` | `/api/launch/stremio` | Runs `scripts/launch-stremio.sh` in background |
| `POST` | `/api/launch/kodi` | Runs `scripts/launch-kodi.sh` in background |
| `POST` | `/api/launch/launcher` | Runs `scripts/launch-launcher.sh` in background |

Launch scripts set:

```bash
DISPLAY=:0
XAUTHORITY=/home/aman/.Xauthority
HOME=/home/aman
```

## Dev workflow on Mac

Install and build both UI apps:

```bash
cd src/launcher && npm install && npm run build
cd ../overlay && npm install && npm run build
```

Run the Python server from the repo root:

```bash
python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000
curl http://127.0.0.1:3000/api/info
curl -X POST http://127.0.0.1:3000/api/launch/stremio
```

For launcher UI iteration:

```bash
cd src/launcher
npm run dev
```

The launcher dev server proxies `/api` to `127.0.0.1:3000`, so keep the Python server running in another terminal when testing launch buttons.

Overlay-only iteration:

```bash
cd src/overlay
npm run dev
```

## Pi deploy

From the Pi:

```bash
cd ~/mango
git pull
sudo apt install -y nodejs npm wmctrl xdotool
sudo apt install -y chromium-browser || sudo apt install -y chromium
bash scripts/phase1/start-mango-ui.sh
```

`start-mango-ui.sh` builds `src/launcher/dist/` and `src/overlay/dist/` when missing, starts the Python server on port `3000`, opens the launcher in Chromium kiosk mode, opens the overlay window, and restores the launcher input-remapper.

For login autostart:

```bash
cd ~/mango
bash scripts/phase1/install-openbox-autostart.sh
openbox --restart
```

If `openbox --restart` does not pick up the autostart or keybind, reboot the Pi.

## Verification checklist

### Local dev machine

- [x] `npm run build` succeeds in `src/launcher`.
- [x] `npm run build` succeeds in `src/overlay`.
- [x] `python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000` starts.
- [x] `curl http://127.0.0.1:3000/api/info` returns HTTP 200 with hostname, IP, launcher port, and companion port.
- [x] `curl http://127.0.0.1:3000/` returns HTTP 200 text/html.
- [x] `curl http://127.0.0.1:3000/overlay/` returns HTTP 200 text/html.
- [x] `curl -X POST http://127.0.0.1:3000/api/launch/stremio` returns HTTP 200 with `{"ok": true}`. The Stremio script may fail on Mac; the API response is the local check.
- [x] `bash -n` passes for Phase 1 shell scripts.
- [x] `python3 -m py_compile src/mango-ui-server/serve.py` passes.
- [x] `git diff --check` passes.

### Pi

- [ ] Launcher is visible fullscreen in Chromium.
- [ ] D-pad moves tile focus; B selects.
- [ ] Stremio tile opens Stremio through Phase 0; gamepad works.
- [ ] YouTube tile opens Kodi through Phase 0; gamepad works.
- [ ] Escape or Y returns to the launcher.
- [ ] Overlay idle badge is visible at bottom-right.
- [ ] `bash scripts/phase0/kill-stremio.sh` still works after testing.

## Notes

- Built `dist/` folders are ignored by git; the Pi start script builds them if absent.
- No secrets are used by Phase 1. YouTube API keys remain Pi-local Phase 0 state.
- API keys in the Settings UI are intentionally deferred to Phase 2.
- The Phase 0 gamepad codes remain unchanged: B is select and Y is back.
