# Scripts

**Ops runbook:** [docs/PHASE0.md](../docs/PHASE0.md) · **Native roadmap:** [docs/NATIVE_ROADMAP.md](../docs/NATIVE_ROADMAP.md)

---

## Daily stack (native)

| Script | When |
|--------|------|
| **`pi-deploy.sh`** | **Mac → Pi** git pull, build, restart — **`--fast`** for iteration (default), **`--full`** when lockfiles change — [DEPLOY.md](../docs/DEPLOY.md) |
| **`pi-exec-gate.sh`** | Mac: pull + pre-couch gate on Pi |
| **`mango-stack.sh`** `start\|stop\|status\|restart` | Primary — launcher + voice + catalog (N1: `MANGO_CATALOG=1`) |
| **`phase1/bootstrap-after-reboot.sh`** | After Pi reboot |
| **`phase1/restart-mango-ui.sh`** | UI-only restart |

**Gates** (lean — no nested regression chains):

```bash
bash scripts/pi-pre-couch-gate.sh          # N0 + sampled N3c (2 plays/rail)
MANGO_GATE_FULL=1 bash scripts/phase-n3c/gate-n3c-verified-rails.sh  # all served items
bash scripts/phase-n0/gate-n0.sh           # stack hygiene only
bash scripts/phase-n1/gate-n1-smoke.sh     # catalog API (+ MANGO_GATE_SPIKES=1 for spikes)
bash scripts/phase-n2/gate-n2-browse.sh    # rails browse only
```

Shared helpers: `lib/gate-common.sh`

---

## Native N1 (catalog + mpv)

| Script | Role |
|--------|------|
| `phase-n1/install-n1-prereqs.sh` | mpv, socat, node 20 |
| `phase-n1/check-n1-prereqs.sh` | Prereq gate |
| `phase-n1/setup-stremio-export.sh` | Normalize `/etc/mango/stremio-export.json` |
| `phase-n1/import-stremio-local.py` | Import addons from desktop Stremio leveldb |
| `phase-n1/spike-mpv-http.sh` | S0 — mpv IPC |
| `phase-n1/spike-stremio-core.sh` | S1 — stremio-core boot |
| `phase-n1/mpv-play.sh` / `mpv-stop.sh` / `mpv-ipc.sh` | mpv helpers |

---

## Launch API (`serve.py`)

| Script | Notes |
|--------|-------|
| `launch-launcher.sh` | Home · debounced 2 s in API |
| `launch-stremio.sh` | **Fallback** — `MANGO_FALLBACK_STREMIO=1` |
| `launch-kodi.sh` | **Legacy** — `MANGO_LEGACY_YOUTUBE=1` |

## `lib/` — TV windows

| Script | Role |
|--------|------|
| `hide-media.sh` | Stack apps below without kill |
| `present-launcher.sh` | Launcher 1920×1080 |
| `present-stremio.sh` | Fullscreen; `--after-back` = no F11 |
| `present-kodi.sh` | Media fullscreen |
| `mango-window.sh` | hide/show launcher z-order |
| `mango-desktop.sh` | lxpanel |
| `mango-cursor.sh` | Hide cursor |

## Gamepad

| Path | Role |
|------|------|
| `phase0/mango-tv-pad.py` | **Pad owner** — launcher · mpv · fallback |
| `phase0/start-mango-tv-pad.sh` | Manual pad start |
| `phase0/tv.sh` | CLI: stremio / kodi (legacy) |

Details: [phase0/README.md](phase0/README.md)

## Voice (Phase 2)

`phase2/start-voice-stack.sh` · `setup-mkcert.sh` · `verify-voice-ready.sh` — [phase2/README.md](phase2/README.md)

## Diagnostics

| Script | Role |
|--------|------|
| `diag/playability-status.py` | Pool depth / verified counts |
| `diag/source-hitrate.py` | Per-catalog candidate probe rates |
| `diag/rail-hitrate.py` | Per-rail verified play samples |
| `diag/alpha-test.sh` | Couch session log on Pi |
| `diag/fetch-session.sh` | Pull session tarball to Mac |
| `phase-n3d/diag-self-hosted.sh` | AIOStreams + AIOMetadata health |
| `verify-tv.sh` | Health gate |

## Playability (N3c)

| Script | Role |
|--------|------|
| `phase-n3c/fill-playability-db.sh` | Full fill orchestration (preflight → maintenance → hit-rate) |
| `phase-n3c/playability-maintenance.sh` | Indexer refresh worker (timer + manual) |
| `phase-n3c/rail-curation.sh` | Manual pins/blocks |
| `phase-n3c/install-playability-timer.sh` | One-time Pi systemd timer setup |

## Mac → Pi

`pi-exec.sh` · `setup-mac-pi-ssh.sh`
