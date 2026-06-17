# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md)

Read before implementing. **Phase 0 on real Pi must pass before `src/` work** (see checklist).

## Progress (2026-06-17)

| Done | Pending |
|------|---------|
| Pi OS Desktop, X11/Openbox, SSH | Stremio login + addons + gamepad |
| Kodi + YouTube addon + InputStream | Kodi YouTube playback sign-off |
| 8BitDo Micro — D-pad / B / Y in Kodi | 30 min stability sign-off |
| Kodi JSON-RPC (`mango` @ :8080) | Phase 1 launcher (`src/`) |
| `map-pro-controller.sh` preset `mango-tv` | |

Pi: `aman@mango.local` · `10.0.0.174`

## Docs

| Doc | Use |
|-----|-----|
| [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md) | **Current next steps** |
| [`docs/phase0-checklist.md`](docs/phase0-checklist.md) | On-Pi bring-up checklist |
| [`docs/kodi-youtube-setup.md`](docs/kodi-youtube-setup.md) | YouTube addon + InputStream |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | 8BitDo Micro layout |
| [`docs/PLAN.md`](docs/PLAN.md) | Implementation phases |
| [`docs/DESIGN.md`](docs/DESIGN.md) | V1 scope, architecture |

## Stack

- Pi 5 8GB · Pi OS Desktop · **X11 + Openbox** (not Wayland)
- Stremio: fragarray ARM64 `.deb` · YouTube: Kodi + `plugin.video.youtube`
- Python orchestrator · Node stremio-service · Vite + vanilla TS (launcher, overlay, companion)
- Phone PTT over **HTTPS** (mkcert) · 8BitDo Micro = TV nav (input-remapper)

## Rules

- Never commit secrets (`/etc/mango/`, `*.key`, `.env`, Kodi RPC password)
- Voice Stremio play → `stremio://` deep link, not orphan MPV
- Stretch features only after V1 Core success criteria pass
