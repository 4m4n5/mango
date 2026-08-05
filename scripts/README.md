# Scripts

**Layout:** [MILESTONES.md](MILESTONES.md) · **Ops:** [docs/OPS.md](../docs/OPS.md) · **Plan:** [docs/ROADMAP.md](../docs/ROADMAP.md)

Scripts are organized by **milestone** (M1–M6). Legacy `phase-*` trees were removed in the milestone rename (`852ba05`) — use paths in [MILESTONES.md](MILESTONES.md) only.

---

## Daily stack

| Script | When |
|--------|------|
| **`pi-deploy.sh`** | Mac → Pi pull/build/restart; **currently blocked for unattended agents** because branch selection is not enforced/pinned and deploy may mutate AIOMetadata private state—see `docs/DEPLOY.md` |
| **`pi-exec-gate.sh`** | Mac pull + gate-lite; **currently blocked for unattended agents** because it derives and pulls an unpinned branch |
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
| M6.2 | `m6-ship/gate-m6-youtube-smoke.sh` — base YouTube API/launcher smoke; playback only with `MANGO_YOUTUBE_PLAY=1` and not proof that YouTube v2 is promoted |
| M6.5 | `m6-ship/gate-m6-ux-smoke.sh` — launcher focus/HUD DOM+CSS contracts; in pre-couch on `feat/native-experience` |
| M6 hardening | `m6-ship/gate-m6-reliability-proof.sh` — run after deploy; fails red, warns yellow |
| M6 playback SSOT | `m6-ship/gate-m6-playback-ssot.sh` — mpv-only, 1080p browse invariant; in pre-couch on `feat/native-experience` |
| M6 controller | `m6-ship/gate-m6-controller-reconnect.sh` — installed BlueZ/pad ownership and no-pairing policy; five physical wake cycles remain couch proof |
| M6 Streams | `m6-ship/gate-m6-stream-picker-source.sh`, `gate-m6-stream-picker-smoke.sh` — source invariants plus URL-free/revisioned Pi state |
| M6 display/profile readiness | `m6-ship/gate-m6-4k-hdr-profile.sh` — mpv-hifi policy, modes/EDID and resources; not native-HDR playback proof |
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
m6-ship/         library/YouTube/Search/UX/reliability/playback/controller gates · HUD fixtures · backup
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

`m1-foundation/pad/mango-tv-pad.py` — sole pad owner for launcher and mpv.
`input-remapper` remains recovery-only if the router cannot grab the device.

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
| `m6-ship/gate-m6-ux-smoke.sh` | M6.5 UX contracts — focus CSS, HUD safe-area, detail FocusGrid bundle, pad alive |
| `m6-ship/reliability-proof.sh` | Record one Reliability Center proof through catalog-service |
| `m6-ship/gate-m6-reliability-proof.sh` | Pi gate for Green/Yellow/Red couch readiness |
| `m6-ship/gate-m6-playback-ssot.sh` | mpv-only + idle 1080p browse enforcement |
| `m6-ship/gate-m6-controller-reconnect.sh` | Controller link/pad ownership and installed no-pairing reconnect policy |
| `m6-ship/gate-m6-stream-picker-source.sh` | Local source/fixture invariants for the Lua HUD/Streams drawer |
| `m6-ship/gate-m6-stream-picker-smoke.sh` | Pi active-stream API, URL-free snapshot, policy and pad wiring |
| `m6-ship/render-mpv-hud-fixtures.sh` | Render production Lua/libass HUD/drawer states through real mpv |
| `m6-ship/gate-m6-4k-hdr-profile.sh` | mpv-hifi policy, display modes/EDID and resources; target-TV playback remains separate |
| `m6-ship/backup-library-state.sh` | Prefers SQLite online backup for `progress.db`/`library.db`, but currently falls back to a plain file copy on database error; do not use it as fail-closed WAL-safe migration proof until that fallback is removed/tested |
| `m3-play/playability/playability-grow-monitor.sh` | Wrapper for grow_monitor.py |
| `m3-play/playability/monitor-grow-poll.sh` | Mac-side Pi polling log for long grow runs |
| `m3-play/playability/rail-pool-retheme.sh` | Thematic pool prune/relocate (manual) |
| `m3-play/playability/rail-curation.sh` | Pins / blocks |

Production grow target is `+20` fresh verified titles per active rail. Benchmark runs use `MANGO_GROW_PER_PASS=5`; see [docs/PLAYABILITY.md](../docs/PLAYABILITY.md).

Household VOD and YouTube recommendation-v2 source contracts live primarily in
the full catalog-service suite (`cd src/catalog-service && npm test`) and
runtime diagnostics. The faster `npm run test:gate` subset does not cover every
Story Graph, content-profile, frontier, calibration, or TMDB-metadata contract.
A green source gate does not promote `shadow`/`off` modes; record the deployed
SHA, rollout flags, generation health, and couch result separately as defined
in [docs/STATUS.md](../docs/STATUS.md).

## Live diagnostics

```bash
bash scripts/live/live-diagnostics.sh
bash scripts/live/gate-live-diagnostics.sh
```

These read catalog `/health` only. They do not probe `/stream`, rebuild Live
rails, or reshuffle couch state.

## Mac → Pi

`pi-exec.sh` · `setup-mac-pi-ssh.sh`
