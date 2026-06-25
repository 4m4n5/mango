# Scripts — milestone layout

Canonical paths aligned with [docs/ROADMAP.md](../docs/ROADMAP.md) milestones **M1–M6**.

## Directory map

| Milestone | Path | Purpose |
|-----------|------|---------|
| **M1** Foundation | `m1-foundation/gate/` | Stack hygiene gate |
| | `m1-foundation/pad/` | Gamepad (`mango-tv-pad.py`) |
| | `m1-foundation/ui/` | Launcher Chromium + `serve.py` |
| **M2** Catalog | `m2-catalog/service/` | mpv helpers · catalog smoke |
| | `m2-catalog/browse/` | Browse gate |
| | `m2-catalog/rails/` | Composite rail validation |
| **M3** Play | `m3-play/detail/` | Detail + episode gates |
| | `m3-play/orchestrator/` | Play ladder + couch play |
| | `m3-play/playability/` | Verified pools · strict grow · theme gate · retheme |
| **M4** Addons | `m4-addons/` | AIOStreams · AIOMetadata |
| **M5** Voice + AI | `m5-voice/stack/` | Orchestrator · companion |
| | `m5-voice/ai/` | Voice tools · AI catalog gates · M5.5 companion UX (planned) |
| **Live** (opt-in) | `live/` | NexoTV IPTV |

## Gates (default deploy)

```bash
bash scripts/gate-lite.sh
bash scripts/pi-pre-couch-gate.sh
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh  # 3 plays/rail
```

| Step | Script |
|------|--------|
| M1 | `m1-foundation/gate/gate-m1.sh` |
| M4 (self-hosted) | `m4-addons/gate-m4-*.sh` |
| M2 | `m2-catalog/browse/gate-m2-browse.sh` |
| M3 | `m3-play/detail/gate-m3-detail.sh`, `gate-m3-episodes.sh` |
| M5 | `m5-voice/ai/gate-m5-ai-catalogs.sh`, `gate-m5-voice.sh` (if voice) |

Full gate play sample: `gate-m3-verified-rails.sh` (3/rail) · `gate-m3-play.sh` · grow regression: `m3-play/playability/gate-m3-library-grow.sh` · ops: [docs/PLAYABILITY.md](../docs/PLAYABILITY.md)

## M6 ship polish (planned)

| Step | Script |
|------|--------|
| M6.5 TV UX | `m6-ship/gate-m6-ux-smoke.sh` (planned) |

## Daily stack

```bash
bash scripts/mango-stack.sh restart
bash scripts/m1-foundation/ui/bootstrap-after-reboot.sh
```

Path helpers: `scripts/lib/milestone-paths.sh`
