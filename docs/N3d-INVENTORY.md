# N3d inventory — self-hosted addon stack

**Branch:** `feat/native-experience`
**Status:** S6 pre-couch integration scaffolded
**Gate:** `bash scripts/phase-n3d/gate-n3d-self-hosted.sh`

---

## Port Layout

| Service | Host URL | Container | Role |
|---------|----------|-----------|------|
| AIOStreams | `http://127.0.0.1:3035` | `mango-aiostreams:3000` | Primary stream aggregator |
| AIOLists | `http://127.0.0.1:3036` | `mango-aiolists:7000` | mdblist catalog adapter |
| catalog-service | `http://127.0.0.1:3020` | host Node | Stremio addon graph + rails |
| launcher | `http://127.0.0.1:3000` | Chromium kiosk | TV home |

## Addon Name Contract

| Old name | N3d name | Notes |
|----------|----------|-------|
| `AIOStreams | ElfHosted` | `AIOStreams` | Local manifest copied from AIOStreams configure UI |
| `AIOMetadata  | ElfHosted` | `AIOLists` | mdblist rails after operator mapping |
| IndiaStreams custom catalogs | `India OTT` | India trending source, with mdblist fallback |

## Paths

| Path | Owner | Secret? |
|------|-------|---------|
| `deploy/aiostreams/.env.example` | repo template | no |
| `deploy/aiostreams/.env` | Pi operator | yes, ignored |
| `~/.local/share/mango/aiostreams/data` | AIOStreams SQLite/config | yes-adjacent |
| `/etc/mango/config.yaml` | operator secrets | yes |
| `/etc/mango/stremio-export.json` | local manifest URLs | yes-adjacent |
| `~/.config/systemd/user/mango-aiostreams.service` | Pi user unit | no |
| `~/.config/systemd/user/mango-aiolists.service` | Pi user unit | no |
| `scripts/diag/poll-maintenance.py` | maintenance progress poller | no |

## Operator Actions Still Required

- Copy `deploy/aiostreams/.env.example` to `deploy/aiostreams/.env` on the Pi and set `SECRET_KEY`.
- Run `bash scripts/phase-n3d/install-aiostreams.sh`.
- Or enable boot startup with `bash scripts/phase-n3d/enable-aiostreams-service.sh`.
- Open `http://127.0.0.1:3035/stremio/configure`, add TorBox, Real-Debrid, Easynews Search, and Torrentio TB/RD.
- Copy the generated AIOStreams manifest URL into `/etc/mango/stremio-export.json` with `"name": "AIOStreams"`.
- Run `bash scripts/phase-n3d/install-aiolists.sh`, configure mdblist imports, and copy its manifest URL as `"name": "AIOLists"`.
- Or enable boot startup with `bash scripts/phase-n3d/enable-aiolists-service.sh`.
- Add `MANGO_CATALOG=1` and `MANGO_SELF_HOSTED_ADDONS=1` to `~/.config/mango/voice.env`.

## S2 Stream Gate

```bash
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/gate-n3d-streams.sh
```

`gate-n3d-streams.sh` fails if `AIOStreams` is absent from stream sources, if any
stream source still contains `ElfHosted`, or if any stream URL contains the public
rate-limit placeholder.

## S3 Catalog Gate

```bash
bash scripts/phase-n3d/gate-n3d-catalogs.sh
```

`gate-n3d-catalogs.sh` fails if mdblist rail sources still use `AIOMetadata` or
`ElfHosted`, if AIOLists is down, or if mdblist/India rails return zero items.

## S4 Catalog Sync

```bash
sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml
cd src/launcher && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n2/gate-n2-browse.sh
```

The repo yaml has no `AIOMetadata` or `ElfHosted` addon references. India catalog
ids still require operator verification against the selected `India OTT` manifest.

## S5 Maintenance Validation

```bash
bash scripts/phase-n3c/playability-maintenance.sh --mode stale
MANGO_POLL_MAX=1 python3 scripts/diag/poll-maintenance.py
pgrep -af 'mpv-probe-ipc.sh|playability-indexer.ts' || true
```

Pass criteria:

| Check | Pass |
|-------|------|
| maintenance JSON | includes `duration_ms` |
| counters | `verified_total` or `failed_total` increases from start |
| probes | no `mpv-probe-ipc.sh` process older than 30 seconds |
| skip behavior | `skipped_recent_failed` is not 100% of candidates |

Current Pi evidence: pending. If this remains pending at handoff, complete
AIOStreams/AIOLists configure UI, restart `MANGO_CATALOG=1`, then run the stale
maintenance command above.

## S6 Pre-Couch Gate

Enable on the Pi:

```bash
printf '%s\n' 'export MANGO_SELF_HOSTED_ADDONS=1' >> ~/.config/mango/voice.env
sudo touch /etc/mango/aiostreams.enabled
```

Then run:

```bash
bash scripts/phase-n3d/gate-n3d-self-hosted.sh
bash scripts/pi-pre-couch-gate.sh
```

Current Pi evidence: pending. Expected first blocker is operator completion of
the AIOStreams/AIOLists configure UIs plus `/etc/mango/stremio-export.json`.

## Pi Gate Attempt — 2026-06-19

Command from Mac:

```bash
bash scripts/pi-exec-gate.sh
```

Result: blocked before N3d gates. SSH succeeded, but `git pull --ff-only` on the
Pi aborted because `~/mango` has local modified/untracked files that would be
overwritten by `origin/feat/native-experience`.

Observed blockers included local edits under:

- `config/catalog.example.yaml`
- `scripts/phase-n2/`
- `scripts/phase-n3c/`
- `src/catalog-service/`
- `src/launcher/`
- untracked `scripts/diag/poll-maintenance.py`
- untracked `scripts/phase-n2b/`
- untracked `src/catalog-service/src/playability/composite-merge.*`

Required user action: review, commit, or intentionally stash the Pi-local changes,
then rerun:

```bash
cd ~/mango
git pull --ff-only
cd src/catalog-service && npm run build
cd ../../src/launcher && npm run build
cd ../..
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/gate-n3d-self-hosted.sh
bash scripts/pi-pre-couch-gate.sh
```

Do not use `git reset --hard` unless the Pi-local edits are confirmed disposable.

## Current Blockers (audit 2026-06-19)

| # | Blocker | Action |
|---|---------|--------|
| 1 | **Docker not installed** on Pi | `bash scripts/phase-n3d/bootstrap-docker.sh` (sudo password required) |
| 2 | **stremio-export.json** still ElfHosted | Configure local AIOStreams → copy manifest; add AIOLists + India OTT |
| 3 | **deploy/aiostreams/.env** missing | `cp deploy/aiostreams/.env.example deploy/aiostreams/.env` + `openssl rand -hex 32` |
| 4 | **Operator configure UIs** not done | AIOStreams TB/RD/Easynews; AIOLists mdblists per `map-mdblist-catalogs.md` |
| 5 | **playability.db stale** | 11 verified / 5 old rails — re-run maintenance after stream plane healthy |
| 6 | **MANGO_SELF_HOSTED_ADDONS** unset | `export MANGO_SELF_HOSTED_ADDONS=1` in voice.env |

Run anytime: `bash scripts/phase-n3d/diag-self-hosted.sh`

Pi repo synced to `550a05c` via `git reset --hard origin/feat/native-experience` (tar-deploy state discarded).
