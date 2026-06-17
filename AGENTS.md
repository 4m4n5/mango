# ai-tv-box — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md)

Read before implementing. **Phase 0 on real Pi must pass before `src/` work** (see checklist).

## Docs

| Doc | Use |
|-----|-----|
| [`docs/PLAN.md`](docs/PLAN.md) | Implementation phases — **start here** |
| [`docs/DESIGN.md`](docs/DESIGN.md) | V1 scope, architecture, success criteria |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked choices (LLM, Stremio .deb, mkcert, Vite, X11) |
| [`docs/phase0-checklist.md`](docs/phase0-checklist.md) | On-Pi bring-up before coding |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Gamepad + phone setup |

## Stack

- Pi 5 8GB · Pi OS Desktop · **X11 + Openbox** (not Wayland)
- Stremio: fragarray ARM64 `.deb` · YouTube: Kodi + addon
- Python orchestrator · Node stremio-service · Vite + vanilla TS (launcher, overlay, companion)
- Phone PTT over **HTTPS** (mkcert) · gamepad = TV nav

## Rules

- Never commit secrets (`/etc/ai-tv-box/`, `*.key`, `.env`)
- Voice Stremio play → `stremio://` deep link, not orphan MPV
- Stretch features only after V1 Core success criteria pass
