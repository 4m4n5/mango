# Getting started

**Agents:** read [`PHASE0.md`](PHASE0.md) first — canonical runbook for the live Pi.

| Doc | When |
|-----|------|
| [**PHASE0.md**](PHASE0.md) | Daily ops, gamepad layout, Kodi vs Stremio, troubleshooting |
| [HARDWARE.md](HARDWARE.md) | 8BitDo Micro face-button diagram |
| [phase0-checklist.md](phase0-checklist.md) | Sign-off checklist |
| [kodi-youtube-setup.md](kodi-youtube-setup.md) | YouTube API keys + addon install |
| [PLAN.md](PLAN.md) | Phase 1+ roadmap |

## Quick start (Pi already set up)

```bash
cd ~/mango && git pull
bash scripts/phase0/tv.sh kodi
bash scripts/phase0/tv.sh stremio
```

## First flash (new SD)

1. Imager → Pi 5 → Pi OS Desktop 64-bit → hostname `mango`, user `aman`, SSH on.
2. `ssh aman@mango.local` · `git clone https://github.com/4m4n5/mango.git`
3. Follow [PHASE0.md § First-time Pi](PHASE0.md#first-time-pi-reference).
