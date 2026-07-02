# Scripts

**Layout:** [MILESTONES.md](MILESTONES.md) · **Ops:** [docs/OPS.md](../docs/OPS.md) · **Plan:** [docs/ROADMAP.md](../docs/ROADMAP.md)

Scripts are organized by **milestone** (M1–M6). Legacy `phase-*` trees were removed in the milestone rename (`852ba05`) — use paths in [MILESTONES.md](MILESTONES.md) only.

---

## Daily stack

| Script | When |
|--------|------|
| **`pi-deploy.sh`** | Mac → Pi: git pull, build, restart (`--fast` / `--full` / `--gate`) |
| **`pi-exec-gate.sh`** | Mac: pull + gate-lite on Pi |
| **`mango-stack.sh`** | `start\|stop\|status\|restart\|refresh` — launcher + catalog + voice |
| **`m1-foundation/ui/bootstrap-after-reboot.sh`** | After Pi reboot |
| **`m1-foundation/ui/restart-mango-ui.sh`** | UI-only restart |

---

## Gates

```bash
bash scripts/pi-pre-couch-gate.sh          # default (~1–2 min)
bash scripts/gate-lite.sh                  # same, on Pi
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh  # ~5–8 min, 3 plays/rail
bash scripts/m1-foundation/gate/gate-m1.sh # stack hygiene only
```

| Milestone | Script |
|-----------|--------|
| M1 | `m1-foundation/gate/gate-m1.sh` |
| M2 | `m2-catalog/browse/gate-m2-browse.sh` |
| M2 smoke | `m2-catalog/service/gate-m2-smoke.sh` |
| M3 | `m3-play/detail/gate-m3-detail.sh`, `gate-m3-episodes.sh` |
| M3 full | `m3-play/playability/gate-m3-verified-rails.sh`, `m3-play/orchestrator/gate-m3-play.sh` |
| M4 | `m4-addons/gate-m4-self-hosted.sh` |
| M5 | `m5-voice/ai/gate-m5-voice.sh`, `gate-m5-ai-catalogs.sh` |
| M6.1 | `m6-ship/gate-m6-library-smoke.sh` |
| M6.2 | `m6-ship/gate-m6-youtube-smoke.sh` — run after YouTube/API/launcher rail changes; playback only with `MANGO_YOUTUBE_PLAY=1` |
| M6 hardening | `m6-ship/gate-m6-reliability-proof.sh` — run after deploy; fails red, warns yellow |
| Live (opt-in) | `live/gate-live-iptv.sh` — `MANGO_LIVE_GATE=1`; `live/gate-live-diagnostics.sh` is health-only |

Shared: `lib/gate-common.sh` · `gate-lite-play.sh` · `gate-lite-unit.sh`

### PR regression gates (Library Grower — not in gate-lite)

Run after grow-rail, compose, monitor, or playability policy changes:

```bash
bash scripts/m3-play/playability/gate-m3-library-grow.sh
```

Legacy per-PR gates (`gate-m3-grow-rail.sh`, `gate-m3-library-grower.sh`, …) forward to the unified gate above.

---

## Milestone directories

```
m1-foundation/   pad (gamepad) · ui (launcher) · gate (M1)
m2-catalog/      service (mpv, catalog API) · browse · rails
m3-play/         detail · orchestrator · playability
m4-addons/       AIOStreams · AIOMetadata · mdblist pipeline
m5-voice/        stack (orchestrator, companion) · ai (voice tools, catalogs)
m6-ship/         Mango library gate/backup · native YouTube smoke · future UX gates
live/            NexoTV IPTV (excluded from gate-lite)
lib/             shared helpers · milestone-paths.sh
diag/            manual diagnostics
```

---

## Launch API (`serve.py`)

| Script | Notes |
|--------|-------|
| `launch-launcher.sh` | Home |

## Gamepad

`m1-foundation/pad/mango-tv-pad.py` — pad owner for launcher · mpv · fallback.

## Voice

`m5-voice/stack/` — mkcert, orchestrator, companion. [docs/VOICE.md](../docs/VOICE.md)

## Playability ops (M3)

| Script | Role |
|--------|------|
| `m3-play/playability/grow-run-control.sh` | Start/status/watch/assess/abort grow runs |
| `m3-play/playability/quick-playability-topup.sh` | ~8 min grow |
| `m3-play/playability/overnight-playability-grow.sh` | ~4 h loop |
| `m3-play/playability/playability-maintenance.sh` | Nightly worker |
| `m3-play/playability/playability-catch-up.sh` | Explicit post-boot/operator catch-up |
| `diag/playability-status.py` | Pool depth (catalog-service must be up) |
| `diag/couch-activity-status.sh` | Idle/defer state for maintenance |
| `diag/grow_monitor.py` | **Grow monitor** — baseline, live status, watch, assess |

## M6 ship ops

| Script | Role |
|--------|------|
| `m6-ship/gate-m6-library-smoke.sh` | Quick Saved/current-context API smoke; included in gate-lite |
| `m6-ship/gate-m6-youtube-smoke.sh` | Native YouTube state/rails/search/detail smoke; `yt-dlp` command check by default, playback only with `MANGO_YOUTUBE_PLAY=1` |
| `m6-ship/reliability-proof.sh` | Record one Reliability Center proof through catalog-service |
| `m6-ship/gate-m6-reliability-proof.sh` | Pi gate for Green/Yellow/Red couch readiness |
| `m6-ship/backup-library-state.sh` | WAL-safe backup of `progress.db` and `library.db`; `mango-stack.sh stop/restart` runs it by default |
| `m3-play/playability/playability-grow-monitor.sh` | Wrapper for grow_monitor.py |
| `m3-play/playability/monitor-grow-poll.sh` | Mac-side Pi polling log for long grow runs |
| `m3-play/playability/rail-pool-retheme.sh` | Thematic pool prune/relocate (manual) |
| `m3-play/playability/rail-curation.sh` | Pins / blocks |

Production grow target is `+20` fresh verified titles per active rail. Benchmark runs use `MANGO_GROW_PER_PASS=5`; see [docs/PLAYABILITY.md](../docs/PLAYABILITY.md).

## Live diagnostics

```bash
bash scripts/live/live-diagnostics.sh
bash scripts/live/gate-live-diagnostics.sh
```

These read catalog `/health` only. They do not probe `/stream`, rebuild Live
rails, or reshuffle couch state.

## Mac → Pi

`pi-exec.sh` · `setup-mac-pi-ssh.sh`
