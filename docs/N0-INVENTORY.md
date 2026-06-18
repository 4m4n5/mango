# Phase N0 inventory

**Branch:** `feat/native-experience`  
**Objective:** remove default-runtime bloat before native `mpv` work.

## Before — Pi observation

Captured over SSH on 2026-06-18 before N0 implementation. The Pi checkout was
still on `main` (`## main...origin/main`), which matches the Phase 0-2 shipped
stack rather than the native branch.

| Area | Before |
|------|--------|
| Chromium app instances | 2: `mango-launcher` and `mango-overlay` |
| Overlay Chromium | running (`--class=mango-overlay --app=http://127.0.0.1:3000/overlay/`) |
| Stremio / Kodi / mpv | no matching processes in inventory capture |
| UI server | `serve.py` on `127.0.0.1:3000` |
| Companion | HTTPS server on `0.0.0.0:3001` |
| Orchestrator | one process, but dual listeners on `0.0.0.0:8765` and `127.0.0.1:8766` |
| tmux | `mango-orch`, `mango-companion` |
| systemd user units | `mango-tv-pad` active; `mango-ui-server` active; watchdog timer active |
| Memory | `7.9Gi` total, `1.0Gi` used, `3.4Gi` free, `6.9Gi` available |
| Temperature | `52.7'C` |

Before top offenders were the two Chromium app roots plus their helper
processes. The overlay root used about 227 MB RSS, and the launcher root used
about 244 MB RSS in the `ps aux --sort=-%mem | head -30` sample.

## Code Inventory

| Component | Path | N0 verdict |
|-----------|------|------------|
| Launcher | `src/launcher/` | Keep; remove mock catalog production path |
| Overlay app | `src/overlay/` | Deleted from build/start path; `/overlay/` returns 410 |
| Launcher HUD | `src/launcher/src/voice-hud.ts` | Canonical TV voice HUD |
| Shared HUD | `src/shared/voiceHud.ts` | Deleted; launcher owns HUD |
| Orchestrator | `src/orchestrator/` | Keep; one uvicorn listener on `:8765` |
| Companion | `src/companion/` | Keep |
| UI server | `src/mango-ui-server/serve.py` | Keep; expose fallback flags; retire overlay route |
| Mock catalog | `src/launcher/src/mock-catalog.ts` | Deleted |
| Fallback apps | `scripts/fallback/` | Explicit opt-in wrappers only |

## After — automated metrics

To be filled after git deploy to the Pi:

```bash
cd ~/mango
bash scripts/mango-stack.sh restart
bash scripts/diag/baseline-metrics.sh --label after-n0 --print-json
bash scripts/phase-n0/gate-n0.sh
```

| Metric | After |
|--------|-------|
| Baseline JSON | TBD |
| Chromium app instances | TBD |
| Overlay Chromium | TBD |
| Stremio / Kodi / mpv idle count | TBD |
| Available memory | TBD |
| N0 gate | TBD |
| Screenshot path | TBD |

## N0-C2 couch note

Pending after automated gate:

1. Cold stack restart.
2. Launcher visible; no wallpaper.
3. Home from launcher is a no-op.
4. Settings → Back → home.
5. Phone PTT one turn; HUD appears on TV.
6. Stremio/Kodi do not appear during the flow.
