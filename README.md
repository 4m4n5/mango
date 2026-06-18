# mango

AI + streaming TV box for **Raspberry Pi 5** — Stremio, YouTube (Kodi), voice from your phone.

## Status

**Phase 0 complete on Pi** — Kodi + YouTube + Stremio + 8BitDo gamepad verified. Next: stability sign-off → Phase 1 launcher.

**Runbook:** [`docs/PHASE0.md`](docs/PHASE0.md) · **Agents:** [`AGENTS.md`](AGENTS.md)

## Daily (on Pi)

```bash
cd ~/mango && git pull
bash scripts/phase0/tv.sh kodi
bash scripts/phase0/tv.sh stremio
```

## Docs

| Doc | Purpose |
|-----|---------|
| [`docs/PHASE0.md`](docs/PHASE0.md) | **Pi runbook** — gamepad, apps, troubleshooting |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | 8BitDo layout |
| [`scripts/phase0/README.md`](scripts/phase0/README.md) | Script index |
| [`docs/PLAN.md`](docs/PLAN.md) | Phases 1–5 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | V1 architecture |

## Layout

```
docs/             PHASE0.md, HARDWARE, plan, design
scripts/phase0/   tv.sh, launch-*, gamepad, YouTube, Stremio
src/              Phase 1+ application code
config/           example config → /etc/mango/ on Pi
```
