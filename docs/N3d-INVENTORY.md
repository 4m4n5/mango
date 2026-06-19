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

**N3d V1 export:** Cinemeta, AIOStreams, AIOLists only — no standalone Torrentio (Torrentio lives inside AIOStreams via Service Wrap).

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

Evaluation corpus: `config/stream-gate-fixtures.json` — Shawshank, RRR, Dhurandhar, Panchayat S1E1, India's Got Latent S1E1, SpongeBob S1E1. Series fixtures use episode ids (`tt…:1:1`).

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

The repo yaml has no `AIOMetadata`, `ElfHosted`, or `IndiaStreams` addon references.
India-themed rails (`movies-india-trending`, `series-india-picks`) use AIOLists mdblist
lists plus Cinemeta `year` for freshness.

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

## Pi deploy

Git only — never rsync. See [`DEPLOY.md`](DEPLOY.md).

```bash
# Mac (after commit + push)
bash scripts/pi-deploy.sh --gate
```

Current Pi: **`11b19b8`** · PRE-COUCH PASS (2026-06-19).

---

## Pi Gate history — 2026-06-19 (resolved)

Earlier `pi-exec-gate.sh` failed when Pi had rsync-dirty tree overlapping `origin/feat/native-experience`. **Fix:** commit on Mac, push, `git pull --ff-only` on Pi (or `git reset --hard origin/…` with user approval). Do not rsync to reconcile.

---

## Current Blockers (operator)

| # | Blocker | Action |
|---|---------|--------|
| 1 | **Docker not installed** on Pi | `bash scripts/phase-n3d/bootstrap-docker.sh` (sudo password required) |
| 2 | **stremio-export.json** AIOLists hash | Configure UI → copy manifest; remove IndiaStreams if present |
| 3 | **deploy/aiostreams/.env** missing | `cp deploy/aiostreams/.env.example deploy/aiostreams/.env` + `openssl rand -hex 32` |
| 4 | **Operator configure UIs** not done | AIOStreams TB/RD/Easynews; AIOLists mdblists per `map-mdblist-catalogs.md` |
| 5 | **playability.db sparse on N3d rails** | `bash scripts/phase-n3c/fill-playability-db.sh` (syncs catalog.yaml + full refresh) |
| 6 | **MANGO_SELF_HOSTED_ADDONS** unset | `export MANGO_SELF_HOSTED_ADDONS=1` in voice.env |

Run anytime: `bash scripts/phase-n3d/diag-self-hosted.sh`

---

## S7-S9 stream metadata handoff — 2026-06-19

| Metric | Before | Current |
|--------|--------|---------|
| Shawshank unique `name` / `display_label` | `name`: 1 | `display_label`: 3 (Pi gate) |
| Stream corpus | Shawshank-only | 6 fixtures (movies + India + TV) |
| Catalog-service tests | none | 13 tests (`npm run test`) |
| Pi stream gate | pending | PASS with `display_label` required by default |
| Pi language gate | pending | PASS — hard `language` rejects Klingon (502) |
| AIOStreams `groups` | `null` | **still `null`** — operator S9 in configure UI |
| Pi deploy | — | `bash scripts/pi-deploy.sh` after push — see [`DEPLOY.md`](DEPLOY.md) |

**S7/S8 shipped in catalog-service:**

- `enrichStreamMetadata()` → `stream-formatter.ts` parser → `display_label`, structured fields
- `preferred_language` soft-only; `language` / `hard_language` hard filter
- Title relaxation keeps `hard_language` (Shawshank title-mismatch path)
- Subtitle lines excluded from audio-language parsing

**S9 operator (remaining):**

```bash
# After Groups UI setup in http://127.0.0.1:3035/stremio/configure
bash scripts/phase-n3d/aiostreams-config.sh get \
  | python3 -c "import json,sys; g=json.load(sys.stdin)['data']['userData'].get('groups'); assert g, 'groups still null'"
```

See `scripts/phase-n3d/configure-aiostreams.md` § Groups.

---

## Source expansion (future) — N3d-F7

**Deferred after N3d V1 is stable.** Goal: widen browse and play surfaces without
re-opening ElfHosted.

| Track | Examples | When |
|-------|----------|------|
| Regional catalogs | India OTT Catalog, indiastreams-style scrapers | After AIOLists mdblist rails pass gates on Pi |
| Extra mdblist lists | Import more lists in AIOLists configure UI | Anytime; update `catalog.example.yaml` + mapping doc |
| Stream-only addons | Additional Torrentio profiles, usenet indexers | When playability maintenance needs more candidates |
| Self-hosted metadata | TMDB bearer in AIOLists env | Optional; Cinemeta default is fine for V1 |

**Process:** add addon to `stremio-export.json` → validate catalog ids on Pi
(`curl …/catalog/…`) → add or extend composite rail in `catalog.example.yaml` →
re-run `gate-n3d-catalogs.sh` and playability maintenance.
