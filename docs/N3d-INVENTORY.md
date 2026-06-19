# N3d inventory — self-hosted addon stack

**Branch:** `feat/native-experience`
**Status:** S4 catalog yaml migrated
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

## Current Blockers

- S1-S6 not yet implemented.
- Pi-local operator configuration not yet complete.
