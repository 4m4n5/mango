# Phase 1 — UI shell

> **Native context:** Launcher is the **TV chrome** for browse/rails (N2+). It no longer cold-starts Stremio/Kodi on the default home screen (N0). Tiles for fallback apps are opt-in only.

**Status:** Complete · foundation for native UX  
**Ops:** [PHASE0.md](PHASE0.md) · **Foreground:** [FOREGROUND.md](FOREGROUND.md)

---

## Built

| Path | Purpose |
|------|---------|
| `src/launcher/` | TV UI at `:3000` (Vite + TS) · embedded voice HUD |
| `src/mango-ui-server/serve.py` | Static server + health + launch API |
| `scripts/launch-*.sh` | Home + fallback app wrappers |
| `scripts/phase1/start-mango-ui.sh` | Server + Chromium kiosk |
| `scripts/diag/` | Couch session logging |

`src/overlay/` — **removed** in N0 (launcher HUD is canonical).

---

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | launcher, chromium, pad/remapper, kodi_rpc |
| `GET` | `/api/info` | hostname, IP, ports |
| `POST` | `/api/launch/launcher` | Home · debounced 2 s |
| `POST` | `/api/launch/stremio` | Fallback only (`MANGO_FALLBACK_STREMIO`) |
| `POST` | `/api/launch/kodi` | Legacy YouTube (`MANGO_LEGACY_YOUTUBE`) |

**N2+:** launcher will call `catalog-service` `:3020` for rails/play — not these launch endpoints for daily use.

**Verify:** `bash scripts/verify-tv.sh` · logs: `~/.cache/mango/mango.log`

---

## Launch behavior (legacy fallback)

| Case | Path |
|------|------|
| Refocus Stremio | `launch-stremio.sh` → present + hide launcher |
| Switch apps | `hide-media.sh` — **never kill** sibling |
| Refocus fails | Restore launcher — no wallpaper |
| ⌂ home | `launch-launcher.sh` · pad `MANGO_SKIP_REMAPPER=1` |

---

## Dev (Mac)

```bash
cd src/launcher && npm install && npm run build
python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000
```

## Pi

```bash
cd ~/mango && git pull && bash scripts/mango-stack.sh restart
```

---

## Diagnostics

```bash
bash scripts/diag/alpha-test.sh
bash scripts/diag/fetch-session.sh    # Mac
```

Historical spec: [tasks/phase1-ui-shell.md](tasks/phase1-ui-shell.md)
