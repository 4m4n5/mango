# Self-hosted addon stack (operator)

**Milestone:** M4 · **Gate:** `bash scripts/m4-addons/gate-m4-self-hosted.sh`

## Port layout

| Service | URL | Role |
|---------|-----|------|
| AIOStreams | `http://127.0.0.1:3035` | Intended sole stream-capable VOD aggregate: nested Torrentio/Comet/MediaFusion plus TorBox/RD and conditional Easynews service policy |
| AIOMetadata | `http://127.0.0.1:3036` | MDBList plus YAML-referenced IndiaStreams custom catalogs (`mdblist.*`, `custom.in_rdata_indiastreams.movie.recmov`, `custom.in_rdata_indiastreams.movie.popmov`, `custom.in_rdata_indiastreams.series.trendingtv`) when present in the operator export |
| catalog-service | `http://127.0.0.1:3020` | Stremio addon graph, rails, playability |
| launcher | `http://127.0.0.1:3000` | TV home (Chromium kiosk) |

## Addon name contract (`/etc/mango/stremio-export.json`)

| Export name | Notes |
|-------------|-------|
| `Cinemeta` | Meta + chart catalogs |
| `AIOStreams` | Local manifest from configure UI |
| `AIOMetadata` | Self-hosted on `:3036` — **not** ElfHosted, **not** legacy AIOLists |
| `Bharat Binge` | Regional catalog source; deploy helper ensures its repository URL is present |
| `mango Live *` | Optional NexoTV Live manifests only; not VOD stream peers |

The normal full manifest graph includes Cinemeta, AIOStreams, AIOMetadata, and
Bharat Binge, plus optional Live manifests when enabled. Only AIOStreams should
advertise the VOD stream path.

Catalog-service still contains an optional Pi-local direct MediaFusion
thin-pool supplement outside this exported graph. It is a documented hardening
gap, not proof that MediaFusion is an ordinary peer addon; see
[`aiostreams-profile.md`](aiostreams-profile.md).



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
3. `bash scripts/m4-addons/install-aiostreams.sh` + configure UI (TB/RD/Easynews; Torrentio + Comet), then credential-safe `aiostreams-config.sh enable-mediafusion`
4. `bash scripts/m4-addons/install-aiometadata.sh`, then human Configure UI;
   current headless `aiometadata-config.sh import` is blocked for agents because
   it leaves/prints a secret-bearing fixed `/tmp` response
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

**Stream corpus** (`stream-gate-fixtures.json`): Shawshank, Breaking Bad, and
SpongeBob (required); RRR, Panchayat, and IGL (soft); Dhurandhar (optional).

**Catalog rails:** required movie/series anchors must have items; optional rails may warn when pool empty.

## Rails (discover)

- **Movies:** global popular, indian cinema, classics, quick-watches, comedy, documentaries
- **Series:** global popular, india picks, classics, miniseries, reality TV, comedy
- **Session dedup:** verified rail sessions from `playability.db` — see `session-select.ts`
- **Library grow:** every active rail targets fresh `+20` new-to-rail verified titles; benchmark override is `MANGO_GROW_PER_PASS=5`
- **Curation:** `bash scripts/m3-play/playability/rail-curation.sh` for pins (e.g. India's Got Latent on `series-comedy`)

## Maintenance

```bash
bash scripts/m3-play/playability/playability-maintenance.sh --mode stale
python3 scripts/diag/playability-status.py
MANGO_RAIL_HITRATE_PER_RAIL=2 python3 scripts/diag/rail-hitrate.py   # after fill
```

## Pi deploy

Git only — never rsync. See [`OPERATIONS.md`](../OPERATIONS.md).

```bash
# Mac preflight (after commit + push)
git fetch origin main
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

The current deploy wrapper is blocked for unattended agents because it does not
enforce/pin that revision and can implicitly mutate AIOMetadata state. Follow
the reviewed exception/manual path in `OPERATIONS.md` until the helper is hardened.

Git deployment does **not** overwrite the Pi-owned AIOStreams `userData`.
The AIO helper now uses private temporary files, fixed redacted output,
post-write readback, and automatic rollback. `get` remains secret-bearing and
must not be logged. AIOMetadata mutation remains independently blocked.

```bash
bash scripts/m4-addons/aiostreams-config.sh set-tvdb-key
bash scripts/m4-addons/aiostreams-config.sh verify
```

The pre-repair snapshot had Torrentio and Comet active, RD/TorBox/Easynews
configured, and an expired MediaFusion share-manifest override returning 404.
Reverify the transactional native-base integration rather than treating that
dated state as permanent.

## Known gaps

| Item | Status |
|------|--------|
| Sustained full grow proof | Re-run monitored `+20` grow after source changes; short rails need source-grow audit evidence |
| India-series source yield | Current hardest source-quality area; many catalog rows are no-stream, duplicate, unresolved, or off-theme |
| Bharat Binge | Latest recorded manifest returned HTTP 403; URL presence from deploy is not catalog-health proof |
| AIO runtime drift/contribution | Prove target policy and credential-safe nested indexer/transport counters separately from Git |
| MediaFusion | Native AIO base integration; cached-search-only movie/series through TorBox/RD; prove causal contribution separately from policy presence |
