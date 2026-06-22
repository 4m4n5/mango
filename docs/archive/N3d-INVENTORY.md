# N3d inventory — self-hosted addon stack

**Branch:** `feat/native-experience`  
**Status:** shipped on Pi — PRE-COUCH PASS  
**Gate:** `bash scripts/phase-n3d/gate-n3d-self-hosted.sh`

---

## Port layout

| Service | URL | Role |
|---------|-----|------|
| AIOStreams | `http://127.0.0.1:3035` | Stream aggregator (TorBox, RD, Torrentio wrap) |
| AIOMetadata | `http://127.0.0.1:3036` | mdblist + regional catalogs (`mdblist.*`, `recmov`, `popmov`, `trendingtv`) |
| catalog-service | `http://127.0.0.1:3020` | Stremio addon graph, rails, playability |
| launcher | `http://127.0.0.1:3000` | TV home (Chromium kiosk) |

## Addon name contract (`/etc/mango/stremio-export.json`)

| Export name | Notes |
|-------------|-------|
| `Cinemeta` | Meta + chart catalogs |
| `AIOStreams` | Local manifest from configure UI |
| `AIOMetadata` | Self-hosted on `:3036` — **not** ElfHosted, **not** legacy AIOLists |

**V1 export:** Cinemeta + AIOStreams + AIOMetadata only.



## Key paths

| Path | Purpose |
|------|---------|
| `deploy/aiostreams/.env` | AIOStreams secrets (Pi operator) |
| `~/.config/mango/aiometadata-import.json` | Configure export for mango-mode import |
| `config/aiometadata-rail-catalogs.json` | mdblist id index for import + hit-rate probes |
| `config/catalog.example.yaml` | Canonical rails (copy to `/etc/mango/catalog.yaml`) |
| `config/catalog-gate-rails.json` | Required/optional rails for `gate-n3d-catalogs.sh` |
| `config/stream-gate-fixtures.json` | Tiered stream evaluation corpus |
| `config/rail-curation-overrides.example.yaml` | Pins/blocks (Pi: `/etc/mango/rail-curation-overrides.yaml`) |
| `/etc/mango/playability.db` | Verified pools + tab session rows |

## Operator setup (one-time)

1. `bash scripts/phase-n3d/bootstrap-docker.sh` (if Docker missing)
2. `cp deploy/aiostreams/.env.example deploy/aiostreams/.env` + `SECRET_KEY`
3. `bash scripts/phase-n3d/install-aiostreams.sh` + configure UI (TB/RD/Easynews/Torrentio)
4. `bash scripts/phase-n3d/install-aiometadata.sh` + `bash scripts/phase-n3d/aiometadata-config.sh import`
5. Wire manifests into `/etc/mango/stremio-export.json`
6. `export MANGO_CATALOG=1 MANGO_SELF_HOSTED_ADDONS=1` in `~/.config/mango/voice.env`
7. `bash scripts/phase-n3c/fill-playability-db.sh` — sync catalog + populate pools

Docs: [`configure-aiostreams.md`](../scripts/phase-n3d/configure-aiostreams.md) · [`configure-aiometadata.md`](../scripts/phase-n3d/configure-aiometadata.md) · [`map-mdblist-catalogs.md`](../scripts/phase-n3d/map-mdblist-catalogs.md) · [`catalog-rail-curation.md`](../config/catalog-rail-curation.md)

## Gates

```bash
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/gate-n3d-streams.sh
bash scripts/phase-n3d/gate-n3d-stream-language.sh
bash scripts/phase-n3d/gate-n3d-catalogs.sh
bash scripts/phase-n3d/gate-n3d-self-hosted.sh   # when MANGO_SELF_HOSTED_ADDONS=1
bash scripts/pi-pre-couch-gate.sh
```

**Stream corpus** (`stream-gate-fixtures.json`): Shawshank + Breaking Bad (required); RRR, Panchayat, IGL (soft); SpongeBob, Dhurandhar (optional).

**Catalog rails:** required movie/series anchors must have items; optional rails may warn when pool empty.

## Rails v2.2 (discover)

- **Movies:** global popular, **indian cinema** (`recmov`+`popmov`), classics, quick-watches, comedy, documentaries
- **Series:** global popular, **india picks** (`trendingtv`+Cinemeta), classics, miniseries, light & casual, comedy
- **Session dedup:** two-phase reserve (floor 8) + anchor-first top-up — see `session-select.ts`
- **Curation:** `bash scripts/phase-n3c/rail-curation.sh` for pins (e.g. India's Got Latent on `series-comedy`)

## Maintenance

```bash
bash scripts/phase-n3c/playability-maintenance.sh --mode stale
python3 scripts/diag/playability-status.py
MANGO_RAIL_HITRATE_PER_RAIL=2 python3 scripts/diag/rail-hitrate.py   # after fill
```

## Pi deploy

Git only — never rsync. See [`DEPLOY.md`](DEPLOY.md).

```bash
# Mac (after commit + push)
bash scripts/pi-deploy.sh --gate
```

## Known gaps

| Item | Status |
|------|--------|
| `series-reality-casual` session rows | Optional rail — may show 0 items when Cinemeta pools overlap tab dedup |
| AIOStreams `groups` | Operator S9 — configure UI if stream picker grouping needed |
| **N3a** stream play orchestrator | Next product phase — launcher → mpv foreground |
