# ai-tv-box

AI + streaming TV box for **Raspberry Pi 5** — Stremio, YouTube (Kodi), and voice control from your phone.

## Status

**Planning complete · Phase 0 next** — flash Pi, install Kodi + Stremio, map gamepad. No application code yet.

## Docs

| Doc | Purpose |
|-----|---------|
| [`docs/PLAN.md`](docs/PLAN.md) | Implementation phases (**start here**) |
| [`docs/DESIGN.md`](docs/DESIGN.md) | V1 scope & architecture |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked implementation choices |
| [`docs/phase0-checklist.md`](docs/phase0-checklist.md) | On-Pi bring-up checklist |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Hardware & gamepad setup |

Agents: see [`AGENTS.md`](AGENTS.md).

## Stack

- Pi 5 8GB · Pi OS Desktop · X11 + Openbox
- Stremio (fragarray ARM64 `.deb`) + Kodi YouTube
- Phone = mic + remote (HTTPS) · USB gamepad = TV navigation
- Hybrid cloud LLM · local Whisper + Piper on Pi

## Repository layout

```
config/           example config (copy to /etc/ai-tv-box/ on Pi)
docs/             design, plan, checklist
scripts/          install & launch scripts (planned)
src/              application code (planned)
```

## Hardware

Pi 5 8GB CanaKit · 128GB SD · USB gamepad · phone · TV (HDMI). Details in [`docs/HARDWARE.md`](docs/HARDWARE.md).
