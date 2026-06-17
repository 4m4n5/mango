# mango

AI + streaming TV box for **Raspberry Pi 5** — Stremio, YouTube (Kodi), and voice control from your phone.

## Status

**Phase 0 in progress** — Kodi + YouTube + JSON-RPC + gamepad done. **Next:** Stremio + gamepad, sign-off. See [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md).

## Docs

| Doc | Purpose |
|-----|---------|
| [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md) | **Hardware setup** — SD card, Pi assembly, first boot |
| [`docs/phase0-checklist.md`](docs/phase0-checklist.md) | Software checklist after Pi boots |
| [`docs/PLAN.md`](docs/PLAN.md) | Implementation phases |
| [`docs/DESIGN.md`](docs/DESIGN.md) | V1 scope & architecture |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked implementation choices |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Hardware & gamepad setup |

Agents: see [`AGENTS.md`](AGENTS.md).

## Stack

- Pi 5 8GB · Pi OS Desktop · X11 + Openbox
- Stremio (fragarray ARM64 `.deb`) + Kodi YouTube
- Phone = mic + remote (HTTPS) · 8BitDo Micro = TV navigation
- Hybrid cloud LLM · local Whisper + Piper on Pi

## Repository layout

```
config/           example config (copy to /etc/mango/ on Pi)
docs/             design, plan, checklist
scripts/          phase0 install & verify scripts
src/              application code (Phase 1+)
```

## Hardware

- Pi 5 8GB · 128GB SD · **8BitDo Micro** (Bluetooth) · phone · TV (HDMI). Details in [`docs/HARDWARE.md`](docs/HARDWARE.md).
