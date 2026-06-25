# Self-hosted addon stack (operator)

**Milestone:** M4 · **Gate:** `bash scripts/m4-addons/gate-m4-self-hosted.sh`

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
| `config/catalog-gate-rails.json` | Required/optional rails for `gate-m4-catalogs.sh` |
| `config/stream-gate-fixtures.json` | Tiered stream evaluation corpus |
| `config/rail-curation-overrides.example.yaml` | Pins/blocks (Pi: `/etc/mango/rail-curation-overrides.yaml`) |
| `/etc/mango/playability.db` | Verified pools + tab session rows |

## Operator setup (one-time)

1. `bash scripts/m4-addons/bootstrap-docker.sh` (if Docker missing)
2. `cp deploy/aiostreams/.env.example deploy/aiostreams/.env` + `SECRET_KEY`
3. `bash scripts/m4-addons/install-aiostreams.sh` + configure UI (TB/RD/Easynews/Torrentio)
4. `bash scripts/m4-addons/install-aiometadata.sh` + `bash scripts/m4-addons/aiometadata-config.sh import`
5. Wire manifests into `/etc/mango/stremio-export.json`
6. `export MANGO_CATALOG=1 MANGO_SELF_HOSTED_ADDONS=1` in `~/.config/mango/voice.env`
7. `bash scripts/m3-play/playability/fill-playability-db.sh` — sync catalog + populate pools

Docs: [`configure-aiostreams.md`](../../scripts/m4-addons/configure-aiostreams.md) · [`configure-aiometadata.md`](../../scripts/m4-addons/configure-aiometadata.md) · [`map-mdblist-catalogs.md`](../../scripts/m4-addons/map-mdblist-catalogs.md) · [`catalog-rail-curation.md`](../../config/catalog-rail-curation.md)

## Gates

```bash
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/m4-addons/gate-m4-streams.sh
bash scripts/m4-addons/gate-m4-stream-language.sh
bash scripts/m4-addons/gate-m4-catalogs.sh
bash scripts/m4-addons/gate-m4-self-hosted.sh   # when MANGO_SELF_HOSTED_ADDONS=1
bash scripts/pi-pre-couch-gate.sh
```

**Stream corpus** (`stream-gate-fixtures.json`): Shawshank + Breaking Bad (required); RRR, Panchayat, IGL (soft); SpongeBob, Dhurandhar (optional).

**Catalog rails:** required movie/series anchors must have items; optional rails may warn when pool empty.

## Rails (discover)

- **Movies:** global popular, indian cinema, classics, quick-watches, comedy, documentaries
- **Series:** global popular, india picks, classics, miniseries, reality TV, comedy
- **Session dedup:** verified rail sessions from `playability.db` — see `session-select.ts`
- **Strict grow:** every active rail targets fresh `+20` new-to-rail verified titles; benchmark override is `MANGO_GROW_PER_PASS=5`
- **Curation:** `bash scripts/m3-play/playability/rail-curation.sh` for pins (e.g. India's Got Latent on `series-comedy`)

## Maintenance

```bash
bash scripts/m3-play/playability/playability-maintenance.sh --mode stale
python3 scripts/diag/playability-status.py
MANGO_RAIL_HITRATE_PER_RAIL=2 python3 scripts/diag/rail-hitrate.py   # after fill
```

## Pi deploy

Git only — never rsync. See [`DEPLOY.md`](../DEPLOY.md).

```bash
# Mac (after commit + push)
bash scripts/pi-deploy.sh --gate
```

## Known gaps

| Item | Status |
|------|--------|
| Sustained full grow proof | Re-run monitored `+20` grow after source changes; short rails need source-grow audit evidence |
| India-series source yield | Current hardest source-quality area; many catalog rows are no-stream, duplicate, unresolved, or off-theme |
| AIOStreams `groups` | Operator S9 — configure UI if stream picker grouping needed |
