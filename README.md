# ai-tv-box

AI + normal streaming box for Raspberry Pi 5 — Stremio, YouTube (Kodi), voice control from your phone.

**Start here:** [`docs/DESIGN.md`](docs/DESIGN.md) — V1 build spec (scope, architecture, phases, success criteria)

## Stack

- Pi 5 8GB · Pi OS desktop · X11 + Openbox
- Stremio desktop + Kodi YouTube · phone companion PWA · hybrid cloud LLM
- Phone = mic + remote · FLIRC/gamepad = TV navigation

## Layout

```
src/orchestrator/   src/launcher/   src/overlay/   src/companion/
src/stremio-service/   src/adapters/   scripts/   config/
```
